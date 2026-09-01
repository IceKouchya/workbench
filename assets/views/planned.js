(function () {
  'use strict';

  function renderPlanned(root, context) {
    var number = context.route.slice(-2);
    root.innerHTML = '<div class="content-inner module-page">' +
      '<nav class="breadcrumb" aria-label="当前位置"><button class="breadcrumb-link" type="button">主页</button><span aria-hidden="true">/</span><span>' + context.title + '</span></nav>' +
      '<div><h1>' + context.title + '</h1><p class="intro">这是一个保留给未来扩展的独占工作区。</p></div>' +
      '<section class="planned-page" aria-labelledby="planned-page-heading"><span class="planned-number">' + number + '</span><h2 id="planned-page-heading">通用模块位置</h2><span class="planned-badge">规划中</span><p>尚未定义具体用途，因此不显示资料、数据或业务操作。</p></section>' +
      '<aside class="module-boundary"><p>边界</p><p>当前模块仅用于确认信息架构与独占页容器，不读取或修改任何权威资料。</p></aside>' +
      '</div>';
    root.querySelector('.breadcrumb-link').addEventListener('click', context.goHome);
  }

  ['planned-02', 'planned-03'].forEach(function (route) {
    window.WorkbenchViews.register(route, renderPlanned);
  });
}());
