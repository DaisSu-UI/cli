# Daisu UI CLI

这是独立的 Node.js CLI、MCP 与离线知识库项目。src 放实现，scripts/extract.mjs 从选定的 daisu-ui 仓库提取元数据，data 放随包数据，skills 放消费端技能。

命令和 MCP 知识查询离线运行；不要在查询时调用远端文档或自动安装依赖。ReactLynx 消费代码通过 TypeScript AST 分析，不执行被扫描的代码。维护客户端配置时保留其他 MCP Server 和用户内容，仅移除有归属且指纹匹配的托管部分。

修改命令、数据结构或接入行为时同步 README 和相关集成测试。完成后运行 npm run format:check、npm run typecheck、npm test、npm run build、npm run check:package。不要在测试中修改真实用户的客户端配置；使用临时项目和 home 目录。

客户端探测不得把共享配置当作某一产品的唯一证据，登记检查不自动修改信任或工具过滤。更新检查只在显式 update --check 时联网。元数据生命周期只读取真实 JSDoc；sync --check 必须只读。CI 沿用组件库的旧版 GitLab 约束，不使用 rules/needs；发布仍由使用方明确执行。

CLI 接入说明由 src/site-docs.ts 生成，命令与工具表从实际注册读取。docs export --ui-dir <仓库> 将页面和摘要清单导出到 UI；--check 严格只读，不依赖固定的本机目录。组件说明与平台约束由 UI 维护并提取为快照，不能在 CLI 内另写一套组件 API 文档。

本地开发默认识别已安装依赖的同级 daisu-ui；构建自动同步，dev 持续监听。可用 DAISU_UI_SOURCE 指定目录或 DAISU_UI_AUTO_SYNC=0 关闭，单仓库必须独立构建。CI 自动只读；查询和已安装的 CLI 不触发源码协作。新增同步行为保持生成结果幂等，过滤输出目录并串行处理修改。
