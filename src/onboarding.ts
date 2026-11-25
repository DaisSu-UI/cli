import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { packageRoot, cliPackage } from "./knowledge.js";
import {
  clients,
  selectClients,
  clientPath,
  encodeServer,
  decodeServer,
  editServer,
  serverEntry,
  printClient,
  parseConfig,
  type Scope,
  type ClientAdapter,
} from "./clients.js";
import {
  applyChanges,
  hash,
  readText,
  safePath,
  lockProject,
  type FileChange,
} from "./files.js";
import { probeServer } from "./probe.js";
import { resolveClients, detectClients } from "./detection.js";
import {
  inspectToolFilters,
  inspectOpenCodeFilters,
  verifyClientRegistration,
} from "./registration.js";
import { valid } from "semver";
import type { ServerDefinition } from "./types.js";

export interface AgentOptions {
  client: string;
  scope?: Scope;
  cwd?: string;
  home?: string;
  with?: string;
  runner?: "local" | "npx" | "global";
  pin?: boolean | string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  registration?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  timeout?: number;
}
interface Asset {
  kind: "mcp" | "skill" | "instructions";
  owners: string[];
  hash: string;
  created: boolean;
  server?: ServerDefinition;
}
interface State {
  schemaVersion: 1;
  assets: Record<string, Asset>;
}
const start = "<!-- daisu-ui:start -->",
  end = "<!-- daisu-ui:end -->";
const cursorFrontmatter =
  '---\ndescription: Daisu UI ReactLynx 组件使用规则\nglobs: "**/*.{tsx,jsx}"\nalwaysApply: false\n---\n\n';
const managedBody = `${start}\n## Daisu UI\n\n使用 Daisu UI 编写或修改 ReactLynx 页面前，通过 daisu list、info、demo、doc 或 Daisu MCP 查询当前版本 API。组件自动加载 CSS；只使用公开入口。项目技能目录中的 daisu-ui/SKILL.md 提供具体约束。跨组件事件回调遵守 ReactLynx 双线程规则。\n${end}`;
function instructionContent(source: string | undefined) {
  const text = source || "";
  const block = instructionBlock(text);
  if (block !== undefined) return text.replace(block, managedBody);
  return (
    text +
    (text && !text.endsWith("\n") ? "\n" : "") +
    (text ? "\n" : "") +
    managedBody +
    "\n"
  );
}
function instructionBlock(text: string): string | undefined {
  const first = text.indexOf(start),
    last = text.indexOf(end);
  if (first < 0 && last < 0) return;
  if (
    first < 0 ||
    last < first ||
    text.indexOf(start, first + start.length) >= 0 ||
    text.indexOf(end, last + end.length) >= 0
  )
    throw new Error(
      "Instructions 托管区块不完整或重复，保留文件，请先修复标记。",
    );
  return text.slice(first, last + end.length);
}
export function serverDefinition(
  cwd: string,
  options: AgentOptions,
): ServerDefinition {
  const args = [
    "mcp",
    "serve",
    ...(options.scope === "user" ? [] : ["--cwd", cwd]),
  ];
  if (options.runner === "npx")
    return {
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: [
        "-y",
        `${cliPackage.name}${
          options.pin
            ? "@" +
              (typeof options.pin === "string"
                ? valid(options.pin) ||
                  (() => {
                    throw new Error("--pin 需要精确 semver 版本。");
                  })()
                : cliPackage.version)
            : ""
        }`,
        ...args,
      ],
    };
  if (options.runner === "global") return { command: "daisu", args };
  return {
    command: process.execPath,
    args: [join(packageRoot, "dist/index.js"), ...args],
  };
}
async function context(options: AgentOptions) {
  const cwd = await realpath(resolve(options.cwd || process.cwd()));
  if (!(await stat(cwd)).isDirectory()) throw new Error("cwd 必须是项目目录。");
  const home = await realpath(resolve(options.home || homedir()));
  const scope = options.scope || "project";
  const selected = await resolveClients(options.client || "auto", scope, {
    cwd,
    home,
    env: options.env,
    platform: options.platform,
  });
  const statePath = join(cwd, ".daisu/cli-state.json");
  await safePath(statePath, [cwd]);
  const text = await readText(statePath);
  let state: State = { schemaVersion: 1, assets: {} };
  if (text) {
    try {
      state = JSON.parse(text);
      if (
        state.schemaVersion !== 1 ||
        !state.assets ||
        Array.isArray(state.assets)
      )
        throw new Error();
      for (const asset of Object.values(state.assets))
        if (
          !asset ||
          !["mcp", "skill", "instructions"].includes(asset.kind) ||
          !Array.isArray(asset.owners) ||
          !asset.owners.every((v) => typeof v === "string") ||
          typeof asset.hash !== "string"
        )
          throw new Error();
    } catch {
      throw new Error(
        "Daisu 托管清单无效，未修改任何配置。请先检查 .daisu/cli-state.json。",
      );
    }
  }
  return {
    cwd,
    home,
    scope,
    selected,
    statePath,
    stateText: text,
    state,
    roots: [cwd, home],
  };
}
export function clientList() {
  return clients.map(({ id, name, project, user, skill, instructions }) => ({
    id,
    name,
    scopes: user ? ["project", "user"] : ["project"],
    projectConfig: project,
    ...(user ? { userConfig: user } : {}),
    skill,
    instructions,
  }));
}
export async function detectedClientList(
  options: {
    cwd?: string;
    home?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    scope?: Scope;
  } = {},
) {
  const cwd = await realpath(resolve(options.cwd || process.cwd())),
    home = await realpath(resolve(options.home || homedir()));
  const detections = await detectClients(
    { cwd, home, env: options.env, platform: options.platform },
    options.scope || "project",
  );
  return {
    cwd,
    clients: clientList().map((client) => ({
      ...client,
      ...detections.find((d) => d.id === client.id),
    })),
  };
}
export async function onboardingPlan(
  operation: "init" | "remove",
  options: AgentOptions,
  onlyMcp = false,
) {
  const ctx = await context(options);
  const { cwd, home, scope, selected, state, statePath, stateText, roots } =
    ctx;
  const parts = new Set(
    (onlyMcp ? "mcp" : options.with || "mcp,skill,instructions")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  if (
    !parts.size ||
    [...parts].some((v) => !["mcp", "skill", "instructions"].includes(v))
  )
    throw new Error("--with 支持 mcp,skill,instructions。");
  const changes = new Map<string, FileChange>();
  const warnings: string[] = [];
  const read = async (path: string) => {
    await safePath(path, roots);
    return changes.has(path) ? changes.get(path)!.after : await readText(path);
  };
  const stage = async (
    path: string,
    after: string | undefined,
    reason: string,
  ) => {
    const before = changes.get(path)?.before ?? (await readText(path));
    if (before === after) {
      changes.delete(path);
      return;
    }
    changes.set(path, { path, before, after, reason });
  };
  const skill = await readFile(
    join(packageRoot, "skills/daisu-ui/SKILL.md"),
    "utf8",
  );
  const server = serverDefinition(cwd, { ...options, scope });
  for (const client of selected) {
    const owner = `${scope}:${client.id}`;
    for (const kind of parts) {
      let path =
        kind === "mcp"
          ? clientPath(client, cwd, home, scope)
          : resolve(
              cwd,
              kind === "skill"
                ? `${client.skill}/SKILL.md`
                : client.instructions,
            );
      if (kind === "mcp" && client.id === "codebuddy-cli") {
        const candidates =
          scope === "project"
            ? [join(cwd, ".mcp.json"), join(cwd, "mcp.json")]
            : [
                join(home, ".codebuddy/.mcp.json"),
                join(home, ".codebuddy/mcp.json"),
                join(home, ".codebuddy.json"),
              ];
        for (const candidate of candidates) {
          if ((await read(candidate)) !== undefined) {
            path = candidate;
            break;
          }
        }
      }
      const key = `${kind}:${path}`,
        before = await read(path),
        asset = state.assets[key];
      let current: string | undefined;
      if (kind === "mcp") {
        const value = serverEntry(before, client);
        current = value === undefined ? undefined : JSON.stringify(value);
      } else if (kind === "instructions")
        current = instructionBlock(before || "");
      else current = before;
      if (operation === "init") {
        const expected =
          kind === "mcp"
            ? JSON.stringify(encodeServer(client, server))
            : kind === "skill"
              ? skill
              : managedBody;
        if (
          current !== undefined &&
          (!asset || hash(current) !== asset.hash) &&
          current !== expected
        )
          throw new Error(
            `已有${kind === "mcp" ? " Daisu MCP " : kind === "skill" ? " Skill " : " Instructions "}内容未托管或被修改，未覆盖：${path}`,
          );
        if (current !== undefined && !asset) {
          warnings.push(`保留已存在但未由本工具创建的内容：${path}`);
          continue;
        }
        let after: string;
        if (kind === "mcp")
          after = editServer(before, client, encodeServer(client, server));
        else if (kind === "instructions") {
          after = instructionContent(before);
          if (client.id === "cursor" && !before)
            after = cursorFrontmatter + after;
        } else after = skill;
        await stage(path, after, `配置 ${client.name} ${kind}`);
        state.assets[key] = {
          kind: kind as Asset["kind"],
          owners: [...new Set([...(asset?.owners || []), owner])].sort(),
          hash: hash(expected),
          created: asset?.created ?? before === undefined,
          ...(kind === "mcp" ? { server } : {}),
        };
      } else {
        if (!asset || !asset.owners.includes(owner)) continue;
        asset.owners = asset.owners.filter((v) => v !== owner);
        if (asset.owners.length) continue;
        if (current !== undefined && hash(current) !== asset.hash) {
          warnings.push(`保留已修改的托管内容：${path}`);
          asset.owners = [owner];
          continue;
        }
        if (current !== undefined) {
          let after: string | undefined;
          if (kind === "mcp") after = editServer(before, client, undefined);
          else if (kind === "instructions")
            after = (before || "").replace(current, "");
          else after = undefined;
          if (asset.created && after !== undefined) {
            const cleaned =
              kind === "mcp"
                ? Object.keys(
                    (await import("./clients.js")).parseConfig(after, client),
                  ).length === 0 && !/(?:^|\n)\s*(?:#|\/\/|\/\*)/.test(after)
                : !after.trim() ||
                  (client.id === "cursor" &&
                    after.trim() === cursorFrontmatter.trim());
            if (cleaned) after = undefined;
          }
          await stage(path, after, `移除 ${client.name} 托管的 ${kind}`);
        }
        delete state.assets[key];
      }
    }
  }
  if (operation === "init") {
    const buddy = clients.find((client) => client.id === "codebuddy-cli")!;
    const candidates =
      scope === "project"
        ? [join(cwd, ".mcp.json"), join(cwd, "mcp.json")]
        : [
            join(home, ".codebuddy/.mcp.json"),
            join(home, ".codebuddy/mcp.json"),
            join(home, ".codebuddy.json"),
          ];
    let previous: string | undefined, next: string | undefined;
    for (const candidate of candidates) {
      if (!previous && (await readText(candidate)) !== undefined)
        previous = candidate;
      if (!next && (await read(candidate)) !== undefined) next = candidate;
    }
    if (previous && next && previous !== next) {
      const config = parseConfig((await readText(previous))!, buddy);
      if (config.mcpServers && Object.keys(config.mcpServers).length)
        throw new Error(
          `新配置 ${next} 将遮蔽 CodeBuddy 已有服务：${previous}。请先合并配置，未写入任何变更。`,
        );
    }
  }
  const afterState = JSON.stringify(state, null, 2) + "\n";
  if (afterState !== stateText && Object.keys(state.assets).length)
    changes.set(statePath, {
      path: statePath,
      before: stateText,
      after: afterState,
      reason: "更新 Daisu 托管清单",
    });
  else if (!Object.keys(state.assets).length && stateText !== undefined)
    changes.set(statePath, {
      path: statePath,
      before: stateText,
      after: undefined,
      reason: "移除空托管清单",
    });
  return {
    operation,
    cwd,
    scope,
    clients: selected.map((c) => c.id),
    changes: [...changes.values()],
    warnings,
    roots,
  };
}
export async function applyOnboarding(
  operation: "init" | "remove",
  options: AgentOptions,
  onlyMcp = false,
) {
  const execute = async () => {
    const plan = await onboardingPlan(operation, options, onlyMcp);
    if (!options.dryRun && plan.changes.length)
      await applyChanges(plan.changes, plan.roots);
    return {
      operation,
      cwd: plan.cwd,
      scope: plan.scope,
      clients: plan.clients,
      dryRun: !!options.dryRun,
      changedFiles: plan.changes.map((c) => ({
        path: c.path,
        action:
          c.after === undefined
            ? "remove"
            : c.before === undefined
              ? "create"
              : "update",
        reason: c.reason,
      })),
      warnings: plan.warnings,
    };
  };
  if (options.dryRun) return execute();
  const cwd = await realpath(resolve(options.cwd || process.cwd()));
  return lockProject(cwd, execute);
}
export async function onboardingStatus(options: AgentOptions, onlyMcp = false) {
  const ctx = await context(options);
  const parts = (
    onlyMcp ? "mcp" : options.with || "mcp,skill,instructions"
  ).split(",");
  const results = [];
  for (const client of ctx.selected) {
    const entries = [];
    for (const kind of parts) {
      const path =
        kind === "mcp"
          ? clientPath(client, ctx.cwd, ctx.home, ctx.scope)
          : resolve(
              ctx.cwd,
              kind === "skill"
                ? `${client.skill}/SKILL.md`
                : client.instructions,
            );
      await safePath(path, ctx.roots);
      const text = await readText(path),
        asset = ctx.state.assets[`${kind}:${path}`];
      const content =
        kind === "mcp"
          ? serverEntry(text, client)
          : kind === "instructions"
            ? instructionBlock(text || "")
            : text;
      const serialized =
        kind === "mcp" && content !== undefined
          ? JSON.stringify(content)
          : (content as string | undefined);
      entries.push({
        kind,
        path,
        configured: content !== undefined,
        managed: !!asset?.owners.includes(`${ctx.scope}:${client.id}`),
        problems:
          kind === "mcp" && content !== undefined
            ? [
                ...inspectToolFilters(content),
                ...(client.opencode
                  ? inspectOpenCodeFilters(parseConfig(text || "{}", client))
                  : []),
              ]
            : [],
        matches:
          serialized !== undefined &&
          !!asset &&
          hash(serialized) === asset.hash,
      });
    }
    results.push({ client: client.id, name: client.name, entries });
  }
  return { cwd: ctx.cwd, scope: ctx.scope, clients: results };
}
export async function onboardingDoctor(options: AgentOptions, onlyMcp = false) {
  const status = await onboardingStatus(options, onlyMcp),
    ctx = await context(options);
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) ||
      options.timeout < 100 ||
      options.timeout > 60000)
  )
    throw new Error("诊断超时应在 100–60000ms 之间。");
  const deadline = Date.now() + (options.timeout || 10000);
  const probes = new Map<string, unknown>();
  const checks = [];
  for (const client of ctx.selected) {
    const result = status.clients.find((c) => c.client === client.id)!;
    const invalid = result.entries.filter(
      (e) => !e.configured || !e.matches || e.problems.length,
    );
    let handshake: any;
    let registration: Awaited<ReturnType<typeof verifyClientRegistration>> = {
      status: "unknown",
      verified: false,
      message: "配置或服务尚未通过检查，未执行客户端查询。",
      sessionVerified: false,
    };
    const mcp = result.entries.find((e) => e.kind === "mcp");
    if (mcp?.configured && mcp.matches && mcp.managed && !mcp.problems.length) {
      const before = await readText(mcp.path),
        decoded = decodeServer(client, serverEntry(before, client));
      const expected = ["local", "global", "npx"].flatMap((runner) =>
        [false, true].map((pin) =>
          serverDefinition(ctx.cwd, {
            ...options,
            scope: ctx.scope,
            runner: runner as AgentOptions["runner"],
            pin,
          }),
        ),
      );
      const pinned = decoded?.args[1]?.match(/^@daisu-ui\/cli@(.+)$/)?.[1];
      if (pinned && valid(pinned))
        expected.push(
          serverDefinition(ctx.cwd, {
            ...options,
            scope: ctx.scope,
            runner: "npx",
            pin: pinned,
          }),
        );
      if (
        decoded &&
        expected.some(
          (value) => JSON.stringify(value) === JSON.stringify(decoded),
        )
      ) {
        const key = JSON.stringify(decoded);
        if (!probes.has(key))
          probes.set(
            key,
            await probeServer(
              decoded,
              ctx.cwd,
              Math.max(100, deadline - Date.now()),
            ),
          );
        handshake = probes.get(key);
        if (
          (handshake as any)?.ok &&
          Date.now() < deadline &&
          options.registration !== false
        )
          registration = await verifyClientRegistration(
            client,
            decoded,
            {
              cwd: ctx.cwd,
              home: ctx.home,
              env: options.env,
              platform: options.platform,
            },
            Math.max(100, deadline - Date.now()),
          );
        else if (Date.now() >= deadline)
          registration = {
            status: "unknown",
            verified: false,
            message: "已用完诊断时间，未执行客户端登记查询。",
            sessionVerified: false,
          };
        else if (options.registration === false)
          registration = {
            status: "unknown",
            verified: false,
            message: "已跳过客户端登记查询。",
            sessionVerified: false,
          };
      }
    }
    const serverReady = !!mcp && handshake?.ok === true;
    checks.push({
      ...result,
      ok:
        !invalid.length &&
        (!mcp || serverReady) &&
        registration.status !== "failed",
      serverReady,
      configurationProblems: invalid.map(
        (entry) =>
          `${entry.kind}: ${!entry.configured ? "缺失" : !entry.matches ? "托管内容与当前文件不同" : entry.problems.join(" ")}`,
      ),
      readiness:
        invalid.length ||
        (mcp && !serverReady) ||
        registration.status === "failed"
          ? "failed"
          : registration.status === "pending"
            ? "pending-approval"
            : registration.verified
              ? "registered"
              : mcp
                ? "server-ready"
                : "configured",
      ...(handshake ? { handshake } : {}),
      registration,
      nextStep:
        "重新加载客户端或会话，在 MCP 面板确认服务并调用 daisu_status、daisu_list；本检查验证独立握手，不代表客户端已批准加载。",
    });
  }
  return {
    cwd: ctx.cwd,
    scope: ctx.scope,
    clients: checks,
    errors: checks.filter((c) => !c.ok).length,
    pending: checks.filter((c) => c.registration.status === "pending").length,
  };
}
export async function onboardingPrint(options: AgentOptions) {
  const ctx = await context(options);
  const server = serverDefinition(ctx.cwd, { ...options, scope: ctx.scope });
  return {
    scope: ctx.scope,
    clients: ctx.selected.map((c) => ({
      client: c.id,
      path: clientPath(c, ctx.cwd, ctx.home, ctx.scope),
      config: printClient(c, server),
    })),
  };
}
