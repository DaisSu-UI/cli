import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkDataDirectory } from "../dist/data-validation.js";
import { loadKnowledge } from "../dist/knowledge.js";
import { analyzeProject } from "../dist/scanner.js";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "daisu-data-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, text);
};
test("all bundled versions validate and tampering cannot pass data health checks", (t) => {
  const root = fixture(t);
  cpSync(resolve("data"), root, { recursive: true });
  const result = checkDataDirectory(root);
  assert(result.ok);
  const version = result.latest;
  const path = join(root, version + ".json");
  writeFileSync(path, readFileSync(path, "utf8") + " ");
  assert.throws(() => checkDataDirectory(root), /校验失败/);
});
test("lifecycle lint applies to components, props, hooks and namespaces only when annotated", (t) => {
  const root = fixture(t),
    data = structuredClone(loadKnowledge({ version: "latest" }).data);
  const button = data.components.find((c) => c.name === "Button");
  button.deprecated = true;
  button.deprecationMessage = "旧接口";
  button.props.find((p) => p.name === "label").deprecated = true;
  button.props.find((p) => p.name === "label").replacement = "caption";
  const hook = data.components.find((c) => c.name === "useToast");
  hook.deprecated = true;
  put(
    root,
    "Page.tsx",
    `import{Button as Action,useToast}from${JSON.stringify(button.importFrom)};import * as UI from ${JSON.stringify(button.importFrom)};export function Page(){useToast();return <><Action label="确认"/><UI.Button label="继续"/></>}`,
  );
  const report = analyzeProject(root, data);
  assert.equal(
    report.issues.filter((i) => i.rule === "deprecated-component").length,
    2,
  );
  assert.equal(
    report.issues.filter((i) => i.rule === "deprecated-prop").length,
    2,
  );
  assert(report.issues.some((i) => i.rule === "deprecated-api"));
  assert(report.issues.some((i) => i.message.includes("caption")));
});
test("extract reads real JSDoc tags, validates source drift and does not execute UI modules", (t) => {
  const root = fixture(t),
    output = join(root, "knowledge");
  put(
    root,
    "packages/daisu-ui/package.json",
    JSON.stringify({
      name: "daisu-ui",
      version: "0.1.0",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      },
    }),
  );
  put(
    root,
    "packages/daisu-ui/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
      },
    }),
  );
  put(
    root,
    "packages/daisu-ui/src/index.ts",
    `throw new Error('must not execute');\nexport type ButtonProps={\n/** @deprecated use caption\n * @replacement caption\n * @since 0.0.1\n */label?:string;caption?:string};\n/** @since 0.0.1\n * @deprecated use NewButton\n * @replacement NewButton\n */export function Button(props:ButtonProps){return null}`,
  );
  put(
    root,
    "packages/daisu-ui/src/styles.css",
    ":root{--cso-ui-primary:#f86100}.theme-dark{--cso-ui-primary:#ff812e}",
  );
  put(
    root,
    "packages/daisu-ui/CHANGELOG.md",
    "# 更新日志\n\n## 0.1.0\n\n2026-11-25\n",
  );
  put(
    root,
    "docs/ui/component-sources.json",
    JSON.stringify({
      button: {
        components: [
          { name: "Button", path: "packages/daisu-ui/src/index.ts" },
        ],
        doc: "docs/ui/components/button.md",
      },
    }),
  );
  put(
    root,
    "docs/ui/components/button.md",
    '# Button 按钮\n\n按钮用途。\n\n## 组件类型\n\n### 基本用法\n\n使用 label。\n\n```tsx\n<Button label="确定" />\n```\n',
  );
  put(
    root,
    "apps/demo/src/features/ui-demo/catalog.ts",
    `export const componentGroups=[{id:'basic',label:'基础',items:[{id:'button',label:'Button 按钮'}]}] as const;`,
  );
  for (const name of ["llms.txt", "llms-full.txt", "COMPONENT_AI_NOTES.md"])
    put(root, `docs/ui/${name}`, `# ReactLynx guide ${name}\n`);
  const args = ["scripts/extract.mjs", "--ui-dir", root, "--output", output];
  execFileSync(process.execPath, args, { stdio: "pipe" });
  const metadata = JSON.parse(readFileSync(join(output, "0.1.0.json"), "utf8"));
  assert.equal(metadata.guides.llms.content, "# ReactLynx guide llms.txt\n");
  const button = metadata.components[0];
  assert.equal(button.since, "0.0.1");
  assert.equal(button.replacement, "NewButton");
  assert(button.deprecated);
  const label = button.props.find((p) => p.name === "label");
  assert(label.deprecated);
  assert.equal(label.replacement, "caption");
  assert(!button.props.find((p) => p.name === "caption").deprecated);
  assert(checkDataDirectory(output).ok);
  const before = readFileSync(join(output, "0.1.0.json"), "utf8");
  execFileSync(process.execPath, [...args, "--check"], { stdio: "pipe" });
  assert.equal(readFileSync(join(output, "0.1.0.json"), "utf8"), before);
  put(
    root,
    "packages/daisu-ui/src/index.ts",
    readFileSync(join(root, "packages/daisu-ui/src/index.ts"), "utf8").replace(
      "caption?:string",
      "caption?:number",
    ),
  );
  assert.throws(() =>
    execFileSync(process.execPath, [...args, "--check"], { stdio: "pipe" }),
  );
  assert.equal(readFileSync(join(output, "0.1.0.json"), "utf8"), before);
});

test("snapshot sync preserves newer latest and rejects corrupt history without partial writes", async (t) => {
  const { saveSnapshot } = await import("../scripts/snapshot-files.mjs");
  const root = fixture(t),
    data = structuredClone(loadKnowledge({ version: "latest" }).data);
  saveSnapshot(root, { ...data, version: "9.0.0" });
  saveSnapshot(root, { ...data, version: "0.1.0" });
  let index = JSON.parse(readFileSync(join(root, "versions.json"), "utf8"));
  assert.equal(index.latest, "9.0.0");
  assert(checkDataDirectory(root).ok);
  const original = readFileSync(join(root, "versions.json"), "utf8");
  writeFileSync(
    join(root, "9.0.0.json"),
    readFileSync(join(root, "9.0.0.json"), "utf8") + " ",
  );
  assert.throws(
    () => saveSnapshot(root, { ...data, version: "0.2.0" }),
    /历史快照摘要/,
  );
  assert.equal(readFileSync(join(root, "versions.json"), "utf8"), original);
  const { existsSync } = await import("node:fs");
  assert(!existsSync(join(root, "0.2.0.json")));
  assert(!existsSync(join(root, ".sync.lock")));
});

test("repeated automatic extraction preserves generated time, bytes and mtimes when knowledge is unchanged", async (t) => {
  const { saveSnapshot } = await import("../scripts/snapshot-files.mjs");
  const { statSync } = await import("node:fs");
  const root = fixture(t),
    data = structuredClone(loadKnowledge({ version: "latest" }).data);
  saveSnapshot(root, data);
  const file = join(root, `${data.version}.json`),
    index = join(root, "versions.json");
  const before = [
    readFileSync(file, "utf8"),
    readFileSync(index, "utf8"),
    statSync(file).mtimeMs,
    statSync(index).mtimeMs,
  ];
  saveSnapshot(root, {
    ...data,
    generatedAt: new Date(Date.now() + 10000).toISOString(),
  });
  assert.deepEqual(
    [
      readFileSync(file, "utf8"),
      readFileSync(index, "utf8"),
      statSync(file).mtimeMs,
      statSync(index).mtimeMs,
    ],
    before,
  );
});
