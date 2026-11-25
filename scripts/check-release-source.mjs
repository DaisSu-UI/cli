import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export function checkReleaseSource({
  root = repositoryRoot,
  env = process.env,
} = {}) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const sourceCommit = git(["rev-parse", "HEAD"]);
  const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
  try {
    git([
      "fetch",
      "--no-tags",
      ...(shallow ? ["--unshallow"] : []),
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
  } catch {
    throw new Error(
      "无法读取远端 origin/main；请确认发布分支存在且 Runner 能读取仓库。",
    );
  }
  const mainCommit = git(["rev-parse", "refs/remotes/origin/main"]);
  try {
    git(["merge-base", "--is-ancestor", sourceCommit, mainCommit]);
  } catch {
    throw new Error(
      "发布源码必须已合入 origin/main；请先完成 developer → main 合并与验证。",
    );
  }
  return { sourceCommit, mainCommit };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert(
    process.argv.slice(2).every((arg) => arg === "--require-main"),
    "仅支持 --require-main 参数。",
  );
  if (process.env.CI_COMMIT_TAG || process.argv.includes("--require-main")) {
    if (process.env.CI_COMMIT_TAG) {
      const pkg = JSON.parse(
        readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
      );
      assert.equal(
        process.env.CI_COMMIT_TAG,
        `v${pkg.version}`,
        "版本 Tag 必须与 CLI 包版本一致。",
      );
    }
    const result = checkReleaseSource();
    console.log(`发布来源通过：${result.sourceCommit} 已包含在 origin/main。`);
  } else
    console.log("分支执行开发验证；只有版本 Tag 可发布已合入 main 的源码。");
}
