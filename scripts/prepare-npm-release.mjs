import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { valid } from "semver";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export function prepareNpmRelease({ root = repositoryRoot } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@daisu-ui/cli");
  assert.notEqual(pkg.private, true);
  assert.equal(valid(pkg.version), pkg.version);
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  assert.equal(
    git(["status", "--porcelain"]),
    "",
    "请先提交源码，再生成发布产物。",
  );
  const output = join(root, "artifacts");
  mkdirSync(output, { recursive: true });
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", output],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  )[0];
  const files = packed.files.map((file) => file.path);
  const allowed = new Set([
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "CHANGELOG.md",
  ]);
  assert(
    files.every(
      (name) => /^(dist|assets|data|skills)\//.test(name) || allowed.has(name),
    ),
    "发布包混入源码、测试或其他工程文件。",
  );
  assert(
    files.includes("dist/index.js") &&
      files.includes("assets/daisu-ui-icon.svg") &&
      files.includes("data/versions.json"),
  );
  assert.equal(packed.filename, `daisu-ui-cli-${pkg.version}.tgz`);
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(readFileSync(join(output, packed.filename)))
      .digest("base64");
  assert.equal(integrity, packed.integrity);
  const manifest = {
    schemaVersion: 1,
    name: pkg.name,
    version: pkg.version,
    sourceCommit: git(["rev-parse", "HEAD"]),
    filename: packed.filename,
    integrity,
    files,
  };
  writeFileSync(
    join(output, "npm-release.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `发布包已准备：${manifest.filename}；源码 ${manifest.sourceCommit}。`,
  );
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepareNpmRelease();
