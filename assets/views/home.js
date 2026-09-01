(function () {
  'use strict';

  var dataApi;
  var homeRoot;
  var refreshBound = false;
  var weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function loadDataLayer(done) {
    if (window.PersonalTasksData) { dataApi = window.PersonalTasksData; done(); return; }
    var script = document.createElement('script');
    script.src = 'assets/views/tasks-data.js';
    script.onload = function () { dataApi = window.PersonalTasksData; done(); };
    script.onerror = function () { done(new Error('个人待办资料层加载失败。')); };
    document.head.appendChild(script);
  }

  function plannedCards() {
    var ledger = '<a class="entry-card planned-card planned-card--ledger" href="#planned-01" aria-label="打开淘宝闪购店铺台账"><span class="planned-card-index">01</span><h3>淘宝闪购店铺台账</h3><p>固定软件实例的本地登录店铺资料。</p><span class="sample-tag">本地</span></a>';
    var reserved = ['02', '03'].map(function (number) {
      return '<a class="entry-card planned-card" href="#planned-' + number + '" aria-label="打开预留模块 ' + number + '"><span class="planned-card-index">' + number + '</span><h3>通用模块位置</h3><p>尚未定义用途。</p><span class="planned-badge">规划中</span></a>';
    }).join('');
    return ledger + reserved;
  }

  function todayText(date) {
    return date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
  }

  function summarySection(title, rows, empty, recurring) {
    var items = rows.map(function (row) {
      return '<li class="home-summary-item' + (row.done ? ' home-summary-item--done' : '') + '"><span class="home-summary-check" aria-hidden="true"></span><span>' + escapeHtml(row.content) + '</span>' + (recurring ? '<small>' + escapeHtml(row.rule) + '</small>' : '') + '</li>';
    }).join('') || '<li class="home-summary-empty">' + empty + '</li>';
    return '<section class="home-summary-section"><h4>' + title + '</h4><ul>' + items + '</ul></section>';
  }

  function summaryMarkup(summary) {
    if (summary.error) return '<div class="home-summary home-summary--error"><p>资料摘要暂不可用。</p></div>';
    if (!summary.connected) {
      return '<div class="home-summary home-summary--unconnected"><button class="secondary-button" type="button" data-home-choose>选择待办资料文件夹</button></div>';
    }
    return '<div class="home-summary" tabindex="0" aria-label="个人待办只读摘要">' +
      summarySection('一次性待办', summary.active, '没有未完成的一次性待办。', false) +
      summarySection('周期性待办', summary.recurring, '今天没有命中的周期性待办。', true) +
      '</div>';
  }

  function taskPanelMarkup(summary) {
    var today = new Date();
    var label = todayText(today) + '，星期' + weekdays[today.getDay()];
    return '<article class="entry-card task-panel">' +
      '<div class="task-panel-main" data-task-entry><div class="task-panel-title"><div><h3><a class="task-panel-link" href="#tasks">个人待办</a></h3><p>一次性事项与今日周期计划。</p></div><span class="sample-tag">本地</span></div>' + summaryMarkup(summary) + '</div>' +
      '<div class="task-panel-aside" aria-label="' + label + '"><span class="today-year">' + today.getFullYear() + '</span><strong class="today-date">' + String(today.getMonth() + 1).padStart(2, '0') + '.' + String(today.getDate()).padStart(2, '0') + '</strong><span class="today-weekday">星期' + weekdays[today.getDay()] + '</span></div>' +
      '</article>';
  }

  function render(summary) {
    if (!homeRoot) return;
    homeRoot.innerHTML = '<div class="content-inner">' +
      '<p class="eyebrow">主页 / 总览</p>' +
      '<h1>工作台</h1>' +
      '<p class="intro">进入常用本地模块与查看后续扩展空间的静态入口。</p>' +
      '<section aria-labelledby="tasks-heading"><div class="section-heading"><h2 id="tasks-heading">当前模块</h2><span class="section-caption">本地 Markdown</span></div>' + taskPanelMarkup(summary) + '</section>' +
      '<section class="planned-section" aria-labelledby="planned-heading"><div class="section-heading"><h2 id="planned-heading">模块入口</h2><span class="section-caption">本地模块与后续预留位置</span></div><div class="planned-grid">' + plannedCards() + '</div></section>' +
      '</div>';
    bindPanel();
  }

  function bindPanel() {
    var entry = homeRoot.querySelector('[data-task-entry]');
    var openTasks = function () { window.location.hash = '#tasks'; };
    entry.addEventListener('click', function () { openTasks(); });
    var summary = entry.querySelector('.home-summary');
    if (summary) {
      summary.addEventListener('click', function (event) { event.stopPropagation(); });
      summary.addEventListener('keydown', function (event) { event.stopPropagation(); });
    }
    var choose = entry.querySelector('[data-home-choose]');
    if (choose) choose.addEventListener('click', function (event) {
      event.stopPropagation();
      dataApi.chooseDirectory().then(loadSummary).catch(function () { render({ connected: false }); });
    });
  }

  function loadSummary() {
    if (!dataApi || !dataApi.hasAccessApi()) { render({ error: true }); return; }
    dataApi.reconnect().then(function (connection) {
      if (!connection.handle || connection.status !== 'granted') { render({ connected: false }); return; }
      return dataApi.inspect(connection.handle).then(function (inspection) {
        if (!inspection.initialized) { render({ connected: false }); return; }
        return dataApi.sources(connection.handle, dataApi.monthText(new Date())).then(function (sources) {
          var date = dataApi.dateText(new Date());
          var recurring = sources.recurring.map(function (row) {
            var parsed = dataApi.parseRule(row.rule);
            var task = { id: row.id, content: row.content, rule: parsed.ok ? parsed.rule : null, enabledAt: row.enabledAt, status: 'enabled' };
            return { task: task, occurrence: task.rule ? dataApi.isScheduledOccurrence(task, date) : null };
          }).filter(function (item) { return item.occurrence; }).map(function (item) {
            return { content: item.task.content, rule: item.task.ruleText || sources.recurring.find(function (row) { return row.id === item.task.id; }).rule, done: dataApi.isRecurringCompleted(item.task.id, date) };
          });
          render({ connected: true, active: sources.active, recurring: recurring });
        });
      });
    }).catch(function () { render({ error: true }); });
  }

  window.WorkbenchViews.register('home', function (root) {
    homeRoot = root;
    if (!refreshBound) {
      refreshBound = true;
      window.addEventListener('hashchange', function () {
        if (window.location.hash === '#home' && homeRoot) loadSummary();
      });
    }
    loadDataLayer(function (error) { if (error) render({ error: true }); else loadSummary(); });
  });
}());
