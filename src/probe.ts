import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServerDefinition } from "./types.js";
export const requiredTools = [
  "daisu_status",
  "daisu_list",
  "daisu_info",
  "daisu_doc",
  "daisu_demo",
  "daisu_token",
  "daisu_changelog",
  "daisu_lint",
];
export async function probeServer(
  server: ServerDefinition,
  cwd: string,
  timeout = 10000,
) {
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 60000)
    throw new Error("握手超时应在 100–60000ms 之间。");
  const client = new Client({ name: "daisu-cli-doctor", version: "1.0.0" });
  const transport = new StdioClientTransport({
    ...server,
    cwd,
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const task = (async () => {
      await client.connect(transport);
      const tools = await client.listTools();
      const missing = requiredTools.filter(
        (name) => !tools.tools.some((t) => t.name === name),
      );
      if (missing.length) throw new Error("MCP 缺少必需工具。");
      const status = await client.callTool({
        name: "daisu_status",
        arguments: {},
      });
      if (status.isError) throw new Error("MCP 状态工具调用失败。");
      const info = await client.callTool({
        name: "daisu_info",
        arguments: { component: "Button" },
      });
      if (info.isError) throw new Error("MCP 组件查询工具调用失败。");
      return {
        ok: true,
        server: client.getServerVersion(),
        tools: tools.tools.map((t) => t.name),
        status: "server-ready",
      };
    })();
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("MCP 握手超时。")), timeout);
      }),
    ]);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && /超时|缺少|工具调用/.test(error.message)
          ? error.message
          : "MCP 进程启动或协议握手失败；请核对 Node 和 CLI 的安装路径。",
    };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
