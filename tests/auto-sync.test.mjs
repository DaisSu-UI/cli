import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveUi,
  synchronize,
  relevantChange,
  createScheduler,
  isCi,
} from "../scripts/auto-sync.mjs";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function put(root, name, value = "") {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daisu-auto-test-")),
    cli = join(root, "cli"),
    ui = join(root, "daisu-ui");
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(cli, "package.json", '{"name":"@daisu-ui/cli","type":"module"}');
  await put(ui, "package.json", '{"type":"module"}');
  await put(ui, "packages/daisu-ui/package.json", '{"name":"daisu-ui"}');
  await mkdir(join(ui, "node_modules/typescript"), { recursive: true });
  await put(ui, "packages/daisu-ui/src/value.txt", "initial-ui");
  await put(cli, "src/value.txt", "initial-cli");
  await put(
    ui,
    "apps/docs/generate.mjs",
    `
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const target='docs/ui/components/layout.md', next=await readFile('packages/daisu-ui/src/value.txt','utf8');
let old;try{old=await readFile(target,'utf8')}catch{}
if(old!==next){if(process.argv.includes('--check'))throw Error('component drift');await mkdir('docs/ui/components',{recursive:true});await writeFile(target,next);}
`,
  );
  const bin = `
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const target=join(process.argv[process.argv.indexOf('--ui-dir')+1],'apps/docs/ai/cli.md'),next=await readFile('src/value.txt','utf8');
let old;try{old=await readFile(target,'utf8')}catch{}
if(old!==next){if(process.argv.includes('--check'))throw Error('export drift');await mkdir(join(target,'..'),{recursive:true});await writeFile(target,next);}
`;
  await put(cli, "src/mock.mjs", bin);
  await put(
    cli,
    "scripts/compile.mjs",
    `import{mkdir,copyFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await copyFile('src/mock.mjs','dist/index.js');`,
  );
  await put(
    cli,
    "scripts/extract.mjs",
    `
import{readFile,writeFile,mkdir}from'node:fs/promises';import{join}from'node:path';
const ui=process.argv[process.argv.indexOf('--ui-dir')+1];
const next=JSON.stringify([await readFile(join(ui,'docs/ui/components/layout.md'),'utf8'),await readFile(join(ui,'apps/docs/ai/cli.md'),'utf8')]);
let old;try{old=await readFile('data/fixture.json','utf8')}catch{}
if(old!==next){if(process.argv.includes('--check'))throw Error('snapshot drift');await mkdir('data',{recursive:true});await writeFile('data/fixture.json',next);}
`,
  );
  await put(
    cli,
    "scripts/validate-data.mjs",
    `import{readFile}from'node:fs/promises';JSON.parse(await readFile('data/fixture.json','utf8'));`,
  );
  return { root, cli, ui };
}
async function snapshot(root) {
  const entries = [];
  async function visit(path) {
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name),
        info = await stat(full);
      if (info.isDirectory()) await visit(full);
      else entries.push([full, await readFile(full, "utf8"), info.mtimeMs]);
    }
  }
  await visit(root);
  return entries;
}
test("local build coordination discovers siblings, regenerates before extracting and propagates both directions", async (t) => {
  const { root, cli, ui } = await fixture(t);
  assert.equal(await resolveUi(cli, undefined, {}), ui);
  await synchronize({ cliDir: cli, env: {} });
  assert.deepEqual(
    JSON.parse(await readFile(join(cli, "data/fixture.json"), "utf8")),
    ["initial-ui", "initial-cli"],
  );
  await put(ui, "packages/daisu-ui/src/value.txt", "new-ui");
  await put(cli, "src/value.txt", "new-cli");
  await synchronize({ cliDir: cli, env: {} });
  assert.deepEqual(
    JSON.parse(await readFile(join(cli, "data/fixture.json"), "utf8")),
    ["new-ui", "new-cli"],
  );
  const before = await snapshot(root);
  await synchronize({ cliDir: cli, check: true, env: {} });
  assert.deepEqual(await snapshot(root), before);
  await put(cli, "src/value.txt", "unsynced");
  const drift = await snapshot(root);
  await assert.rejects(synchronize({ cliDir: cli, check: true, env: {} }));
  assert.deepEqual(await snapshot(root), drift);
});
test("standalone and disabled builds skip, explicit missing sources fail, CI checks without repairing", async (t) => {
  const { root, cli, ui } = await fixture(t);
  assert(isCi({ CI: "true" }));
  assert(!isCi({ CI: "false" }));
  assert.equal(
    (await synchronize({ cliDir: cli, env: { DAISU_UI_AUTO_SYNC: "0" } }))
      .skipped,
    "disabled",
  );
  await assert.rejects(resolveUi(cli, join(root, "missing"), {}), /不存在/);
  await synchronize({ cliDir: cli, env: {} });
  await put(ui, "packages/daisu-ui/src/value.txt", "ci-drift");
  const before = await snapshot(root);
  await assert.rejects(synchronize({ cliDir: cli, env: { CI: "true" } }));
  assert.deepEqual(await snapshot(root), before);
  await rm(ui, { recursive: true });
  assert.equal(
    (await synchronize({ cliDir: cli, env: {} })).skipped,
    "standalone",
  );
});
test("watch filters exclude outputs and still react to source, API, examples and CLI changes", () => {
  for (const [kind, path] of [
    ["cli", "data/1.json"],
    ["cli", "dist/index.js"],
    ["ui", "apps/docs/dist/index.html"],
    ["ui", "docs/ui/component-sources.json"],
    ["ui", "docs/ui/components/layout.md"],
    ["ui", "apps/docs/ai/cli-manifest.json"],
    ["ui", "apps/docs/ai/mcp.md"],
  ])
    assert(!relevantChange(kind, path), path);
  for (const [kind, path] of [
    ["cli", "src/mcp.ts"],
    ["cli", "skills/daisu-ui/SKILL.md"],
    ["ui", "packages/daisu-ui/src/Button.tsx"],
    ["ui", "docs/ui/components/button.md"],
    ["ui", "apps/docs/guides/basic.mjs"],
    ["ui", "apps/demo/src/features/example.tsx"],
  ])
    assert(relevantChange(kind, path), path);
});
test("watch scheduler coalesces bursts, serializes late changes and retries after errors", async () => {
  const calls = [],
    errors = [];
  let release;
  let active = 0,
    max = 0;
  const first = new Promise((done) => (release = done));
  const scheduler = createScheduler(
    async (changes) => {
      active++;
      max = Math.max(max, active);
      calls.push([...changes]);
      try {
        if (calls.length === 1) await first;
        if (calls.length === 2) throw Error("retry");
      } finally {
        active--;
      }
    },
    { debounce: 5, onError: (error) => errors.push(error.message) },
  );
  try {
    scheduler.schedule("ui");
    scheduler.schedule("cli");
    while (calls.length < 1) await delay(5);
    scheduler.schedule("ui-demo");
    await delay(15);
    assert.equal(calls.length, 1);
    release();
    while (calls.length < 2) await delay(5);
    assert.equal(max, 1);
    assert.deepEqual(calls[0], ["ui", "cli"]);
    assert.deepEqual(errors, ["retry"]);
    scheduler.schedule("cli");
    while (calls.length < 3) await delay(5);
  } finally {
    scheduler.close();
    release();
  }
});

test("simultaneous local build hooks serialize, retaining a consistent snapshot", async (t) => {
  const { cli } = await fixture(t);
  await Promise.all([
    synchronize({ cliDir: cli, env: {} }),
    synchronize({ cliDir: cli, env: {} }),
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(join(cli, "data/fixture.json"), "utf8")),
    ["initial-ui", "initial-cli"],
  );
});

test(
  "real filesystem watcher synchronizes later UI edits without watching its own outputs",
  { timeout: 10000 },
  async (t) => {
    const { cli, ui } = await fixture(t);
    const { watchSynchronization } = await import("../scripts/auto-sync.mjs");
    const watcher = await watchSynchronization({
      cliDir: cli,
      uiDir: ui,
      env: {},
    });
    t.after(() => watcher.close());
    await put(ui, "packages/daisu-ui/src/value.txt", "watched-ui");
    const deadline = Date.now() + 5000;
    for (;;) {
      const current = JSON.parse(
        await readFile(join(cli, "data/fixture.json"), "utf8"),
      );
      if (current[0] === "watched-ui") break;
      if (Date.now() > deadline)
        assert.fail("watcher did not synchronize source edits");
      await delay(25);
    }
    watcher.close();
  },
);
