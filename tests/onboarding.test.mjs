import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  applyOnboarding,
  onboardingPlan,
  onboardingStatus,
  onboardingDoctor,
  clientList,
} from "../dist/onboarding.js";
import { applyChanges } from "../dist/files.js";
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "daisu-agent-"));
  const cwd = join(base, "project"),
    home = join(base, "home");
  mkdirSync(cwd);
  mkdirSync(home);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, cwd, home, client: "cursor", scope: "project", yes: true };
}
function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function tree(dir) {
  return readdirSync(dir, { recursive: true }).sort();
}
test("dry-run is pure and produces reviewable planned paths", async (t) => {
  const o = fixture(t);
  const before = tree(o.base);
  const plan = await applyOnboarding("init", { ...o, dryRun: true });
  assert(plan.changedFiles.length >= 4);
  assert.deepEqual(tree(o.base), before);
});
test("JSONC config, unrelated server credentials and user instructions survive init/remove", async (t) => {
  const o = fixture(t),
    config = join(o.cwd, ".cursor/mcp.json"),
    rules = join(o.cwd, ".cursor/rules/daisu-ui.mdc");
  const source =
    '{// keep this comment\n"mcpServers":{"existing":{"command":"private-tool","env":{"TOKEN":"secret-value"}}}}\n';
  put(config, source);
  put(rules, "# My rules\nKeep this content.\n");
  await applyOnboarding("init", o);
  const text = readFileSync(config, "utf8");
  assert(text.includes("// keep this comment"));
  assert(text.includes("secret-value"));
  assert(readFileSync(rules, "utf8").startsWith("# My rules"));
  const repeated = await applyOnboarding("init", o);
  assert.equal(repeated.changedFiles.length, 0);
  const status = await onboardingStatus(o);
  assert(status.clients[0].entries.every((e) => e.matches));
  await applyOnboarding("remove", o);
  assert(readFileSync(config, "utf8").includes("secret-value"));
  assert(!readFileSync(config, "utf8").includes('"daisu-ui"'));
  assert(readFileSync(rules, "utf8").includes("Keep this content."));
  assert(!readFileSync(rules, "utf8").includes("<!-- daisu-ui:start -->"));
});
test("Codex TOML editing preserves unrelated fields and servers", async (t) => {
  const o = { ...fixture(t), client: "codex" };
  const path = join(o.cwd, ".codex/config.toml");
  put(
    path,
    '# keep\nmodel = "custom"\n\n[mcp_servers.existing]\ncommand = "other"\nargs = ["hello"]\n',
  );
  await applyOnboarding("init", o);
  assert(readFileSync(path, "utf8").includes('model = "custom"'));
  assert(readFileSync(path, "utf8").includes("[mcp_servers.existing]"));
  await applyOnboarding("remove", o);
  const after = readFileSync(path, "utf8");
  assert(after.includes("# keep"));
  assert(after.includes("[mcp_servers.existing]"));
  assert(!after.includes("[mcp_servers.daisu-ui]"));
});
test("all clients initialize once; shared files are reference counted", async (t) => {
  const o = { ...fixture(t), client: "all" };
  await applyOnboarding("init", o);
  const result = await onboardingStatus(o);
  assert.equal(result.clients.length, 10);
  assert(result.clients.every((c) => c.entries.every((e) => e.matches)));
  assert.equal((await applyOnboarding("init", o)).changedFiles.length, 0);
  await applyOnboarding("remove", { ...o, client: "claude" });
  assert(readFileSync(join(o.cwd, ".mcp.json"), "utf8").includes("daisu-ui"));
  assert(
    (
      await onboardingStatus({ ...o, client: "qoder" })
    ).clients[0].entries.every((e) => e.matches),
  );
  await applyOnboarding("remove", o);
  assert(!existsSync(join(o.cwd, ".daisu/cli-state.json")));
});
test("modified skill and server contents are preserved on removal", async (t) => {
  const o = fixture(t);
  await applyOnboarding("init", o);
  const skill = join(o.cwd, ".cursor/skills/daisu-ui/SKILL.md");
  writeFileSync(skill, readFileSync(skill, "utf8") + "\nUser addition.\n");
  const result = await applyOnboarding("remove", o);
  assert(result.warnings.length);
  assert(readFileSync(skill, "utf8").includes("User addition."));
});
test("foreign Daisu MCP config is not overwritten", async (t) => {
  const o = fixture(t),
    path = join(o.cwd, ".cursor/mcp.json");
  const before = '{"mcpServers":{"daisu-ui":{"command":"custom","args":[]}}}\n';
  put(path, before);
  await assert.rejects(() => applyOnboarding("init", o), /未托管或被修改/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert(!existsSync(join(o.cwd, ".cursor/skills/daisu-ui/SKILL.md")));
});
test("config paths containing symlinks cannot redirect writes", async (t) => {
  const o = fixture(t),
    outside = join(o.base, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(o.cwd, ".cursor"), "dir");
  await assert.rejects(() => applyOnboarding("init", o), /符号链接/);
  assert.deepEqual(readdirSync(outside), []);
});
test("modified configuration is never executed by doctor", async (t) => {
  const o = fixture(t);
  await applyOnboarding("init", o);
  const path = join(o.cwd, ".cursor/mcp.json"),
    value = JSON.parse(readFileSync(path, "utf8")),
    marker = join(o.cwd, "executed.txt");
  value.mcpServers["daisu-ui"] = {
    command: process.execPath,
    args: [
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`,
    ],
  };
  writeFileSync(path, JSON.stringify(value));
  const result = await onboardingDoctor({ ...o, timeout: 1000 });
  assert(result.errors > 0);
  assert(!existsSync(marker));
});
test("doctor performs a real stdio handshake with locally configured CLI", async (t) => {
  const o = fixture(t);
  await applyOnboarding("init", o);
  const result = await onboardingDoctor({ ...o, timeout: 15000 });
  assert.equal(result.errors, 0, JSON.stringify(result));
  assert(result.clients[0].handshake.tools.includes("daisu_info"));
  assert.equal(result.clients[0].registration.status, "unsupported");
  assert.equal(result.clients[0].registration.sessionVerified, false);
  assert.equal(result.clients[0].readiness, "server-ready");
});
test("project and user MCP locations are distinct while skills stay project scoped", async (t) => {
  const o = { ...fixture(t), scope: "user" };
  await applyOnboarding("init", o);
  assert(existsSync(join(o.home, ".cursor/mcp.json")));
  assert(existsSync(join(o.cwd, ".cursor/skills/daisu-ui/SKILL.md")));
  assert(!existsSync(join(o.cwd, ".cursor/mcp.json")));
});
test("concurrent file edits abort a transaction before applying other writes", async (t) => {
  const o = fixture(t),
    a = join(o.cwd, "a.txt"),
    b = join(o.cwd, "b.txt");
  put(a, "old");
  put(b, "changed");
  await assert.rejects(
    () =>
      applyChanges(
        [
          { path: a, before: "old", after: "new", reason: "test" },
          { path: b, before: "old", after: "new", reason: "test" },
        ],
        [o.cwd],
      ),
    /发生变化/,
  );
  assert.equal(readFileSync(a, "utf8"), "old");
});

test("duplicate JSON keys fail without rewriting configuration", async (t) => {
  const o = fixture(t),
    path = join(o.cwd, ".cursor/mcp.json");
  const source =
    '{"mcpServers":{},"mcpServers":{"existing":{"command":"keep"}}}\n';
  put(path, source);
  await assert.rejects(() => applyOnboarding("init", o), /无法解析/);
  assert.equal(readFileSync(path, "utf8"), source);
});
test("new Cursor rule is removed fully and Codex comments are preserved", async (t) => {
  const o = fixture(t);
  await applyOnboarding("init", o);
  await applyOnboarding("remove", o);
  assert(!existsSync(join(o.cwd, ".cursor/rules/daisu-ui.mdc")));
  const codex = { ...o, client: "codex" };
  await applyOnboarding("init", codex);
  const path = join(o.cwd, ".codex/config.toml");
  writeFileSync(path, readFileSync(path, "utf8") + "# user note to keep\n");
  await applyOnboarding("remove", codex);
  assert(readFileSync(path, "utf8").includes("# user note to keep"));
});

test("all refuses to shadow CodeBuddy project legacy services", async (t) => {
  const o = { ...fixture(t), client: "all" },
    legacy = join(o.cwd, "mcp.json"),
    source = '{"mcpServers":{"existing":{"command":"keep"}}}\n';
  put(legacy, source);
  await assert.rejects(() => applyOnboarding("init", o), /将遮蔽 CodeBuddy/);
  assert.equal(readFileSync(legacy, "utf8"), source);
  assert(!existsSync(join(o.cwd, ".mcp.json")));
  assert(!existsSync(join(o.cwd, ".daisu/cli-state.json")));
});
test("empty CodeBuddy legacy config can coexist with shared new project config", async (t) => {
  const o = { ...fixture(t), client: "all" };
  put(join(o.cwd, "mcp.json"), '{"mcpServers":{}}\n');
  await applyOnboarding("init", o);
  const status = await onboardingStatus(o);
  assert(
    status.clients.every((c) => c.entries.every((e) => e.matches && e.managed)),
  );
  await applyOnboarding("remove", o);
  assert(existsSync(join(o.cwd, "mcp.json")));
});
test("all refuses to shadow CodeBuddy user legacy services", async (t) => {
  const o = { ...fixture(t), client: "all", scope: "user" },
    legacy = join(o.home, ".codebuddy.json");
  put(legacy, '{"mcpServers":{"existing":{"command":"keep"}}}\n');
  await assert.rejects(() => applyOnboarding("init", o), /将遮蔽 CodeBuddy/);
  assert(!existsSync(join(o.home, ".codebuddy/mcp.json")));
});
