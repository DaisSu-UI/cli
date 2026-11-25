import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadKnowledge,
  queryKnowledge,
  findComponent,
  availableVersions,
} from "../dist/knowledge.js";
const bin = resolve("dist/index.js");
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "daisu-query-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(args, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 20000,
  });
  if (result.error) throw result.error;
  return result;
}

test("bundled data has real ReactLynx APIs, methods, sources and no absolute repository dependency", () => {
  const data = loadKnowledge({ version: "latest" }).data;
  assert(data.components.length >= 100);
  assert(data.components.some((c) => c.kind === "hook"));
  const button = findComponent("Button", data);
  assert(button.props.some((p) => p.name === "tone"));
  assert(!button.props.some((p) => p.name === "v-model"));
  assert(button.events.some((e) => e.name === "onTap"));
  assert(button.slots.some((s) => s.name === "icon"));
  assert(button.demos[0].code.includes("<Button"));
  assert(button.demoSource.includes("daisu-ui"));
  assert(data.changelog.some((e) => e.version === data.version));
  assert(
    data.cssVars.some(
      (v) =>
        v.name === "--cso-ui-primary" &&
        v.defaultValue === "#f86100" &&
        v.darkValue === "#ff812e",
    ),
  );
  assert(!data.cssVars.some((v) => v.name.startsWith("--ui-")));
  assert(!JSON.stringify(data).includes("/media/youzi/Project/"));
});
test("component names, kebab names, Chinese aliases and search resolve", () => {
  assert.equal(queryKnowledge("info", ["按钮"]).name, "Button");
  assert.equal(queryKnowledge("info", ["input-number"]).name, "InputNumber");
  assert(
    queryKnowledge("list", ["导航"]).components.some(
      (c) => c.name === "Segmented",
    ),
  );
  assert(
    queryKnowledge("list", ["useToast"]).components.some(
      (c) => c.kind === "hook",
    ),
  );
});
test("metadata follows installed package and reports unavailable exact version", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "node_modules/daisu-ui"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules/daisu-ui/package.json"),
    JSON.stringify({ name: "daisu-ui", version: availableVersions().latest }),
  );
  assert.equal(loadKnowledge({ cwd: dir }).versionSource, "node_modules");
  writeFileSync(
    join(dir, "node_modules/daisu-ui/package.json"),
    JSON.stringify({ name: "daisu-ui", version: "99.0.0" }),
  );
  assert.throws(() => loadKnowledge({ cwd: dir }), /没有匹配/);
  assert.equal(
    loadKnowledge({ cwd: dir, version: "latest" }).versionSource,
    "flag",
  );
});
test("dependency ranges and local tarballs do not silently pretend to be exact installed versions", (t) => {
  const dir = fixture(t);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { "daisu-ui": "^0.1.0-beta.0" } }),
  );
  assert.equal(loadKnowledge({ cwd: dir }).versionSource, "package.json");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { "daisu-ui": "file:vendor/ui.tgz" } }),
  );
  assert(loadKnowledge({ cwd: dir }).warnings.length);
  assert.throws(
    () => loadKnowledge({ cwd: dir, version: "../../private" }),
    /没有匹配/,
  );
});
test("demo aliases and complete source work without upstream checkout", () => {
  assert.deepEqual(
    queryKnowledge("demo", ["Button", "basic"]).demo,
    queryKnowledge("demo", ["Button", "demo-1"]).demo,
  );
  assert(
    queryKnowledge("demo", ["Button", "source"]).demo.code.includes(
      "export function",
    ),
  );
  assert.throws(
    () => queryKnowledge("demo", ["Button", "not-a-demo"]),
    /找不到示例/,
  );
  assert(queryKnowledge("doc", ["Button"]).doc.includes("## Events"));
});
test("CLI supports JSON, markdown, help, versions and invalid input exit codes", (t) => {
  const cwd = fixture(t);
  let run = cli(["list", "button", "--format", "json"], cwd);
  assert.equal(run.status, 0, run.stderr);
  assert(JSON.parse(run.stdout).components.some((c) => c.name === "Button"));
  run = cli(["doc", "Button", "--format", "markdown"], cwd);
  assert.equal(run.status, 0);
  assert(run.stdout.startsWith("# Button"));
  run = cli(["--help"], cwd);
  assert.equal(run.status, 0);
  assert(run.stdout.includes("agent"));
  run = cli(["-V"], cwd);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /0\.1\.0/);
  for (const args of [
    ["info", "Missing"],
    ["list", "--format", "yaml"],
    ["info", "Button", "--version", "99.0.0"],
  ]) {
    run = cli(args, cwd);
    assert.notEqual(run.status, 0);
    assert(run.stderr.length > 0);
  }
});
test("CLI changelog supports release and component filters", () => {
  assert.equal(queryKnowledge("changelog", ["0.1.0-beta.0"]).entries.length, 1);
  assert(
    queryKnowledge("changelog", ["Button"]).entries.every((e) =>
      e.components.includes("Button"),
    ),
  );
});
