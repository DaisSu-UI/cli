---
name: daisu-ui
description: 查询并使用 Daisu UI 的 ReactLynx 组件、Hook、主题和公开 API；适用于 Daisu UI 页面编写、重构和组件用法排查。
---

# Daisu UI

Daisu UI 是 ReactLynx 组件库。组件 API、示例和平台能力随版本变化。先用 daisu data list / doctor 或 MCP daisu_status 核对实际选择的组件数据版本，再使用本地 Daisu CLI 或对应 MCP tools 查询所需内容。

- `daisu list <关键词>`：按中英文名称、分类、用途查找组件。
- `daisu info <组件>`：核对公开属性、事件、内容插槽、方法和主题变量。
- `daisu demo <组件>` 列出示例；`daisu demo <组件> basic` 读取基本用法，`source` 读取交互示例源码。
- `daisu doc <组件>`：读取完整使用说明与平台边界。
- `daisu search "关键词"`：全文检索组件说明与平台约束；可用 `--limit 8` 限制结果。
- `daisu token <组件>`：查询 CSS 变量。
- `daisu doctor .`、`daisu usage .`、`daisu lint .`：检查 ReactLynx 工程、统计和诊断 TSX/JSX 用法。

MCP 查询工具包括 daisu_list、daisu_search、daisu_info、daisu_doc、daisu_demo 与 daisu_token；项目诊断为 daisu_doctor、daisu_usage 和 daisu_lint。CLI 自身 --version 与查询命令的 --version <组件版本> 含义不同。

查询可加 `--format json`。默认匹配项目安装的 daisu-ui 版本；没有对应离线数据时应更新知识库，不要把其他版本当作当前版本。

当前组件包从 `@daisu-ui/ui`、`@daisu-ui/ui/router`、`@daisu-ui/ui/utils` 等公开入口导入；历史版本按查询结果的 importFrom 使用对应公开入口，不引用库内源码。组件入口自动加载 CSS。使用 Lynx 的 `view`、`text`、`image` 等元素及 `@lynx-js/react`；不要混用 Vue 的 v-model、uni-app 或其他组件库属性。

Bundle 引擎目标、类型依赖与宿主元素注册按所选组件版本的文档核对；不要把新版本的 Lynx 4.0 基线套用到历史快照，也不要把编译成功等同于原生设备验收。

跨组件传递、包含状态更新或宿主调用的事件函数按 ReactLynx 双线程规则标记 `'background only'`；不使用 `useLayoutEffect`。浏览器媒体、裁剪和原生能力的支持范围以当前组件文档为准，Web 演示不等于设备验证。

CLI 已通过 @daisu-ui/cli@latest 分发。若全局命令不在 PATH 中，使用项目已配置的 Daisu MCP tools、项目开发依赖的 npx --no-install daisu 或当前 CLI 的绝对入口。手工配置的全局 MCP 使用 command=daisu、args=[mcp]，客户端工作目录需指向消费项目。

若查询结果包含明确的弃用标记，按文档中的替代接口调整；没有标注时不推测弃用或引入版本。MCP 诊断需区分服务调用、客户端登记与实际会话工具可用，不能把独立握手当作客户端已启用。
