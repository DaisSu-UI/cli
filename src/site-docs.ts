import { readFile, writeFile, mkdir, rename, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Command } from "commander";
import { createMcpServer } from "./mcp.js";
import { cliPackage, packageRoot } from "./knowledge.js";
import { within } from "./files.js";
import { clients, printClient } from "./clients.js";

const cell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (headers: string[], rows: string[][]) =>
  [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map(cell).join(" | ")} |`)
    .join("\n");
const code = (content: string, language = "bash") =>
  `\n\`\`\`${language}\n${content}\n\`\`\`\n`;
export async function renderSiteDocs(): Promise<Record<string, string>> {
  const { createCliProgram } = await import("./app.js");
  const commandRows: string[][] = [];
  function visit(command: Command, parent = "") {
    const name = `${parent} ${command.name()}`.trim();
    if (command !== program)
      commandRows.push([
        `\`${name}${command.registeredArguments.map((arg) => ` ${arg.required ? "<" : "["}${arg.name()}${arg.required ? ">" : "]"}`).join("")}\``,
        command.description(),
        command.options.map((option) => `\`${option.flags}\``).join("、") ||
          "—",
      ]);
    for (const child of command.commands) visit(child, name);
  }
  const program = createCliProgram();
  visit(program);
  const server = await createMcpServer({ cwd: packageRoot, version: "latest" });
  const client = new Client({
    name: "daisu-doc-export",
    version: cliPackage.version,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  let tools, resources, templates, prompts;
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
    resources = (await client.listResources()).resources;
    templates = (await client.listResourceTemplates()).resourceTemplates;
    prompts = (await client.listPrompts()).prompts;
  } finally {
    await client.close();
    await server.close();
  }
  const note = `本文由 \`${cliPackage.name}@${cliPackage.version}\` 生成。内容在 CLI 仓库维护；更新方式见 [CLI 工具](#/ai-cli)。`;
  const sampleServer = { command: "daisu", args: ["mcp"] };
  const config = (id: string) =>
    code(
      printClient(
        clients.find((client) => client.id === id)!,
        sampleServer,
      ).trimEnd(),
      id === "codex" ? "toml" : "json",
    );
  const clientTable = table(
    ["客户端 ID", "客户端", "项目 MCP 文件", "范围"],
    clients.map((client) => [
      "`" + client.id + "`",
      client.name,
      "`" + client.project + "`",
      client.user ? "project / user" : "project",
    ]),
  );
  const skillTable = table(
    ["客户端 ID", "Skill 目录", "Instructions"],
    clients.map((client) => [
      "`" + client.id + "`",
      "`" + client.skill + "`",
      "`" + client.instructions + "`",
    ]),
  );
  return {
    "overview.md": `# AI 总览

Daisu UI 提供面向 ReactLynx 的组件文档、版本化离线知识库、CLI、MCP Server 和消费端 Skill。可以在终端查询，也可以让编辑器中的 Agent 按需调用同一份资料。先确认项目安装的组件版本，再查询 API、示例和平台限制。

## 选择接入方式

| 场景 | 推荐入口 | 使用方式 |
| --- | --- | --- |
| 只希望 AI 阅读说明 | [LLMs.txt](#/ai-llm) | 将文档链接加入上下文，按需打开组件页 |
| 查询 API、示例、主题变量 | [CLI 工具](#/ai-cli) | 使用 \`daisu info\`、\`doc\`、\`demo\`、\`token\` 离线查询 |
| 让 AI 按需调用组件知识库 | [MCP 接入](#/ai-mcp) | 为客户端配置 \`daisu mcp serve\` |
| 让 Agent 完成页面开发和排查 | [AI Skills](#/ai-skills) | 一次安装 MCP、Skill 与 Instructions |
| 检查已有 ReactLynx 项目 | [CLI 工具](#/ai-cli) | 使用 \`doctor\`、\`usage\`、\`lint\` 分析源码 |

## 推荐使用路径

### 第一次使用

CLI 当前版本为 \`${cliPackage.version}\`，在 npmjs 使用 beta 标签。先按 [CLI 安装说明](#/ai-cli) 安装 @daisu-ui/cli@beta；也可从 Git 源码构建或安装本地 tarball。CLI 安装完成后，下面的命令均可离线查询；组件包和 CLI 是两个独立的安装项。

在消费项目执行：

\`\`\`bash
daisu data list
daisu doctor .
daisu list 表单
daisu info Input
daisu demo Input basic
\`\`\`

使用源码时，将 \`daisu\` 换为 \`node /绝对路径/cli/dist/index.js\`。不需要为查询启动文档网站，也不需要配置 API Key。

### 接入 MCP

先全局安装已发布的 CLI：

\`\`\`bash
npm install -g @daisu-ui/cli@beta
\`\`\`

在支持 mcpServers 的客户端中添加以下配置，由客户端启动服务：

${config("cursor")}

客户端需要能在 PATH 中找到 daisu，并在消费项目目录启动服务。需要固定项目时，在 args 中加上 --cwd 与消费项目绝对路径；VS Code、Codex 使用各自的配置格式，详见 [MCP 接入](#/ai-mcp)。

### 希望 Agent 完成开发任务

先预览针对当前项目的配置计划，再指定实际客户端安装：

\`\`\`bash
daisu agent init --client auto --dry-run
daisu agent init --client cursor --yes
daisu agent doctor --client cursor
\`\`\`

将 cursor 换为自己的客户端 ID；自动识别不明确时会要求显式选择。\`agent init\` 默认配置 MCP、消费端 Skill 和 Instructions。客户端完成信任或启用后，在实际会话中要求它先调用 \`daisu_status\`，再查询组件：

\`\`\`text
请使用 Daisu UI 实现用户资料表单，目标为 ReactLynx，支持浅色和深色主题。
先调用 daisu_status 确认组件数据版本；查询 Form、FormItem、Input、Button 的
公开 API、完整文档和示例，再生成代码。说明当前平台未支持的能力。
完成后运行当前项目的类型检查、测试与构建，不直接导入组件库内部文件。
\`\`\`

### 只需要 MCP 或终端查询

仅接入 MCP 使用 \`daisu mcp init --client cursor --yes\`；它不会安装 Skill 和 Instructions。无需编辑器工具调用时，直接执行 CLI 查询命令即可。

### 只需要文档上下文

把 [llms.txt](./llms.txt) 的完整地址交给支持网页读取的工具。需要更多约束时补充 [llms-full.txt](./llms-full.txt) 和 [组件生成约束](./component-ai-notes.txt)。准确的属性与回调签名仍以当前版本组件文档和公开类型为准。

## 能力地图

| 能力 | 提供的资料或行为 | 核对要点 |
| --- | --- | --- |
| \`list\` / \`search\` | 组件、Hook 与文档全文检索 | 英文名、中文名或用途均可检索 |
| \`info\` / \`doc\` | 公开 API 和完整组件说明 | 属性、事件、插槽、方法与平台能力 |
| \`demo\` | 文档示例和完整交互源码 | 不把示例私有组合当作公开组件 |
| \`token\` | 组件与全局 CSS 变量 | 按实际资料区分默认值与明暗主题值 |
| \`doctor\` / \`usage\` / \`lint\` | 依赖、JSX 集成、使用统计和用法诊断 | 源码静态检查，不能替代项目编译与设备验证 |
| MCP | 通过工具、资源和 Prompt 提供上述能力 | 实际客户端仍需完成启用和工具调用验证 |
| Skill / Instructions | 查询顺序、ReactLynx 规则和验证要求 | 由客户端加载，API 仍从知识库按版本查询 |

## 版本与内容来源

当前组件包名为 @daisu-ui/ui，CLI 为 @daisu-ui/cli；历史组件快照可能使用旧包名 daisu-ui，导入路径以所选版本返回的 importFrom 为准。CLI 版本、组件库版本和文档站版本分别管理。\`daisu --version\` 显示 CLI 版本，\`daisu info Button --version <版本>\` 选择组件数据；\`daisu data list\` 查看当前包实际收录的快照。查询不会自动读取最新网页，也不会因为本地 UI 源码更新而自动更新快照。

组件 API、Demo、平台约束和 LLM 资料由 UI 仓库维护；CLI 将其提取为带版本与摘要的快照。本站的 CLI、MCP、Skills 接入页由 CLI 源码生成，命令表与工具表取自实际注册。本地两个开发仓库就绪时，构建会自动同步；安装后的查询不触发源码同步。具体流程见 [CLI 工具](#/ai-cli)。

## 延伸阅读

- [LLMs.txt 与上下文使用](#/ai-llm)
- [CLI 安装、查询与版本选择](#/ai-cli)
- [MCP 客户端配置与验证](#/ai-mcp)
- [AI Skills 安装和项目规则](#/ai-skills)
- [平台适配](#/platforms) · [定制主题](#/theme-customization)
- [UI 源码仓库](https://git.zilueit.com/daisu-ui/daisu-ui) · [CLI 源码仓库](https://git.zilueit.com/daisu-ui/cli)

${note}
`,
    "cli.md": `# @daisu-ui/cli

[@daisu-ui/cli](https://www.npmjs.com/package/@daisu-ui/cli) 是 Daisu UI 的 AI 工具包，提供命令行工具、MCP Server、版本化离线组件知识库和消费端 Skill。它将真实的 ReactLynx 组件 API、文档、示例、主题变量和更新记录接入终端、编辑器与 Agent。

[npm 包](https://www.npmjs.com/package/@daisu-ui/cli) · [源码仓库](https://git.zilueit.com/daisu-ui/cli) · [AI 总览](#/ai-guide)

不确定 CLI、LLMs.txt、MCP 和 Skills 的区别时，先阅读 [AI 总览](#/ai-guide)。组件运行时包为 @daisu-ui/ui，CLI 是单独安装的开发工具。

## 亮点

- **离线知识库**：组件属性、事件、插槽、方法、CSS 变量、Demo 与更新记录随包提供，查询不依赖文档服务或 API Key。
- **适合 Agent 调用**：查询支持结构化输出，MCP 提供按需工具、文档资源和 Prompt。
- **匹配项目版本**：识别实际安装依赖，支持选择已收录版本，历史包名和当前 @daisu-ui/ui 按各自 API 查询。
- **ReactLynx 项目分析**：doctor、usage、lint 基于 TypeScript AST 检查集成、组件使用和已知模式，不执行被扫描代码。
- **客户端接入**：可一次配置 MCP、Skill 和 Instructions，支持预览计划并保留用户已有配置。

## 安装

需要 Node.js >=20.19.0。当前发布在 npmjs，预发布建议显式安装 beta 标签：

\`\`\`bash
npm install -g @daisu-ui/cli@beta
daisu --version
\`\`\`

安装完成后可使用 daisu 命令。需要固定 CLI 版本时，将 beta 换为具体版本，例如 ${cliPackage.version}。

不全局安装也可使用：

\`\`\`bash
npx --yes @daisu-ui/cli@beta info Button
# 或安装为消费项目的开发依赖
npm install --save-dev @daisu-ui/cli@beta
npx --no-install daisu info Button
\`\`\`

首次安装和 npx 下载可能联网；安装后的本地知识查询与 MCP 默认离线。项目开发依赖用户将后文 daisu 替换为 npx --no-install daisu。

## 快速开始

在消费项目执行：

\`\`\`bash
daisu list
daisu info Button
daisu demo Button basic
daisu doc Button
daisu token Button
daisu changelog
\`\`\`

组件名支持公开名称、目录 ID 和中文名，例如 Button、button、按钮。分组 ID 指向该组首个公开组件；Row、Col 等成员可以单独查询。

## 命令速查

### 组件知识

${table(
  ["命令", "用途", "选项"],
  commandRows.filter(([name]) =>
    /^`daisu (list|search|info|doc|demo|token|changelog)(?: |`)/.test(name),
  ),
)}

demo 不指定示例名时列出示例；basic 读取基本用法，source 读取完整交互源码，其他示例名以实际列表为准。token 不带组件名时查询全局变量。search 检索完整组件说明和 LLM 约束，多个关键词以空格分隔并要求全部匹配。

\`\`\`bash
daisu list 表单
daisu info Input --format json
daisu demo Button
daisu demo Button source
daisu search "受控" --limit 8
daisu changelog Button
\`\`\`

### 项目分析

${table(
  ["命令", "用途", "选项"],
  commandRows.filter(([name]) =>
    /^`daisu (doctor|usage|lint)(?: |`)/.test(name),
  ),
)}

\`\`\`bash
daisu doctor .
daisu usage . --format json
daisu lint .
daisu lint . --strict
\`\`\`

doctor 检查 Node、依赖、JSX 集成与知识版本；usage 统计组件和 Hook；lint 检查私有导入、未知导出或属性、空按钮及已知线程回调模式。有错误时 lint 返回非零退出码，--strict 将警告也视为失败。

扫描覆盖 TS/TSX、JS/JSX 及其 c/m 扩展名，忽略依赖、输出目录、vendor 和符号链接。它不提供完整的跨文件 barrel 推导，不能代替 tsc、测试、构建和原生设备验收。

## MCP Server

启动 stdio 服务：

\`\`\`bash
daisu mcp
\`\`\`

全局安装后，在支持 mcpServers 的客户端中添加：

${config("cursor")}

客户端需能在 PATH 找到 daisu，并在消费项目目录启动服务。需要固定目录时，args 使用 ["mcp", "--cwd", "/absolute/path/to/project"]。服务没有网页或监听端口，一般由客户端启动，无需提前在终端运行。

也可以让 CLI 自动配置本机入口：

\`\`\`bash
daisu mcp init --client cursor --dry-run
daisu mcp init --client cursor --yes
daisu mcp doctor --client cursor
\`\`\`

当前实际工具如下，来自 MCP 握手结果：

${table(
  ["工具", "用途"],
  tools.map((tool) => ["`" + tool.name + "`", tool.description || ""]),
)}

VS Code、Codex 等配置格式、文档资源、Prompt、版本与连接排查见 [MCP 接入详情](#/ai-mcp)。独立握手通过后，仍需在实际会话调用 daisu_status 确认工具可用。

## Agent 与 AI Skills

在消费项目中，一次接入 MCP、Skill 和 Instructions：

\`\`\`bash
daisu agent list
daisu agent init --client auto --dry-run
daisu agent init --client cursor --yes
daisu agent doctor --client cursor
\`\`\`

将 cursor 换为自己的客户端 ID。自动探测不明确时要求显式选择，--client all 表示明确接入全部支持的客户端。仅需 MCP 用 mcp init；Skill 内容、文件位置与移除步骤见 [AI Skills](#/ai-skills)。

## 通用参数

| 参数 | 适用命令 | 说明 |
| --- | --- | --- |
| --format text\\|json\\|markdown | 查询与分析命令 | 选择文本、JSON 或 Markdown 输出；以命令 --help 为准 |
| --version <版本> | 组件查询、项目分析及 MCP 服务 | 选择已收录组件版本或范围，latest 表示随包最新快照 |
| --cwd <目录> | 支持该选项的查询、接入和服务命令 | 指定版本识别或客户端目标目录 |
| --limit <数量> | search | 限制结果数，为 1–20，默认 8 |
| --strict | doctor、usage、lint | 严格模式，具体退出状态以对应命令为准 |

\`\`\`bash
daisu --version
daisu data list
daisu info Button --version 0.1.0-beta.1
daisu info Button --version latest --format json
daisu info Button --cwd /absolute/path/to/project
\`\`\`

顶层 --version 显示 CLI 自身版本；子命令后的 --version 选择组件资料。默认依次检查显式版本、项目实际安装版本、最近 package.json 依赖声明、随包 latest。不存在对应快照时明确报错，不把其他版本冒充当前 API。

尚未安装的 file、workspace、Git 依赖无法确定精确版本，会给出警告并使用随包数据；先安装组件包或选择已收录版本。当前包使用 @daisu-ui/ui，历史 daisu-ui 快照的导入入口以返回的 importFrom 为准。

## 数据校验与更新

\`\`\`bash
daisu data check
daisu update
daisu update --check
\`\`\`

data check 校验版本索引、结构和 SHA-256 摘要。update 默认只报告本地状态；--check 才联网查询 CLI 更新，不自动安装。升级 CLI 可重新执行 npm install -g @daisu-ui/cli@beta；升级后按 data list 核对实际收录的组件版本。

## 源码开发与资料同步

源码：[git@git.zilueit.com:daisu-ui/cli.git](https://git.zilueit.com/daisu-ui/cli)。源码用户可以构建后通过 node /absolute/path/to/cli/dist/index.js 使用，也可 npm pack 生成 tarball。

本地按 DaiSu-UI/{cli,daisu-ui} 并列维护且依赖就绪时，正常构建自动完成 UI 组件资料 → CLI 快照、CLI 接入说明 → UI 文档站的双向同步。CLI 的 npm run dev 持续监听；UI 的 npm run ui:docs:dev 同时更新文档与必要的演示 Bundle。

非同级目录通过 DAISU_UI_SOURCE / DAISU_UI_CLI_SOURCE 定位，DAISU_UI_AUTO_SYNC=0 关闭开发协作。单仓库仍能独立构建；CI 自动只读检查，不修补资料。安装后的查询不触发源码协作。

需要指定目录或排查时，在 CLI 仓库运行：

\`\`\`bash
npm run sync -- --ui-dir /absolute/path/to/daisu-ui
npm run docs:export -- --ui-dir /absolute/path/to/daisu-ui
npm run sync -- --ui-dir /absolute/path/to/daisu-ui --check
npm run docs:export -- --ui-dir /absolute/path/to/daisu-ui --check
# 使用已安装的 CLI 直接做只读比较
daisu docs export --ui-dir /absolute/path/to/daisu-ui --check
\`\`\`

--check 严格只读。版本数据提交到 CLI，接入页面和摘要清单提交到 UI，不手工修改生成页。开发文档、CLI npm 发布、组件 npm 发布与业务 Bundle 分别执行。

${note}
`,
    "mcp.md": `# MCP 接入

MCP Server 由独立的 \`@daisu-ui/cli\` 提供，通过 stdio 通信，stdout 仅输出 JSON-RPC。组件知识读取随包的版本快照；项目检查限定在服务启动时指定的消费项目目录中。先完成 [CLI 安装](#/ai-cli)，再选择自动配置或手工配置。

## 自动配置

在消费项目执行，先查看计划再写入：

\`\`\`bash
daisu mcp list
daisu mcp init --client auto --dry-run
daisu mcp init --client cursor --yes
daisu mcp status --client cursor
daisu mcp doctor --client cursor
\`\`\`

替换 cursor 为实际客户端 ID。自动识别不明确时要求显式选择；不会默认配置所有客户端。默认 project 范围，将消费项目绝对路径写入 --cwd，使用当前 Node 和 CLI 的绝对入口，启动不需要访问注册表。

\`mcp init\` 只配置 MCP；需要同时安装 Skill 和 Instructions 时使用 [agent init](#/ai-skills)。已有其他 MCP Server 和用户配置会保留。写入后，客户端可能还需要信任项目、启用服务、批准工具或重启。

## 支持的客户端

表格来自当前客户端适配器；路径为项目范围的默认位置。OpenCode 与 CodeBuddy CLI 会识别已有兼容配置，具体目标路径以 init 的计划和 status 为准。

${clientTable}

\`--scope user\` 只改变 MCP 配置位置，不固定消费项目 --cwd；需要稳定的项目版本和分析目录时优先使用 project。VS Code 仅支持 project。使用 \`daisu mcp list --format json\` 查看实际用户路径和探测依据。

## 手工配置

让 CLI 输出符合当前客户端格式和本机路径的片段：

\`\`\`bash
daisu mcp print --client cursor
daisu mcp print --client vscode
daisu mcp print --client codex
\`\`\`

下面展示全局安装 npm install -g @daisu-ui/cli@beta 后的简洁配置，使用 daisu mcp。客户端必须能在 PATH 找到 daisu；工作目录应为消费项目。需要固定目录时，args 使用 ["mcp", "--cwd", "/absolute/path/to/consumer-project"]。合并服务条目到已有配置，不覆盖整个文件。

print 只输出配置，不写文件。默认生成本机 Node 和 CLI 的绝对入口及消费项目目录，适合编辑器无法读取全局 PATH 的情况；目录含空格时保留为单个参数。

### Cursor 与通用 JSON

Cursor 使用 .cursor/mcp.json；支持 mcpServers 的其他客户端采用同样的服务条目：

${config("cursor")}

### VS Code

项目文件为 .vscode/mcp.json，使用 servers 字段与 type: stdio：

${config("vscode")}

### Codex

项目文件为 .codex/config.toml，使用独立 TOML 服务表。Codex 必须信任并加载该项目配置，仍需在会话中验证工具可用：

${config("codex")}

以上片段由 CLI 的实际配置适配器生成。其他客户端使用对应的 mcp print 结果，OpenCode 的 command 为数组，不能套用 mcpServers 格式。

## 启动方式与版本

独立启动可运行 \`daisu mcp\` 或 \`daisu mcp serve --cwd /absolute/path/to/consumer-project\`。服务没有 HTTP 页面或监听端口，启动后等待客户端消息；一般由客户端自动启动，无需提前开一个终端运行。

默认 --runner local 使用当前安装的绝对入口。--runner global 生成 daisu mcp serve，要求客户端 PATH 能找到全局命令。--runner npx 可从 npm 启动，首次启动可能联网；使用 --pin 固定当前或指定 CLI 版本，不能代替组件数据版本选择。

在服务启动命令上添加 \`--version <组件版本>\` 可固定默认数据；工具调用的 version 参数可逐次选择。未显式指定时按消费项目依赖选择快照，先调用 daisu_status 核对来源。修改了本地 UI 源码不会改变已收录数据；重新同步和安装 CLI 数据后重启服务。

## 验证连接

\`\`\`bash
daisu mcp doctor --client cursor --no-registration
daisu mcp doctor --client cursor --timeout 15000
\`\`\`

| 状态 | 代表的结果 | 后续操作 |
| --- | --- | --- |
| server-ready | 独立进程能列工具、查询状态和 Button API | 在实际客户端会话调用工具 |
| registered | 支持登记查询的客户端识别了服务 | 确认当前会话已启用服务和目标工具 |
| pending-approval | 客户端等待信任或批准，退出码 2 | 在客户端完成信任或服务批准 |
| failed | 配置、服务调用或明确客户端状态失败，退出码 1 | 根据诊断结果修复后重试 |

doctor 分开报告配置、服务握手和客户端登记。Codex、Claude Code、OpenCode 支持只读登记查询；其他客户端可能报告 unsupported 或需要手工确认。\`sessionVerified\` 为 false，独立握手不能证明当前会话已能调用工具；诊断不会自动修改项目信任或工具过滤。

在实际 AI 会话发送：

\`\`\`text
请先调用 daisu_status，说明当前 CLI、组件数据版本及来源。
再调用 daisu_info 查询 Button，调用 daisu_demo 读取 basic 示例。
请依据返回的公开属性生成 ReactLynx 用法，不猜测未返回的参数。
\`\`\`

## 工具

下表通过真实 MCP 握手获取，参数名后 ? 表示可选。工具查询默认离线，limit 的有效范围和版本错误以服务实际返回为准。

${table(
  ["工具", "说明", "参数"],
  tools.map((tool) => [
    tool.name,
    tool.description || "",
    Object.keys(tool.inputSchema.properties || {})
      .map(
        (name) =>
          "`" +
          name +
          (tool.inputSchema.required?.includes(name) ? "" : "?") +
          "`",
      )
      .join("、") || "—",
  ]),
)}

## 资源与提示词

${table(["资源", "说明"], [...resources.map((resource) => [resource.uri, resource.description || ""]), ...templates.map((resource) => [resource.uriTemplate, resource.description || ""])])}

guide 支持 llms、llms-full、component-ai-notes；历史快照未收录时会明确报错。资源使用服务默认数据版本，工具可单次指定 version。

${table(
  ["提示词", "说明"],
  prompts.map((prompt) => [prompt.name, prompt.description || ""]),
)}

## 迁移与排查

- 找不到命令：使用源码入口绝对路径，或检查 Node 与 CLI 的安装位置。迁移目录后重新预览 init，不要保留旧入口。
- 版本缺失：先调用 daisu_status 或执行 daisu data list，补充对应快照；不要强制使用不匹配的 API。
- 项目诊断目录不对：项目范围配置中的 --cwd 应指向消费项目，不是 CLI 或 UI 仓库。
- 已配置但会话没有工具：检查信任、启用状态和工具过滤；重启或重新加载客户端后实际调用验证。
- 已有同名服务：先确认原配置归属。旧的 UI 仓库 apps/mcp 已退役，新服务统一使用 CLI 的 daisu_* 工具与 daisu:// 资源；手工配置需先备份并合并替换同名服务。
- 仅移除 CLI 托管内容：先运行 \`daisu mcp remove --client cursor --dry-run\`，核对后加 --yes；手工配置或用户改动不会被当成可直接覆盖的托管内容。

- [CLI 工具](#/ai-cli) · [AI Skills](#/ai-skills) · [AI 总览](#/ai-guide)

${note}
`,
    "skills.md": `# AI Skills

消费端 Skill 为 Agent 提供 Daisu UI 的查询顺序、ReactLynx 编写约束和验证要求。MCP 提供真正的工具调用能力；Instructions 将项目规则提供给不同客户端。三者可一起安装，也可按项目选择。

## 内置技能

| Skill | 内容 | 适用场景 | 源文件 |
| --- | --- | --- | --- |
| daisu-ui | 版本核对、API/示例查询、ReactLynx 约束与验证要求 | 组件选型、页面生成、主题和常见组件用法排查 | [SKILL.md](https://git.zilueit.com/daisu-ui/cli/blob/main/skills/daisu-ui/SKILL.md) |

当前消费端技能随 [@daisu-ui/cli](https://www.npmjs.com/package/@daisu-ui/cli) 分发，通过下方 agent init 安装。UI 维护者的 Lynx 技能见本页末尾，分别服务于消费项目与组件库开发。

## 安装前准备

先执行 npm install -g @daisu-ui/cli@beta，或按 [CLI 工具](#/ai-cli) 使用项目依赖和源码入口。在需要生成代码的消费项目执行接入命令，不要把 CLI 仓库作为目标项目。源码用户用 \`node /absolute/path/to/cli/dist/index.js\` 替代 daisu；项目开发依赖用户用 \`npx --no-install daisu\`。

## 一次接入

\`\`\`bash
daisu agent list
daisu agent init --client auto --dry-run
daisu agent init --client cursor --yes
daisu agent status --client cursor
daisu agent doctor --client cursor
\`\`\`

自动识别不明确时显式指定客户端。init 默认安装 mcp,skill,instructions，--yes 表示执行已核对的计划；交互终端可不带 --yes，查看计划后确认。客户端加载项目规则、Skill 和 MCP 后，仍需在实际会话发起一次工具查询。

### 按需安装

\`\`\`bash
daisu agent init --client cursor --with skill,instructions --dry-run
daisu agent init --client cursor --with skill,instructions --yes
daisu mcp init --client cursor --yes
\`\`\`

--with 可以选择 mcp、skill、instructions；仅配置 MCP 使用 mcp init。项目路径默认是当前目录，可用 --cwd 明确指定。--scope user 只改变 MCP 位置，Skill 和 Instructions 始终写入指定项目；VS Code 仅支持 project。

## 各客户端的文件位置

消费端 Skill 的唯一源文件为 CLI 包内 skills/daisu-ui/SKILL.md。下表来自实际客户端适配器：

${skillTable}

组件 API、平台约束与示例来自 UI 仓库的版本快照，不在 Skill 中复制另一份 API 表格。CLI 安装包已携带技能文件，无需从另一个不存在的技能仓库安装。

## 使用流程

1. 确认消费项目的组件版本，以及 CLI 或 MCP 实际选择的数据版本。
2. 用 list/search 选组件，再用 info/doc/demo 核对属性、事件、完整说明与真实示例。
3. 从 @daisu-ui/ui 的公开入口导入组件，按受控状态、主题和宿主能力约束生成代码。
4. 用 doctor/lint 提供静态诊断，再运行消费项目自己的类型检查、测试与构建。
5. 对键盘、媒体、手势和列表性能，在目标原生设备验证。

可直接提供以下任务：

\`\`\`text
请先按本项目的 Daisu UI Skill 工作。
检查组件版本，查询 Form、FormItem、Input、Button 和 ConfigProvider 的公开文档。
实现带校验的资料表单，支持深色模式，并说明原生宿主需要提供的能力。
先参考真实示例，再编写 ReactLynx 代码；完成后执行本项目的验证命令。
\`\`\`

若只安装 Skill 与 Instructions，Agent 仍需通过可执行的 CLI 或已连接的 MCP 获取 API。目录内存在 SKILL.md 不等于客户端已经加载，status 和 doctor 也不能代替实际会话验证。

## 更新、迁移与移除

\`\`\`bash
daisu agent status --client cursor
daisu agent init --client cursor --dry-run
daisu agent remove --client cursor --dry-run
daisu agent remove --client cursor --yes
\`\`\`

工具记录 .daisu/cli-state.json 的托管内容及归属。保留用户规则、其他 MCP Server 和共享内容；仅对有归属且指纹匹配的内容更新或移除。用户修改后的托管内容会提示，不强行覆盖。不要删除状态清单以绕过保护；更新 CLI、迁移安装位置或手工改动后，先查看计划和状态，再按提示处理。

--client all 表示明确接入全部支持的客户端，不是自动选择。多个客户端共享 AGENTS.md 或 MCP 文件时，移除一个客户端不会删除其他托管客户端仍需要的内容。

## UI 库维护者技能

UI 仓库中的 AGENTS.md 和 .agents/skills 用于组件库维护，覆盖 Lynx API、CSS 兼容性、双线程规则及设备验收。它们继续由 UI 仓库维护；消费端 Skill 由 CLI 维护。

在 UI 仓库修改组件时先遵循其维护规范，更新 API 文档与平台约束。本地协作仓库就绪时，构建自动同步 CLI 快照；其他布局按 CLI 工具页显式同步。消费项目安装的 daisu-ui Skill 不会替换维护者规则，也不会自动更新组件库。

- [MCP 配置和会话验证](#/ai-mcp) · [CLI 与版本快照](#/ai-cli) · [AI 总览](#/ai-guide)

${note}
`,
  };
}

export async function exportSiteDocs(uiDir: string, check = false) {
  const root = await realpath(resolve(uiDir));
  const pkg = JSON.parse(
    await readFile(join(root, "packages/daisu-ui/package.json"), "utf8"),
  );
  if (!["@daisu-ui/ui", "daisu-ui"].includes(pkg.name))
    throw new Error("目标不是 Daisu UI 仓库。");
  const pages = await renderSiteDocs();
  const manifest = {
    schemaVersion: 1,
    generator: { package: cliPackage.name, version: cliPackage.version },
    files: Object.fromEntries(
      Object.entries(pages).map(([name, content]) => [
        name,
        createHash("sha256").update(content).digest("hex"),
      ]),
    ),
  };
  const files = {
    ...pages,
    "cli-manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  };
  const target = join(root, "apps/docs/ai");
  // Reject existing symlinks escaping the explicitly selected repository.
  for (const path of [
    join(root, "apps"),
    join(root, "apps/docs"),
    target,
    ...Object.keys(files).map((name) => join(target, name)),
  ]) {
    try {
      if (!within(root, await realpath(path)))
        throw new Error("文档目标路径越界。");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const changed: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    let current;
    try {
      current = await readFile(join(target, name), "utf8");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    if (content !== current) changed.push(name);
  }
  if (check && changed.length)
    throw new Error(
      `CLI 接入文档未同步：${changed.join("、")}。请运行 docs export。`,
    );
  if (!check && changed.length) {
    await mkdir(target, { recursive: true });
    for (const name of changed) {
      const temporary = join(target, `.${name}.${process.pid}.tmp`);
      await writeFile(temporary, files[name as keyof typeof files], "utf8");
      await rename(temporary, join(target, name));
    }
  }
  return {
    ok: true,
    check,
    generator: manifest.generator,
    changedFiles: changed,
    message: check ? "CLI 接入文档一致，未写入文件。" : "已导出 CLI 接入文档。",
  };
}
