const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadData(localStorage) {
  const context = { window: { localStorage: localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null } }, Promise };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'tasks-data.js'), 'utf8'), context);
  return context.window.PersonalTasksData;
}

function createMemoryRoot(files, failCloseAt) {
  let closeCount = 0;
  function directory(prefix) {
    return {
      queryPermission: () => Promise.resolve('granted'),
      getDirectoryHandle: (name) => Promise.resolve(directory(prefix ? prefix + '/' + name : name)),
      getFileHandle: (name) => {
        const filePath = prefix ? prefix + '/' + name : name;
        return Promise.resolve({
          getFile: () => Promise.resolve({ text: () => Promise.resolve(files.get(filePath) || '') }),
          createWritable: () => {
            let pending;
            return Promise.resolve({
              write: (text) => { pending = text; return Promise.resolve(); },
              close: () => {
                closeCount += 1;
                if (closeCount === failCloseAt) return Promise.reject(new Error('simulated write failure'));
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

test('resolves either the parent directory or planning directory without nesting', async () => {
  const data = loadData();
  let requestedCreate;
  const planning = { name: 'planning' };
  const parent = { name: '20-tasks-and-planning', getDirectoryHandle: (name, options) => { assert.equal(name, 'planning'); requestedCreate = options.create; return Promise.resolve(planning); } };
  assert.equal(await data.planningHandleFor(parent, true), planning);
  assert.equal(requestedCreate, true);
  assert.equal(await data.planningHandleFor(planning, true), planning);
});

test('does not fall back to a parent directory when planning is unavailable', async () => {
  const data = loadData();
  const parent = { name: '20-tasks-and-planning', getDirectoryHandle: () => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFoundError' })) };
  await assert.rejects(data.planningHandleFor(parent, false), /not found/);
});

test('serializes and parses escaped one-line markdown table cells', () => {
  const data = loadData();
  const text = data.tableText('一次性待办', ['id', 'content'], [{ id: 'oneoff-1', content: '整理 | 归档 \\ 文件' }]);
  assert.match(text, /整理 \\\| 归档 \\\\ 文件/);
  assert.equal(JSON.stringify(data.parseTable(text, ['id', 'content'])), JSON.stringify([{ id: 'oneoff-1', content: '整理 | 归档 \\ 文件' }]));
});

test('creates local date and timestamp formats without UTC conversion', () => {
  const data = loadData();
  const date = new Date(2026, 7, 31, 14, 30);
  assert.equal(data.monthText(date), '2026-08');
  assert.equal(data.dateText(date), '2026-08-31');
  assert.equal(data.timestamp(date), '2026-08-31 14:30');
});

test('normalizes one recurrence family and rejects invalid rules', () => {
  const data = loadData();
  assert.equal(data.parseRule('每日').ok, true);
  assert.equal(data.formatRule({ kind: 'weekly', weekdays: [5, 1, 1] }), '每周：周一、周五');
  assert.equal(data.formatRule({ kind: 'monthly', days: [31, 1] }), '每月：1日、31日');
  assert.equal(data.parseRule('每周一、三、五').ok, true);
  assert.equal(data.parseRule('每月0日').ok, false);
  assert.equal(data.parseRule('每周：').ok, false);
});

test('maps monthly overflow to the final day and preserves requested days', () => {
  const data = loadData();
  assert.equal(JSON.stringify(data.resolveMonthlyDay(2026, 2, 31)), JSON.stringify({ day: 28, fallbackToMonthEnd: true }));
  const task = { id: 'recurring-1', rule: { kind: 'monthly', days: [28, 29, 30, 31] }, status: 'enabled', enabledAt: '2026-01-01 00:00' };
  const occurrence = data.isScheduledOccurrence(task, '2026-02-28');
  assert.equal(occurrence.fallbackToMonthEnd, true);
  assert.deepEqual(occurrence.requestedMonthDays, [28, 29, 30, 31]);
  assert.equal(data.occurrencesForMonth(task, 2026, 2).length, 1);
});

test('keeps recurring completion state separate from markdown data', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), get length() { return values.size; }, key: (index) => Array.from(values.keys())[index] || null };
  const data = loadData(storage);
  assert.equal(data.toggleRecurringCompleted('recurring-1', '2026-08-31').completed, true);
  assert.equal(values.get(data.completionKey('recurring-1', '2026-08-31')), '1');
  assert.equal(data.toggleRecurringCompleted('recurring-1', '2026-08-31').completed, false);
  assert.equal(values.has(data.completionKey('recurring-1', '2026-08-31')), false);
});

test('rolls back the target source when recurring transfer cannot remove its source row', async () => {
  const data = loadData();
  const recurringRows = [{ id: 'recurring-1', content: '测试计划', rule: '每日', createdAt: '2026-08-31 14:00', enabledAt: '2026-08-31 14:00' }];
  const pausedRows = [];
  const recurringText = data.tableText('周期性任务', data.COLUMNS.recurring, recurringRows);
  const pausedText = data.tableText('已搁置或暂停事项', data.COLUMNS.paused, pausedRows);
  const files = new Map([
    ['recurring/周期性任务清单.md', recurringText],
    ['recurring/已搁置或暂停事项.md', pausedText]
  ]);
  const root = createMemoryRoot(files, 2);
  const nextPaused = recurringRows.slice();
  await assert.rejects(data.moveRowsBetweenSources(root, 'recurring', 'paused', [], nextPaused, pausedRows, recurringText, pausedText), /simulated write failure/);
  assert.equal(files.get('recurring/周期性任务清单.md'), recurringText);
  assert.equal(files.get('recurring/已搁置或暂停事项.md'), pausedText);
});

test('clears only future completion states invalidated by an adjusted rule', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), get length() { return values.size; }, key: (index) => Array.from(values.keys())[index] || null };
  const data = loadData(storage);
  data.setRecurringCompleted('recurring-1', '2026-08-30', true);
  data.setRecurringCompleted('recurring-1', '2026-08-31', true);
  data.setRecurringCompleted('recurring-1', '2026-09-01', true);
  data.clearFutureInvalidCompletions('recurring-1', { kind: 'weekly', weekdays: [1] }, '2026-08-31');
  assert.equal(data.isRecurringCompleted('recurring-1', '2026-08-30'), true);
  assert.equal(data.isRecurringCompleted('recurring-1', '2026-08-31'), true);
  assert.equal(data.isRecurringCompleted('recurring-1', '2026-09-01'), false);
});
