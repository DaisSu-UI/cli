# Daisu UI CLI

Daisu UI 的离线组件知识库、ReactLynx 项目分析、MCP Server 与 Agent 接入工具。组件知识来自 Daisu UI 自身源码、文档与示例。

源码仓库：`git@git.zilueit.com:daisu-ui/cli.git`（[浏览源码](https://git.zilueit.com/daisu-ui/cli)）。组件库独立维护于 `git@git.zilueit.com:daisu-ui/daisu-ui.git`。

当前 CLI 版本为 `0.1.0-beta.2`；随包数据包含当前 `@daisu-ui/ui@0.1.0-beta.3` 与历史 daisu-ui 快照，使用 `daisu data list` 查看实际版本。npm 包名称预置为 `@daisu-ui/cli`，可执行命令为 `daisu`。**目前尚未发布到 npm**，先使用本地源码或 tarball；无需 API Key。

## 本地使用

需要 Node.js >= 20.19.0。

```bash
git clone git@git.zilueit.com:daisu-ui/cli.git
cd cli
npm ci
npm run build
node dist/index.js list
node dist/index.js info Button
node dist/index.js demo Button basic
```

生成并安装本地 npm 包后，可以直接使用 `daisu`：

```bash
npm pack
npm install -g ./daisu-ui-cli-0.1.0-beta.2.tgz
daisu info Button
```

包内包含版本化知识数据和 Skill。运行查询和 MCP 不依赖组件库源码目录，不访问网络，不自动检查远端更新。组件库发布新版本后，应重新提取并发布对应 CLI 数据。

## 命令

| 命令                                               | 用途                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `daisu list [keyword]`                             | 搜索组件、Hook、中文名、分类或用途                     |
| `daisu search <query> [--limit <count>]`           | 离线全文搜索组件与 LLM 约束文档，按来源去重            |
| `daisu info <component>`                           | 查询真实属性、事件、内容插槽、方法和 CSS 变量          |
| `daisu doc <component>`                            | 输出完整 Markdown 使用文档                             |
| `daisu demo <component> [demo]`                    | 列出示例，或输出指定示例；`source` 为完整交互源码      |
| `daisu token [component]`                          | 查询组件或全局 CSS 变量，主题 Token 包括已提取的明暗值 |
| `daisu changelog [releaseOrComponent] [component]` | 按发布版本或组件筛选更新记录                           |
| `daisu doctor [dir]`                               | 检查 Node、依赖、离线版本和 JSX 集成                   |
| `daisu usage [dir]`                                | 统计 TSX/JSX 组件和 Hook 使用情况                      |
| `daisu lint [dir]`                                 | 检查私有导入、未知导出/属性、空按钮和线程回调等问题    |

```bash
daisu list 导航
daisu info input-number --format json
daisu doc Segmented --format markdown
daisu demo Button                    # 列出示例
daisu demo Button demo-1             # 与 basic 等价
daisu demo Button 禁用
daisu demo Button source
daisu token Button
daisu changelog 0.1.0-beta.0
daisu changelog Button
```

组件名可用 `Button`、`button`、`按钮` 等形式。分组名称（如 `layout`）指向该组首个公开组件；查询 `Row`、`Col` 可获得各自 API。

查询和分析支持 `--format text|json|markdown`。JSON 写入 stdout，错误写入 stderr；`lint` 有错误时返回非零退出码，`--strict` 会将警告也视为失败。文档与示例在 text 模式下直接输出 Markdown 或源码。

### 版本选择

```bash
daisu info Button --version latest
daisu info Button --version 0.1.0-beta.1
daisu info Button --cwd /path/to/consumer
```

默认依次检查：项目实际安装的 `@daisu-ui/ui`（兼容历史 `daisu-ui`）、最近的 `package.json` 依赖声明、CLI 随包的最新数据。优先匹配实际安装的精确版本；声明为 semver 范围时选择范围内最高的离线版本。找不到对应版本会明确报错，不用其他版本冒充当前 API。

尚未安装的 `file:`、`workspace:` 等依赖无法确定精确版本，会报告警告并使用随包数据。可先安装依赖，或显式选择 `--version`。`daisu -V` / `daisu --version` 输出 CLI 版本；子命令后的 `--version <value>` 指组件库数据版本。

### 分析范围

扫描 `.ts`、`.tsx`、`.js`、`.jsx` 及其 c/m 扩展名，忽略生成目录、依赖、vendor 和符号链接。通过 TypeScript AST 和绑定符号识别来自公开入口的具名导入、别名、命名空间 JSX 与 Hook 调用；字符串、注释、同名局部变量和其他组件库不计入统计。

当前不做跨文件自定义 barrel 的完整重导出推导，也不替代消费项目的 `tsc`；lint 主要核对导出名、属性名和已知模式。内联回调未标记线程边界会给出警告，是否需要后台副作用应结合上下文判断。

## 数据与显式更新检查

```bash
daisu data list
daisu data check
daisu update                       # 只报告本地版本，不联网
daisu update --check               # 显式查询 npm，默认 beta CLI 查询 beta dist-tag
daisu update --check --tag latest
```

每个知识文件都有 SHA-256 摘要。查询会验证所选数据的摘要与结构，`data check` 检查全部快照和索引。它验证包内数据完整性；与当前 UI 源码是否一致，用下文 `sync --check` 验证。

`update --check` 只查询版本并给出安装建议，不执行安装，不影响查询命令或 MCP 的离线行为。包尚未发布时报告 `not-published`；失败或超时会给出状态。可通过 `--registry` 指定注册表、`--timeout` 指定检查超时。

## Agent 一键接入

在消费项目根目录运行：

```bash
daisu agent list
daisu agent init --client auto --dry-run
daisu agent init --client codex --dry-run
daisu agent init --client codex --yes
daisu agent status --client codex
daisu agent doctor --client codex
```

初始化和移除默认使用 `--client auto`：优先识别当前客户端的会话环境，再根据可执行文件和专用配置判断。共享 `.mcp.json` 本身不能区分 Claude、Qoder、CodeBuddy；候选不明确时要求显式指定，不会自动配置全部客户端。`agent list` / `mcp list` 显示探测依据，仅列环境变量名称，不输出变量值。

未全局安装时，将上面的 `daisu` 换为 `node /绝对路径/cli/dist/index.js`。

`agent init` 同时配置 MCP、安装 `daisu-ui` Skill、写入托管 Instructions。默认只修改项目文件，MCP 使用当前 Node 与 CLI 的绝对路径，可离线启动；新建配置文件权限为 0600。客户端仍可能要求重启、信任项目或批准 MCP。doctor 分别报告配置、独立工具调用和客户端登记；不会将一次独立握手标为会话验收。

| Client ID                     | 项目 MCP                                           | Skill                        | Instructions                      |
| ----------------------------- | -------------------------------------------------- | ---------------------------- | --------------------------------- |
| `claude`                      | `.mcp.json`                                        | `.claude/skills/daisu-ui`    | `CLAUDE.md`                       |
| `cursor`                      | `.cursor/mcp.json`                                 | `.cursor/skills/daisu-ui`    | `.cursor/rules/daisu-ui.mdc`      |
| `vscode`                      | `.vscode/mcp.json`                                 | `.github/skills/daisu-ui`    | `.github/copilot-instructions.md` |
| `codex`                       | `.codex/config.toml`                               | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `opencode`                    | `opencode.json[c]` 或 `.opencode/opencode.json[c]` | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `antigravity`                 | `.agents/mcp_config.json`                          | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `qoder` / `qoder-cli`         | `.mcp.json`                                        | `.qoder/skills/daisu-ui`     | `AGENTS.md`                       |
| `codebuddy` / `codebuddy-cli` | `.mcp.json`                                        | `.codebuddy/skills/daisu-ui` | `CODEBUDDY.md`                    |

`--client all` 是明确配置全部客户端的选择。共有的文件采用引用计数，移除一个客户端不会删除其他托管客户端仍使用的共享内容。CodeBuddy CLI 会复用已有 `mcp.json`；若新建更高优先级配置会遮蔽已有服务，则在写入前报错，先合并配置再重试；OpenCode 有多个配置文件时会要求先合并，以免遮蔽其他服务。

```bash
daisu agent init --client cursor --with skill,instructions --yes
daisu agent init --client all --yes
daisu agent remove --client cursor --dry-run
daisu agent remove --client cursor --yes
```

- `--dry-run` 仅展示计划，不创建目录、锁或配置。
- `--yes` 用于脚本和 Agent 明确确认写入；交互终端不带该参数时显示计划并确认。
- JSONC 保留其他字段和注释，TOML 仅编辑 Daisu 的独立服务表；不覆盖其他 MCP Server。
- `.daisu/cli-state.json` 记录本工具管理的内容和归属。不要手工删除它，移除时需要据此识别所有权。
- 初始化会拒绝覆盖未知或被修改的托管内容；移除会保留修改后的内容并给出提示。
- 文件计划执行前重新核对内容，写入使用临时文件与原子替换；失败时尽可能回滚。配置路径中的符号链接会被拒绝。
- 迁移 CLI 安装目录后，重新运行 `init` 更新绝对路径；先恢复或移除旧托管配置，不要通过删除清单强制覆盖。

### 用户范围与启动方式

```bash
daisu mcp init --client cursor --scope user --yes
```

`--scope user` 仅改变 MCP 位置，Skill 和 Instructions 仍在指定项目。VS Code 只支持 project；其他客户端的用户配置路径可通过 `daisu mcp list --format json` 查询。用户范围的工作目录由客户端启动环境决定，需要项目版本和读取边界稳定时优先使用 project scope。

默认 `--runner local` 不依赖 npm 注册表。工具发布到 npm 后，可选：

```bash
daisu mcp init --client cursor --runner npx --pin --yes
```

`npx` 模式首次启动可能访问网络。`--pin` 固定当前 CLI 版本，也可以使用 `--pin 0.1.0-beta.0` 固定一个明确的历史 CLI 版本；数据版本仍由 `--version` 控制。`--runner global` 生成 `daisu mcp serve`，要求客户端能在 PATH 找到全局命令。Qoder CLI 的 `QODER_CONFIG_DIR` 可覆盖用户配置目录。

自动配置针对表中 10 个客户端 ID；其他支持标准 stdio MCP 的客户端使用下面的手动配置。其他客户端需按其实际配置格式接入。

### 诊断结果的含义

```bash
daisu agent doctor --client codex
daisu mcp doctor --client claude --timeout 15000
daisu mcp doctor --client cursor --no-registration
```

- `server-ready`：当前 CLI 的 MCP 能列出工具、返回状态并真实查询 Button API。
- `registered`：支持查询的客户端 CLI 已识别 Daisu 服务；Codex 还会核对有效启动命令和工具过滤。
- `pending-approval`：客户端需要信任项目或批准服务；命令退出码为 2。
- `failed`：配置、服务调用或明确的客户端状态失败；退出码为 1。

目前 Codex、Claude Code、OpenCode 提供只读登记查询；其余客户端明确报告 `unsupported` 或需要手动确认。没有稳定查询入口时保留 `server-ready`，不会假报已登记。`sessionVerified` 始终为 false：仍需在实际客户端会话调用工具，独立进程无法代替这一步。

登记查询不会自动信任项目、修改工具过滤或启用服务，不执行项目目录中伪装的客户端程序，也不回显客户端原始输出中的凭据。`--no-registration` 可仅验证配置和离线 MCP 服务。`--timeout` 是本次诊断的整体时间预算，包含登记检查。

## MCP Server

```bash
daisu mcp                # 启动 stdio 服务
daisu mcp serve          # 等价写法
daisu mcp print --client cursor
daisu mcp init --client cursor --yes
daisu mcp status --client cursor
daisu mcp doctor --client cursor --timeout 15000
daisu mcp remove --client cursor --yes
```

只需要 MCP 时使用 `mcp init`，不会安装 Skill 和 Instructions。启动服务时 stdout 只写 JSON-RPC。

手动配置示例（将路径换成实际安装位置）：

```json
{
  "mcpServers": {
    "daisu-ui": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/cli/dist/index.js",
        "mcp",
        "serve",
        "--cwd",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

| Tool              | 功能                                                        |
| ----------------- | ----------------------------------------------------------- |
| `daisu_status`    | CLI、离线版本、当前数据与来源                               |
| `daisu_list`      | 发现组件和 Hook                                             |
| `daisu_search`    | 搜索完整文档与平台约束；query、可选 limit（1–20）与 version |
| `daisu_info`      | 查询组件 API                                                |
| `daisu_doc`       | 获取完整 Markdown                                           |
| `daisu_demo`      | 列出或读取示例                                              |
| `daisu_token`     | 查询 CSS 变量                                               |
| `daisu_changelog` | 筛选更新日志                                                |
| `daisu_lint`      | 检查项目源码用法                                            |
| `daisu_usage`     | 统计项目使用情况                                            |
| `daisu_doctor`    | 检查项目集成                                                |

还提供 `daisu://versions`、`daisu://components/{component}` 和 `daisu://guides/{guide}` 资源（guide：llms、llms-full、component-ai-notes；历史快照可能未收录）和 `daisu_component_usage` Prompt。项目分析工具只读取 MCP 启动目录内的目标路径，不跟随扫描树中的符号链接。

## 自动同步（默认本地开发）

本机保持 `DaiSu-UI/{daisu-ui,cli}` 布局、两个仓库均已安装开发依赖时，正常运行 CLI 的 `npm run build` 或 UI 的 `npm run build` / `npm run ui:docs:build`，会自动生成组件说明、导出 CLI 接入页面、刷新离线快照并校验数据。无需再单独执行 `sync` 和 `docs:export`。查询、MCP 和安装后的 CLI 不触发源码同步。

UI 的 `npm run ui:docs:dev` 在预览期间监听两个仓库：修改 UI 组件、说明或 CLI 接入实现后自动同步并重建文档；组件或 Demo 改动同时重建演示 Bundle。刷新浏览器查看结果。仅开发 CLI 可运行 `npm run dev`，持续监听并同步；Ctrl+C 会停止监听与子进程。事件合并、串行执行并过滤生成文件，避免互相触发；无内容变化时不改快照时间和生成文件。

无需本地路径配置。非同级目录可设置 `DAISU_UI_SOURCE`（CLI 找 UI）与 `DAISU_UI_CLI_SOURCE`（UI 找 CLI），显式配置错误会失败。`DAISU_UI_AUTO_SYNC=0` 关闭本地自动协作。只检出一个仓库或同级仓库未安装开发依赖时，使用已提交的资料独立构建。CI 自动切换为只读同步校验；CI 配置了源码路径时需先准备两端开发依赖与 CLI 构建产物，不在 CI 中修补待发布资料。

手工全流程和只读排查入口仍可使用：

```bash
npm run sync:auto
npm run sync:auto -- --check
```

## 更新知识库（独立维护入口）

数据同步只读取明确指定的 Daisu UI 仓库，不执行上游 TSX 或修改库文件，也不自动拉取 Git：

```bash
npm run sync -- --ui-dir /path/to/daisu-ui
npm run sync -- --ui-dir /path/to/daisu-ui --check  # 只校验源码/文档与快照是否一致
npm run build
npm test
npm run check:package
```

数据来自公开导出、TypeScript Props、组件分类、逐组件 Markdown、CSS、交互 Demo 和 CHANGELOG。按组件库版本写入 `data/<version>.json`，索引为 `data/versions.json`。提取多个版本时保留旧数据文件，以支持多版本查询；`latest` 指向已保存的最高 semver 版本，更新旧版本不会把 latest 降级。每份快照的摘要写入索引，历史数据摘要异常时停止同步。

元数据包含提取时间、源码提交、是否有未提交修改和完整输入摘要（包含实际读取的组件 TS/TSX、文档、样式和示例），便于核对数据来源。只发布通过检查的知识快照。

`@since`、`@deprecated` 和明确的 `@replacement` 从 Daisu 自身 JSDoc 提取。未标注的 API 不推测引入版本或替代接口。lint 对所有已标注组件、属性和 Hook 给出弃用提示；当前库没有标注时不会套用其他库的弃用记录。

快照写入使用同步锁、临时文件和失败恢复；`--check` 不写数据、索引或锁。可以直接运行 `extract` 做底层提取，日常建议用 `sync` 一起执行构建和完整性检查。

## 同步文档站接入说明

UI 仓库维护组件文档、LLM 约束、AGENTS 与维护者 Lynx 技能；CLI 维护命令、MCP、客户端和消费端 Skill。UI 仓库不再内置另一套 MCP。以下命令在 CLI 仓库运行：

```bash
npm run docs:export -- --ui-dir /path/to/daisu-ui
npm run docs:export -- --ui-dir /path/to/daisu-ui --check
```

生成 `apps/docs/ai/{overview,cli,mcp,skills}.md` 和 `cli-manifest.json`，命令与参数表来自实际 CLI 注册及 MCP 握手，客户端表格和手工配置片段来自真实适配器。页面覆盖安装、版本选择、终端查询、客户端配置、会话验证、Skill 生命周期及维护同步。提交这些输出到 UI 仓库，勿手工编辑；UI 独立构建只校验本地摘要；本地存在已安装依赖的同级 CLI 时自动协作，无需手工同步。CLI `--check` 比较实现与导出结果，严格只读；UI 的摘要检查发现生成页被修改，不能替代 CLI 的实现一致性检查。

正常构建自动完成 UI → CLI（知识快照）与 CLI → UI（接入页面）同步，显式命令保留作排查入口。默认离线验证不要求两个仓库同时存在。默认识别本地 `DaiSu-UI/{daisu-ui,cli}` 布局，也可用环境变量指定路径。

## GitLab CI 与发布前检查

`.gitlab-ci.yml` 沿用现有 Daisu UI 的旧版 GitLab 写法，使用 `only/except`，不复制 GitHub Actions。分支和版本 tag 执行完整验证并保存 npm tarball，CI 不自动发布 npm 或修改 Git。

```bash
npm run verify
```

此命令依次检查格式、类型、测试/构建、数据摘要、发布版本和独立包消费。若 GitLab 提供 `CI_COMMIT_TAG`，它必须与 CLI 的 `package.json` 版本一致。

CLI CI 默认校验已提交的离线快照；runner 若能读取 UI 仓库，可显式设置 `DAISU_UI_SOURCE` 为该仓库目录，追加源码和文档站接入页面一致性检查。实际 UI 版本更新后本地构建会自动同步，评审并提交生成结果即可，不构造不存在的历史版本。

## 开发验证

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run check:package
```

`check:package` 生成 `artifacts/` 下的 npm tarball，离线安装到临时消费者目录，再验证 API、文档与 MCP 配置计划，确认产物不依赖源码仓库。

源代码分为知识查询、TSX 分析、MCP、客户端适配与托管文件事务。修改命令、数据或配置行为时同步维护集成测试和本说明。
