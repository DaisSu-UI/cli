import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  availableVersions,
  cliPackage,
  loadKnowledge,
  queryKnowledge,
} from "./knowledge.js";
import { lintProject, usageProject, doctorProject } from "./scanner.js";
import { within } from "./files.js";
import type { QueryOptions } from "./types.js";
export async function createMcpServer(options: QueryOptions = {}) {
  const root = await realpath(resolve(options.cwd || process.cwd()));
  const server = new McpServer(
    { name: "daisu-ui", version: cliPackage.version },
    {
      instructions:
        "查询 Daisu UI 的 ReactLynx 组件与 Hook。先 daisu_list，再 info/demo/doc；不要使用 Vue 或 wot-ui API。所有知识查询使用随包数据，项目分析只读取当前项目。",
    },
  );
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const response = (value: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  });
  const safe =
    (handler: (args: any) => Promise<unknown> | unknown) =>
    async (args: any) => {
      try {
        return response(await handler(args));
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "查询失败",
            },
          ],
        };
      }
    };
  const version = { version: z.string().optional() };
  server.registerTool(
    "daisu_status",
    {
      description: "离线 MCP 服务、CLI 版本、可用组件库版本及数据来源。",
      inputSchema: {},
      annotations,
    },
    safe(() => {
      const selected = loadKnowledge({ ...options, cwd: root });
      return {
        server: { name: "daisu-ui", version: cliPackage.version },
        cli: { name: cliPackage.name, version: cliPackage.version },
        offline: true,
        versions: availableVersions(),
        selectedVersion: selected.version,
        versionSource: selected.versionSource,
        warnings: selected.warnings,
        source: selected.data.source,
      };
    }),
  );
  server.registerTool(
    "daisu_search",
    {
      description:
        "离线全文搜索组件文档与平台约束，多个词须全部匹配，按来源文档去重。",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
        ...version,
      },
      annotations,
    },
    safe((args) =>
      queryKnowledge("search", [args.query], {
        ...options,
        cwd: root,
        ...(args.version ? { version: args.version } : {}),
        limit: args.limit,
      }),
    ),
  );
  const spec = [
    [
      "list",
      "查询组件/Hook；可按中英文名称、分类或用途搜索。",
      { keyword: z.string().optional(), ...version },
    ],
    [
      "info",
      "查询真实公开 Props、事件、插槽、方法、CSS 变量。",
      { component: z.string(), ...version },
    ],
    [
      "doc",
      "读取组件完整 Markdown 文档和平台能力边界。",
      { component: z.string(), ...version },
    ],
    [
      "demo",
      "列出示例或读取指定示例；basic 为基本用法，source 为完整交互源码。",
      { component: z.string(), demo: z.string().optional(), ...version },
    ],
    [
      "token",
      "查询组件或全局 CSS 变量及默认值。",
      { component: z.string().optional(), ...version },
    ],
    [
      "changelog",
      "按发布版本或组件筛选开发/更新记录。",
      {
        release: z.string().optional(),
        component: z.string().optional(),
        ...version,
      },
    ],
  ] as const;
  for (const [command, description, inputSchema] of spec)
    server.registerTool(
      `daisu_${command}`,
      { description, inputSchema, annotations },
      safe((args) => {
        const positional =
          command === "list"
            ? [args.keyword || ""]
            : command === "demo"
              ? [args.component, args.demo]
              : command === "changelog"
                ? [
                    args.release || args.component || "",
                    args.release ? args.component : undefined,
                  ]
                : [args.component];
        const result = queryKnowledge(
          command,
          positional.filter((v) => v !== undefined),
          {
            ...options,
            cwd: root,
            ...(args.version ? { version: args.version } : {}),
          },
        );
        return command === "doc" ? result.doc : result;
      }),
    );
  for (const [name, handler, description] of [
    [
      "lint",
      lintProject,
      "只读检查当前项目 TSX/JSX 中的组件导入、属性和回调。",
    ],
    ["usage", usageProject, "统计当前项目 TSX/JSX 组件及 Hook 使用情况。"],
    [
      "doctor",
      doctorProject,
      "检查当前项目 Node、依赖、知识库版本与 JSX 集成。",
    ],
  ] as const) {
    server.registerTool(
      `daisu_${name}`,
      {
        description,
        inputSchema: { dir: z.string().optional(), ...version },
        annotations: { ...annotations, openWorldHint: false },
      },
      safe(async (args) => {
        const dir = await realpath(resolve(root, args.dir || "."));
        if (!within(root, dir))
          throw new Error("项目分析路径必须位于 MCP 启动工作目录内。");
        return handler(dir, {
          ...options,
          cwd: dir,
          ...(args.version ? { version: args.version } : {}),
        });
      }),
    );
  }
  server.registerResource(
    "versions",
    "daisu://versions",
    {
      description: "随包可离线查询的 Daisu UI 版本",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(availableVersions()),
        },
      ],
    }),
  );
  server.registerResource(
    "component-document",
    new ResourceTemplate("daisu://components/{component}", { list: undefined }),
    { description: "组件 Markdown 文档", mimeType: "text/markdown" },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: queryKnowledge("doc", [String(variables.component)], {
            ...options,
            cwd: root,
          }).doc,
        },
      ],
    }),
  );
  server.registerResource(
    "usage-guide",
    new ResourceTemplate("daisu://guides/{guide}", { list: undefined }),
    {
      description:
        "UI 维护的使用约束：llms、llms-full、component-ai-notes；历史快照可能未收录",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const selected = loadKnowledge({ ...options, cwd: root });
      const guide = selected.data.guides?.[String(variables.guide)];
      if (!guide)
        throw new Error(`该快照未收录指南：${String(variables.guide)}`);
      return {
        contents: [
          { uri: uri.href, mimeType: "text/plain", text: guide.content },
        ],
      };
    },
  );
  server.registerPrompt(
    "daisu_component_usage",
    {
      description: "根据真实 Daisu API 编写 ReactLynx 组件用法",
      argsSchema: { component: z.string() },
    },
    async ({ component }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `基于以下 Daisu UI 文档生成 ReactLynx 用法。使用公开入口，保留线程约束并说明实际平台支持。\n\n${queryKnowledge("doc", [component], { ...options, cwd: root }).doc}`,
          },
        },
      ],
    }),
  );
  return server;
}
export async function serveMcp(options: QueryOptions = {}) {
  const server = await createMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
