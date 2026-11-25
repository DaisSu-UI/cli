import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClientAdapter } from "./clients.js";
import { findClientExecutable, type DetectionContext } from "./detection.js";
import { within } from "./files.js";
import { requiredTools } from "./probe.js";
import type { ServerDefinition } from "./types.js";

export interface Registration {
  status: "registered" | "pending" | "failed" | "unknown" | "unsupported";
  verified: boolean;
  message: string;
  checkedBy?: string;
  sessionVerified: false;
}
export function inspectToolFilters(value: any): string[] {
  const problems: string[] = [];
  if (value?.enabled === false || value?.disabled === true)
    problems.push("Daisu MCP 服务已禁用。");
  const enabled = value?.enabled_tools,
    disabled = value?.disabled_tools ?? value?.disabledTools;
  for (const [label, list] of [
    ["enabled_tools", enabled],
    ["disabled_tools", disabled],
  ] as const)
    if (
      list !== undefined &&
      (!Array.isArray(list) || !list.every((v) => typeof v === "string"))
    )
      problems.push(`${label} 应为字符串数组。`);
  if (
    Array.isArray(enabled) &&
    enabled.every((v) => typeof v === "string") &&
    requiredTools.some((t) => !enabled.includes(t))
  )
    problems.push("工具白名单未包含全部 Daisu 必需工具。");
  if (
    Array.isArray(disabled) &&
    requiredTools.some((t) => disabled.includes(t))
  )
    problems.push("工具黑名单禁用了 Daisu 必需工具。");
  return problems;
}
export function inspectOpenCodeFilters(config: any): string[] {
  const states = new Map(requiredTools.map((name) => [name, true]));
  for (const filter of [config?.tools, config?.permission]) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter))
      continue;
    for (const [pattern, value] of Object.entries(filter)) {
      const enabled =
        typeof value === "boolean"
          ? value
          : value === "deny"
            ? false
            : value === "allow" || value === "ask"
              ? true
              : undefined;
      if (enabled === undefined) continue;
      const expression = pattern
        .split("")
        .map((char) =>
          char === "*"
            ? ".*"
            : char === "?"
              ? "."
              : /[\\^$.*+?()[\]{}|]/.test(char)
                ? "\\" + char
                : char,
        )
        .join("");
      const match = new RegExp("^" + expression + "$");
      for (const tool of requiredTools)
        if (pattern === "daisu-ui" || match.test("daisu-ui_" + tool))
          states.set(tool, enabled);
    }
  }
  return requiredTools.some((tool) => states.get(tool) === false)
    ? [
        "OpenCode 的 tools/permission 配置限制了 Daisu 必需工具，请在客户端配置中确认。",
      ]
    : [];
}
async function clientCommand(
  command: string,
  args: string[],
  context: DetectionContext,
  timeout: number,
) {
  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timeout: boolean;
    failed: boolean;
  }>((resolveResult) => {
    const child = spawn(command, args, {
      cwd: context.cwd,
      env: context.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "",
      settled = false,
      timedOut = false,
      forced: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forced) clearTimeout(forced);
      resolveResult({ code, stdout, stderr, timeout: timedOut, failed });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forced = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null, true);
      }, 250);
    }, timeout);
    const append = (chunk: Buffer, channel: "stdout" | "stderr") => {
      if (channel === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > 1024 * 1024) {
        child.kill("SIGKILL");
        finish(null, true);
      }
    };
    child.stdout.on("data", (d) => append(d, "stdout"));
    child.stderr.on("data", (d) => append(d, "stderr"));
    child.on("error", () => finish(null, true));
    child.on("close", (code) => finish(code));
  });
}
export async function verifyClientRegistration(
  client: ClientAdapter,
  expected: ServerDefinition,
  context: DetectionContext,
  timeout = 5000,
): Promise<Registration> {
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 60000)
    throw new Error("登记查询超时应在 100–60000ms 之间。");
  const base = { verified: false, sessionVerified: false as const };
  const commands: Record<string, { names: string[]; args: string[] }> = {
    codex: { names: ["codex"], args: ["mcp", "get", "daisu-ui", "--json"] },
    claude: { names: ["claude"], args: ["mcp", "get", "daisu-ui"] },
    opencode: { names: ["opencode"], args: ["mcp", "list"] },
  };
  const spec = commands[client.id];
  if (!spec)
    return {
      ...base,
      status: "unsupported",
      message: `${client.name} 无稳定的非交互登记查询入口，请在客户端 MCP 面板确认。`,
    };
  const executable = await findClientExecutable(spec.names, context);
  if (!executable)
    return {
      ...base,
      status: "unknown",
      message: `未找到 ${client.name} 可执行文件，未验证客户端登记。`,
    };
  const root = await realpath(context.cwd);
  if (within(root, executable))
    return {
      ...base,
      status: "unknown",
      message:
        "检测到项目目录内的客户端可执行文件，未自动执行；请在客户端中确认。",
    };
  if (context.platform === "win32" || process.platform === "win32")
    return {
      ...base,
      status: "unsupported",
      message:
        "Windows 客户端登记查询暂需在客户端面板确认，配置生成与独立握手仍可使用。",
    };
  const result = await clientCommand(
      executable,
      spec.args,
      { ...context, cwd: root },
      timeout,
    ),
    checkedBy = `${spec.names[0]} ${spec.args.join(" ")}`;
  if (result.timeout)
    return {
      ...base,
      status: "unknown",
      message: "客户端登记查询超时，未改变配置。",
      checkedBy,
    };
  if (result.failed)
    return {
      ...base,
      status: "unknown",
      message: "无法执行客户端登记查询。",
      checkedBy,
    };
  const output = result.stdout + "\n" + result.stderr;
  if (
    /pending approval|approval.*pending|untrusted|not trusted|trust (?:this )?(?:project|workspace)/i.test(
      output,
    )
  )
    return {
      ...base,
      status: "pending",
      message: "客户端需要信任项目或批准 MCP，请在客户端中完成后重试。",
      checkedBy,
    };
  if (result.code !== 0)
    return {
      ...base,
      status: /no mcp server|not found|未找到/i.test(output)
        ? "pending"
        : "failed",
      message: "客户端尚未确认 Daisu 服务，请在客户端核对项目范围和 MCP 登记。",
      checkedBy,
    };
  if (client.id === "codex") {
    let value: any;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      return {
        ...base,
        status: "unknown",
        message: "Codex 返回的登记响应无法识别。",
        checkedBy,
      };
    }
    if (value?.name !== "daisu-ui")
      return {
        ...base,
        status: "unknown",
        message: "Codex 返回的服务名称不匹配。",
        checkedBy,
      };
    const problems = inspectToolFilters(value);
    if (problems.length)
      return {
        ...base,
        status: "failed",
        message: problems.join(" "),
        checkedBy,
      };
    const actual = value.transport || value;
    if (
      actual.command !== expected.command ||
      JSON.stringify(actual.args || []) !== JSON.stringify(expected.args)
    )
      return {
        ...base,
        status: "failed",
        message:
          "客户端有效启动命令与当前 Daisu 配置不同，可能被其他配置范围覆盖。",
        checkedBy,
      };
    return {
      ...base,
      status: "registered",
      verified: true,
      message: "Codex 已登记匹配的 Daisu 服务，工具过滤允许必需能力。",
      checkedBy,
    };
  }
  const line =
    client.id === "opencode"
      ? output
          .split(/\r?\n/)
          .find((s) => /(?:^|[\s│┃✓●○⚠✗×✔!])daisu-ui(?=\s|$)/i.test(s))
      : output;
  if (!line || !line.includes("daisu-ui"))
    return {
      ...base,
      status: "unknown",
      message: "客户端响应中未找到可确认的 Daisu 服务。",
      checkedBy,
    };
  if (/disabled|disconnected|failed|error|rejected/i.test(line))
    return {
      ...base,
      status: "failed",
      message: "客户端识别到 Daisu 服务，但状态为禁用或连接失败。",
      checkedBy,
    };
  if (!/connected|\bcommand\b|\bscope\b/i.test(line))
    return {
      ...base,
      status: "unknown",
      message: "客户端能识别服务名称，但未返回足够的登记或连接信息。",
      checkedBy,
    };
  return {
    ...base,
    status: "registered",
    verified: true,
    message: `${client.name} 已识别 Daisu 服务；会话内工具调用仍需在客户端确认。`,
    checkedBy,
  };
}
