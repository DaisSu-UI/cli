import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseSource } from "./check-release-source.mjs";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const registry = "https://registry.npmjs.org/";
export function npmReleaseTag(version, requested) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  assert(
    match && !match[4]?.split(".").some((part) => /^0\d+$/.test(part)),
    "版本必须是精确 semver。",
  );
  const tag = requested || (match[4] ? "beta" : "latest");
  assert.match(tag, /^[a-z][a-z0-9._-]*$/, "npm 标签格式无效。");
  return tag;
}
export function loadRelease({ root = repositoryRoot, env = process.env } = {}) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  assert.equal(git(["status", "--porcelain"]), "", "发布前必须提交源码变更。");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(
    readFileSync(join(root, "artifacts/npm-release.json"), "utf8"),
  );
  assert.equal(pkg.name, "@daisu-ui/cli");
  assert.notEqual(pkg.private, true);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, pkg.name);
  assert.equal(
    manifest.version,
    pkg.version,
    "产物版本已过期，请重新验证与打包。",
  );
  assert.equal(
    manifest.sourceCommit,
    git(["rev-parse", "HEAD"]),
    "产物源码已过期，请重新验证与打包。",
  );
  assert.equal(
    manifest.filename,
    `daisu-ui-cli-${pkg.version}.tgz`,
    "产物文件名无效。",
  );
  const archive = join(root, "artifacts", manifest.filename);
  assert.equal(
    manifest.integrity,
    "sha512-" +
      createHash("sha512").update(readFileSync(archive)).digest("base64"),
    "产物完整性校验失败。",
  );
  if (env.CI) {
    assert.equal(
      env.CI_COMMIT_TAG,
      `v${pkg.version}`,
      "CI 仅允许从对应版本 Tag 发布。",
    );
    if (env.CI_COMMIT_REF_PROTECTED !== undefined)
      assert.equal(
        env.CI_COMMIT_REF_PROTECTED,
        "true",
        "CI 版本标签必须受保护。",
      );
    if (env.CI_PROJECT_PATH)
      assert.equal(
        env.CI_PROJECT_PATH,
        "daisu-ui/cli",
        "CI 仅发布指定 CLI 项目。",
      );
  }
  return { pkg, manifest, archive };
}
async function existingVersion(release, fetcher) {
  const response = await fetcher(
    `${registry}${encodeURIComponent(release.name)}/${encodeURIComponent(release.version)}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) return;
  if (!response.ok)
    throw new Error(
      `无法确认 npm 版本状态（HTTP ${response.status}），停止发布。`,
    );
  const remote = await response.json();
  assert.equal(
    remote.dist?.integrity,
    release.integrity,
    "该 npm 版本已存在且产物不同；请使用新的版本号，不能覆盖。",
  );
  return remote;
}
export async function publishNpmRelease({
  root = repositoryRoot,
  env = process.env,
  args = process.argv.slice(2),
  fetcher = globalThis.fetch,
  execute = execFileSync,
} = {}) {
  let dryRun = false,
    requested;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--tag") {
      requested = args[++i];
      assert(requested, "--tag 缺少值。");
    } else throw new Error("仅支持 --dry-run 和 --tag <标签>。");
  }
  const release = loadRelease({ root, env });
  assert(
    !(env.CI && requested),
    "CI 的发布渠道由版本自动确定，不接受手工覆盖。",
  );
  const tag = npmReleaseTag(
    release.pkg.version,
    requested || release.pkg.publishConfig?.tag,
  );
  checkReleaseSource({ root, env });
  if (dryRun) {
    console.log(
      `发布预演通过：${release.pkg.name}@${release.pkg.version} → ${tag}；未联网 npm、未写入认证或发布。`,
    );
    return { status: "dry-run", tag };
  }
  if (await existingVersion(release.manifest, fetcher)) {
    console.log(
      `npm 已存在相同产物，跳过重复发布：${release.pkg.name}@${release.pkg.version}`,
    );
    return { status: "already-published", tag };
  }
  assert(
    !env.CI || env.NPM_TOKEN,
    "请在 CLI 项目 GitLab Secret variables 中配置受保护的 NPM_TOKEN（Read and write，Bypass 2FA）。",
  );
  const temporary = mkdtempSync(join(tmpdir(), "daisu-cli-npm-auth-"));
  const childEnv = { ...env };
  try {
    if (env.NPM_TOKEN) {
      assert(
        /^[A-Za-z0-9_-]+$/.test(env.NPM_TOKEN.trim()),
        "NPM_TOKEN 格式无效。",
      );
      const config = join(temporary, "npmrc");
      writeFileSync(
        config,
        "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n",
        { mode: 0o600 },
      );
      childEnv.npm_config_userconfig = config;
      childEnv.NPM_TOKEN = env.NPM_TOKEN.trim();
      childEnv.npm_config_auth_type = "legacy";
    }
    console.log(
      `发布 ${release.pkg.name}@${release.pkg.version}，渠道 ${tag}。`,
    );
    try {
      execute(
        "npm",
        [
          "publish",
          release.archive,
          "--registry",
          registry,
          "--access",
          "public",
          "--tag",
          tag,
        ],
        { cwd: root, env: childEnv, stdio: "inherit" },
      );
    } catch (error) {
      // A simultaneous retry may have completed the exact same artifact.
      if (await existingVersion(release.manifest, fetcher))
        return { status: "already-published", tag };
      throw error;
    }
    return { status: "published", tag };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await publishNpmRelease();
