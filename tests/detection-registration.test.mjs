import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectClients, resolveClients } from "../dist/detection.js";
import { clients } from "../dist/clients.js";
import { verifyClientRegistration } from "../dist/registration.js";
import { applyOnboarding, onboardingDoctor } from "../dist/onboarding.js";
import { requiredTools } from "../dist/probe.js";
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "daisu-detect-"));
  const cwd = join(base, "project"),
    home = join(base, "home"),
    bin = join(base, "bin");
  for (const dir of [cwd, home, bin]) mkdirSync(dir);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, cwd, home, bin, env: { PATH: bin } };
}
function executable(path, body) {
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
}
test("active environment wins over other installed clients, without exposing environment values", async (t) => {
  const f = fixture(t);
  executable(join(f.bin, "claude"), "");
  const env = {
    ...f.env,
    CODEX_THREAD_ID: "private-session-id",
    TERM_PROGRAM: "vscode",
  };
  const result = await resolveClients("auto", "project", { ...f, env });
  assert.deepEqual(
    result.map((c) => c.id),
    ["codex"],
  );
  assert(
    !JSON.stringify(await detectClients({ ...f, env })).includes(
      "private-session-id",
    ),
  );
});
test("shared MCP config and ambiguous executables do not silently select a client", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, ".mcp.json"), "{}");
  await assert.rejects(() => resolveClients("auto", "project", f), /没有可靠/);
  executable(join(f.bin, "codex"), "");
  executable(join(f.bin, "claude"), "");
  await assert.rejects(
    () => resolveClients("auto", "project", f),
    /多个客户端/,
  );
});
test("single executable can be selected, and unsupported user scope fails", async (t) => {
  const f = fixture(t);
  executable(join(f.bin, "codex"), "");
  assert.equal((await resolveClients("auto", "project", f))[0].id, "codex");
  await assert.rejects(
    () =>
      resolveClients("auto", "user", {
        ...f,
        env: { ...f.env, TERM_PROGRAM: "vscode" },
      }),
    /不支持 user/,
  );
});
test("Codex registration checks command, enabled state and tool filters", async (t) => {
  const f = fixture(t),
    client = clients.find((c) => c.id === "codex"),
    server = { command: process.execPath, args: ["cli.js", "mcp", "serve"] };
  const value = {
    name: "daisu-ui",
    enabled: true,
    transport: { type: "stdio", ...server },
    enabled_tools: requiredTools,
  };
  const reply = (v) =>
    executable(
      join(f.bin, "codex"),
      `process.stdout.write(${JSON.stringify(JSON.stringify(v))});`,
    );
  reply(value);
  let result = await verifyClientRegistration(client, server, f);
  assert.equal(result.status, "registered");
  assert(result.verified);
  assert(!result.sessionVerified);
  reply({ ...value, enabled: false });
  assert.equal(
    (await verifyClientRegistration(client, server, f)).status,
    "failed",
  );
  reply({ ...value, disabled_tools: ["daisu_info"] });
  assert.equal(
    (await verifyClientRegistration(client, server, f)).status,
    "failed",
  );
  reply({ ...value, transport: { command: "other", args: [] } });
  assert.equal(
    (await verifyClientRegistration(client, server, f)).status,
    "failed",
  );
});
test("approval, malformed output and secrets are reported without raw client output", async (t) => {
  const f = fixture(t),
    client = clients.find((c) => c.id === "codex"),
    server = { command: "node", args: [] };
  executable(
    join(f.bin, "codex"),
    `console.error('untrusted private-token-value');process.exit(1)`,
  );
  let result = await verifyClientRegistration(client, server, f);
  assert.equal(result.status, "pending");
  assert(!JSON.stringify(result).includes("private-token-value"));
  executable(join(f.bin, "codex"), `console.log('private-token-value')`);
  result = await verifyClientRegistration(client, server, f);
  assert.equal(result.status, "unknown");
  assert(!JSON.stringify(result).includes("private-token-value"));
});
test("project-controlled binaries are not executed; hanging client is terminated", async (t) => {
  const f = fixture(t),
    client = clients.find((c) => c.id === "codex"),
    server = { command: "node", args: [] };
  const inside = join(f.cwd, "bin");
  mkdirSync(inside);
  executable(join(inside, "codex"), `throw Error('must not execute')`);
  assert.equal(
    (
      await verifyClientRegistration(client, server, {
        ...f,
        env: { PATH: inside },
      })
    ).status,
    "unknown",
  );
  executable(join(f.bin, "codex"), "setInterval(()=>{},1000)");
  const started = Date.now();
  assert.equal(
    (await verifyClientRegistration(client, server, f, 150)).status,
    "unknown",
  );
  assert(Date.now() - started < 2000);
});
test("doctor differentiates independently callable service and client registration", async (t) => {
  const f = fixture(t),
    options = { ...f, client: "codex", scope: "project", yes: true };
  await applyOnboarding("init", options);
  const { readFileSync } = await import("node:fs");
  const { parse } = await import("smol-toml");
  const config = parse(readFileSync(join(f.cwd, ".codex/config.toml"), "utf8"));
  const expected = config.mcp_servers["daisu-ui"];
  executable(
    join(f.bin, "codex"),
    `console.log(${JSON.stringify(JSON.stringify({ name: "daisu-ui", enabled: true, transport: expected }))})`,
  );
  const result = await onboardingDoctor({ ...options, timeout: 10000 });
  assert.equal(result.errors, 0);
  assert.equal(result.clients[0].readiness, "registered");
  assert.equal(result.clients[0].serverReady, true);
  assert.equal(result.clients[0].registration.sessionVerified, false);
});
test("pin accepts a specific CLI version and is preserved in npx config", async (t) => {
  const f = fixture(t);
  const { onboardingPrint } = await import("../dist/onboarding.js");
  const result = await onboardingPrint({
    ...f,
    client: "cursor",
    scope: "project",
    runner: "npx",
    pin: "0.1.0-beta.0",
  });
  assert(result.clients[0].config.includes("@daisu-ui/cli@0.1.0-beta.0"));
  await assert.rejects(
    () =>
      onboardingPrint({ ...f, client: "cursor", runner: "npx", pin: "latest" }),
    /精确 semver/,
  );
});

test("OpenCode glob tool filters are diagnosed without rewriting user permissions", async (t) => {
  const { inspectOpenCodeFilters } = await import("../dist/registration.js");
  assert(inspectOpenCodeFilters({ tools: { "daisu-ui_*": false } }).length);
  assert(
    !inspectOpenCodeFilters({ tools: { "*": false, "daisu-ui_*": true } })
      .length,
  );
  assert(
    inspectOpenCodeFilters({ permission: { "daisu-ui_daisu_info": "deny" } })
      .length,
  );
  assert(
    !inspectOpenCodeFilters({ permission: { "daisu-ui_*": "ask" } }).length,
  );
  const f = fixture(t);
  writeFileSync(
    join(f.cwd, "opencode.json"),
    JSON.stringify({ tools: { "daisu-ui_*": false } }),
  );
  await applyOnboarding("init", { ...f, client: "opencode", yes: true });
  const result = await onboardingDoctor({
    ...f,
    client: "opencode",
    timeout: 5000,
  });
  assert(result.errors > 0);
  assert(
    result.clients[0].configurationProblems.some((p) =>
      p.includes("tools/permission"),
    ),
  );
});
