# Workbench Assets

本目录保存 Workbench 的入口壳层资源，不包含任何权威资料或业务数据。

- `shell.css` 定义常驻侧栏、主内容容器与各视图共享样式。
- `router.js` 读取 hash，更新导航状态，并按需加载相应视图脚本。它维护 `window.WorkbenchViews` 注册表、失败重试和已打开视图的 DOM 缓存，避免返回模块时重置其临时状态。
- `router.test.js` 使用 Node 标准库模拟路由环境，验证失败重试、标题状态和视图返回缓存。
- `views/` 保存由路由协调器加载的视图渲染器；`views/tasks-data.js` 是个人待办的本地目录授权、标准 Markdown 解析与写入层；`views/taobao-flash-sale-ledger-data.js` 是淘宝闪购店铺台账独立的目录授权、固定 Markdown 解析、写入、删除与恢复边界。

## Hash 路由协议

允许的 hash 是 `#home`、`#tasks`、`#planned-01`、`#planned-02` 与 `#planned-03`。未知 hash 会替换为 `#home`。浏览器刷新、书签、前进和后退均由 `hashchange` 恢复当前视图。

首次打开一个尚未加载的路由时，路由器显示“正在打开模块”；脚本加载失败则显示“模块暂不可用”，同时保留可用侧栏，并清除失败脚本的加载缓存以允许再次进入时重试。已成功加载的视图脚本不会被重复插入；成功渲染的视图 DOM 会在离开时暂存，返回时原样恢复。

## 视图注册协议

每个视图以普通相对路径脚本加载，并调用：

```js
window.WorkbenchViews.register('route-name', function (root, context) {
  // Render only into root.
});
```

`context` 提供当前 `route`、页面 `title` 及 `goHome()`。渲染器不得直接读取、写入或同步权威资料；`views/tasks.js` 只能通过专用的 `views/tasks-data.js`，在用户主动目录授权后读写 `20-tasks-and-planning/planning/` 标准 Markdown；`views/taobao-flash-sale-ledger.js` 只能通过 `views/taobao-flash-sale-ledger-data.js` 访问两份固定的淘宝运营 Markdown。共享视图必须为每个可访问路由登记独立的注册项。
