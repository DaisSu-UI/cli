import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { probeServer } from "../dist/probe.js";
test("real MCP supports initialization, tools, resources, prompts, errors and project confinement", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "daisu-mcp-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js"), "mcp", "serve", "--cwd", cwd],
    cwd,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of [
    "daisu_status",
    "daisu_search",
    "daisu_list",
    "daisu_info",
    "daisu_doc",
    "daisu_demo",
    "daisu_token",
    "daisu_changelog",
    "daisu_lint",
    "daisu_usage",
    "daisu_doctor",
  ])
    assert(tools.tools.some((t) => t.name === name));
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  let result = await call("daisu_status");
  assert.equal(JSON.parse(result.content[0].text).offline, true);
  result = await call("daisu_info", { component: "Button" });
  assert(
    JSON.parse(result.content[0].text).events.some((e) => e.name === "onTap"),
  );
  result = await call("daisu_doc", { component: "Button" });
  assert(result.content[0].text.startsWith("# Button"));
  result = await call("daisu_demo", { component: "Button", demo: "basic" });
  assert(JSON.parse(result.content[0].text).demo.code.includes("<Button"));
  result = await call("daisu_token", { component: "Button" });
  assert(JSON.parse(result.content[0].text).cssVars.length);
  result = await call("daisu_list", { keyword: "分段" });
  assert(
    JSON.parse(result.content[0].text).components.some(
      (c) => c.name === "Segmented",
    ),
  );
  result = await call("daisu_changelog", { release: "0.1.0-beta.0" });
  assert.equal(JSON.parse(result.content[0].text).entries.length, 1);
  result = await call("daisu_info", { component: "Missing" });
  assert(result.isError);
  result = await call("daisu_lint", { dir: tmpdir() });
  assert(result.isError);
  assert.match(result.content[0].text, /启动工作目录/);
  result = await call("daisu_info", {
    component: "Button",
    version: "999.0.0",
  });
  assert(result.isError);
  result = await call("daisu_search", { query: "onTap", limit: 2 });
  assert.equal(JSON.parse(result.content[0].text).results.length, 2);
  result = await call("daisu_search", { query: "onTap", limit: 21 });
  assert(result.isError);
  const guide = await client.readResource({ uri: "daisu://guides/llms" });
  assert(guide.contents[0].text.includes("ReactLynx"));
  const resources = await client.listResources();
  assert(resources.resources.some((r) => r.uri === "daisu://versions"));
  const doc = await client.readResource({ uri: "daisu://components/Button" });
  assert(doc.contents[0].text.includes("Button"));
  const prompts = await client.listPrompts();
  assert(prompts.prompts.some((p) => p.name === "daisu_component_usage"));
  const prompt = await client.getPrompt({
    name: "daisu_component_usage",
    arguments: { component: "Button" },
  });
  assert(prompt.messages[0].content.text.includes("ReactLynx"));
  assert.equal(stderr, "");
});
test("doctor times out and terminates an unresponsive child", async () => {
  const started = Date.now();
  const result = await probeServer(
    { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
    process.cwd(),
    200,
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /超时/);
  assert(Date.now() - started < 5000);
});
