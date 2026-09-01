(function () {
  'use strict';

  var dataApi;
  var currentHandle;
  var currentData;
  var state = { tab: 'active', completedMonth: null, completedDate: null, recurringMonth: null, recurringDate: null, recurringView: 'enabled', pendingUndo: null };

  function loadDataLayer(done) {
    if (window.PersonalTasksData) { dataApi = window.PersonalTasksData; done(); return; }
    var script = document.createElement('script');
    script.src = 'assets/views/tasks-data.js';
    script.onload = function () { dataApi = window.PersonalTasksData; done(); };
    script.onerror = function () { done(new Error('个人待办资料层加载失败。')); };
    document.head.appendChild(script);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function localDateKey(date) { return dataApi.dateText(date); }
  function monthFromDateKey(key) { return key ? key.slice(0, 7) : dataApi.monthText(new Date()); }
  function dateFromMonth(month, day) { return month + '-' + String(day).padStart(2, '0'); }
  function monthParts(month) { var parts = month.split('-').map(Number); return { year: parts[0], month: parts[1] }; }
  function shiftMonth(month, amount) { var parts = monthParts(month); var date = new Date(parts.year, parts.month - 1 + amount, 1); return dataApi.monthText(date); }
  function monthLabel(month) { var parts = monthParts(month); return parts.year + ' 年 ' + parts.month + ' 月'; }
  function dateLabel(key) { var parts = key.split('-'); return parts[0] + ' 年 ' + Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日'; }
  function selectedDateForMonth(month) {
    var today = dataApi.monthText(new Date());
    return month === today ? dataApi.dateText(new Date()) : dateFromMonth(month, 1);
  }
  function now() { return new Date(); }

  function renderShell(root, context, body) {
    root.innerHTML = '<div class="content-inner module-page tasks-module">' +
      '<nav class="breadcrumb" aria-label="当前位置"><button class="breadcrumb-link" type="button">主页</button><span aria-hidden="true">/</span><span>个人待办</span></nav>' +
      '<div class="module-heading"><div><p class="eyebrow">本地 Markdown</p><h1>个人待办</h1><p class="intro">一次性事项、已完成记录与周期计划，共用已授权的本地资料目录。</p></div><span class="local-badge">离线</span></div>' + body + '</div>';
    root.querySelector('.breadcrumb-link').addEventListener('click', context.goHome);
  }

  function renderStatus(root, context, title, message, actions) {
    renderShell(root, context, '<section class="state-panel"><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p><div class="state-actions">' + actions + '</div></section>');
  }

  function bindChoose(root, action, context) {
    var button = root.querySelector('[data-action="' + action + '"]');
    if (button) button.addEventListener('click', function () {
      dataApi.chooseDirectory().then(start).catch(function (error) { renderChoose(root, context, error); });
    });
  }

  function renderChoose(root, context, error) {
    renderStatus(root, context, '选择待办资料父目录', error ? error.message : '首次使用请选择 20-tasks-and-planning 父目录。页面只会创建或使用其中的 planning/ 子目录。', '<button class="primary-button" type="button" data-action="choose">选择父目录</button><p class="state-note">请用 Chrome 或 Edge 直接打开此 file:/// 页面。这里不启动服务，也不改用网络接口。</p>');
    bindChoose(root, 'choose', context);
  }

  function renderPermission(root, context, handle, status) {
    var label = status === 'prompt' ? '重新授权目录' : '选择待办资料父目录';
    renderStatus(root, context, '目录权限需要恢复', '浏览器仍保存了目录入口，但当前权限状态为 ' + status + '。请在按钮点击中重新授权，或重新选择 20-tasks-and-planning 父目录。', '<button class="primary-button" type="button" data-action="permission">' + label + '</button><button class="secondary-button" type="button" data-action="choose">重新选择父目录</button>');
    root.querySelector('[data-action="permission"]').addEventListener('click', function () { dataApi.requestPermission(handle, false).then(start).catch(function (error) { renderPermission(root, context, handle, error.message); }); });
    bindChoose(root, 'choose', context);
  }

  function renderUninitialized(root, context, handle, inspection) {
    var missing = inspection.missing.map(function (key) { return dataApi.FILES[key].join('/'); }).join('、');
    renderStatus(root, context, '初始化空资料', '当前 planning/ 子目录缺少标准待办资料：' + missing + '。只会创建缺失文件，不会覆盖已有资料。', '<button class="primary-button" type="button" data-action="initialize">初始化空资料</button><button class="secondary-button" type="button" data-action="choose">重新选择父目录</button>');
    root.querySelector('[data-action="initialize"]').addEventListener('click', function () {
      var button = root.querySelector('[data-action="initialize"]');
      button.disabled = true;
      dataApi.initialize(handle, inspection.missing).then(start).catch(function (error) {
        button.disabled = false;
        renderStatus(root, context, '初始化未完成', error.message + ' 已成功创建的文件不会被覆盖，重新点击可继续。', '<button class="secondary-button" type="button" data-action="retry">重试</button><button class="secondary-button" type="button" data-action="choose">重新选择父目录</button>');
        root.querySelector('[data-action="retry"]').addEventListener('click', function () { start(); });
        bindChoose(root, 'choose', context);
      });
    });
    bindChoose(root, 'choose', context);
  }

  function addInlineError(root, message, retry) {
    var old = root.querySelector('.inline-error');
    if (old) old.remove();
    var node = document.createElement('div');
    node.className = 'inline-error';
    node.innerHTML = '<strong>操作失败</strong><span>' + escapeHtml(message) + '</span>' + (retry ? '<button type="button" class="link-button">重试</button>' : '');
    var target = root.querySelector('.task-workspace') || root.querySelector('.state-panel');
    if (target) target.prepend(node);
    if (retry) node.querySelector('button').addEventListener('click', retry);
  }

  function tabMarkup() {
    return '<div class="task-tabs" role="tablist" aria-label="待办分类">' +
      [['active', '一次性待办'], ['completed', '已完成'], ['recurring', '周期性计划']].map(function (item) {
        return '<button class="task-tab' + (state.tab === item[0] ? ' task-tab--active' : '') + '" type="button" role="tab" aria-selected="' + (state.tab === item[0]) + '" data-tab="' + item[0] + '">' + item[1] + '</button>';
      }).join('') + '</div>';
  }

  function boundaryMarkup() {
    return '<aside class="module-boundary"><p>资料边界</p><p>仅访问已授权目录中的 Personal Tasks 标准 Markdown；长任务位于 tasks/，本页面不读取或操作。</p><button class="link-button" type="button" data-action="change-directory">重新选择父目录</button></aside>';
  }

  function reloadAndRender() {
    var month = state.tab === 'completed' ? (state.completedMonth || dataApi.monthText(new Date())) : (state.recurringMonth || dataApi.monthText(new Date()));
    return dataApi.sources(currentHandle, month).then(function (nextData) { currentData = nextData; renderCurrent(); });
  }

  function bindTabs(root) {
    root.querySelectorAll('[data-tab]').forEach(function (button) { button.addEventListener('click', function () { state.tab = button.dataset.tab; reloadAndRender(); }); });
    root.querySelector('[data-action="change-directory"]').addEventListener('click', function () { dataApi.chooseDirectory().then(start).catch(function (error) { renderChoose(root, { goHome: goHome }, error); }); });
  }

  function renderActive(root) {
    var rows = currentData.active.map(function (row) {
      return '<li class="task-row"><span class="task-row-text">' + escapeHtml(row.content) + '</span><button class="row-button" type="button" data-complete="' + escapeHtml(row.id) + '">完成</button></li>';
    }).join('') || '<li class="empty-row">还没有一次性待办。</li>';
    renderShell(root, { goHome: goHome }, '<section class="task-workspace" aria-label="个人待办工作区">' + tabMarkup() + '<section class="task-section"><div class="section-heading"><div><h2>一次性待办</h2><p class="section-caption">新事项追加到清单末尾。</p></div><span class="count-badge">' + currentData.active.length + '</span></div><form class="task-add-form"><label class="sr-only" for="new-task">新增一次性待办</label><input id="new-task" name="content" type="text" maxlength="240" placeholder="输入一项待办" autocomplete="off"><button class="primary-button" type="submit">新增</button></form><ul class="task-list task-list--live" aria-label="一次性待办列表">' + rows + '</ul></section>' + boundaryMarkup() + '</section>');
    bindTabs(root);
    root.querySelector('.task-add-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = root.querySelector('#new-task');
      var content = input.value.trim();
      if (!content || /[\r\n]/.test(content)) { input.setCustomValidity('请输入单行待办内容。'); input.reportValidity(); return; }
      input.setCustomValidity('');
      var button = root.querySelector('.task-add-form button');
      button.disabled = true;
      dataApi.writeSource(currentHandle, 'active', currentData.active.concat([{ id: dataApi.id('oneoff'), content: content }]), null, currentData.raw.active).then(start).catch(function (error) { button.disabled = false; addInlineError(root, error.message, function () { button.click(); }); });
    });
    root.querySelectorAll('[data-complete]').forEach(function (button) { button.addEventListener('click', function () { completeOneOff(root, button.dataset.complete); }); });
  }

  function completeOneOff(root, taskId) {
    var task = currentData.active.find(function (row) { return row.id === taskId; });
    if (!task) return;
    root.querySelector('[data-complete="' + taskId + '"]').disabled = true;
    var month = dataApi.monthText(new Date());
    dataApi.moveOneOffToCompleted(currentHandle, currentData.active, currentData.completed, task, month, currentData.raw.active, currentData.raw.completed).then(function () {
      state.pendingUndo = { task: task, month: month };
      start().then(function () { showUndoFeedback(); });
    }).catch(function (error) { addInlineError(root, error.message, function () { completeOneOff(root, taskId); }); });
  }

  function showUndoFeedback() {
    var root = document.getElementById('view-root');
    if (!root || !state.pendingUndo) return;
    var node = document.createElement('div');
    node.className = 'toast-feedback';
    node.innerHTML = '<span>已完成</span><button type="button" class="link-button">撤销</button>';
    root.querySelector('.tasks-module').prepend(node);
    var undo = state.pendingUndo;
    node.querySelector('button').addEventListener('click', function () {
      node.querySelector('button').disabled = true;
      var completed = currentData.completed.filter(function (row) { return row.id !== undo.task.id; });
      dataApi.restoreOneOff(currentHandle, currentData.active, currentData.completed, undo.task, undo.month, currentData.raw.active, currentData.raw.completed).then(function () { state.pendingUndo = null; start(); }).catch(function (error) { node.querySelector('button').disabled = false; addInlineError(root, error.message, function () { node.querySelector('button').click(); }); });
    });
    window.setTimeout(function () { if (node.isConnected) node.remove(); state.pendingUndo = null; }, 7000);
  }

  function calendarMarkup(month, selected, prefix) {
    var parts = monthParts(month);
    var first = new Date(parts.year, parts.month - 1, 1).getDay();
    var total = dataApi.daysInMonth(parts.year, parts.month);
    var cells = [];
    for (var i = 0; i < first; i += 1) cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
    for (var day = 1; day <= total; day += 1) {
      var key = dateFromMonth(month, day);
      cells.push('<button type="button" class="calendar-day' + (key === selected ? ' calendar-day--selected' : '') + '" data-' + prefix + '-date="' + key + '">' + day + '</button>');
    }
    return '<div class="calendar"><div class="calendar-toolbar"><button class="icon-button" type="button" data-' + prefix + '-month="-1" aria-label="上个月" title="上个月">←</button><strong>' + monthLabel(month) + '</strong><button class="icon-button" type="button" data-' + prefix + '-month="1" aria-label="下个月" title="下个月">→</button></div><div class="calendar-weekdays">' + dataApi.WEEKDAYS.map(function (day) { return '<span>周' + day + '</span>'; }).join('') + '</div><div class="calendar-grid">' + cells.join('') + '</div></div>';
  }

  function bindCalendar(root, prefix, onChange) {
    root.querySelectorAll('[data-' + prefix + '-date]').forEach(function (button) { button.addEventListener('click', function () { onChange(button.getAttribute('data-' + prefix + '-date')); }); });
    root.querySelectorAll('[data-' + prefix + '-month]').forEach(function (button) { button.addEventListener('click', function () { var current = prefix === 'completed' ? (state.completedMonth || dataApi.monthText(new Date())) : (state.recurringMonth || dataApi.monthText(new Date())); onChange(shiftMonth(current, Number(button.getAttribute('data-' + prefix + '-month')))); }); });
  }

  function renderCompleted(root) {
    var month = state.completedMonth || dataApi.monthText(new Date());
    var selected = state.completedDate || selectedDateForMonth(month);
    if (monthFromDateKey(selected) !== month) selected = dateFromMonth(month, 1);
    var rows = currentData.completed.filter(function (row) { return String(row.completedAt).slice(0, 10) === selected; });
    var content = rows.map(function (row) { return '<li class="task-row task-row--with-action"><span class="task-row-text">' + escapeHtml(row.content) + '<small class="row-meta">' + escapeHtml(row.completedAt) + '</small></span><span class="row-actions row-actions--fixed"><button class="row-button" type="button" data-restore="' + escapeHtml(row.id) + '">恢复</button></span></li>'; }).join('') || '<li class="empty-row">这一天没有已完成事项。</li>';
    renderShell(root, { goHome: goHome }, '<section class="task-workspace task-workspace--calendar" aria-label="已完成事项工作区">' + tabMarkup() + '<section class="calendar-layout"><div class="calendar-pane">' + calendarMarkup(month, selected, 'completed') + '<p class="calendar-note">没有月度文件的月份只显示为空，不会创建文件。</p></div><section class="task-section calendar-detail"><div class="section-heading"><div><h2>' + dateLabel(selected) + '</h2><p class="section-caption">已完成事项</p></div><span class="count-badge">' + rows.length + '</span></div><ul class="task-list task-list--live" aria-label="当天已完成事项">' + content + '</ul></section></section><div class="calendar-boundary">' + boundaryMarkup() + '</div></section>');
    bindTabs(root);
    bindCalendar(root, 'completed', function (value) { if (value.length === 7) { state.completedMonth = value; state.completedDate = value + '-01'; } else state.completedDate = value; reloadAndRender(); });
    root.querySelectorAll('[data-restore]').forEach(function (button) { button.addEventListener('click', function () { restoreOneOff(root, button.dataset.restore, month); }); });
  }

  function normalizeRecurring(row) {
    var parsed = dataApi.parseRule(row.rule);
    return { id: row.id, content: row.content, ruleText: row.rule, rule: parsed.ok ? parsed.rule : null, createdAt: row.createdAt, enabledAt: row.enabledAt, endedAt: row.endedAt, status: 'enabled' };
  }

  function recurringRowsForDate(date) {
    return currentData.recurring.map(normalizeRecurring).map(function (task) { return { task: task, occurrence: task.rule ? dataApi.isScheduledOccurrence(task, date) : null }; }).filter(function (item) { return item.occurrence; });
  }

  function recurringRuleLabel(task, occurrence) {
    if (!occurrence || !occurrence.fallbackToMonthEnd) return task.ruleText;
    return task.ruleText + '（原定 ' + occurrence.requestedMonthDays.filter(function (day) { return day > Number(occurrence.date.slice(-2)); }).join('、') + ' 日，回退至月底）';
  }

  function recurringManagementMarkup() {
    var rows = state.recurringView === 'paused' ? currentData.paused : currentData.ended;
    var title = state.recurringView === 'paused' ? '已暂停' : '已结束';
    var content = rows.map(function (row) { return '<li class="task-row task-row--with-action"><span class="task-row-text">' + escapeHtml(row.content) + '<small class="row-meta">' + escapeHtml(row.rule) + (row.endedAt ? ' · 结束于 ' + escapeHtml(row.endedAt) : '') + '</small></span><span class="row-actions row-actions--fixed"><button class="row-button" type="button" data-recurring-restore="' + escapeHtml(row.id) + '">恢复</button></span></li>'; }).join('') || '<li class="empty-row">没有' + title + '事项。</li>';
    return '<section class="task-section management-section"><div class="section-heading"><div><h2>' + title + '</h2><p class="section-caption">恢复后从恢复时刻开始新的启用区间。</p></div><button class="link-button" type="button" data-management-back="enabled">返回周期日历</button></div><ul class="task-list task-list--live">' + content + '</ul></section>';
  }

  function rulePicker(prefix, existing) {
    var current = existing || { kind: 'daily' };
    var weekly = current.kind === 'weekly' ? current.weekdays : [];
    var monthly = current.kind === 'monthly' ? current.days : [];
    return '<fieldset class="rule-picker"><legend>执行规则</legend><label><input type="radio" name="' + prefix + '-family" value="daily" ' + (current.kind === 'daily' ? 'checked' : '') + '> 每日</label><label><input type="radio" name="' + prefix + '-family" value="weekly" ' + (current.kind === 'weekly' ? 'checked' : '') + '> 每周指定日</label><div class="choice-grid"><span class="choice-group-label">每周指定日</span>' + dataApi.WEEKDAYS.map(function (day, index) { return '<label><input type="checkbox" name="' + prefix + '-weekday" value="' + index + '" ' + (weekly.indexOf(index) !== -1 ? 'checked' : '') + '> 周' + day + '</label>'; }).join('') + '</div><label><input type="radio" name="' + prefix + '-family" value="monthly" ' + (current.kind === 'monthly' ? 'checked' : '') + '> 每月指定日</label><div class="choice-grid choice-grid--days"><span class="choice-group-label">每月指定日</span>' + Array.from({ length: 31 }, function (_, index) { var day = index + 1; return '<label><input type="checkbox" name="' + prefix + '-monthday" value="' + day + '" ' + (monthly.indexOf(day) !== -1 ? 'checked' : '') + '> ' + day + '日</label>'; }).join('') + '</div></fieldset>';
  }

  function bindRulePicker(root, prefix) {
    var radios = root.querySelectorAll('input[name="' + prefix + '-family"]');
    var update = function () {
      var family = root.querySelector('input[name="' + prefix + '-family"]:checked').value;
      root.querySelectorAll('input[name="' + prefix + '-weekday"]').forEach(function (input) { input.disabled = family !== 'weekly'; });
      root.querySelectorAll('input[name="' + prefix + '-monthday"]').forEach(function (input) { input.disabled = family !== 'monthly'; });
    };
    radios.forEach(function (radio) { radio.addEventListener('change', update); });
    update();
  }

  function selectedRule(root, prefix) {
    var family = root.querySelector('input[name="' + prefix + '-family"]:checked').value;
    if (family === 'daily') return { kind: 'daily' };
    var selector = family === 'weekly' ? 'input[name="' + prefix + '-weekday"]:checked' : 'input[name="' + prefix + '-monthday"]:checked';
    var values = Array.from(root.querySelectorAll(selector)).map(function (input) { return Number(input.value); });
    return family === 'weekly' ? { kind: 'weekly', weekdays: values } : { kind: 'monthly', days: values };
  }

  function recurringMenuMarkup(task) {
    return '<details class="row-menu"><summary class="icon-button" aria-label="打开管理菜单" title="管理菜单">⋯</summary><div class="row-menu-popover"><button type="button" data-pause="' + escapeHtml(task.id) + '">暂停</button><button type="button" data-end="' + escapeHtml(task.id) + '">结束</button><button type="button" data-adjust="' + escapeHtml(task.id) + '">调整规则</button></div></details>';
  }

  function recurringCreateMarkup() {
    return '<details class="recurring-create"><summary class="secondary-button">新增周期计划</summary><form class="recurring-form" data-recurring-form="create"><label for="new-recurring">任务内容</label><input id="new-recurring" name="content" type="text" maxlength="240" placeholder="输入一项周期计划"><div data-rule-picker="create">' + rulePicker('create') + '</div><div class="form-actions"><button class="primary-button" type="submit">保存计划</button><button class="secondary-button" type="button" data-cancel-recurring>返回</button></div></form></details>';
  }

  function renderRecurring(root) {
    if (state.recurringView !== 'enabled') {
      renderShell(root, { goHome: goHome }, '<section class="task-workspace" aria-label="周期任务管理">' + tabMarkup() + recurringManagementMarkup() + boundaryMarkup() + '</section>');
      bindTabs(root);
      root.querySelector('[data-management-back]').addEventListener('click', function () { state.recurringView = 'enabled'; renderCurrent(); });
      root.querySelectorAll('[data-recurring-restore]').forEach(function (button) { button.addEventListener('click', function () { restoreRecurring(root, button.dataset.recurringRestore, state.recurringView); }); });
      return;
    }
    var month = state.recurringMonth || dataApi.monthText(new Date());
    var selected = state.recurringDate || selectedDateForMonth(month);
    if (monthFromDateKey(selected) !== month) selected = dateFromMonth(month, 1);
    var items = recurringRowsForDate(selected);
    var content = items.map(function (item) {
      var done = dataApi.isRecurringCompleted(item.task.id, selected);
      return '<li class="task-row task-row--with-action' + (done ? ' task-row--done' : '') + '"><span class="task-row-text"><span>' + escapeHtml(item.task.content) + '</span><small class="row-meta">' + escapeHtml(recurringRuleLabel(item.task, item.occurrence)) + '</small></span><span class="row-actions row-actions--recurring"><button class="row-button" type="button" data-toggle-recurring="' + escapeHtml(item.task.id) + '">' + (done ? '撤销完成' : '确认完成') + '</button>' + recurringMenuMarkup(item.task) + '</span></li>';
    }).join('') || '<li class="empty-row">这一天没有周期计划。</li>';
    var enabled = currentData.recurring.map(normalizeRecurring);
    renderShell(root, { goHome: goHome }, '<section class="task-workspace task-workspace--calendar" aria-label="周期计划工作区">' + tabMarkup() + '<section class="recurring-toolbar"><div><strong>周期计划</strong><span class="section-caption">确认完成只保存在浏览器本地。</span></div><div class="management-links"><button type="button" class="link-button" data-management="paused">已暂停（' + currentData.paused.length + '）</button><button type="button" class="link-button" data-management="ended">已结束（' + currentData.ended.length + '）</button></div>' + recurringCreateMarkup() + '</section><section class="calendar-layout"><div class="calendar-pane">' + calendarMarkup(month, selected, 'recurring') + '<p class="calendar-note">周期规则只从创建或最近恢复日期开始生效。</p></div><section class="task-section calendar-detail"><div class="section-heading"><div><h2>' + dateLabel(selected) + '</h2><p class="section-caption">当日周期计划</p></div><span class="count-badge">' + items.length + '</span></div><ul class="task-list task-list--live" aria-label="当天周期计划">' + content + '</ul></section></section><div class="calendar-boundary">' + boundaryMarkup() + '</div></section>');
    bindTabs(root);
    bindCalendar(root, 'recurring', function (value) { if (value.length === 7) { state.recurringMonth = value; state.recurringDate = value + '-01'; } else state.recurringDate = value; reloadAndRender(); });
    root.querySelectorAll('[data-toggle-recurring]').forEach(function (button) { button.addEventListener('click', function () { toggleRecurring(root, button.dataset.toggleRecurring, selected); }); });
    root.querySelectorAll('[data-pause]').forEach(function (button) { button.addEventListener('click', function () { pauseRecurring(root, button.dataset.pause); }); });
    root.querySelectorAll('[data-end]').forEach(function (button) { button.addEventListener('click', function () { endRecurring(root, button.dataset.end); }); });
    root.querySelectorAll('[data-adjust]').forEach(function (button) { button.addEventListener('click', function () { showAdjustForm(root, button.dataset.adjust); }); });
    root.querySelectorAll('[data-management]').forEach(function (button) { button.addEventListener('click', function () { state.recurringView = button.dataset.management; renderCurrent(); }); });
    bindRulePicker(root, 'create');
    root.querySelector('[data-cancel-recurring]').addEventListener('click', function () {
      var details = root.querySelector('.recurring-create');
      details.removeAttribute('open');
      root.querySelector('[data-recurring-form]').reset();
    });
    root.querySelector('[data-recurring-form]').addEventListener('submit', function (event) { event.preventDefault(); createRecurring(root); });
  }

  function toggleRecurring(root, taskId, date) {
    var result = dataApi.toggleRecurringCompleted(taskId, date);
    if (!result.ok) { addInlineError(root, '浏览器本地完成状态无法写入，请检查 localStorage 后重试。', function () { toggleRecurring(root, taskId, date); }); return; }
    renderCurrent();
  }

  function createRecurring(root) {
    var form = root.querySelector('[data-recurring-form]');
    var input = form.querySelector('[name="content"]');
    var content = input.value.trim();
    if (!content || /[\r\n]/.test(content)) { input.setCustomValidity('请输入单行周期计划内容。'); input.reportValidity(); return; }
    try {
      var rule = selectedRule(root, 'create');
      dataApi.validateRule(rule);
      var stamp = dataApi.timestamp(now());
      var next = currentData.recurring.concat([{ id: dataApi.id('recurring'), content: content, rule: dataApi.formatRule(rule), createdAt: stamp, enabledAt: stamp }]);
      form.querySelector('button[type="submit"]').disabled = true;
      dataApi.writeSource(currentHandle, 'recurring', next, null, currentData.raw.recurring).then(start).catch(function (error) { form.querySelector('button[type="submit"]').disabled = false; addInlineError(root, error.message, function () { createRecurring(root); }); });
    } catch (error) { addInlineError(root, error.message); }
  }

  function showAdjustForm(root, taskId) {
    var task = currentData.recurring.map(normalizeRecurring).find(function (row) { return row.id === taskId; });
    if (!task || !task.rule) { addInlineError(root, '该周期任务的规则格式无效，无法调整。'); return; }
    var row = root.querySelector('[data-adjust="' + taskId + '"]').closest('.task-row');
    var form = document.createElement('form');
    form.className = 'rule-adjust-form';
    form.innerHTML = '<label>调整规则</label>' + rulePicker('adjust-' + taskId, task.rule) + '<button class="primary-button" type="submit">保存</button><button class="link-button" type="button">取消</button>';
    row.after(form);
    form.querySelector('[type="button"]').addEventListener('click', function () { form.remove(); });
    bindRulePicker(form, 'adjust-' + taskId);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        var rule = selectedRule(form, 'adjust-' + taskId);
        dataApi.validateRule(rule);
        var next = currentData.recurring.map(function (sourceRow) { return sourceRow.id === taskId ? Object.assign({}, sourceRow, { rule: dataApi.formatRule(rule) }) : sourceRow; });
        dataApi.writeSource(currentHandle, 'recurring', next, null, currentData.raw.recurring).then(function () {
          dataApi.clearFutureInvalidCompletions(taskId, rule, localDateKey(now()));
          start();
        }).catch(function (error) { addInlineError(root, error.message, function () { form.querySelector('[type="submit"]').click(); }); });
      } catch (error) { addInlineError(root, error.message); }
    });
  }

  function transitionRows(root, taskId, action) {
    var source = currentData.recurring.find(function (row) { return row.id === taskId; });
    if (!source) return;
    var stamp = dataApi.timestamp(now());
    var transition = action === 'pause' ? { type: 'pause' } : { type: 'end', confirmed: true };
    var nextTask;
    try { nextTask = dataApi.transitionRecurringTask(Object.assign({}, normalizeRecurring(source)), transition, stamp); } catch (error) { addInlineError(root, error.message); return; }
    var targetKey = action === 'pause' ? 'paused' : 'ended';
    var targetRows = currentData[targetKey].concat([{ id: nextTask.id, content: nextTask.content, rule: source.rule, createdAt: source.createdAt, enabledAt: source.enabledAt }].map(function (row) { return action === 'end' ? Object.assign(row, { endedAt: stamp }) : row; }));
    var sourceRows = currentData.recurring.filter(function (row) { return row.id !== taskId; });
    dataApi.moveRowsBetweenSources(currentHandle, 'recurring', targetKey, sourceRows, targetRows, currentData[targetKey], currentData.raw.recurring, currentData.raw[targetKey]).then(start).catch(function (error) { addInlineError(root, error.message, function () { transitionRows(root, taskId, action); }); });
  }

  function pauseRecurring(root, taskId) { transitionRows(root, taskId, 'pause'); }
  function endRecurring(root, taskId) { if (window.confirm('结束后该周期任务将停止显示，但仍可从“已结束”恢复。确定结束吗？')) transitionRows(root, taskId, 'end'); }

  function restoreRecurring(root, taskId, sourceKey) {
    var sourceRows = currentData[sourceKey];
    var source = sourceRows.find(function (row) { return row.id === taskId; });
    if (!source) return;
    var restored = Object.assign({}, source, { enabledAt: dataApi.timestamp(now()) });
    delete restored.endedAt;
    var enabledRows = currentData.recurring.concat([{ id: restored.id, content: restored.content, rule: restored.rule, createdAt: restored.createdAt, enabledAt: restored.enabledAt }]);
    var nextSource = sourceRows.filter(function (row) { return row.id !== taskId; });
    dataApi.moveRowsBetweenSources(currentHandle, sourceKey, 'recurring', nextSource, enabledRows, currentData.recurring, currentData.raw[sourceKey], currentData.raw.recurring).then(start).catch(function (error) { addInlineError(root, error.message, function () { restoreRecurring(root, taskId, sourceKey); }); });
  }

  function restoreOneOff(root, taskId, month) {
    var task = currentData.completed.find(function (row) { return row.id === taskId; });
    if (!task) return;
    dataApi.restoreOneOff(currentHandle, currentData.active, currentData.completed, { id: task.id, content: task.content }, month, currentData.raw.active, currentData.raw.completed).then(function () { state.tab = 'active'; start(); }).catch(function (error) { addInlineError(root, error.message, function () { restoreOneOff(root, taskId, month); }); });
  }

  function renderCurrent() {
    var root = document.getElementById('view-root');
    if (!root || !currentData) return;
    if (state.tab === 'active') renderActive(root);
    else if (state.tab === 'completed') renderCompleted(root);
    else renderRecurring(root);
  }

  function goHome() { window.location.hash = '#home'; }

  function start() {
    var root = document.getElementById('view-root');
    if (!dataApi || !dataApi.hasAccessApi()) { renderStatus(root, { goHome: goHome }, '需要支持目录授权的浏览器', '当前浏览器没有可用的 File System Access API 或 IndexedDB。', '<p class="state-note">请用 Chrome 或 Edge 直接打开此 file:/// 页面。这里不启动服务，也不改用网络接口。</p>'); return Promise.resolve(); }
    return dataApi.reconnect().then(function (connection) {
      if (!connection.handle) { renderChoose(root, { goHome: goHome }); return; }
      if (connection.status !== 'granted') { renderPermission(root, { goHome: goHome }, connection.handle, connection.status); return; }
      currentHandle = connection.handle;
      return dataApi.inspect(currentHandle).then(function (inspection) {
        if (!inspection.initialized) { renderUninitialized(root, { goHome: goHome }, currentHandle, inspection); return; }
        var month = state.tab === 'completed' ? (state.completedMonth || dataApi.monthText(new Date())) : (state.recurringMonth || dataApi.monthText(new Date()));
        return dataApi.sources(currentHandle, month).then(function (nextData) { currentData = nextData; renderCurrent(); });
      });
    }).catch(function (error) {
      renderStatus(root, { goHome: goHome }, '资料读取失败', error.message, '<button class="secondary-button" type="button" data-action="retry">重试</button><button class="secondary-button" type="button" data-action="choose">重新选择父目录</button>');
      root.querySelector('[data-action="retry"]').addEventListener('click', start);
      bindChoose(root, 'choose', { goHome: goHome });
    });
  }

  window.WorkbenchViews.register('tasks', function () {
    loadDataLayer(function (error) {
      var root = document.getElementById('view-root');
      if (error) { renderStatus(root, { goHome: goHome }, '个人待办不可用', error.message, '<button class="secondary-button" type="button" data-action="retry">重试</button>'); root.querySelector('[data-action="retry"]').addEventListener('click', start); return; }
      start();
    });
  });
}());
