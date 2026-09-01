(function () {
  'use strict';

  var DB_NAME = 'workbench-personal-tasks';
  var DB_VERSION = 1;
  var STORE = 'handles';
  var HANDLE_KEY = 'planning-directory';
  var FILES = {
    active: ['一次性待办.md'],
    recurring: ['recurring', '周期性任务清单.md'],
    paused: ['recurring', '已搁置或暂停事项.md'],
    ended: ['recurring', '已结束周期性任务.md']
  };
  var COLUMNS = {
    active: ['id', 'content'],
    completed: ['id', 'content', 'completedAt'],
    recurring: ['id', 'content', 'rule', 'createdAt', 'enabledAt'],
    paused: ['id', 'content', 'rule', 'createdAt', 'enabledAt'],
    ended: ['id', 'content', 'rule', 'createdAt', 'enabledAt', 'endedAt']
  };
  var TITLES = {
    active: '一次性待办',
    completed: '已完成事项',
    recurring: '周期性任务',
    paused: '已搁置或暂停事项',
    ended: '已结束周期性任务'
  };
  var writeQueues = [];
  var COMPLETION_PREFIX = 'workbench.personalTasks.recurring.v1';
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function hasAccessApi() {
    return typeof window.showDirectoryPicker === 'function' && typeof window.indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof window.indexedDB === 'undefined') {
        reject(new Error('当前浏览器不支持 IndexedDB。'));
        return;
      }
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(new Error('无法打开本地授权记录。')); };
    });
  }

  function saveHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(handle, HANDLE_KEY);
        transaction.oncomplete = function () { db.close(); resolve(handle); };
        transaction.onerror = function () { db.close(); reject(new Error('无法保存目录授权记录。')); };
      });
    });
  }

  function loadHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY);
        request.onsuccess = function () { db.close(); resolve(request.result || null); };
        request.onerror = function () { db.close(); reject(new Error('无法读取目录授权记录。')); };
      });
    });
  }

  function requestPermission(handle, write) {
    if (!handle) return Promise.reject(new Error('尚未选择待办资料父目录。'));
    return Promise.resolve(handle.queryPermission({ mode: write ? 'readwrite' : 'read' })).then(function (permission) {
      if (permission === 'granted') return handle;
      if (typeof handle.requestPermission !== 'function') throw new Error('目录权限已失效，请重新选择待办资料父目录。');
      return handle.requestPermission({ mode: write ? 'readwrite' : 'read' }).then(function (next) {
        if (next !== 'granted') throw new Error('目录权限未授予，请重新选择待办资料父目录。');
        return handle;
      });
    });
  }

  function planningHandleFor(selectedHandle, create) {
    if (selectedHandle.name === 'planning') return Promise.resolve(selectedHandle);
    return selectedHandle.getDirectoryHandle('planning', { create: !!create });
  }

  function chooseDirectory() {
    if (!hasAccessApi()) return Promise.reject(new Error('当前 Chrome/Edge 环境不支持 file:/// 所需的目录授权能力。'));
    return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (selectedHandle) {
      return planningHandleFor(selectedHandle, true).then(saveHandle);
    });
  }

  function reconnect() {
    return loadHandle().then(function (handle) {
      if (!handle) return { handle: null, status: 'missing' };
      return Promise.resolve(handle.queryPermission({ mode: 'read' })).then(function (permission) {
        if (permission !== 'granted') return { handle: handle, status: permission || 'prompt' };
        return planningHandleFor(handle, false).then(function (planningHandle) {
          return saveHandle(planningHandle).then(function () { return { handle: planningHandle, status: 'granted' }; });
        }).catch(function (error) {
          if (isMissing(error)) return { handle: null, status: 'missing' };
          throw error;
        });
      });
    });
  }

  function filePath(fileKey, month) {
    if (fileKey === 'completed') return ['已完成事项', month + '.md'];
    return FILES[fileKey];
  }

  function getDirectoryHandle(root, parts, create) {
    var chain = Promise.resolve(root);
    parts.forEach(function (part) {
      chain = chain.then(function (directory) { return directory.getDirectoryHandle(part, { create: !!create }); });
    });
    return chain;
  }

  function getFileHandle(root, parts, create) {
    return getDirectoryHandle(root, parts.slice(0, -1), create).then(function (directory) {
      return directory.getFileHandle(parts[parts.length - 1], { create: !!create });
    });
  }

  function readText(root, parts) {
    return getFileHandle(root, parts, false).then(function (handle) {
      return handle.getFile().then(function (file) { return file.text(); });
    });
  }

  function isMissing(error) {
    return error && (error.name === 'NotFoundError' || /无法找到|not found/i.test(error.message || ''));
  }

  function withWriteQueue(root, operation) {
    var existing = writeQueues.find(function (item) { return item.root === root; });
    if (!existing) {
      existing = { root: root, tail: Promise.resolve() };
      writeQueues.push(existing);
    }
    var next = existing.tail.then(operation, operation);
    existing.tail = next.catch(function () {});
    return next;
  }

  function writeText(root, parts, text, create, permissionAlreadyGranted) {
    return withWriteQueue(root, function () {
      var permission = permissionAlreadyGranted ? Promise.resolve(root) : requestPermission(root, true);
      return permission.then(function () {
        return getFileHandle(root, parts, !!create).then(function (handle) {
          var writable;
          var closed = false;
          return handle.createWritable().then(function (nextWritable) {
            writable = nextWritable;
            return writable.write(text).then(function () {
              return writable.close().then(function () { closed = true; });
            });
          }).catch(function (error) {
            if (writable && !closed && typeof writable.abort === 'function') {
              return Promise.resolve(writable.abort()).catch(function () {}).then(function () { throw error; });
            }
            throw error;
          });
        });
      });
    });
  }

  function escapeCell(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, function () { throw new Error('Markdown 表格单元格不能包含换行。'); });
  }

  function unescapeCell(value) {
    return String(value || '').replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
  }

  function splitRow(line) {
    var trimmed = line.trim();
    if (trimmed.charAt(0) === '|') trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === '|') trimmed = trimmed.slice(0, -1);
    var cells = [];
    var cell = '';
    var escaped = false;
    for (var i = 0; i < trimmed.length; i += 1) {
      var character = trimmed.charAt(i);
      if (escaped) { cell += character; escaped = false; }
      else if (character === '\\') { cell += character; escaped = true; }
      else if (character === '|') { cells.push(cell); cell = ''; }
      else cell += character;
    }
    cells.push(cell);
    return cells;
  }

  function headerFor(column) {
    return { id: 'ID', content: '任务内容', rule: '执行时期', createdAt: '创建时间', enabledAt: '启用时间', completedAt: '完成时间', endedAt: '结束时间' }[column];
  }

  function parseRows(lines, columns) {
    return lines.slice(3).filter(Boolean).map(function (line) {
      var cells = splitRow(line);
      if (cells.length !== columns.length) throw new Error('资料表格列数不符合标准。');
      var row = {};
      columns.forEach(function (column, index) { row[column] = unescapeCell(cells[index].trim()); });
      if (!row.id || !row.content || /[\r\n]/.test(row.content)) throw new Error('资料表格包含空 ID 或无效任务内容。');
      return row;
    });
  }

  function validateTable(text, title, columns) {
    var lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); });
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    var expectedHeader = '| ' + columns.map(headerFor).join(' | ') + ' |';
    var expectedDivider = '| ' + columns.map(function () { return '---'; }).join(' | ') + ' |';
    if (lines.length < 3 || lines[0] !== '# ' + title || lines[1] !== expectedHeader || lines[2] !== expectedDivider) {
      throw new Error('资料格式不符合标准表格：' + title + '。');
    }
    if (lines.slice(3).some(function (line) { return !/^\|.*\|$/.test(line); })) throw new Error('资料表格包含标准表格之外的内容。');
    return parseRows(lines, columns);
  }

  function tableText(title, columns, rows) {
    return '# ' + title + '\n| ' + columns.map(headerFor).join(' | ') + ' |\n| ' + columns.map(function () { return '---'; }).join(' | ') + ' |\n' + rows.map(function (row) {
      return '| ' + columns.map(function (column) { return escapeCell(row[column]); }).join(' | ') + ' |';
    }).join('\n') + (rows.length ? '\n' : '');
  }

  function monthText(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'); }
  function dateText(date) { return monthText(date) + '-' + String(date.getDate()).padStart(2, '0'); }
  function timestamp(date) { return dateText(date) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); }
  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function dateOnly(value) { return String(value || '').slice(0, 10); }

  function readSource(root, key, month) {
    return readText(root, filePath(key, month)).catch(function (error) {
      if (isMissing(error)) return '';
      throw error;
    });
  }

  function inspect(root) {
    return Promise.all(Object.keys(FILES).map(function (key) {
      return readText(root, FILES[key]).then(function (text) {
        validateTable(text, TITLES[key], COLUMNS[key]);
        return { key: key, exists: true };
      }).catch(function (error) {
        if (isMissing(error)) return { key: key, exists: false, path: FILES[key].join('/') };
        throw error;
      });
    })).then(function (results) {
      return { initialized: results.every(function (result) { return result.exists; }), files: results, missing: results.filter(function (result) { return !result.exists; }).map(function (result) { return result.key; }) };
    });
  }

  function sources(root, month) {
    return Promise.all([readSource(root, 'active'), readSource(root, 'completed', month), readSource(root, 'recurring'), readSource(root, 'paused'), readSource(root, 'ended')]).then(function (texts) {
      return {
        active: validateTable(texts[0], TITLES.active, COLUMNS.active),
        completed: texts[1] ? validateTable(texts[1], TITLES.completed + '：' + month, COLUMNS.completed) : [],
        recurring: validateTable(texts[2], TITLES.recurring, COLUMNS.recurring),
        paused: validateTable(texts[3], TITLES.paused, COLUMNS.paused),
        ended: validateTable(texts[4], TITLES.ended, COLUMNS.ended),
        raw: { active: texts[0], completed: texts[1], recurring: texts[2], paused: texts[3], ended: texts[4] },
        month: month
      };
    });
  }

  function initialize(root, missingKeys) {
    var requested = missingKeys && missingKeys.length ? missingKeys.slice() : Object.keys(FILES);
    return requestPermission(root, true).then(function () {
      return inspect(root).then(function (inspection) {
        var toCreate = requested.filter(function (key) { return inspection.missing.indexOf(key) !== -1; });
        return getDirectoryHandle(root, ['已完成事项'], true).then(function () {
          var completed = [];
          return toCreate.reduce(function (chain, key) {
            return chain.then(function () {
              return writeText(root, filePath(key), tableText(TITLES[key], COLUMNS[key], []), true, true).then(function () { completed.push(key); });
            });
          }, Promise.resolve()).then(function () { return { created: completed, missing: inspection.missing.filter(function (key) { return completed.indexOf(key) === -1; }) }; });
        });
      });
    });
  }

  function sourceTitle(key, month) {
    return key === 'completed' ? TITLES.completed + '：' + month : TITLES[key];
  }

  function readSourceText(root, key, month) {
    return readText(root, filePath(key, month)).catch(function (error) {
      if (key === 'completed' && isMissing(error)) return '';
      throw error;
    });
  }

  function writeSource(root, key, rows, month, expectedText) {
    return requestPermission(root, true).then(function () {
      return readSourceText(root, key, month).then(function (currentText) {
        if (expectedText != null && currentText !== expectedText) throw new Error('资料已被其他窗口修改，请重新读取后重试。');
        if (currentText) validateTable(currentText, sourceTitle(key, month), COLUMNS[key]);
        return writeText(root, filePath(key, month), tableText(sourceTitle(key, month), COLUMNS[key], rows), key === 'completed', true);
      });
    });
  }

  function moveOneOffToCompleted(root, activeRows, completedRows, task, month, expectedActive, expectedCompleted) {
    var nextCompleted = completedRows.concat([{ id: task.id, content: task.content, completedAt: timestamp(new Date()) }]);
    var nextActive = activeRows.filter(function (row) { return row.id !== task.id; });
    return writeSource(root, 'completed', nextCompleted, month, expectedCompleted).then(function () {
      return writeSource(root, 'active', nextActive, null, expectedActive).catch(function (error) {
        return writeSource(root, 'completed', completedRows, month, tableText(TITLES.completed + '：' + month, COLUMNS.completed, nextCompleted)).catch(function () {}).then(function () { throw error; });
      });
    });
  }

  function restoreOneOff(root, activeRows, completedRows, task, month, expectedActive, expectedCompleted) {
    var nextActive = activeRows.concat([{ id: task.id, content: task.content }]);
    var nextCompleted = completedRows.filter(function (row) { return row.id !== task.id; });
    return writeSource(root, 'active', nextActive, null, expectedActive).then(function () {
      return writeSource(root, 'completed', nextCompleted, month, expectedCompleted).catch(function (error) {
        return writeSource(root, 'active', activeRows, null, tableText(TITLES.active, COLUMNS.active, nextActive)).catch(function () {}).then(function () { throw error; });
      });
    });
  }

  function moveRowsBetweenSources(root, sourceKey, targetKey, nextSourceRows, nextTargetRows, originalTargetRows, expectedSource, expectedTarget) {
    return writeSource(root, targetKey, nextTargetRows, null, expectedTarget).then(function () {
      return writeSource(root, sourceKey, nextSourceRows, null, expectedSource).catch(function (error) {
        return writeSource(root, targetKey, originalTargetRows, null, tableText(TITLES[targetKey], COLUMNS[targetKey], nextTargetRows)).catch(function () {}).then(function () { throw error; });
      });
    });
  }

  function parseRule(text) {
    var value = String(text || '').trim();
    if (value === '每日') return { ok: true, rule: { kind: 'daily' } };
    if (value === '每周') return { ok: false, code: 'EMPTY' };
    var legacyWeekly = value.match(/^每周([日一二三四五六](?:、[日一二三四五六])*)$/);
    if (legacyWeekly) value = '每周：' + legacyWeekly[1].split('、').map(function (day) { return '周' + day; }).join('、');
    var legacyMonthly = value.match(/^每月(\d{1,2}(?:日、\d{1,2}日)*)$/);
    if (legacyMonthly) value = '每月：' + legacyMonthly[1];
    var weekly = value.match(/^每周：(.+)$/);
    if (weekly) {
      var weekdays = weekly[1].split('、').map(function (day) { return WEEKDAYS.indexOf(day.replace(/^周/, '')); });
      if (!weekdays.length || weekdays.some(function (day) { return day < 0; })) return { ok: false, code: 'UNSUPPORTED' };
      return { ok: true, rule: { kind: 'weekly', weekdays: weekdays.filter(function (day, index, list) { return list.indexOf(day) === index; }).sort(function (a, b) { return a - b; }) } };
    }
    var monthly = value.match(/^每月：(.+)$/);
    if (monthly) {
      var days = monthly[1].split('、').map(function (day) { return Number(day.replace('日', '')); });
      if (!days.length || days.some(function (day) { return !Number.isInteger(day) || day < 1 || day > 31; })) return { ok: false, code: 'INVALID_DAY' };
      return { ok: true, rule: { kind: 'monthly', days: days.filter(function (day, index, list) { return list.indexOf(day) === index; }).sort(function (a, b) { return a - b; }) } };
    }
    return { ok: false, code: value ? 'UNSUPPORTED' : 'EMPTY' };
  }

  function validateRule(rule) {
    if (!rule || !rule.kind) throw new Error('请选择一种周期规则。');
    if (rule.kind === 'daily') return;
    var values = rule.kind === 'weekly' ? rule.weekdays : rule.days;
    var min = rule.kind === 'weekly' ? 0 : 1;
    var max = rule.kind === 'weekly' ? 6 : 31;
    if (!Array.isArray(values) || !values.length || values.some(function (value) { return !Number.isInteger(value) || value < min || value > max; })) throw new Error('周期规则的选择无效。');
  }

  function uniqueSorted(values) {
    return values.slice().sort(function (a, b) { return a - b; }).filter(function (value, index, list) { return index === 0 || value !== list[index - 1]; });
  }

  function formatRule(rule) {
    validateRule(rule);
    if (rule.kind === 'daily') return '每日';
    if (rule.kind === 'weekly') return '每周：' + uniqueSorted(rule.weekdays).map(function (day) { return '周' + WEEKDAYS[day]; }).join('、');
    return '每月：' + uniqueSorted(rule.days).map(function (day) { return day + '日'; }).join('、');
  }

  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
  function resolveMonthlyDay(year, month, requestedDay) {
    var last = daysInMonth(year, month);
    return { day: Math.min(requestedDay, last), fallbackToMonthEnd: requestedDay > last };
  }
  function scheduledOn(rule, date) {
    var parts = date.split('-').map(Number);
    var day = parts[2];
    if (rule.kind === 'daily') return { matches: true, requestedMonthDays: [] };
    if (rule.kind === 'weekly') return { matches: rule.weekdays.indexOf(new Date(parts[0], parts[1] - 1, day).getDay()) !== -1, requestedMonthDays: [] };
    var requested = rule.days.filter(function (requestedDay) { return resolveMonthlyDay(parts[0], parts[1], requestedDay).day === day; });
    return { matches: requested.length > 0, requestedMonthDays: requested };
  }
  function isActiveOn(task, date) {
    return task.status === 'enabled' && date >= dateOnly(task.enabledAt);
  }
  function isScheduledOccurrence(task, date) {
    if (!isActiveOn(task, date)) return null;
    var result = scheduledOn(task.rule, date);
    return result.matches ? { taskId: task.id, date: date, requestedMonthDays: result.requestedMonthDays, fallbackToMonthEnd: result.requestedMonthDays.some(function (requested) { return requested > Number(date.split('-')[2]); }) } : null;
  }
  function occurrencesForMonth(task, year, month) {
    var result = [];
    for (var day = 1; day <= daysInMonth(year, month); day += 1) {
      var date = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var occurrence = isScheduledOccurrence(task, date);
      if (occurrence) result.push(occurrence);
    }
    return result;
  }
  function transitionRecurringTask(task, transition, now) {
    var next = Object.assign({}, task);
    if (transition.type === 'pause' && task.status === 'enabled') next.status = 'paused';
    else if (transition.type === 'end' && task.status === 'enabled' && transition.confirmed) { next.status = 'ended'; next.endedAt = now; }
    else if (transition.type === 'restore' && (task.status === 'paused' || task.status === 'ended')) { next.status = 'enabled'; next.enabledAt = now; delete next.endedAt; }
    else if (transition.type === 'change-rule' && task.status === 'enabled') { validateRule(transition.rule); next.rule = transition.rule; }
    else throw new Error('当前周期任务状态不允许此操作。');
    return next;
  }
  function completionKey(taskId, date) { return COMPLETION_PREFIX + ':' + taskId + ':' + date; }
  function isRecurringCompleted(taskId, date) { try { return window.localStorage.getItem(completionKey(taskId, date)) === '1'; } catch (error) { return false; } }
  function setRecurringCompleted(taskId, date, completed) { try { if (completed) window.localStorage.setItem(completionKey(taskId, date), '1'); else window.localStorage.removeItem(completionKey(taskId, date)); return true; } catch (error) { return false; } }
  function toggleRecurringCompleted(taskId, date) {
    var next = !isRecurringCompleted(taskId, date);
    if (!setRecurringCompleted(taskId, date, next)) return { ok: false, completed: isRecurringCompleted(taskId, date) };
    return { ok: true, completed: next };
  }

  function clearFutureInvalidCompletions(taskId, rule, fromDate) {
    try {
      var keys = [];
      for (var index = 0; index < window.localStorage.length; index += 1) {
        var key = window.localStorage.key(index);
        if (key && key.indexOf(COMPLETION_PREFIX + ':' + taskId + ':') === 0) keys.push(key);
      }
      keys.forEach(function (key) {
        var date = key.slice((COMPLETION_PREFIX + ':' + taskId + ':').length);
        if (date >= fromDate && !scheduledOn(rule, date).matches) window.localStorage.removeItem(key);
      });
      return true;
    } catch (error) { return false; }
  }

  window.PersonalTasksData = {
    FILES: FILES, COLUMNS: COLUMNS, TITLES: TITLES, WEEKDAYS: WEEKDAYS,
    hasAccessApi: hasAccessApi, planningHandleFor: planningHandleFor, chooseDirectory: chooseDirectory, reconnect: reconnect, saveHandle: saveHandle, requestPermission: requestPermission,
    inspect: inspect, sources: sources, initialize: initialize, writeSource: writeSource, moveOneOffToCompleted: moveOneOffToCompleted, restoreOneOff: restoreOneOff, moveRowsBetweenSources: moveRowsBetweenSources,
    tableText: tableText, parseTable: function (text, columns) { var first = String(text || '').split(/\r?\n/)[0].replace(/^# /, ''); return validateTable(text, first, columns); }, validateTable: validateTable,
    monthText: monthText, dateText: dateText, timestamp: timestamp, id: id,
    parseRule: parseRule, validateRule: validateRule, formatRule: formatRule, daysInMonth: daysInMonth, resolveMonthlyDay: resolveMonthlyDay,
    scheduledOn: scheduledOn, isActiveOn: isActiveOn, isScheduledOccurrence: isScheduledOccurrence, occurrencesForMonth: occurrencesForMonth, transitionRecurringTask: transitionRecurringTask,
    completionKey: completionKey, isRecurringCompleted: isRecurringCompleted, setRecurringCompleted: setRecurringCompleted, toggleRecurringCompleted: toggleRecurringCompleted, clearFutureInvalidCompletions: clearFutureInvalidCompletions
  };
}());
