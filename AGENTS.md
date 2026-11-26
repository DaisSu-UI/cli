# Daisu UI CLI

Git 提交信息的标题和正文统一使用中文；技术名称、版本号和标识符保留原文。

这是独立的 Node.js CLI、MCP 与离线知识库项目。src 放实现，scripts/extract.mjs 从选定的 daisu-ui 仓库提取元数据，data 放随包数据，skills 放消费端技能。

命令和 MCP 知识查询离线运行；不要在查询时调用远端文档或自动安装依赖。ReactLynx 消费代码通过 TypeScript AST 分析，不执行被扫描的代码。维护客户端配置时保留其他 MCP Server 和用户内容，仅移除有归属且指纹匹配的托管部分。

修改命令、数据结构或接入行为时同步 README 和相关集成测试。实现、数据或配置修改完成后集中运行 npm run format:check、npm run typecheck、npm test、npm run check:package；npm test 已包含构建，同一输入不再单独重复 npm run build。纯文案修改按下文验证节奏处理。不要在测试中修改真实用户的客户端配置；使用临时项目和 home 目录。

## 执行范围与验证节奏

- 先用日志或最小复现定位问题，再完成最小必要修复。只修改本次目标需要的文件、依赖和仓库；版本升级、发布、部署、快照提取、示例整理与跨仓库同步须为目标所需且已有授权。
- 集中完成修改后统一验证；同一源码、依赖、配置及产物输入未变且检查已通过时复用结果。仅在检查失败、相关输入改变或新增证据表明需要复查时，重跑受影响的检查。
- 执行复合脚本前查看 package.json，识别内置构建、生成与同步，避免重复执行。共享产物的写入串行进行；独立的读取和检查可以并行。无需联动 UI 时，代理构建使用 `DAISU_UI_AUTO_SYNC=0`。
- 纯说明和 AGENTS.md 文案修改只做差异及相关格式检查；修改生成来源、命令示例或配置契约时补做对应校验。不要为纯文字修改运行全量测试、构建、快照同步或发版。
- 等待 CI 或注册表传播时说明正在等待什么，按合理间隔查询并持续报告进展；不因等待扩展任务范围。相同环境限制重复失败时保留证据，选择明确的替代验证或说明阻塞，避免反复试探。

客户端探测不得把共享配置当作某一产品的唯一证据，登记检查不自动修改信任或工具过滤。更新检查只在显式 update --check 时联网。元数据生命周期只读取真实 JSDoc；sync --check 必须只读。默认仓库为 GitHub DaisSu-UI/cli，GitHub Actions 验证分支与 PR，只从已合入 main 的对应版本 Tag 自动发布。developer 为开发分支，main 为发布分支。保留的旧版 GitLab 配置仍需兼容 GitLab 10.5 / Runner 11.11，不使用 rules/needs。

CLI 接入说明由 src/site-docs.ts 生成，命令与工具表从实际注册读取。docs export --ui-dir <仓库> 将页面和摘要清单导出到 UI；--check 严格只读，不依赖固定的本机目录。组件说明与平台约束由 UI 维护并提取为快照，不能在 CLI 内另写一套组件 API 文档。

本地开发默认识别已安装依赖的同级 daisu-ui；构建自动同步，dev 持续监听。可用 DAISU_UI_SOURCE 指定目录或 DAISU_UI_AUTO_SYNC=0 关闭，单仓库必须独立构建。CI 自动只读；查询和已安装的 CLI 不触发源码协作。新增同步行为保持生成结果幂等，过滤输出目录并串行处理修改。

CI 发布复用 verify 产物，不重新构建；核对远端 main、精确版本、源提交和 SHA-512。NPM_TOKEN 只来自 CI Secrets，GitHub Actions 仅在发布步骤读取，不提交或输出。修改发布流程时运行 npm run test:release 与 npm run verify；相同版本的重试只在远端摘要一致时跳过。

GitHub → GitLab 同步只推送 main / developer 同名分支，不强推、不同步发布标签；仅使用专用 Deploy Key Secret 和已核对的主机公钥，临时私钥在作业结束后清理。
