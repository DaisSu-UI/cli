import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportSiteDocs, renderSiteDocs } from "../dist/site-docs.js";
import { clients, serverEntry, decodeServer } from "../dist/clients.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daisu-site-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "packages/daisu-ui"), { recursive: true });
  await writeFile(
    join(root, "packages/daisu-ui/package.json"),
    '{"name":"daisu-ui"}',
  );
  return root;
}
test("export is deterministic, reflects registered commands/tools and --check never writes", async (t) => {
  const root = await fixture(t),
    target = join(root, "apps/docs/ai");
  await assert.rejects(exportSiteDocs(root, true), /未同步/);
  await assert.rejects(stat(join(root, "apps")), /ENOENT/);
  await exportSiteDocs(root);
  const snapshot = async () =>
    Promise.all(
      (await readdir(target))
        .sort()
        .map(async (name) => [
          name,
          await readFile(join(target, name), "utf8"),
          (await stat(join(target, name))).mtimeMs,
        ]),
    );
  const before = await snapshot();
  await exportSiteDocs(root, true);
  await exportSiteDocs(root);
  assert.deepEqual(await snapshot(), before);
  const pages = await renderSiteDocs();
  assert.match(pages["mcp.md"], /daisu_search/);
  assert.match(pages["cli.md"], /daisu docs export/);
  assert.match(pages["cli.md"], /--ui-dir/);
  assert(!JSON.stringify(pages).includes("/media/youzi/"));
  await writeFile(join(target, "mcp.md"), "# manual edit");
  const changed = await snapshot();
  await assert.rejects(exportSiteDocs(root, true), /mcp.md/);
  assert.deepEqual(await snapshot(), changed);
  await exportSiteDocs(root);
  await exportSiteDocs(root, true);
});
test("export rejects non-UI targets and symlinks escaping the selected repository", async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, "packages/daisu-ui/package.json"),
    '{"name":"other"}',
  );
  await assert.rejects(exportSiteDocs(root), /不是 Daisu UI/);
  await writeFile(
    join(root, "packages/daisu-ui/package.json"),
    '{"name":"daisu-ui"}',
  );
  const external = await fixture(t);
  await mkdir(join(root, "apps/docs"), { recursive: true });
  await symlink(external, join(root, "apps/docs/ai"));
  await assert.rejects(exportSiteDocs(root), /路径越界/);
});

test("documented global client snippets parse and use the published CLI entry", async () => {
  const pages = await renderSiteDocs();
  const blocks = [
    ...pages["mcp.md"].matchAll(/```(?:json|toml)\n([\s\S]*?)```/g),
  ];
  assert.equal(blocks.length, 3);
  for (const [index, id] of ["cursor", "vscode", "codex"].entries()) {
    const client = clients.find((item) => item.id === id);
    const server = decodeServer(client, serverEntry(blocks[index][1], client));
    assert.equal(server.command, "daisu");
    assert.deepEqual(server.args, ["mcp"]);
  }
  for (const name of ["overview.md", "cli.md"]) {
    const block = pages[name].match(/```json\n([\s\S]*?)```/);
    assert(block, name);
    const client = clients.find((item) => item.id === "cursor");
    const server = decodeServer(client, serverEntry(block[1], client));
    assert.deepEqual(server, { command: "daisu", args: ["mcp"] });
  }
  assert.match(pages["cli.md"], /git@git.zilueit.com:daisu-ui\/cli.git/);
  assert.match(pages["overview.md"], /daisu_status/);
  assert.match(pages["mcp.md"], /sessionVerified/);
});
