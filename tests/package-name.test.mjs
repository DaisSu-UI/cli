import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  availableVersions,
  loadKnowledge,
  queryKnowledge,
} from "../dist/knowledge.js";
import { usageProject, lintProject } from "../dist/scanner.js";
import { exportSiteDocs } from "../dist/site-docs.js";
import { resolveUi } from "../scripts/auto-sync.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daisu-scoped-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("scoped installed package takes precedence and unknown versions do not fall back", async (t) => {
  const root = await fixture(t),
    latest = availableVersions().latest;
  for (const [name, version] of [
    ["daisu-ui", "0.1.0-beta.1"],
    ["@daisu-ui/ui", latest],
  ]) {
    await mkdir(join(root, "node_modules", name), { recursive: true });
    await writeFile(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  assert.equal(loadKnowledge({ cwd: root }).version, latest);
  assert.equal(
    queryKnowledge("info", ["Button"], { cwd: root }).importFrom,
    "@daisu-ui/ui",
  );
  await writeFile(
    join(root, "node_modules/@daisu-ui/ui/package.json"),
    JSON.stringify({ name: "@daisu-ui/ui", version: "99.0.0" }),
  );
  assert.throws(() => loadKnowledge({ cwd: root }), /没有匹配/);
});
test("scoped dependency and JSX imports are analyzed using their actual public entry", async (t) => {
  const root = await fixture(t),
    latest = availableVersions().latest;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "@daisu-ui/ui": latest } }),
  );
  await writeFile(
    join(root, "Page.tsx"),
    "import {Button} from '@daisu-ui/ui'; export const Page=()=> <Button label=\"确定\"/>;",
  );
  assert.equal(loadKnowledge({ cwd: root }).versionSource, "package.json");
  assert.equal(
    usageProject(root).components.find((item) => item.name === "Button").count,
    1,
  );
  assert.equal(lintProject(root).errors, 0);
  await writeFile(
    join(root, "Private.tsx"),
    "import {Input} from '@daisu-ui/ui/src/Input';",
  );
  assert(
    lintProject(root).issues.some((item) => item.rule === "private-import"),
  );
});
test("documentation export and development source discovery accept the scoped UI package", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "packages/daisu-ui"), { recursive: true });
  await writeFile(
    join(root, "packages/daisu-ui/package.json"),
    '{"name":"@daisu-ui/ui"}',
  );
  await mkdir(join(root, "node_modules/typescript"), { recursive: true });
  assert.equal(await resolveUi("/unused", root, {}), root);
  await exportSiteDocs(root);
  await exportSiteDocs(root, true);
});
