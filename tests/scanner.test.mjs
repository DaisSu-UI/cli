import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageProject, lintProject, doctorProject } from "../dist/scanner.js";
function fixture(t, source) {
  const dir = mkdtempSync(join(tmpdir(), "daisu-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: {
        "daisu-ui": "0.1.0-beta.1",
        "@lynx-js/react": "^0.126.2",
      },
    }),
  );
  writeFileSync(join(dir, "Page.tsx"), source);
  return dir;
}
test("usage resolves import aliases and namespace JSX; comments and strings are ignored", (t) => {
  const dir = fixture(
    t,
    `import { Button as Action, useToast as toast } from 'daisu-ui';import * as UI from 'daisu-ui';// <Action />\nconst code='<UI.Button />';export function Page(){toast();return <><Action label="提交"/><UI.Button icon={<UI.Icon name="home"/>}/></>;}`,
  );
  const result = usageProject(dir);
  assert.equal(result.components.find((c) => c.name === "Button").count, 2);
  assert.equal(result.components.find((c) => c.name === "Icon").count, 1);
  assert.equal(result.components.find((c) => c.name === "useToast").count, 1);
});
test("local shadowing and other component libraries are not counted", (t) => {
  const dir = fixture(
    t,
    `import { Button as Action } from 'daisu-ui';import { Button } from 'another-ui';function Nested(Action:any){return <Action/>}export function Page(){return <><Button/><Action label="确认"/></>}`,
  );
  const result = usageProject(dir);
  assert.equal(result.components.find((c) => c.name === "Button").count, 1);
});
test("lint detects private imports, unknown exports, props and namespace components", (t) => {
  const dir = fixture(
    t,
    `import { Button, Fake } from 'daisu-ui';import * as UI from 'daisu-ui';import { Input } from 'daisu-ui/src/Input';export const Page=()=> <><Button type="primary"/><UI.Nonexistent/></>;`,
  );
  const rules = lintProject(dir).issues.map((i) => i.rule);
  for (const rule of [
    "private-import",
    "unknown-export",
    "unknown-prop",
    "unknown-component",
    "empty-button",
  ])
    assert(rules.includes(rule), rule);
});
test("valid callbacks, spread props and loading buttons avoid false lint errors", (t) => {
  const dir = fixture(
    t,
    `import{Button,Input}from'daisu-ui';const props={label:'确认'};export function Page(){return <><Button {...props}/><Button loading/><Button label="确认" onTap={()=>{'background only';console.log('确认')}}/><Input placeholder="输入"/></>}`,
  );
  const result = lintProject(dir);
  assert.equal(result.errors, 0);
  assert.equal(result.warningsCount, 0);
});
test("ReactLynx callback boundary and unsupported hooks are reported with source positions", (t) => {
  const dir = fixture(
    t,
    `import{Button}from'daisu-ui';import{useLayoutEffect}from'@lynx-js/react';\nexport const Page=()=> <Button label="确认" onTap={()=>console.log('tap')}/>;`,
  );
  const result = lintProject(dir);
  assert(result.issues.some((i) => i.rule === "unsupported-hook"));
  assert(
    result.issues.some(
      (i) => i.rule === "background-callback" && i.line === 2 && i.column > 1,
    ),
  );
});
test("scanner ignores generated trees and symlinks", (t) => {
  const dir = fixture(
    t,
    `import{Button}from'daisu-ui';export const Page=()=> <Button label="确认"/>;`,
  );
  mkdirSync(join(dir, "dist"));
  writeFileSync(
    join(dir, "dist/Generated.tsx"),
    `import{Button}from'daisu-ui';export const X=()=> <Button/>;`,
  );
  symlinkSync(join(dir, "dist"), join(dir, "linked"), "dir");
  assert.equal(usageProject(dir).scannedFiles, 1);
});
test("doctor accepts automatic styles and JSONC tsconfig", (t) => {
  const dir = fixture(t, "export{}");
  writeFileSync(
    join(dir, "tsconfig.json"),
    `{// source\n"compilerOptions":{"jsxImportSource":"@lynx-js/react",},}`,
  );
  const result = doctorProject(dir);
  assert.equal(result.errors, 0);
  assert.equal(result.checks.find((c) => c.name === "styles").status, "pass");
  assert.equal(
    result.checks.find((c) => c.name === "typescript-jsx").status,
    "pass",
  );
});

test("similarly named packages and package.json imports are not component errors", (t) => {
  const dir = fixture(
    t,
    `import{Widget}from'daisu-ui-extra';import pkg from 'daisu-ui/package.json';export const Page=()=> <Widget/>;`,
  );
  const result = lintProject(dir);
  assert.equal(result.errors, 0);
  assert.equal(usageProject(dir).components.length, 0);
});
