import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test(
  "documented daisu mcp command connects through PATH and queries real component knowledge",
  { skip: process.platform === "win32", timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "daisu-global-entry-"));
    let client;
    t.after(async () => {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    });
    const bin = join(root, "bin");
    await mkdir(bin);
    await symlink(
      fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      join(bin, "daisu"),
    );
    client = new Client({
      name: "documented-global-configuration",
      version: "1.0.0",
    });
    await client.connect(
      new StdioClientTransport({
        command: "daisu",
        args: ["mcp"],
        cwd: root,
        env: { PATH: bin + delimiter + process.env.PATH },
        stderr: "pipe",
      }),
    );
    assert(
      (await client.listTools()).tools.some(
        (tool) => tool.name === "daisu_info",
      ),
    );
    const result = await client.callTool({
      name: "daisu_info",
      arguments: { component: "Button" },
    });
    assert.notEqual(result.isError, true);
    const info = JSON.parse(
      result.content.find((item) => item.type === "text").text,
    );
    assert.equal(info.name, "Button");
    assert(info.events.some((item) => item.name === "onTap"));
  },
);
