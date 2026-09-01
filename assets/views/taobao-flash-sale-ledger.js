(function () {
  'use strict';

  var dataApi;
  var currentHandle;
  var currentSources;
  var state = { query: '', form: null, error: '', restoreChoice: null };
  var currentRoot;
  var currentContext;

  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }
  function loadDataLayer(done) {
    if (window.TaobaoFlashSaleLedgerData) { dataApi = window.TaobaoFlashSaleLedgerData; done(); return; }
    var script = document.createElement('script');
    script.src = 'assets/views/taobao-flash-sale-ledger-data.js';
    script.onload = function () { dataApi = window.TaobaoFlashSaleLedgerData; done(); };
    script.onerror = function () { done(new Error('台账资料层加载失败。')); };
    document.head.appendChild(script);
  }
  function renderShell(root, body) {
    root.innerHTML = '<div class="content-inner module-page ledger-module"><nav class="breadcrumb" aria-label="当前位置"><button class="breadcrumb-link" type="button">主页</button><span aria-hidden="true">/</span><span>淘宝闪购店铺台账</span></nav><div class="module-heading"><div><p class="eyebrow">本地 Markdown</p><h1>淘宝闪购店铺台账</h1><p class="intro">固定 8 个软件实例，每个实例 5 个登录槽位。</p></div><span class="local-badge">离线</span></div>' + body + '</div>';
    root.querySelector('.breadcrumb-link').addEventListener('click', currentContext.goHome);
  }
  function statusPage(root, title, message, actions) {
    renderShell(root, '<section class="state-panel"><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p><div class="state-actions">' + actions + '</div></section>');
  }
  function isActive(root) { return root === currentRoot && window.location.hash === '#planned-01'; }
  function choose(root) { dataApi.chooseDirectory().then(function () { return start(root); }).catch(function (error) { if (isActive(root)) renderChoose(root, error.message); }); }
  function renderChoose(root, error) { statusPage(root, '选择业务资料目录', error || '首次使用请选择 40-business-and-operations 父目录。页面只会访问固定的淘宝闪购软件登录店铺台账和删除记录。', '<button class="primary-button" type="button" data-choose>选择业务资料目录</button><p class="state-note">请用 Chrome 或 Edge 直接打开此 file:/// 页面。这里不启动服务，也不改用网络接口。</p>'); root.querySelector('[data-choose]').addEventListener('click', function () { choose(root); }); }
  function renderPermission(root, connection) { statusPage(root, '目录权限需要恢复', '浏览器仍保存了业务资料目录入口，但当前权限状态为 ' + connection.status + '。请重新授权或重新选择目录。', '<button class="primary-button" type="button" data-permission>重新授权目录</button><button class="secondary-button" type="button" data-choose>重新选择目录</button>'); root.querySelector('[data-permission]').addEventListener('click', function () { dataApi.requestPermission(connection.handle, false).then(function () { return start(root); }).catch(function (error) { if (isActive(root)) renderPermission(root, { handle: connection.handle, status: error.message }); }); }); root.querySelector('[data-choose]').addEventListener('click', function () { choose(root); }); }
  function inlineError() { return state.error ? '<div class="inline-error"><strong>操作失败</strong><span>' + escapeHtml(state.error) + '</span></div>' : ''; }
  function formMarkup() {
    if (!state.form) return '';
    var form = state.form;
    return '<section class="ledger-editor"><div class="section-heading"><div><h2>' + (form.mode === 'create' ? '新增店铺记录' : '编辑店铺记录') + '</h2><p class="section-caption">淘宝闪购软件 ' + form.instance + ' 号 / 槽位 ' + form.slot + '</p></div><button class="link-button" type="button" data-cancel-form>关闭</button></div><form data-ledger-form><label>店铺名称<input name="name" type="text" maxlength="120" required value="' + escapeHtml(form.values.name) + '"></label><label>店铺 ID<input name="id" inputmode="numeric" pattern="[0-9]+" maxlength="40" required value="' + escapeHtml(form.values.id) + '"></label><label>登录状态<select name="status" required><option value="已登录"' + (form.values.status === '已登录' ? ' selected' : '') + '>已登录</option><option value="登录失效"' + (form.values.status === '登录失效' ? ' selected' : '') + '>登录失效</option></select></label><label>备注<textarea name="note" rows="3" maxlength="500">' + escapeHtml(form.values.note) + '</textarea></label><div class="form-actions"><button class="primary-button" type="submit">保存</button><button class="secondary-button" type="button" data-cancel-form>取消</button></div></form></section>';
  }
  function matchRecord(record) { var query = state.query.trim().toLowerCase(); return !query || (record && (record.name.toLowerCase().indexOf(query) !== -1 || record.id.indexOf(query) !== -1)); }
  function slotMarkup(instance, slot) {
    var record = slot.record;
    if (state.query.trim() && (!record || !matchRecord(record))) return '';
    var detail = record ? '<strong>' + escapeHtml(record.name) + '</strong><span>' + escapeHtml(record.id) + '</span><span class="ledger-status">' + escapeHtml(record.status) + '</span><small>' + escapeHtml(record.note || '无备注') + '</small>' : '<span class="ledger-empty">空槽位</span>';
    var actions = record ? '<button class="row-button" type="button" data-edit="' + instance.number + '-' + slot.number + '">编辑</button><button class="row-button row-button--danger" type="button" data-delete="' + instance.number + '-' + slot.number + '">删除</button>' : '<button class="row-button" type="button" data-create="' + instance.number + '-' + slot.number + '">新增</button>';
    return '<li class="ledger-slot"><span class="ledger-slot-number">槽位 ' + slot.number + '</span><span class="ledger-record">' + detail + '</span><span class="row-actions ledger-actions">' + actions + '</span></li>';
  }
  function workspaceMarkup() {
    var instances = currentSources.ledger.instances.map(function (instance) { var slots = instance.slots.map(function (slot) { return slotMarkup(instance, slot); }).join(''); if (!slots) return ''; return '<section class="ledger-instance"><div class="section-heading"><h2>淘宝闪购软件 ' + instance.number + ' 号</h2><span class="section-caption">固定 5 个登录槽位</span></div><ul class="ledger-slots">' + slots + '</ul></section>'; }).join('') || '<section class="task-section"><p class="empty-row">没有与当前筛选条件匹配的店铺记录。</p></section>';
    var deleted = currentSources.deleted.records.map(function (record, index) { return '<li class="deleted-record"><span><strong>' + escapeHtml(record.name) + '</strong><small>删除于 ' + escapeHtml(record.deletedAt) + '，原淘宝闪购软件 ' + record.instance + ' 号 / 槽位 ' + record.slot + '</small></span><span>' + escapeHtml(record.id) + '</span><span>' + escapeHtml(record.restored) + '</span>' + (record.restored === '未恢复' ? '<button class="row-button" type="button" data-restore="' + index + '">恢复</button>' : '') + '</li>'; }).join('') || '<li class="empty-row">没有可恢复的删除记录。</li>';
    return '<section class="ledger-workspace">' + inlineError() + '<div class="ledger-toolbar"><label class="ledger-search"><span class="sr-only">按店铺名称或店铺 ID 筛选</span><input type="search" data-search placeholder="搜索店铺名称或店铺 ID" value="' + escapeHtml(state.query) + '"></label><button class="secondary-button" type="button" data-reload>重新读取</button><button class="link-button" type="button" data-change-directory>重新选择目录</button></div>' + formMarkup() + '<div class="ledger-layout"><div class="ledger-instances">' + instances + '</div><aside class="ledger-deletions"><div class="section-heading"><div><h2>删除记录</h2><p class="section-caption">仅可恢复未恢复记录</p></div></div><ul>' + deleted + '</ul></aside></div><aside class="module-boundary"><p>资料边界</p><p>仅访问已授权目录中的固定台账和删除记录。不会读取、列出或修改其他业务资料。</p></aside></section>';
  }
  function renderWorkspace(root) { renderShell(root, workspaceMarkup()); bindWorkspace(root); }
  function setError(message) { state.error = message; }
  function clearError() { state.error = ''; }
  function reload() { return dataApi.readSources(currentHandle).then(function (sources) { currentSources = sources; return sources; }); }
  function renderReadFailure(root, error) { currentSources = null; statusPage(root, '资料读取失败', error.message, '<button class="secondary-button" type="button" data-retry>重新读取</button><button class="secondary-button" type="button" data-choose>重新选择目录</button>'); root.querySelector('[data-retry]').addEventListener('click', function () { start(root); }); root.querySelector('[data-choose]').addEventListener('click', function () { choose(root); }); }
  function refreshAfterMutationFailure(root, error) { reload().then(function () { setError(error.message); renderWorkspace(root); }).catch(function (readError) { renderReadFailure(root, readError); }); }
  function success(root, message) { var notice = document.createElement('div'); notice.className = 'toast-feedback'; notice.textContent = message; root.querySelector('.ledger-workspace').prepend(notice); window.setTimeout(function () { if (notice.isConnected) notice.remove(); }, 3000); }
  function parseTarget(value) { var parts = value.split('-').map(Number); return { instance: parts[0], slot: parts[1] }; }
  function captureFormValues(root) { var form = root.querySelector('[data-ledger-form]'); if (form && state.form) state.form.values = { name: form.elements.name.value, id: form.elements.id.value, status: form.elements.status.value, note: form.elements.note.value }; }
  function startForm(target, mode) { var found = currentSources.ledger.instances[target.instance - 1].slots[target.slot - 1]; state.form = { mode: mode, instance: target.instance, slot: target.slot, values: found.record ? Object.assign({}, found.record) : { name: '', id: '', status: '已登录', note: '' } }; clearError(); renderWorkspace(currentRoot); currentRoot.querySelector('[data-ledger-form] input[name="name"]').focus(); }
  function saveForm(root) { var form = root.querySelector('[data-ledger-form]'); var values = { name: form.elements.name.value.trim(), id: form.elements.id.value.trim(), status: form.elements.status.value, note: form.elements.note.value.trim() }; state.form.values = values; try { dataApi.validateRecord(currentSources.ledger, values, { instance: state.form.instance, slot: state.form.slot }); } catch (error) { setError(error.message); renderWorkspace(root); return; } var button = form.querySelector('[type="submit"]'); button.disabled = true; dataApi.saveRecord(currentHandle, currentSources.ledger, state.form.instance, state.form.slot, values).then(function () { return reload(); }).then(function () { state.form = null; clearError(); renderWorkspace(root); success(root, '店铺记录已保存。'); }).catch(function (error) { button.disabled = false; setError(error.message); renderWorkspace(root); }); }
  function deleteTarget(root, target) { var record = currentSources.ledger.instances[target.instance - 1].slots[target.slot - 1].record; if (!record || !window.confirm('确认删除？\n淘宝闪购软件 ' + target.instance + ' 号，槽位 ' + target.slot + '，' + record.name + '（' + record.id + '）')) return; dataApi.deleteRecord(currentHandle, currentSources, target.instance, target.slot, dataApi.timestamp(new Date())).then(function () { return reload(); }).then(function () { clearError(); renderWorkspace(root); success(root, '店铺记录已删除并写入删除记录。'); }).catch(function (error) { refreshAfterMutationFailure(root, error); }); }
  function showRestoreChoice(root, index, choices) { state.restoreChoice = { index: index, choices: choices }; renderShell(root, '<section class="state-panel"><h2>选择恢复的软件实例</h2><p>原淘宝闪购软件实例已满 5 个槽位。请选择一个仍有空槽位的其他实例。</p><div class="state-actions">' + choices.map(function (choice) { return '<button class="secondary-button" type="button" data-restore-choice="' + choice + '">淘宝闪购软件 ' + choice + ' 号</button>'; }).join('') + '<button class="link-button" type="button" data-cancel-restore>返回台账</button></div></section>'); root.querySelectorAll('[data-restore-choice]').forEach(function (button) { button.addEventListener('click', function () { restore(root, index, Number(button.dataset.restoreChoice)); }); }); root.querySelector('[data-cancel-restore]').addEventListener('click', function () { state.restoreChoice = null; renderWorkspace(root); }); }
  function restore(root, index, choice) { dataApi.restoreRecord(currentHandle, currentSources, index, choice).then(function (result) { if (result.requiresChoice) { showRestoreChoice(root, index, result.choices); return null; } return reload().then(function () { clearError(); state.restoreChoice = null; renderWorkspace(root); success(root, '店铺记录已恢复到淘宝闪购软件 ' + result.target.instance + ' 号，槽位 ' + result.target.slot + '。'); }); }).catch(function (error) { state.restoreChoice = null; refreshAfterMutationFailure(root, error); }); }
  function bindWorkspace(root) {
    root.querySelector('[data-search]').addEventListener('input', function (event) { captureFormValues(root); state.query = event.target.value; renderWorkspace(root); root.querySelector('[data-search]').focus(); });
    root.querySelector('[data-reload]').addEventListener('click', function () { reload().then(function () { clearError(); renderWorkspace(root); }).catch(function (error) { setError(error.message); renderWorkspace(root); }); });
    root.querySelector('[data-change-directory]').addEventListener('click', function () { choose(root); });
    root.querySelectorAll('[data-create]').forEach(function (button) { button.addEventListener('click', function () { startForm(parseTarget(button.dataset.create), 'create'); }); });
    root.querySelectorAll('[data-edit]').forEach(function (button) { button.addEventListener('click', function () { startForm(parseTarget(button.dataset.edit), 'edit'); }); });
    root.querySelectorAll('[data-delete]').forEach(function (button) { button.addEventListener('click', function () { deleteTarget(root, parseTarget(button.dataset.delete)); }); });
    root.querySelectorAll('[data-restore]').forEach(function (button) { button.addEventListener('click', function () { restore(root, Number(button.dataset.restore)); }); });
    root.querySelectorAll('[data-cancel-form]').forEach(function (button) { button.addEventListener('click', function () { state.form = null; clearError(); renderWorkspace(root); }); });
    var form = root.querySelector('[data-ledger-form]'); if (form) form.addEventListener('submit', function (event) { event.preventDefault(); saveForm(root); });
  }
  function start(root) {
    if (!isActive(root)) return Promise.resolve();
    if (!dataApi || !dataApi.hasAccessApi()) { statusPage(root, '需要支持目录授权的浏览器', '当前浏览器没有可用的 File System Access API 或 IndexedDB。', '<p class="state-note">请用 Chrome 或 Edge 直接打开此 file:/// 页面。</p>'); return Promise.resolve(); }
    return dataApi.reconnect().then(function (connection) { if (!isActive(root)) return; if (!connection.handle) { renderChoose(root); return; } if (connection.status !== 'granted') { renderPermission(root, connection); return; } currentHandle = connection.handle; return reload().then(function () { if (isActive(root)) renderWorkspace(root); }); }).catch(function (error) { if (isActive(root)) renderReadFailure(root, error); });
  }
  function openLedger(root, context) { currentRoot = root; currentContext = context; loadDataLayer(function (error) { if (!isActive(root)) return; if (error) { statusPage(root, '淘宝闪购店铺台账不可用', error.message, '<button class="secondary-button" type="button" data-retry>重试</button>'); root.querySelector('[data-retry]').addEventListener('click', function () { openLedger(root, context); }); return; } start(root); }); }
  window.WorkbenchViews.register('planned-01', openLedger);
}());
