import { access, realpath } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { resolve, join, delimiter, extname } from "node:path";
import { clients, type ClientAdapter, type Scope } from "./clients.js";

export interface DetectionContext {
  cwd: string;
  home: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}
export interface ClientDetection {
  id: string;
  name: string;
  installed: boolean;
  active: boolean;
  executable?: string;
  scopeSupported: boolean;
  evidence: { kind: "environment" | "executable" | "config"; value: string }[];
}
const binaries: Record<string, string[]> = {
  claude: ["claude"],
  cursor: ["cursor-agent", "cursor"],
  vscode: ["code"],
  codex: ["codex"],
  opencode: ["opencode"],
  antigravity: ["agy-ide", "agy"],
  qoder: ["qoder-ide"],
  "qoder-cli": ["qodercli"],
  codebuddy: ["buddy"],
  "codebuddy-cli": ["codebuddy"],
};
export async function findClientExecutable(
  names: string[],
  context: DetectionContext,
): Promise<string | undefined> {
  const env = context.env || process.env,
    platform = context.platform || process.platform;
  for (const name of names)
    for (const directory of (env.PATH || "")
      .split(platform === "win32" ? ";" : delimiter)
      .filter(Boolean)) {
      const extensions =
        platform === "win32" && !extname(name)
          ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
          : [""];
      for (const extension of extensions) {
        const candidate = resolve(
          context.cwd,
          directory,
          `${name}${extension}`,
        );
        try {
          await access(
            candidate,
            platform === "win32" ? constants.F_OK : constants.X_OK,
          );
          return await realpath(candidate);
        } catch {}
      }
    }
}
export async function detectClients(
  context: DetectionContext,
  scope: Scope = "project",
): Promise<ClientDetection[]> {
  const env = context.env || process.env;
  const activeSignals: Record<string, string[]> = {
    codex: ["CODEX_THREAD_ID", "CODEX_CI"],
    claude: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    cursor: ["CURSOR_AGENT", "CURSOR_SESSION_ID", "CURSOR_TRACE_ID"],
    opencode: ["OPENCODE_SESSION_ID"],
    antigravity: ["ANTIGRAVITY_SESSION_ID"],
    qoder: ["QODER_IDE_SESSION_ID"],
    "qoder-cli": ["QODER_SESSION_ID"],
    codebuddy: ["CODEBUDDY_IDE_SESSION_ID"],
    "codebuddy-cli": ["CODEBUDDY_SESSION_ID"],
    vscode: [],
  };
  if (
    env.TERM_PROGRAM === "vscode" &&
    !Object.values(activeSignals)
      .flat()
      .some((key) => env[key])
  )
    activeSignals.vscode = ["TERM_PROGRAM"];
  const result: ClientDetection[] = [];
  for (const client of clients) {
    const evidence: ClientDetection["evidence"] = [];
    for (const key of activeSignals[client.id] || [])
      if (env[key]) evidence.push({ kind: "environment", value: key });
    const executable = await findClientExecutable(
      binaries[client.id] || [],
      context,
    );
    if (executable) evidence.push({ kind: "executable", value: executable });
    // Shared .mcp.json does not identify Claude, Qoder, or CodeBuddy by itself.
    const paths = [
      ...(clients.filter((c) => c.skill === client.skill).length === 1
        ? [join(context.cwd, client.skill, "SKILL.md")]
        : []),
      ...(client.user ? [join(context.home, client.user)] : []),
    ];
    if (client.project !== ".mcp.json")
      paths.push(join(context.cwd, client.project));
    for (const path of [...new Set(paths)])
      if (existsSync(path)) evidence.push({ kind: "config", value: path });
    result.push({
      id: client.id,
      name: client.name,
      installed: evidence.length > 0,
      active: evidence.some((e) => e.kind === "environment"),
      ...(executable ? { executable } : {}),
      scopeSupported: scope === "project" || !!client.user,
      evidence,
    });
  }
  return result;
}
export async function resolveClients(
  value: string,
  scope: Scope,
  context: DetectionContext,
): Promise<ClientAdapter[]> {
  if (value !== "auto") {
    const { selectClients } = await import("./clients.js");
    return selectClients(value, scope);
  }
  const detected = await detectClients(context, scope);
  const active = detected.filter((c) => c.active);
  if (active.length === 1) {
    if (!active[0].scopeSupported)
      throw new Error(`${active[0].name} 不支持 ${scope} 范围。`);
    return clients.filter((c) => c.id === active[0].id);
  }
  const candidates = active.length
    ? active
    : detected.filter((c) => c.installed && c.scopeSupported);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? `检测到多个客户端：${candidates.map((c) => c.id).join(", ")}。请用 --client 指定一个，或显式选择 all。`
        : "没有可靠识别到客户端。请运行 daisu agent list，并用 --client 指定；不会自动配置所有客户端。",
    );
  return clients.filter((c) => c.id === candidates[0].id);
}
