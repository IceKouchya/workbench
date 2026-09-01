(function () {
  'use strict';

  var DB_NAME = 'workbench-taobao-flash-sale-ledger';
  var STORE = 'handles';
  var HANDLE_KEY = 'business-operations-directory';
  var LEDGER_PATH = ['operations', '淘宝运营', '淘宝闪购软件登录店铺台账.md'];
  var DELETED_PATH = ['operations', '淘宝运营', '淘宝闪购软件登录店铺删除记录.md'];
  var RECORD_COLUMNS = ['删除时间', '软件实例', '槽位', '店铺名称', '店铺 ID', '登录状态', '备注', '恢复状态'];
  var writeQueues = [];

  function hasAccessApi() { return typeof window.showDirectoryPicker === 'function' && typeof window.indexedDB !== 'undefined'; }
  function isMissing(error) { return error && (error.name === 'NotFoundError' || /无法找到|not found/i.test(error.message || '')); }
  function escapeCell(value) { return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, function () { throw new Error('Markdown 表格单元格不能包含换行。'); }); }
  function unescapeCell(value) { return String(value || '').replace(/\\\|/g, '|').replace(/\\\\/g, '\\'); }

  function splitRow(line) {
    var text = String(line).trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    var cells = [], cell = '', escaped = false;
    for (var index = 0; index < text.length; index += 1) {
      var character = text.charAt(index);
      if (escaped) { cell += character; escaped = false; }
      else if (character === '\\') { cell += character; escaped = true; }
      else if (character === '|') { cells.push(cell); cell = ''; }
      else cell += character;
    }
    cells.push(cell);
    return cells;
  }

  function formatSlot(slot, record) {
    var fields = record ? [record.name, record.id, record.status, record.note] : ['', '', '', ''];
    return '| ' + [slot].concat(fields).map(escapeCell).join(' | ') + ' |';
  }

  function validateRecord(ledger, record, target) {
    if (!record || !String(record.name || '').trim()) throw new Error('店铺名称不能为空。');
    if (!/^\d+$/.test(String(record.id || ''))) throw new Error('店铺 ID 必须是纯数字。');
    if (record.status !== '已登录' && record.status !== '登录失效') throw new Error('登录状态只能是“已登录”或“登录失效”。');
    ['name', 'id', 'status', 'note'].forEach(function (key) { if (/[\r\n]/.test(String(record[key] || ''))) throw new Error('店铺字段不能包含换行。'); });
    ledger.instances.forEach(function (instance) {
      instance.slots.forEach(function (slot) {
        if (slot.record && slot.record.id === String(record.id) && (!target || target.instance !== instance.number || target.slot !== slot.number)) throw new Error('店铺 ID 必须在全台账全局唯一。');
      });
    });
  }

  function parseLedger(text) {
    var raw = String(text || '');
    var newline = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    var lines = raw.replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines[0] !== '# 淘宝闪购软件登录店铺台账') throw new Error('台账标题不符合固定格式。');
    var headings = [];
    lines.forEach(function (line, index) { var match = line.match(/^## 淘宝闪购软件 (\d+) 号$/); if (match) headings.push({ number: Number(match[1]), index: index }); });
    if (headings.length !== 8 || headings.some(function (heading, index) { return heading.number !== index + 1; })) throw new Error('台账必须包含 8 个固定软件实例。');
    var instances = headings.map(function (heading, instanceIndex) {
      var headerLine = heading.index + 2;
      var dividerLine = heading.index + 3;
      if (lines[heading.index + 1] !== '' || lines[headerLine] !== '| 序号 | 店铺名称 | 店铺 ID | 登录状态 | 备注 |' || lines[dividerLine] !== '| --- | --- | --- | --- | --- |') throw new Error('软件实例 ' + heading.number + ' 的表格格式不符合固定格式。');
      var rows = lines.slice(dividerLine + 1, dividerLine + 6);
      if (rows.length !== 5 || (instanceIndex < 7 && lines[dividerLine + 6] !== '')) throw new Error('软件实例 ' + heading.number + ' 必须恰有 5 个固定槽位。');
      var slots = rows.map(function (row, index) {
        var cells = splitRow(row);
        if (cells.length !== 5) throw new Error('软件实例 ' + heading.number + ' 的槽位列数不正确。');
        cells = cells.map(function (cell) { return unescapeCell(cell.trim()); });
        if (cells[0] !== String(index + 1)) throw new Error('软件实例 ' + heading.number + ' 的槽位编号不正确。');
        var populated = cells.slice(1).some(Boolean);
        if (populated && (!cells[1] || !cells[2] || !cells[3])) throw new Error('非空槽位必须具备完整店铺记录。');
        if (!populated) return { number: index + 1, record: null, lineIndex: dividerLine + 1 + index };
        var record = { name: cells[1], id: cells[2], status: cells[3], note: cells[4] };
        return { number: index + 1, record: record, lineIndex: dividerLine + 1 + index };
      });
      return { number: heading.number, slots: slots };
    });
    var ledger = { raw: raw, newline: newline, lines: lines, instances: instances };
    var ids = {};
    instances.forEach(function (instance) { instance.slots.forEach(function (slot) { if (slot.record) { validateRecord({ instances: [] }, slot.record); if (ids[slot.record.id]) throw new Error('台账中存在重复店铺 ID。'); ids[slot.record.id] = true; } }); });
    return ledger;
  }

  function ledgerText(ledger, instanceNumber, slotNumber, record) {
    var lines = ledger.lines.slice();
    var instance = ledger.instances[instanceNumber - 1];
    if (!instance || !instance.slots[slotNumber - 1]) throw new Error('目标软件实例或槽位不存在。');
    lines[instance.slots[slotNumber - 1].lineIndex] = formatSlot(slotNumber, record);
    return lines.join(ledger.newline) + ledger.newline;
  }

  function deletedRecordsText(records) {
    return '# 淘宝闪购软件登录店铺删除记录\n| ' + RECORD_COLUMNS.join(' | ') + ' |\n| ' + RECORD_COLUMNS.map(function () { return '---'; }).join(' | ') + ' |\n' + records.map(function (record) { return '| ' + [record.deletedAt, record.instance, record.slot, record.name, record.id, record.status, record.note, record.restored].map(escapeCell).join(' | ') + ' |'; }).join('\n') + (records.length ? '\n' : '');
  }

  function parseDeletedRecords(text) {
    var raw = String(text || '');
    if (!raw) return { raw: '', records: [] };
    var lines = raw.replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var header = '| ' + RECORD_COLUMNS.join(' | ') + ' |';
    var divider = '| ' + RECORD_COLUMNS.map(function () { return '---'; }).join(' | ') + ' |';
    if (lines.length < 3 || lines[0] !== '# 淘宝闪购软件登录店铺删除记录' || lines[1] !== header || lines[2] !== divider) throw new Error('删除记录格式不符合固定表格。');
    var records = lines.slice(3).map(function (line) {
      var cells = splitRow(line);
      if (cells.length !== 8) throw new Error('删除记录表格列数不正确。');
      cells = cells.map(function (cell) { return unescapeCell(cell.trim()); });
      if (!cells[0] || !/^\d+$/.test(cells[1]) || Number(cells[1]) < 1 || Number(cells[1]) > 8 || !/^\d+$/.test(cells[2]) || Number(cells[2]) < 1 || Number(cells[2]) > 5 || !cells[3] || !/^\d+$/.test(cells[4]) || (cells[5] !== '已登录' && cells[5] !== '登录失效') || (cells[7] !== '未恢复' && cells[7] !== '已恢复')) throw new Error('删除记录包含无效字段。');
      return { deletedAt: cells[0], instance: Number(cells[1]), slot: Number(cells[2]), name: cells[3], id: cells[4], status: cells[5], note: cells[6], restored: cells[7] };
    });
    return { raw: raw, records: records };
  }

  function getDirectoryHandle(root, parts, create) { return parts.reduce(function (chain, part) { return chain.then(function (directory) { return directory.getDirectoryHandle(part, { create: !!create }); }); }, Promise.resolve(root)); }
  function getFileHandle(root, parts, create) { return getDirectoryHandle(root, parts.slice(0, -1), false).then(function (directory) { return directory.getFileHandle(parts[parts.length - 1], { create: !!create }); }); }
  function readText(root, parts) { return getFileHandle(root, parts, false).then(function (handle) { return handle.getFile().then(function (file) { return file.text(); }); }); }
  function requestPermission(handle, write) { if (!handle) return Promise.reject(new Error('尚未选择业务资料父目录。')); return Promise.resolve(handle.queryPermission({ mode: write ? 'readwrite' : 'read' })).then(function (status) { if (status === 'granted') return handle; if (typeof handle.requestPermission !== 'function') throw new Error('目录权限已失效，请重新选择业务资料父目录。'); return handle.requestPermission({ mode: write ? 'readwrite' : 'read' }).then(function (next) { if (next !== 'granted') throw new Error('目录权限未授予，请重新选择业务资料父目录。'); return handle; }); }); }
  function queued(root, operation) { var item = writeQueues.find(function (candidate) { return candidate.root === root; }); if (!item) { item = { root: root, tail: Promise.resolve() }; writeQueues.push(item); } var next = item.tail.then(operation, operation); item.tail = next.catch(function () {}); return next; }
  function rawWriteText(root, parts, text, create) { return getFileHandle(root, parts, create).then(function (handle) { var writable, closed = false; return handle.createWritable().then(function (next) { writable = next; return writable.write(text).then(function () { return writable.close().then(function () { closed = true; }); }); }).catch(function (error) { if (writable && !closed && writable.abort) return Promise.resolve(writable.abort()).catch(function () {}).then(function () { throw error; }); throw error; }); }); }
  function writeText(root, parts, text, create) { return queued(root, function () { return requestPermission(root, true).then(function () { return rawWriteText(root, parts, text, create); }); }); }
  function readLedger(root) { return readText(root, LEDGER_PATH).catch(function (error) { if (isMissing(error)) throw new Error('找不到固定台账文件：operations/淘宝运营/淘宝闪购软件登录店铺台账.md。'); throw error; }).then(parseLedger); }
  function readSources(root) { return Promise.all([readLedger(root), readText(root, DELETED_PATH).catch(function (error) { if (isMissing(error)) return ''; throw error; })]).then(function (values) { return { ledger: values[0], deleted: parseDeletedRecords(values[1]) }; }); }
  function ensureExpected(current, expected, message) { if (current !== expected) throw new Error(message || '资料已被其他窗口修改，请重新读取后重试。'); }

  function saveRecord(root, snapshot, instance, slot, record) { return queued(root, function () { return requestPermission(root, true).then(function () { return readText(root, LEDGER_PATH).then(function (current) { ensureExpected(current, snapshot.raw); var ledger = parseLedger(current); validateRecord(ledger, record, { instance: instance, slot: slot }); return rawWriteText(root, LEDGER_PATH, ledgerText(ledger, instance, slot, record), false); }); }); }); }
  function deleteRecord(root, snapshot, instance, slot, deletedAt) { return queued(root, function () { var original, record, nextDeleted, originalDeleted; var ledgerSnapshot = snapshot.ledger || snapshot; var expectedDeleted = snapshot.deleted ? snapshot.deleted.raw : null; return requestPermission(root, true).then(function () { return readText(root, LEDGER_PATH); }).then(function (current) { ensureExpected(current, ledgerSnapshot.raw); original = current; var ledger = parseLedger(current); var target = ledger.instances[instance - 1] && ledger.instances[instance - 1].slots[slot - 1]; if (!target || !target.record) throw new Error('目标槽位没有可删除的店铺记录。'); record = target.record; return readText(root, DELETED_PATH).catch(function (error) { if (isMissing(error)) return ''; throw error; }); }).then(function (deletedText) { if (expectedDeleted != null) ensureExpected(deletedText, expectedDeleted); originalDeleted = deletedText; var deleted = parseDeletedRecords(deletedText); nextDeleted = deleted.records.concat([{ deletedAt: deletedAt, instance: instance, slot: slot, name: record.name, id: record.id, status: record.status, note: record.note, restored: '未恢复' }]); return rawWriteText(root, DELETED_PATH, deletedRecordsText(nextDeleted), true); }).then(function () { return rawWriteText(root, LEDGER_PATH, ledgerText(parseLedger(original), instance, slot, null), false).catch(function (error) { return rawWriteText(root, DELETED_PATH, originalDeleted || deletedRecordsText([]), false).catch(function () {}).then(function () { throw error; }); }); }); }); }
  function emptySlot(ledger, instance) { var item = ledger.instances[instance - 1]; return item && item.slots.find(function (slot) { return !slot.record; }); }
  function restoreRecord(root, sources, recordIndex, selectedInstance) { return queued(root, function () { return requestPermission(root, true).then(function () { return Promise.all([readText(root, LEDGER_PATH), readText(root, DELETED_PATH)]); }).then(function (values) { ensureExpected(values[0], sources.ledger.raw); ensureExpected(values[1], sources.deleted.raw); var ledger = parseLedger(values[0]); var deleted = parseDeletedRecords(values[1]); var record = deleted.records[recordIndex]; if (!record) throw new Error('删除记录不存在，请重新读取。'); if (record.restored === '已恢复') throw new Error('该删除记录已经恢复，不能再次恢复。'); validateRecord(ledger, { name: record.name, id: record.id, status: record.status, note: record.note }); var target = emptySlot(ledger, record.instance); if (!target) { var choices = ledger.instances.filter(function (instance) { return instance.number !== record.instance && emptySlot(ledger, instance.number); }).map(function (instance) { return instance.number; }); if (!choices.length) throw new Error('当前没有可用于恢复的空槽位。'); if (!selectedInstance) return { requiresChoice: true, choices: choices }; if (choices.indexOf(Number(selectedInstance)) === -1) throw new Error('请选择仍有空槽位的其他软件实例。'); target = emptySlot(ledger, Number(selectedInstance)); }
        if (!target) throw new Error('当前没有可用于恢复的空槽位。');
        var ledgerNext = ledgerText(ledger, target && (selectedInstance ? Number(selectedInstance) : record.instance), target.number, { name: record.name, id: record.id, status: record.status, note: record.note });
        deleted.records[recordIndex].restored = '已恢复';
        return rawWriteText(root, LEDGER_PATH, ledgerNext, false).then(function () { return rawWriteText(root, DELETED_PATH, deletedRecordsText(deleted.records), false).catch(function (error) { return rawWriteText(root, LEDGER_PATH, values[0], false).catch(function () {}).then(function () { throw error; }); }); }).then(function () { return { target: { instance: selectedInstance ? Number(selectedInstance) : record.instance, slot: target.number } }; });
      }); }); }

  function openDb() { return new Promise(function (resolve, reject) { var request = window.indexedDB.open(DB_NAME, 1); request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); }; request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(new Error('无法打开本地授权记录。')); }; }); }
  function saveHandle(handle) { return openDb().then(function (db) { return new Promise(function (resolve, reject) { var transaction = db.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).put(handle, HANDLE_KEY); transaction.oncomplete = function () { db.close(); resolve(handle); }; transaction.onerror = function () { db.close(); reject(new Error('无法保存业务资料目录授权记录。')); }; }); }); }
  function loadHandle() { return openDb().then(function (db) { return new Promise(function (resolve, reject) { var request = db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY); request.onsuccess = function () { db.close(); resolve(request.result || null); }; request.onerror = function () { db.close(); reject(new Error('无法读取业务资料目录授权记录。')); }; }); }); }
  function businessRootHandleFor(handle) { if (!handle || handle.name !== '40-business-and-operations') throw new Error('请选择 40-business-and-operations 父目录。'); return handle; }
  function chooseDirectory() { if (!hasAccessApi()) return Promise.reject(new Error('当前 Chrome/Edge 环境不支持 file:/// 所需的目录授权能力。')); return window.showDirectoryPicker({ mode: 'readwrite' }).then(businessRootHandleFor).then(saveHandle); }
  function reconnect() { return loadHandle().then(function (handle) { if (!handle) return { handle: null, status: 'missing' }; businessRootHandleFor(handle); return Promise.resolve(handle.queryPermission({ mode: 'read' })).then(function (status) { return { handle: handle, status: status || 'prompt' }; }); }); }
  function timestamp(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); }

  window.TaobaoFlashSaleLedgerData = { hasAccessApi: hasAccessApi, chooseDirectory: chooseDirectory, reconnect: reconnect, requestPermission: requestPermission, readLedger: readLedger, readSources: readSources, parseLedger: parseLedger, parseDeletedRecords: parseDeletedRecords, deletedRecordsText: deletedRecordsText, validateRecord: validateRecord, saveRecord: saveRecord, deleteRecord: deleteRecord, restoreRecord: restoreRecord, timestamp: timestamp };
}());
