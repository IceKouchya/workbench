const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadData() {
  const context = { window: {}, Promise };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'taobao-flash-sale-ledger-data.js'), 'utf8'), context);
  return context.window.TaobaoFlashSaleLedgerData;
}

function ledgerText(records) {
  const lines = ['# 淘宝闪购软件登录店铺台账', '', '> 固定测试台账。'];
  for (let instance = 1; instance <= 8; instance += 1) {
    lines.push('', '## 淘宝闪购软件 ' + instance + ' 号', '', '| 序号 | 店铺名称 | 店铺 ID | 登录状态 | 备注 |', '| --- | --- | --- | --- | --- |');
    for (let slot = 1; slot <= 5; slot += 1) {
      const record = records && records[instance + '-' + slot] || {};
      lines.push('| ' + slot + ' | ' + (record.name || '') + ' | ' + (record.id || '') + ' | ' + (record.status || '') + ' | ' + (record.note || '') + ' |');
    }
  }
  return lines.join('\n') + '\n';
}

function memoryRoot(files, failPath) {
  function directory(prefix) {
    return {
      queryPermission: () => Promise.resolve('granted'),
      requestPermission: () => Promise.resolve('granted'),
      getDirectoryHandle: (name) => Promise.resolve(directory(prefix ? prefix + '/' + name : name)),
      getFileHandle: (name, options) => {
        const filePath = prefix ? prefix + '/' + name : name;
        if (!files.has(filePath) && !(options && options.create)) return Promise.reject(Object.assign(new Error('not found'), { name: 'NotFoundError' }));
        return Promise.resolve({
          getFile: () => Promise.resolve({ text: () => Promise.resolve(files.get(filePath) || '') }),
          createWritable: () => {
            let pending = '';
            return Promise.resolve({
              write: (text) => { pending = text; return Promise.resolve(); },
              close: () => {
                if (filePath === failPath) return Promise.reject(new Error('simulated write failure'));
                files.set(filePath, pending);
                return Promise.resolve();
              },
              abort: () => Promise.resolve()
            });
          }
        });
      }
    };
  }
  return directory('');
}

const ledgerPath = 'operations/淘宝运营/淘宝闪购软件登录店铺台账.md';
const deletedPath = 'operations/淘宝运营/淘宝闪购软件登录店铺删除记录.md';

test('uses an existing directory grant and rejects a denied permission request', async () => {
  const data = loadData();
  const granted = { queryPermission: () => Promise.resolve('granted') };
  assert.equal(await data.requestPermission(granted, true), granted);
  const denied = { queryPermission: () => Promise.resolve('prompt'), requestPermission: () => Promise.resolve('denied') };
  await assert.rejects(data.requestPermission(denied, false), /未授予/);
});

test('parses exactly eight instances with five slots and preserves empty slots', () => {
  const data = loadData();
  const ledger = data.parseLedger(ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录' } }));
  assert.equal(ledger.instances.length, 8);
  assert.equal(ledger.instances[0].slots.length, 5);
  assert.equal(JSON.stringify(ledger.instances[0].slots[0].record), JSON.stringify({ name: '店铺 A', id: '1001', status: '已登录', note: '' }));
  assert.equal(ledger.instances[7].slots[4].record, null);
  assert.throws(() => data.parseLedger(ledgerText().replace('## 淘宝闪购软件 8 号', '## 淘宝闪购软件 9 号')), /8 个固定软件实例/);
});

test('validates unique numeric store IDs and the two allowed login states', () => {
  const data = loadData();
  const ledger = data.parseLedger(ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录' } }));
  assert.throws(() => data.validateRecord(ledger, { name: '店铺 B', id: 'abc', status: '已登录', note: '' }), /纯数字/);
  assert.throws(() => data.validateRecord(ledger, { name: '店铺 B', id: '1001', status: '已登录', note: '' }), /全局唯一/);
  assert.throws(() => data.validateRecord(ledger, { name: '店铺 B', id: '1002', status: '待登录', note: '' }), /登录状态/);
  assert.doesNotThrow(() => data.validateRecord(ledger, { name: '店铺 A', id: '1001', status: '登录失效', note: '' }, { instance: 1, slot: 1 }));
});

test('rejects saving after an external ledger change', async () => {
  const data = loadData();
  const original = ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录' } });
  const files = new Map([[ledgerPath, original]]);
  const root = memoryRoot(files);
  const snapshot = await data.readLedger(root);
  files.set(ledgerPath, original.replace('店铺 A', '外部修改'));
  await assert.rejects(data.saveRecord(root, snapshot, 1, 1, { name: '店铺 B', id: '1002', status: '已登录', note: '' }), /其他窗口修改/);
  assert.match(files.get(ledgerPath), /外部修改/);
});

test('initializes then appends fixed deletion records', async () => {
  const data = loadData();
  const files = new Map([[ledgerPath, ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录', note: '首条' }, '1-2': { name: '店铺 B', id: '1002', status: '登录失效' } })]]);
  const root = memoryRoot(files);
  let snapshot = await data.readLedger(root);
  await data.deleteRecord(root, snapshot, 1, 1, '2026-08-31 14:30');
  snapshot = await data.readLedger(root);
  await data.deleteRecord(root, snapshot, 1, 2, '2026-08-31 14:31');
  assert.match(files.get(deletedPath), /删除时间 \| 软件实例 \| 槽位 \| 店铺名称 \| 店铺 ID \| 登录状态 \| 备注 \| 恢复状态/);
  assert.match(files.get(deletedPath), /2026-08-31 14:30/);
  assert.match(files.get(deletedPath), /2026-08-31 14:31/);
  assert.equal((files.get(deletedPath).match(/\| 2026-08-31/g) || []).length, 2);
});

test('does not clear a ledger slot when deletion record writing fails', async () => {
  const data = loadData();
  const original = ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录' } });
  const files = new Map([[ledgerPath, original]]);
  const root = memoryRoot(files, deletedPath);
  await assert.rejects(data.deleteRecord(root, await data.readLedger(root), 1, 1, '2026-08-31 14:30'), /simulated write failure/);
  assert.equal(files.get(ledgerPath), original);
});

test('rolls back a deletion record when clearing the ledger slot fails', async () => {
  const data = loadData();
  const original = ledgerText({ '1-1': { name: '店铺 A', id: '1001', status: '已登录' } });
  const files = new Map([[ledgerPath, original]]);
  const root = memoryRoot(files, ledgerPath);
  await assert.rejects(data.deleteRecord(root, await data.readLedger(root), 1, 1, '2026-08-31 14:30'), /simulated write failure/);
  assert.equal(files.get(ledgerPath), original);
  assert.equal(files.get(deletedPath), data.deletedRecordsText([]));
});

test('restores to any empty slot in the original instance and marks the record restored', async () => {
  const data = loadData();
  const deleted = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 1, name: '店铺 A', id: '1001', status: '已登录', note: '', restored: '未恢复' }]);
  const files = new Map([[ledgerPath, ledgerText({ '1-1': { name: '其他店', id: '2001', status: '已登录' } })], [deletedPath, deleted]]);
  const root = memoryRoot(files);
  const sources = await data.readSources(root);
  const result = await data.restoreRecord(root, sources, 0);
  assert.equal(JSON.stringify(result.target), JSON.stringify({ instance: 1, slot: 2 }));
  assert.match(files.get(ledgerPath), /\| 2 \| 店铺 A \| 1001 \| 已登录/);
  assert.match(files.get(deletedPath), /\| 已恢复 \|/);
});

test('rolls back the ledger when marking a restored deletion record fails', async () => {
  const data = loadData();
  const original = ledgerText();
  const deleted = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 1, name: '店铺 A', id: '1001', status: '已登录', note: '', restored: '未恢复' }]);
  const files = new Map([[ledgerPath, original], [deletedPath, deleted]]);
  const root = memoryRoot(files, deletedPath);
  await assert.rejects(data.restoreRecord(root, await data.readSources(root), 0), /simulated write failure/);
  assert.equal(files.get(ledgerPath), original);
  assert.equal(files.get(deletedPath), deleted);
});

test('requires an alternate instance when original instance is full', async () => {
  const data = loadData();
  const records = {};
  for (let slot = 1; slot <= 5; slot += 1) records['1-' + slot] = { name: '店铺 ' + slot, id: String(1000 + slot), status: '已登录' };
  const deleted = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 1, name: '店铺 A', id: '2001', status: '已登录', note: '', restored: '未恢复' }]);
  const files = new Map([[ledgerPath, ledgerText(records)], [deletedPath, deleted]]);
  const root = memoryRoot(files);
  const sources = await data.readSources(root);
  const choice = await data.restoreRecord(root, sources, 0);
  assert.equal(JSON.stringify(choice), JSON.stringify({ requiresChoice: true, choices: [2, 3, 4, 5, 6, 7, 8] }));
  const result = await data.restoreRecord(root, sources, 0, 2);
  assert.equal(JSON.stringify(result.target), JSON.stringify({ instance: 2, slot: 1 }));
});

test('rejects recovery when every instance is full', async () => {
  const data = loadData();
  const records = {};
  for (let instance = 1; instance <= 8; instance += 1) for (let slot = 1; slot <= 5; slot += 1) records[instance + '-' + slot] = { name: '店铺 ' + instance + '-' + slot, id: String(instance * 100 + slot), status: '已登录' };
  const deleted = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 1, name: '店铺 A', id: '9001', status: '已登录', note: '', restored: '未恢复' }]);
  const files = new Map([[ledgerPath, ledgerText(records)], [deletedPath, deleted]]);
  const root = memoryRoot(files);
  await assert.rejects(data.restoreRecord(root, await data.readSources(root), 0), /没有可用于恢复的空槽位/);
});

test('rejects deletion records outside the fixed instance and slot range', () => {
  const data = loadData();
  const invalidInstance = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 9, slot: 1, name: '店铺 A', id: '1001', status: '已登录', note: '', restored: '未恢复' }]);
  const invalidSlot = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 6, name: '店铺 A', id: '1001', status: '已登录', note: '', restored: '未恢复' }]);
  assert.throws(() => data.parseDeletedRecords(invalidInstance), /无效字段/);
  assert.throws(() => data.parseDeletedRecords(invalidSlot), /无效字段/);
});

test('rejects duplicate IDs and records already restored during recovery', async () => {
  const data = loadData();
  const deleted = data.deletedRecordsText([{ deletedAt: '2026-08-31 14:30', instance: 1, slot: 1, name: '店铺 A', id: '1001', status: '已登录', note: '', restored: '未恢复' }]);
  const duplicateFiles = new Map([[ledgerPath, ledgerText({ '2-1': { name: '现有店', id: '1001', status: '已登录' } })], [deletedPath, deleted]]);
  await assert.rejects(data.restoreRecord(memoryRoot(duplicateFiles), await data.readSources(memoryRoot(duplicateFiles)), 0), /全局唯一/);
  const restoredFiles = new Map([[ledgerPath, ledgerText()], [deletedPath, deleted.replace('未恢复', '已恢复')]]);
  const restoredRoot = memoryRoot(restoredFiles);
  await assert.rejects(data.restoreRecord(restoredRoot, await data.readSources(restoredRoot), 0), /已经恢复/);
});
