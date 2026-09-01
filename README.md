# Workbench

Workbench 是独立的本地工作区控制台源码入口，不是 DSH 插件。它只提供展示与进入位置的页面框架；Markdown、Canvas、日志、待办和既有插件仍是各自资料的权威来源。

## 运行

直接在浏览器中打开 `index.html`。项目不依赖本地服务器：入口和按需视图脚本均使用相对路径，因此也支持 `file:///`。

主页默认位于 `#home`；可使用 `#tasks`、`#planned-01`、`#planned-02` 或 `#planned-03` 直接打开对应模块。`#planned-01` 是“淘宝闪购店铺台账”的稳定 URL；未知 hash 自动回主页。

## 文件地图

- `index.html`：唯一 HTML 入口，保留常驻侧栏和主内容挂载区。
- `assets/shell.css`：壳层和全部视图共用的页面样式。
- `assets/router.js`：hash 路由、首次视图脚本加载、导航状态、失败重试和视图临时状态恢复协调。
- `assets/router.test.js`：路由失败恢复、标题状态和视图缓存的无依赖行为测试。
- `assets/views/`：独立的主页、个人待办与共享预留模块渲染器，详见其 README。

## 项目资料

代码之外的项目全景、范围、计划、记录、Canvas 与模块方案统一维护在 [`../../obsidian-vault/Projects/workbench/`](../../obsidian-vault/Projects/workbench/)：

- [`Overview.md`](../../obsidian-vault/Projects/workbench/Overview.md)：项目范围、权威资料边界、验收口径与有效补丁。
- [`Plan.md`](../../obsidian-vault/Projects/workbench/Plan.md)：当前计划和下一步。
- [`Notes.md`](../../obsidian-vault/Projects/workbench/Notes.md)：长期约定与项目记录。
- [`workbench.canvas`](../../obsidian-vault/Projects/workbench/workbench.canvas)：项目关系与状态的可视化版本。

代码行为、运行方式和技术实现仍以本仓库的 README、`index.html`、`assets/` 与测试为准。

## 当前边界

个人待办已是受控的本地 Markdown 模块：仅在 Chrome/Edge 直接打开 `file:///` 页面、由用户主动选择 `20-tasks-and-planning` 父目录后，自动定位并使用其 `planning/` 子目录。它可操作一次性待办、按月的已完成事项和周期计划；周期任务的单日完成状态只存于浏览器 localStorage。

淘宝闪购店铺台账使用独立的授权记录与资料层：在 Chrome/Edge 的 `file:///` 页面由用户主动选择 `40-business-and-operations` 父目录后，它只访问 `operations/淘宝运营/淘宝闪购软件登录店铺台账.md` 和同目录的 `淘宝闪购软件登录店铺删除记录.md`。它固定显示 8 个软件实例及每实例 5 个槽位，支持全局筛选、增改、确认删除和删除记录驱动的恢复；格式、权限或预期文本异常时不生成假数据或覆盖外部修改。当前实现和 Node 测试已完成，真实目录授权后的端到端 CRUD 仍待修在本机浏览器验收。

不启动服务、不联网、不使用扩展、API、DSH 插件、云同步或账号系统；不读取、修改或管理长任务，长任务索引保留在 `20-tasks-and-planning/tasks/任务索引.md`。预留模块 02 与 03 持续标为“规划中”，没有数据、业务操作或已定义用途。

## 当前新增补丁

### 2026-08-31：主页总览与模块独占视图

**状态：`已实现，待验收`。** 本补丁覆盖项目起始状态中与当前实现直接冲突的“没有可运行页面”表述；原始记录仍保留决策历史。

单一 `index.html` 入口已保留常驻侧栏与主内容挂载区。主页是总览，个人待办和预留模块均替换右侧主内容区为独占页。视图、壳层样式和 hash 路由已分离，预留模块 01-03 共用一个视图实现。仍需按执行票完成实际页面级验收后，才能标记为已验收。
