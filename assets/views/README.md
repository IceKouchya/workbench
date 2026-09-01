# Workbench Views

视图渲染器只负责生成传入主内容挂载区的 HTML；常驻侧栏、hash 路由、标题和加载失败处理属于 `../router.js`。

- `home.js`：主页总览，提供 Personal Tasks 的无数据入口卡片与预留模块入口卡片。
- `tasks.js`：个人待办独占页，负责授权状态、初始化状态和工作区渲染；真实资料操作由 `tasks-data.js` 提供。
- `taobao-flash-sale-ledger.js`：淘宝闪购店铺台账独占页，负责授权、分组、筛选、表单、确认删除与恢复选择；只调用同名资料层。
- `taobao-flash-sale-ledger-data.js`：台账唯一的 File System Access API、独立 IndexedDB 授权句柄、固定 Markdown 解析/写入、校验、删除和恢复边界。
- `planned.js`：预留模块 02-03 的共享独占页，通过当前路由编号渲染页面，持续展示“规划中”。

新增模块时，在 `../router.js` 添加允许 hash 与脚本路径，再在对应视图脚本中通过 `window.WorkbenchViews.register()` 登记渲染函数。不要复制无差异预留页；存在共同结构的模块应共享同一渲染器。
