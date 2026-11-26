# 更新日志

## 0.1.0-beta.5

- 修复新 Runner 的离线安装包校验和 CI 凭据对测试的影响，通过 GitLab 自动发布 npm 首页居中修正版。

## 0.1.0-beta.4

- npm 默认首页采用居中 Logo、标题、徽章与导航，补齐公开图片和 HTTPS 包元数据。
- 区分 developer 开发与 main 发布分支，通过版本标签自动验证并发布 npm，校验产物摘要、版本与源码来源，支持重复任务核对。

## 0.1.0-beta.3

- npm README 使用品牌 Logo 与居中头部，统一标题、简介、徽章、导航和首屏分隔布局。
- 使用公开可加载的徽章，新增随包分发的品牌图标；补齐 HTTPS 仓库、主页和问题反馈地址。

## 0.1.0-beta.2

- 首次以 `@daisu-ui/cli` 发布到 npmjs，提供 `beta` 标签安装与 npx 用法；收录 `@daisu-ui/ui@0.1.0-beta.3` 并兼容历史组件包名。

- 兼容当前 @daisu-ui/ui 包名及历史 daisu-ui 快照；项目检测、源码检查和知识提取按真实公开入口工作。

- 完善 AI 总览、CLI 安装与版本选择、MCP 客户端配置和会话验证、Skill 生命周期；配置示例与客户端表格从适配器生成，统一独立源码仓库入口。

- 本地 UI/CLI 构建自动同步，文档开发与 CLI dev 支持串行监听；CI 只读校验，单仓库独立运行。无内容变化不改生成文件与快照时间。

- UI 接入说明统一由 CLI 导出为文档站页面，命令和 MCP 表来自实际注册；附生成摘要和严格只读的一致性检查。
- 增加离线全文搜索命令及 daisu_search，按来源文档去重，限制结果数量。
- 收录 UI 的 LLM 与逐组件约束，通过 daisu://guides/{guide} 读取；保留历史版本快照。
- 独立 tarball 验收覆盖文档导出、搜索与约束资源；CI 可同时检查 UI 知识和接入说明。

## 0.1.0-beta.1

2026-11-25 · 开发中，尚未发布到 npm

- 增加有依据的客户端自动识别；候选不明确时要求指定。
- Codex、Claude Code、OpenCode 增加只读登记查询，区分服务可调用、已登记、待批准和未知状态。
- 增加工具过滤、禁用状态和启动命令覆盖诊断；保留实际会话需单独确认的说明。
- 从真实 JSDoc 提取 since、deprecated、replacement，支持组件、属性和 Hook 弃用诊断。
- 增加 data list/check、快照摘要、完整源码输入指纹和 sync --check。
- 增加仅显式联网的 update --check，不自动检查或安装更新。
- 增加符合现有旧版 GitLab 的 CI、统一 verify 和发布版本校验，保留手动发布方式。

## 0.1.0-beta.0

2026-11-25 · 开发中，尚未发布到 npm

- 提供 Daisu UI 离线 API、文档、示例、主题变量和更新记录查询。
- 从独立 UI 仓库提取版本化数据，不依赖主业务工程。
- 提供 ReactLynx TSX/JSX 项目诊断、使用统计和 lint。
- 提供 stdio MCP、10 个只读工具、组件文档资源与使用 Prompt。
- 提供 10 个客户端 ID 的 Agent/MCP 配置生命周期、Skill 与 Instructions。
- 支持 dry-run、幂等更新、共享内容归属、原子替换和修改保护。
- 默认从本地 CLI 启动 MCP，支持 npm tarball 离线独立消费检查。
