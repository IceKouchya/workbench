(function () {
  'use strict';

  var routes = {
    home: { title: '主页', script: 'assets/views/home.js' },
    tasks: { title: '个人待办', script: 'assets/views/tasks.js' },
    'planned-01': { title: '淘宝闪购店铺台账', script: 'assets/views/taobao-flash-sale-ledger.js' },
    'planned-02': { title: '预留模块 02', script: 'assets/views/planned.js' },
    'planned-03': { title: '预留模块 03', script: 'assets/views/planned.js' }
  };
  var registry = {};
  var pendingScripts = {};
  var cachedViews = {};
  var currentRoute = null;
  var root = document.getElementById('view-root');
  var navEntries = document.querySelectorAll('[data-route]');

  window.WorkbenchViews = {
    register: function (route, render) {
      registry[route] = render;
    }
  };

  function routeFromHash() {
    var route = window.location.hash.slice(1);
    return Object.prototype.hasOwnProperty.call(routes, route) ? route : 'home';
  }

  function updateNavigation(route) {
    navEntries.forEach(function (entry) {
      var active = entry.dataset.route === route;
      entry.classList.toggle('nav-entry--active', active);
      entry.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function showLoading(route) {
    preserveCurrentView();
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<div class="content-inner"><div class="loading-state"><h1>正在打开模块</h1><p>正在加载页面结构。</p></div></div>';
    document.title = '工作台 | ' + routes[route].title + ' | 正在打开';
  }

  function showFailure(route) {
    root.setAttribute('aria-busy', 'false');
    root.innerHTML = '<div class="content-inner"><div class="error-state"><h1>模块暂不可用</h1><p>' + routes[route].title + ' 的页面结构未能加载。侧栏仍可用于返回其他位置。</p></div></div>';
    document.title = '工作台 | ' + routes[route].title + ' | 模块暂不可用';
  }

  function loadScript(route) {
    var routeConfig = routes[route];
    if (registry[route]) {
      return Promise.resolve();
    }
    if (pendingScripts[routeConfig.script]) {
      return pendingScripts[routeConfig.script];
    }

    pendingScripts[routeConfig.script] = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = routeConfig.script;
      script.onload = function () {
        registry[route] ? resolve() : reject(new Error('View did not register: ' + route));
      };
      script.onerror = function () { reject(new Error('Unable to load: ' + routeConfig.script)); };
      document.head.appendChild(script);
    }).catch(function (error) {
      delete pendingScripts[routeConfig.script];
      throw error;
    });
    return pendingScripts[routeConfig.script];
  }

  function preserveCurrentView() {
    if (!currentRoute || !root.firstChild) {
      return;
    }
    cachedViews[currentRoute] = document.createDocumentFragment();
    while (root.firstChild) {
      cachedViews[currentRoute].appendChild(root.firstChild);
    }
    currentRoute = null;
  }

  function render(route) {
    var renderer = registry[route];
    preserveCurrentView();
    root.setAttribute('aria-busy', 'false');
    if (cachedViews[route]) {
      root.appendChild(cachedViews[route]);
    } else {
      root.innerHTML = '';
      renderer(root, {
        route: route,
        title: routes[route].title,
        goHome: function () { window.location.hash = '#home'; }
      });
    }
    currentRoute = route;
    document.title = '工作台 | ' + routes[route].title;
  }

  function handleRoute() {
    var route = routeFromHash();
    if (window.location.hash !== '#' + route) {
      window.location.replace('#' + route);
      return;
    }
    updateNavigation(route);
    if (registry[route]) {
      render(route);
      return;
    }
    showLoading(route);
    loadScript(route).then(function () {
      if (routeFromHash() === route) {
        render(route);
      }
    }).catch(function () {
      if (routeFromHash() === route) {
        showFailure(route);
      }
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}());
