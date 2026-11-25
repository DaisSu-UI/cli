import { Command, Option } from "commander";
import { createInterface } from "node:readline/promises";
import { checkDataDirectory } from "./data-validation.js";
import { updateStatus } from "./updates.js";
import { join } from "node:path";
import { cliPackage, queryKnowledge, packageRoot } from "./knowledge.js";
import { lintProject, usageProject, doctorProject } from "./scanner.js";
import { serveMcp } from "./mcp.js";
import {
  clientList,
  detectedClientList,
  applyOnboarding,
  onboardingPlan,
  onboardingPrint,
  onboardingStatus,
  onboardingDoctor,
  type AgentOptions,
} from "./onboarding.js";
import { renderOutput } from "./output.js";
import type { OutputFormat } from "./types.js";
function formatOption(command: Command) {
  return command.addOption(
    new Option("--format <format>", "输出格式")
      .choices(["text", "json", "markdown"])
      .default("text"),
  );
}
function queryOptions(command: Command) {
  return formatOption(command)
    .option("--version <version>", "组件库离线数据版本或 semver 范围")
    .option("--cwd <dir>", "用于识别依赖版本的项目目录");
}
function emit(command: string, result: any, format: OutputFormat) {
  process.stdout.write(renderOutput(command, result, format));
  if (format !== "json")
    for (const warning of result.warnings || [])
      process.stderr.write(`提示：${warning}\n`);
}
async function confirm(options: AgentOptions) {
  if (options.dryRun || options.yes) return;
  if (!process.stdin.isTTY)
    throw new Error("写入配置需显式传入 --yes；仅预览请使用 --dry-run。");
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await prompt.question("应用上述 Daisu 配置变更？[y/N] ");
    if (!/^y(?:es)?$/i.test(answer.trim()))
      throw new Error("已取消，未修改配置。");
  } finally {
    prompt.close();
  }
}
function clientOptions(command: Command, required = false) {
  const value = formatOption(command)
    .addOption(
      new Option("--client <client>", "客户端 ID、auto 或 all").default(
        required ? "auto" : "all",
      ),
    )
    .addOption(
      new Option("--scope <scope>", "配置范围")
        .choices(["project", "user"])
        .default("project"),
    )
    .option("--cwd <dir>", "目标项目目录")
    .addOption(
      new Option("--runner <runner>", "MCP 启动方式；local 可离线启动")
        .choices(["local", "npx", "global"])
        .default("local"),
    )
    .option("--pin [version]", "npx 启动时固定当前或指定 CLI 版本")
    .option(
      "--with <parts>",
      "agent 能力：mcp,skill,instructions",
      "mcp,skill,instructions",
    );
  if (required) value.getOptionValue("client");
  return value;
}
export function createCliProgram() {
  const program = new Command()
    .enablePositionalOptions()
    .name("daisu")
    .description("Daisu UI 离线知识、ReactLynx 项目分析和 AI 接入工具")
    .version(cliPackage.version, "-V, --version");
  program.showHelpAfterError();
  for (const [name, description] of [
    ["list", "列出或搜索组件与 Hook"],
    ["search", "离线全文搜索组件文档与使用约束"],
    ["info", "查询公开 API"],
    ["doc", "输出组件文档"],
    ["demo", "列出或输出组件示例"],
    ["token", "查询 CSS 变量"],
    ["changelog", "查询更新日志"],
  ]) {
    const command = program
      .command(name)
      .description(description)
      .allowExcessArguments(false);
    if (name === "search")
      command
        .argument("<query>", "全部搜索词均须匹配")
        .option("--limit <count>", "结果条数（1–20）", Number, 8);
    else if (name === "list")
      command.argument("[keyword]", "中英文名称、分类或用途");
    else if (name === "token") command.argument("[component]", "组件名称");
    else if (name === "changelog")
      command
        .argument("[releaseOrComponent]", "发布版本或组件")
        .argument("[component]", "组件名称");
    else command.argument("<component>", "组件名称、别名或中文名");
    if (name === "demo")
      command.argument("[demo]", "示例名称；basic、demo-1、中文标题或 source");
    queryOptions(command).action((...args: any[]) => {
      const options = args[command.registeredArguments.length];
      emit(
        name,
        queryKnowledge(
          name,
          args.slice(0, command.registeredArguments.length),
          options,
        ),
        options.format,
      );
    });
  }
  for (const [name, description, handler] of [
    ["doctor", "诊断 ReactLynx 项目集成", doctorProject],
    ["usage", "统计 TSX/JSX 组件使用", usageProject],
    ["lint", "诊断组件用法", lintProject],
  ] as const) {
    queryOptions(
      program
        .command(name)
        .description(description)
        .argument("[dir]", "项目目录", "."),
    )
      .option("--strict", "将 lint 警告视为失败")
      .action((dir, options) => {
        const result = handler(dir, options);
        emit(name, result, options.format);
        if (
          (result as any).errors ||
          (options.strict && (result as any).warningsCount)
        )
          process.exitCode = 1;
      });
  }
  formatOption(
    program
      .command("docs")
      .description("维护文档站的 CLI 接入说明")
      .command("export")
      .description("生成接入页面；--check 严格只读")
      .requiredOption("--ui-dir <dir>", "Daisu UI 仓库")
      .option("--check", "只比较，不创建或修改文件"),
  ).action(async (options) => {
    const { exportSiteDocs } = await import("./site-docs.js");
    emit(
      "docs-export",
      await exportSiteDocs(options.uiDir, options.check),
      options.format,
    );
  });
  const data = program.command("data").description("检查随包离线知识库");
  for (const operation of ["list", "check"])
    formatOption(
      data
        .command(operation)
        .description(
          operation === "check"
            ? "检查结构、版本索引和数据摘要"
            : "列出离线版本和来源",
        ),
    ).action((options) =>
      emit(
        "data-" + operation,
        checkDataDirectory(join(packageRoot, "data")),
        options.format,
      ),
    );
  formatOption(
    program.command("update").description("显式检查 CLI 更新，不自动安装"),
  )
    .option("--check", "联网查询 npm dist-tag")
    .option("--registry <url>", "npm 注册表地址")
    .option("--tag <tag>", "npm dist-tag")
    .option("--timeout <ms>", "检查超时毫秒数", Number, 3000)
    .action(async (options) => {
      const result = await updateStatus(options);
      emit("update", result, options.format);
      if (["unavailable", "tag-unavailable"].includes(result.status))
        process.exitCode = 1;
    });
  for (const name of ["mcp", "agent"]) {
    const group = program
      .command(name)
      .description(
        name === "mcp"
          ? "启动 MCP 或管理客户端配置"
          : "管理 MCP、Skill 和 Instructions",
      );
    if (name === "mcp") {
      queryOptions(group).action(async (options) => {
        await serveMcp(options);
      });
      queryOptions(
        group.command("serve").description("启动 stdio MCP Server"),
      ).action(async (options) => {
        await serveMcp(options);
      });
    }
    formatOption(group.command("list").description("列出可自动配置的客户端"))
      .option("--cwd <dir>", "检测项目目录")
      .addOption(
        new Option("--scope <scope>", "配置范围")
          .choices(["project", "user"])
          .default("project"),
      )
      .action(async (options) =>
        emit(`${name}-list`, await detectedClientList(options), options.format),
      );
    for (const operation of ["init", "remove"] as const) {
      clientOptions(
        group
          .command(operation)
          .description(
            operation === "init"
              ? "初始化所选客户端"
              : "仅移除本工具托管的内容",
          ),
        true,
      )
        .option("--dry-run", "只显示计划，不写入文件")
        .option("--yes", "确认执行配置写入")
        .action(async (options) => {
          const plan = await onboardingPlan(operation, options, name === "mcp");
          if (!options.dryRun && !options.yes && plan.changes.length) {
            emit(
              `${name}-${operation}`,
              {
                operation,
                clients: plan.clients,
                dryRun: true,
                changedFiles: plan.changes.map((c) => ({
                  path: c.path,
                  action:
                    c.after === undefined
                      ? "remove"
                      : c.before === undefined
                        ? "create"
                        : "update",
                })),
                warnings: plan.warnings,
              },
              options.format,
            );
            await confirm(options);
          }
          const result = await applyOnboarding(
            operation,
            options,
            name === "mcp",
          );
          emit(`${name}-${operation}`, result, options.format);
        });
    }
    clientOptions(
      group.command("status").description("检查配置和托管状态"),
    ).action(async (options) =>
      emit(
        `${name}-status`,
        await onboardingStatus(options, name === "mcp"),
        options.format,
      ),
    );
    clientOptions(
      group.command("doctor").description("检查配置并执行真实 MCP 握手"),
    )
      .option("--no-registration", "仅检查配置和独立服务，跳过客户端登记查询")
      .option(
        "--timeout <ms>",
        "握手超时毫秒数",
        (value) => Number(value),
        10000,
      )
      .action(async (options) => {
        const result = await onboardingDoctor(options, name === "mcp");
        emit(`${name}-doctor`, result, options.format);
        if (result.errors) process.exitCode = 1;
        else if (result.pending) process.exitCode = 2;
      });
    if (name === "mcp")
      clientOptions(
        group.command("print").description("输出 MCP 配置片段"),
      ).action(async (options) =>
        emit("mcp-print", await onboardingPrint(options), options.format),
      );
  }
  return program;
}
