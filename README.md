<p align="center">
  <a href="https://www.npmjs.com/package/@daisu-ui/cli">
    <img src="https://cdn.jsdelivr.net/npm/@daisu-ui/cli@0.1.0-beta.3/assets/daisu-ui-icon.svg" width="96" height="96" alt="Daisu UI CLI">
  </a>
</p>

<h1 align="center">@daisu-ui/cli</h1>

<p align="center"><strong>让 AI 准确使用 Daisu UI。</strong></p>

<p align="center">
  把组件 API、文档、示例和版本知识，接入你的终端与 AI 编程工具。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daisu-ui/cli"><img src="https://img.shields.io/npm/v/%40daisu-ui%2Fcli?style=flat-square&amp;color=1c64fd&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@daisu-ui/cli"><img src="https://img.shields.io/badge/downloads-new%20package-868e96?style=flat-square" alt="npm downloads: new package"></a>
  <a href="https://github.com/DaisSu-UI/cli"><img src="https://img.shields.io/badge/source-GitHub-181717?style=flat-square" alt="GitHub source"></a>
  <a href="https://github.com/DaisSu-UI/cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-74a600?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/DaisSu-UI/daisu-ui">组件库</a>
  · <a href="#-30-秒接入">快速开始</a>
  · <a href="#agent-接入">Agent 接入</a>
  · <a href="#在终端使用">CLI</a>
  · <a href="#只配置-mcp">MCP</a>
  · <a href="#开发与贡献">参与贡献</a>
</p>

---

Daisu UI 是面向 **ReactLynx** 的组件库。这个工具将真实的公开类型、组件说明、CSS 变量、交互示例和更新记录打包为离线知识库，通过 CLI、MCP 和消费端 Skill 提供给开发者与 AI Agent。

- **查询真实 API**：核对 Props、事件、内容插槽、方法、CSS 变量和示例源码。
- **匹配项目版本**：识别安装依赖，也可指定已收录的精确版本或 semver 范围。
- **离线使用知识**：数据随 npm 包分发，查询不需要文档服务、API Key 或网络。
- **保留用户配置**：支持 dry-run、幂等写入、原子替换与失败回滚，按归属管理接入内容。

## 🚀 30 秒接入

需要 **Node.js >= 20.19.0**。当前为预发布版本，使用 `latest` 标签安装当前版本。

```bash
npm install -g @daisu-ui/cli@latest
```

进入使用组件库的项目，配置你的 AI 客户端：

```bash
daisu agent init --client cursor
daisu agent doctor --client cursor
```

默认会配置三部分：

| 能力             | 作用                                        |
| ---------------- | ------------------------------------------- |
| MCP Server       | 让 AI 按需调用 11 个 Daisu UI 工具          |
| `daisu-ui` Skill | 提供组件选择、查询顺序与 ReactLynx 使用约束 |
| Instructions     | 提醒 AI 在生成代码前查询真实 API 并完成验证 |

按实际客户端替换 `cursor`：

| Claude Code | Cursor   | VS Code  | Codex   | OpenCode   |
| ----------- | -------- | -------- | ------- | ---------- |
| `claude`    | `cursor` | `vscode` | `codex` | `opencode` |

| Antigravity   | Qoder IDE | Qoder CLI   | CodeBuddy IDE | CodeBuddy CLI   |
| ------------- | --------- | ----------- | ------------- | --------------- |
| `antigravity` | `qoder`   | `qoder-cli` | `codebuddy`   | `codebuddy-cli` |

配置完成后，按客户端要求重新加载项目、信任项目或启用 MCP。`doctor` 的独立握手通过后，还需要在实际 AI 会话调用 `daisu_status`、`daisu_list` 确认工具可用。

同时使用多个客户端时：

```bash
daisu agent init --client all
daisu agent doctor --client all --timeout 30000
```

`all` 明确选择全部支持的客户端；用户范围只处理支持 `--scope user` 的客户端。共享配置会合并写入，避免重复插入。

## 它解决什么问题

缺少组件上下文时，AI 可能生成不存在的属性、混用其他框架的 API，或把浏览器演示能力当作原生支持。Daisu CLI 在写代码前补上当前版本的组件知识与平台边界。

```text
Daisu UI 源码、文档、Demo、更新记录
                  │
             版本化离线知识库
                  │
         ┌────────┼────────┐
        CLI      MCP      Skill + Instructions
                  └────────┴──→ 你的 AI 编程工具
```

也可以把它当作独立的组件查询工具：

```bash
daisu info Button
```

```text
Button · Button 按钮
公开入口：@daisu-ui/ui

Props
- label: string — 按钮文本
- tone: ButtonTone = primary — 语义颜色
- variant: ButtonVariant = solid — 按钮外观
- size: ButtonSize = medium — 按钮尺寸
- loading: boolean = false — 加载状态
- disabled: boolean = false — 禁用状态

Events
- onTap: () => void — 点击按钮时触发
```

以上为输出节选。实际返回由所选组件数据版本决定。组件入口自动加载样式，无需另写 `import '@daisu-ui/ui/styles.css'`。

## Agent 接入

`agent init` 是推荐入口，同时管理 MCP、消费端 Skill 和 Instructions。请在**消费项目**运行，而不是把 CLI 源码仓库当作目标项目。

```bash
daisu agent list
daisu agent init --client cursor --dry-run
daisu agent init --client cursor
daisu agent status --client cursor
daisu agent doctor --client cursor
daisu agent remove --client cursor --dry-run
```

- `--dry-run` 只展示计划，不创建或修改文件。
- 交互式写入先确认；脚本、Agent 或 CI 中显式添加 `--yes`。
- 重复执行 `init` 不会重复插入配置。
- `remove` 只处理本工具托管且内容指纹匹配的部分，保留修改过的内容及其他服务。
- `--scope user` 只改变 MCP 配置位置；Skill 与 Instructions 仍写入所选项目。
- `.daisu/cli-state.json` 保存托管归属，不要通过手工删除它来强制覆盖配置。

只接入部分能力：

```bash
daisu agent init --client codex --with mcp --yes
daisu agent init --client claude --with skill,instructions --yes
```

复制下面的需求给 AI，也可以由它按计划完成接入：

```text
请在当前项目接入 Daisu UI。
先使用 daisu agent list 确认客户端，再用 agent init --dry-run 查看变更。
接入后运行 agent doctor，并在实际客户端调用 daisu_status 和 daisu_list。
生成 ReactLynx 代码前查询真实 API、文档和示例，说明目标平台的能力边界。
完成后运行当前项目自己的类型检查、测试和构建。
```

### 客户端文件位置

| Client ID                     | 项目 MCP                                           | 项目 Skill                   | 项目 Instructions                 |
| ----------------------------- | -------------------------------------------------- | ---------------------------- | --------------------------------- |
| `claude`                      | `.mcp.json`                                        | `.claude/skills/daisu-ui`    | `CLAUDE.md`                       |
| `cursor`                      | `.cursor/mcp.json`                                 | `.cursor/skills/daisu-ui`    | `.cursor/rules/daisu-ui.mdc`      |
| `vscode`                      | `.vscode/mcp.json`                                 | `.github/skills/daisu-ui`    | `.github/copilot-instructions.md` |
| `codex`                       | `.codex/config.toml`                               | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `opencode`                    | `opencode.json[c]` 或 `.opencode/opencode.json[c]` | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `antigravity`                 | `.agents/mcp_config.json`                          | `.agents/skills/daisu-ui`    | `AGENTS.md`                       |
| `qoder` / `qoder-cli`         | `.mcp.json`                                        | `.qoder/skills/daisu-ui`     | `AGENTS.md`                       |
| `codebuddy` / `codebuddy-cli` | `.mcp.json`                                        | `.codebuddy/skills/daisu-ui` | `CODEBUDDY.md`                    |

默认 `--runner local` 使用当前 Node 与 CLI 的绝对路径，MCP 启动不需要下载依赖。迁移 CLI 安装位置后，按提示重新初始化配置。用户范围由客户端启动环境决定工作目录，需要固定项目版本与读取边界时优先使用项目范围。

OpenCode 复用唯一的已有配置；存在多个候选文件时要求先合并。CodeBuddy CLI 可复用项目已有的 `mcp.json`，用户配置按 `~/.codebuddy/.mcp.json`、`~/.codebuddy/mcp.json`、`~/.codebuddy.json` 依次查找；会遮蔽已有服务时，在写入前停止。Qoder CLI 支持 `QODER_CONFIG_DIR`。

## 在终端使用

全局安装后使用 `daisu`，也可以按需运行：

```bash
npx -y @daisu-ui/cli@latest info Button
pnpm dlx @daisu-ui/cli@latest info Button
```

项目开发依赖方式：

```bash
npm install --save-dev @daisu-ui/cli@latest
npx --no-install daisu info Button
```

安装和首次 package runner 下载需要网络；安装后的本地知识查询不联网。组件包是 `@daisu-ui/ui`，CLI 包是 `@daisu-ui/cli`，两者分别安装、独立版本管理。

### 组件知识

| 命令                                               | 用途                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| `daisu list [keyword]`                             | 按中英文名称、分类或用途发现组件、Hook 和公开 API |
| `daisu search <query> --limit 8`                   | 全文检索组件说明及平台约束，按来源文档去重        |
| `daisu info <component>`                           | 查询 Props、事件、内容插槽、方法和 CSS 变量       |
| `daisu doc <component>`                            | 输出完整 Markdown 文档                            |
| `daisu demo <component> [demo]`                    | 列出或读取示例；`source` 读取完整交互源码         |
| `daisu token [component]`                          | 查询组件或全局 CSS 变量                           |
| `daisu changelog [releaseOrComponent] [component]` | 按版本或组件查询更新记录                          |

```bash
daisu list 表单
daisu info Button
daisu doc Segmented
daisu demo Button basic
daisu demo Button source
daisu search "受控" --limit 8
daisu token Button
```

组件名支持公开名称、目录 ID 和中文名。分组 ID 指向组内首个公开组件，查询 `Row`、`Col` 等具体名称可获得各自 API。

### 项目分析

| 命令                 | 用途                                                   |
| -------------------- | ------------------------------------------------------ |
| `daisu doctor [dir]` | 检查 Node、依赖、数据版本和 JSX 集成                   |
| `daisu usage [dir]`  | 统计 TSX/JSX 中的组件和 Hook 使用                      |
| `daisu lint [dir]`   | 检查私有导入、未知导出或属性、空按钮及已知线程回调模式 |

采用 TypeScript AST 识别具名导入、别名和命名空间 JSX，不执行被扫描代码，不跟随扫描树中的符号链接，忽略依赖、生成目录和 vendor。

### 版本与结构化输出

```bash
daisu -V
daisu data list
daisu info Button --version 0.1.0-beta.3
daisu info Button --version 0.1.0-beta.1
daisu list --version latest --format json
daisu data check
```

当前 Git 仓库已收录 `@daisu-ui/ui@0.1.0-beta.4` 及历史快照；已发布的 npm CLI 按各自版本携带数据，不随 Git 自动更新，实际收录范围用 `daisu data list` 核对。默认优先识别项目实际安装版本，再检查依赖声明，最后使用随包最新数据；找不到对应版本会明确报错。尚未安装的本地路径或 Git 依赖无法确定版本时，会给出提示。历史版本的导入路径以查询结果中的 `importFrom` 为准。

查询支持 `--format text|json|markdown`。JSON 结果写入 stdout，提示包含在 warnings 字段中；非 JSON 模式将提示写入 stderr，错误仍写入 stderr；`lint` 有错误时返回非零退出码，`--strict` 将警告也视为失败。`daisu --version` 是 CLI 版本，子命令的 `--version <值>` 是组件数据版本。

`daisu update` 只报告本地版本；只有显式运行 `daisu update --check` 才会查询 npm 更新，不自动安装。

## 只配置 MCP

只需要工具调用时使用 `mcp`，不会安装 Skill 或 Instructions：

```bash
daisu mcp list
daisu mcp init --client cursor --dry-run
daisu mcp init --client cursor
daisu mcp status --client cursor
daisu mcp doctor --client cursor
daisu mcp remove --client cursor
```

直接启动 stdio 服务：

```bash
daisu mcp
daisu mcp serve
```

预览配置使用 `daisu mcp print --client cursor`。可选 `--runner npx --pin` 固定当前 CLI 版本，或 `--runner global` 使用 PATH 中的 `daisu`；npx 首次启动可能需要网络。

### 11 个 MCP 工具

| Tool              | 功能                          |
| ----------------- | ----------------------------- |
| `daisu_status`    | CLI、数据版本、来源与当前选择 |
| `daisu_list`      | 发现组件、Hook 与公开 API     |
| `daisu_search`    | 全文检索文档和平台约束        |
| `daisu_info`      | 查询真实公开 API              |
| `daisu_doc`       | 读取完整组件文档              |
| `daisu_demo`      | 列出或读取示例源码            |
| `daisu_token`     | 查询主题变量                  |
| `daisu_changelog` | 筛选更新记录                  |
| `daisu_lint`      | 检查项目组件用法              |
| `daisu_usage`     | 统计组件与 Hook 使用          |
| `daisu_doctor`    | 检查项目集成                  |

资源包括 `daisu://versions`、`daisu://components/{component}`、`daisu://guides/{guide}`；guide 可选 `llms`、`llms-full`、`component-ai-notes`，历史快照可能未收录。另提供 `daisu_component_usage` Prompt。项目分析限制在 MCP 启动工作目录内。

### 手动配置

通用 `mcpServers` 配置示例，使用 npm 的 `latest` 版本；需要固定已安装版本时使用 `daisu mcp print --client cursor --runner npx --pin`：

```json
{
  "mcpServers": {
    "daisu-ui": {
      "command": "npx",
      "args": [
        "-y",
        "@daisu-ui/cli@latest",
        "mcp",
        "serve",
        "--cwd",
        "/absolute/path/to/consumer-project"
      ]
    }
  }
}
```

VS Code 使用 `servers` 根字段，Codex 使用 TOML 的 `mcp_servers.daisu-ui`，OpenCode 使用自身的 `mcp` 结构。优先通过 `mcp print` 获取对应客户端的真实格式。

### 如何确认接入成功

`doctor` 分别报告配置、独立 MCP 握手和客户端登记。Codex、Claude Code、OpenCode 支持只读登记检查；其他客户端可能报告 `unsupported` 或需要手工确认。

`server-ready` 表示独立服务可调用，`sessionVerified: false` 表示尚未验证当前客户端会话。客户端还可能要求重启、信任项目或启用工具；请在实际会话调用 `daisu_status` 和 `daisu_list`。诊断不会自动修改这些客户端设置。

## 配置保护

写入前先计算文件变更计划，执行前再次核对内容。JSONC 保留无关字段与注释，TOML 只编辑托管服务表；文件采用临时文件与原子替换，失败时尽可能回滚。未知、被修改或存在遮蔽冲突的配置会停止处理。移除按托管归属和内容指纹进行，保留其他服务、用户规则与已修改内容。

## 开发与贡献

```bash
git clone git@github.com:DaisSu-UI/cli.git
cd cli
npm ci
npm run build
npm run dev
```

源码入口为 `src`，离线数据为 `data`，消费端技能为 `skills/daisu-ui/SKILL.md`。`npm run dev` 持续监听并同步本地 UI / CLI 源文件；Ctrl+C 退出。

UI 与 CLI 并列为 `DaiSu-UI/{daisu-ui,cli}`、两端均已安装开发依赖时，正常构建自动生成组件说明、导出接入页并刷新离线快照。UI 的 `npm run ui:docs:dev` 同时监听两端修改，更新文档和必要的 Demo Bundle，刷新浏览器查看。事件合并、串行执行并过滤生成文件，内容不变时不重写快照时间。

其他目录使用 `DAISU_UI_SOURCE`、`DAISU_UI_CLI_SOURCE` 指定；`DAISU_UI_AUTO_SYNC=0` 关闭自动协作。单独检出仓库时使用已保存资料独立构建；CI 与 `--check` 只读验证。已安装的 CLI 和 MCP 查询不会自动读写源码仓库。

```bash
npm run sync:auto -- --check
npm run verify
```

`verify` 包括格式、类型、测试、数据摘要、发布版本和 tarball 独立安装验证。测试使用临时目录，不改真实编辑器配置。显式维护入口仍为 `npm run sync -- --ui-dir <UI仓库>` 与 `npm run docs:export -- --ui-dir <UI仓库>`；数据同步不自动拉取 Git。

源码与默认远程仓库托管于 [GitHub](https://github.com/DaisSu-UI/cli)。[GitHub Actions](https://github.com/DaisSu-UI/cli/actions) 对 developer、main 和 PR 执行验证；推送与 CLI 版本一致、且已合入 main 的 `v<版本>` 标签后，自动发布经过校验的同一份 tarball。发布步骤读取仓库 Actions Secret `NPM_TOKEN`，验证与打包步骤不接触发布凭据。分支、渠道、首次设置和重试方式见 [自动发布说明](https://github.com/DaisSu-UI/cli/blob/main/docs/releasing.md)。`AGENTS.md` 管理仓库开发规则；消费端 Skill 通过 `agent init` 安装到使用者项目。

## 当前边界

- 面向 ReactLynx 的 Daisu UI，当前组件包为 `@daisu-ui/ui`，兼容已收录的历史 `daisu-ui` 快照。
- 扫描聚焦 TS/TSX、JS/JSX 的公开入口，不做完整的跨文件 barrel 重导出推导，也不替代类型检查或设备验收。
- Web Demo 不等于原生平台可用；媒体、裁剪和宿主能力以组件文档及目标设备验证为准。
- 自动接入支持上表的 10 个客户端 ID；其他客户端可按标准 stdio MCP 方式手动配置。

## License

[MIT](https://github.com/DaisSu-UI/cli/blob/main/LICENSE)。第三方说明见 [THIRD_PARTY_NOTICES.md](https://github.com/DaisSu-UI/cli/blob/main/THIRD_PARTY_NOTICES.md)。
