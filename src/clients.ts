import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  parse as parseJsonc,
  parseTree,
  modify,
  applyEdits,
  type ParseError,
} from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import type { ServerDefinition } from "./types.js";

export type Scope = "project" | "user";
export interface ClientAdapter {
  id: string;
  name: string;
  project: string;
  user?: string;
  root: string;
  skill: string;
  instructions: string;
  toml?: boolean;
  opencode?: boolean;
}
export const clients: ClientAdapter[] = [
  {
    id: "claude",
    name: "Claude Code",
    project: ".mcp.json",
    user: ".claude.json",
    root: "mcpServers",
    skill: ".claude/skills/daisu-ui",
    instructions: "CLAUDE.md",
  },
  {
    id: "cursor",
    name: "Cursor",
    project: ".cursor/mcp.json",
    user: ".cursor/mcp.json",
    root: "mcpServers",
    skill: ".cursor/skills/daisu-ui",
    instructions: ".cursor/rules/daisu-ui.mdc",
  },
  {
    id: "vscode",
    name: "VS Code",
    project: ".vscode/mcp.json",
    root: "servers",
    skill: ".github/skills/daisu-ui",
    instructions: ".github/copilot-instructions.md",
  },
  {
    id: "codex",
    name: "Codex",
    project: ".codex/config.toml",
    user: ".codex/config.toml",
    root: "mcp_servers",
    skill: ".agents/skills/daisu-ui",
    instructions: "AGENTS.md",
    toml: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    project: "opencode.json",
    user: ".config/opencode/opencode.json",
    root: "mcp",
    skill: ".agents/skills/daisu-ui",
    instructions: "AGENTS.md",
    opencode: true,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    project: ".agents/mcp_config.json",
    user: ".gemini/config/mcp_config.json",
    root: "mcpServers",
    skill: ".agents/skills/daisu-ui",
    instructions: "AGENTS.md",
  },
  {
    id: "qoder",
    name: "Qoder IDE",
    project: ".mcp.json",
    user: ".qoder/mcp.json",
    root: "mcpServers",
    skill: ".qoder/skills/daisu-ui",
    instructions: "AGENTS.md",
  },
  {
    id: "qoder-cli",
    name: "Qoder CLI",
    project: ".mcp.json",
    user: ".qoder/settings.json",
    root: "mcpServers",
    skill: ".qoder/skills/daisu-ui",
    instructions: "AGENTS.md",
  },
  {
    id: "codebuddy",
    name: "CodeBuddy IDE",
    project: ".mcp.json",
    user: ".codebuddy/mcp.json",
    root: "mcpServers",
    skill: ".codebuddy/skills/daisu-ui",
    instructions: "CODEBUDDY.md",
  },
  {
    id: "codebuddy-cli",
    name: "CodeBuddy CLI",
    project: ".mcp.json",
    user: ".codebuddy/.mcp.json",
    root: "mcpServers",
    skill: ".codebuddy/skills/daisu-ui",
    instructions: "CODEBUDDY.md",
  },
];
export function selectClients(value: string, scope: Scope): ClientAdapter[] {
  if (value === "all")
    return clients.filter((c) => scope === "project" || c.user);
  const client = clients.find((c) => c.id === value);
  if (!client)
    throw new Error(
      `不支持的客户端 ${value}。可用：${clients.map((c) => c.id).join(", ")}、all。`,
    );
  if (scope === "user" && !client.user)
    throw new Error(`${client.name} 仅支持 project scope。`);
  return [client];
}
export function clientPath(
  client: ClientAdapter,
  cwd: string,
  home: string,
  scope: Scope,
): string {
  if (client.opencode) {
    const base = scope === "project" ? cwd : join(home, ".config/opencode");
    const candidates =
      scope === "project"
        ? [
            "opencode.json",
            "opencode.jsonc",
            ".opencode/opencode.json",
            ".opencode/opencode.jsonc",
          ]
        : ["opencode.json", "opencode.jsonc"];
    const existing = candidates.filter((name) =>
      existsSync(resolve(base, name)),
    );
    if (existing.length > 1)
      throw new Error(
        "发现多个 OpenCode 配置，先合并配置以避免遮蔽已有 MCP 服务。",
      );
    return resolve(base, existing[0] || "opencode.json");
  }
  if (client.id === "codebuddy-cli") {
    const base = scope === "project" ? cwd : home;
    const names =
      scope === "project"
        ? [".mcp.json", "mcp.json"]
        : [".codebuddy/.mcp.json", ".codebuddy/mcp.json", ".codebuddy.json"];
    return resolve(
      base,
      names.find((name) => existsSync(resolve(base, name))) || names[0],
    );
  }
  if (
    client.id === "qoder-cli" &&
    scope === "user" &&
    process.env.QODER_CONFIG_DIR
  )
    return resolve(cwd, process.env.QODER_CONFIG_DIR, "settings.json");
  return resolve(
    scope === "project" ? cwd : home,
    scope === "project" ? client.project : client.user!,
  );
}
export function parseConfig(
  source: string,
  client: ClientAdapter,
): Record<string, any> {
  try {
    if (client.toml) {
      const value = parseToml(source);
      if (!value || typeof value !== "object") throw new Error();
      return value;
    }
    const errors: ParseError[] = [];
    const input = source.trim() ? source : "{}";
    const value = parseJsonc(input, errors, {
      allowTrailingComma: true,
    });
    const tree = parseTree(input);
    const checkKeys = (node: NonNullable<typeof tree>) => {
      if (node.type === "object") {
        const names = node.children?.map(
          (property) => property.children?.[0]?.value,
        );
        if (names && new Set(names).size !== names.length) throw new Error();
      }
      node.children?.forEach(checkKeys);
    };
    if (tree) checkKeys(tree);
    if (
      errors.length ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      `${client.name} 配置无法解析；保留原文件，请先修复 ${client.toml ? "TOML" : "JSON/JSONC"}。`,
    );
  }
}
export function serverEntry(
  source: string | undefined,
  client: ClientAdapter,
): unknown {
  if (source === undefined) return undefined;
  const root = parseConfig(source, client)[client.root];
  if (
    root !== undefined &&
    (!root || typeof root !== "object" || Array.isArray(root))
  )
    throw new Error(`${client.root} 必须是配置对象。`);
  return root?.["daisu-ui"];
}
export function encodeServer(client: ClientAdapter, server: ServerDefinition) {
  if (client.opencode)
    return {
      type: "local",
      command: [server.command, ...server.args],
      enabled: true,
    };
  return client.id === "vscode" ? { type: "stdio", ...server } : server;
}
export function decodeServer(
  client: ClientAdapter,
  value: any,
): ServerDefinition | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.disabled === true ||
    value.enabled === false
  )
    return;
  if (client.opencode) {
    if (
      value.type !== "local" ||
      !Array.isArray(value.command) ||
      !value.command.every((v: unknown) => typeof v === "string") ||
      !value.command.length
    )
      return;
    return { command: value.command[0], args: value.command.slice(1) };
  }
  if (
    typeof value.command !== "string" ||
    !Array.isArray(value.args) ||
    !value.args.every((v: unknown) => typeof v === "string")
  )
    return;
  return { command: value.command, args: value.args };
}
function tomlSection(
  source: string,
): { start: number; end: number } | undefined {
  const headings = [
    ...source.matchAll(/^\s*\[([^\]\n]+)\][ \t]*(?:#[^\n]*)?\r?$/gm),
  ];
  const match = headings.find((h) =>
    /^mcp_servers\s*\.\s*(?:daisu-ui|"daisu-ui"|'daisu-ui')\s*$/.test(h[1]),
  );
  if (!match) return;
  const index = headings.indexOf(match);
  const next = headings
    .slice(index + 1)
    .find(
      (h) =>
        !/^mcp_servers\s*\.\s*(?:daisu-ui|"daisu-ui"|'daisu-ui')\s*\./.test(
          h[1],
        ),
    );
  return { start: match.index!, end: next?.index ?? source.length };
}
export function editServer(
  source: string | undefined,
  client: ClientAdapter,
  value: unknown | undefined,
): string {
  const text = source || (client.toml ? "" : "{}\n");
  const current = serverEntry(source, client);
  if (JSON.stringify(current) === JSON.stringify(value)) return text;
  let after: string;
  if (client.toml) {
    const section = tomlSection(text);
    if (current !== undefined && !section)
      throw new Error(
        "无法在保留其他配置的前提下修改内联 TOML 服务；请先将 daisu-ui 改为独立 [mcp_servers.daisu-ui] 表。",
      );
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const server = value as ServerDefinition | undefined;
    const block = server
      ? `[mcp_servers.daisu-ui]${eol}command = ${JSON.stringify(server.command)}${eol}args = ${JSON.stringify(server.args)}${eol}`
      : "";
    if (section) {
      const comments = text
        .slice(section.start, section.end)
        .split(/\r?\n/)
        .filter((line) => /^\s*#/.test(line));
      after =
        text.slice(0, section.start) +
        block +
        (comments.length ? comments.join(eol) + eol : "") +
        text.slice(section.end);
    } else
      after =
        text +
        (text && !text.endsWith("\n") ? eol : "") +
        (text ? eol : "") +
        block;
  } else {
    after = applyEdits(
      text,
      modify(text, [client.root, "daisu-ui"], value, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: text.includes("\r\n") ? "\r\n" : "\n",
        },
      }),
    );
    if (!after.endsWith("\n")) after += "\n";
  }
  const actual = serverEntry(after, client);
  if (JSON.stringify(actual) !== JSON.stringify(value))
    throw new Error("配置修改校验失败，原文件未写入。");
  return after;
}
export function printClient(client: ClientAdapter, server: ServerDefinition) {
  const value = encodeServer(client, server);
  return client.toml
    ? editServer(undefined, client, value)
    : JSON.stringify({ [client.root]: { "daisu-ui": value } }, null, 2) + "\n";
}
