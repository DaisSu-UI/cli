import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReleaseSource } from "../scripts/check-release-source.mjs";
import {
  loadRelease,
  npmReleaseTag,
  publishNpmRelease,
} from "../scripts/publish-npm-release.mjs";
const env = { ...process.env, CI: "", DAISU_UI_AUTO_SYNC: "0" };
for (const key of [
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "npm_config_otp",
  "NPM_CONFIG_OTP",
])
  delete env[key];
function fixture(t, version = "1.0.0-beta.1") {
  const parent = mkdtempSync(join(tmpdir(), "daisu-ci-publish-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "repo"),
    remote = join(parent, "remote.git");
  mkdirSync(root);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, ".gitignore"), "artifacts/\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@daisu-ui/cli", version }),
  );
  git("add", ".");
  git("commit", "-m", "initial");
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  mkdirSync(join(root, "artifacts"));
  const archive = join(root, "artifacts", `daisu-ui-cli-${version}.tgz`);
  writeFileSync(archive, "tested artifact");
  const manifest = {
    schemaVersion: 1,
    name: "@daisu-ui/cli",
    version,
    sourceCommit: git("rev-parse", "HEAD"),
    filename: `daisu-ui-cli-${version}.tgz`,
    integrity:
      "sha512-" +
      createHash("sha512").update(readFileSync(archive)).digest("base64"),
  };
  writeFileSync(
    join(root, "artifacts/npm-release.json"),
    JSON.stringify(manifest),
  );
  return { root, remote, git, archive, manifest };
}
const absent = async () => new Response("", { status: 404 });
test("release channels follow semver; explicit manual channel stays available for README promotion", () => {
  assert.equal(npmReleaseTag("1.0.0"), "latest");
  assert.equal(npmReleaseTag("1.0.0-beta.1"), "beta");
  assert.equal(npmReleaseTag("1.0.0-rc.1"), "beta");
  assert.equal(npmReleaseTag("1.0.0-beta.1", "latest"), "latest");
  for (const version of ["1", "1.0", "v1.0.0", "01.0.0", "1.0.0-beta.01"])
    assert.throws(() => npmReleaseTag(version));
  assert.throws(() => npmReleaseTag("1.0.0", "bad tag"));
});
test("release validates exact source and bytes, refuses dirty or stale source and traversal", (t) => {
  const f = fixture(t);
  assert.equal(
    loadRelease({ root: f.root, env }).manifest.version,
    f.manifest.version,
  );
  writeFileSync(f.archive, "tampered");
  assert.throws(() => loadRelease({ root: f.root, env }), /完整性/);
  writeFileSync(f.archive, "tested artifact");
  writeFileSync(join(f.root, "new.txt"), "uncommitted");
  assert.throws(() => loadRelease({ root: f.root, env }), /提交源码/);
  rmSync(join(f.root, "new.txt"));
  const path = join(f.root, "artifacts/npm-release.json");
  writeFileSync(
    path,
    JSON.stringify({ ...f.manifest, filename: "../untrusted.tgz" }),
  );
  assert.throws(() => loadRelease({ root: f.root, env }), /文件名/);
  writeFileSync(
    path,
    JSON.stringify({ ...f.manifest, sourceCommit: "0".repeat(40) }),
  );
  assert.throws(() => loadRelease({ root: f.root, env }), /源码已过期/);
  writeFileSync(path, JSON.stringify({ ...f.manifest, version: "99.0.0" }));
  assert.throws(() => loadRelease({ root: f.root, env }), /版本已过期/);
});
test("main ancestry check refreshes the remote and blocks development-only tags", (t) => {
  const f = fixture(t);
  assert(checkReleaseSource({ root: f.root, env }).mainCommit);
  f.git("switch", "-c", "developer");
  writeFileSync(join(f.root, "feature.txt"), "not merged");
  f.git("add", ".");
  f.git("commit", "-m", "development only");
  f.git("push", "origin", "developer");
  assert.throws(
    () => checkReleaseSource({ root: f.root, env }),
    /合入 origin\/main/,
  );
  // A stale local tracking branch must not substitute for the real remote main.
  f.git("update-ref", "refs/remotes/origin/main", f.git("rev-parse", "HEAD"));
  assert.throws(
    () => checkReleaseSource({ root: f.root, env }),
    /合入 origin\/main/,
  );
});
test("CI needs the exact protected tag and cannot override its channel", async (t) => {
  const f = fixture(t);
  const neverPublish = () =>
    assert.fail("This test must never execute npm publish.");
  const ci = {
    ...env,
    CI: "true",
    CI_COMMIT_TAG: `v${f.manifest.version}`,
    CI_PROJECT_PATH: "daisu-ui/cli",
    CI_COMMIT_REF_PROTECTED: "true",
  };
  assert.throws(
    () => loadRelease({ root: f.root, env: { ...ci, CI_COMMIT_TAG: "" } }),
    /对应版本 Tag/,
  );
  assert.throws(
    () =>
      loadRelease({
        root: f.root,
        env: { ...ci, CI_COMMIT_REF_PROTECTED: "false" },
      }),
    /受保护/,
  );
  await assert.rejects(
    publishNpmRelease({
      root: f.root,
      env: ci,
      args: ["--tag", "latest"],
      fetcher: absent,
      execute: neverPublish,
    }),
    /不接受/,
  );
  await assert.rejects(
    publishNpmRelease({
      root: f.root,
      env: ci,
      args: [],
      fetcher: absent,
      execute: neverPublish,
    }),
    /NPM_TOKEN/,
  );
});
test("dry-run publishes nothing, identical retries skip and different published bytes fail", async (t) => {
  const f = fixture(t);
  let contacted = false;
  assert.equal(
    (
      await publishNpmRelease({
        root: f.root,
        env,
        args: ["--dry-run"],
        fetcher: () => {
          contacted = true;
          throw Error();
        },
      })
    ).status,
    "dry-run",
  );
  assert(!contacted);
  assert.equal(
    (
      await publishNpmRelease({
        root: f.root,
        env,
        args: [],
        fetcher: async () =>
          new Response(
            JSON.stringify({ dist: { integrity: f.manifest.integrity } }),
          ),
      })
    ).status,
    "already-published",
  );
  await assert.rejects(
    publishNpmRelease({
      root: f.root,
      env,
      args: [],
      fetcher: async () =>
        new Response(JSON.stringify({ dist: { integrity: "different" } })),
    }),
    /已存在且产物不同/,
  );
  await assert.rejects(
    publishNpmRelease({
      root: f.root,
      env,
      args: [],
      fetcher: async () => new Response("", { status: 503 }),
    }),
    /HTTP 503/,
  );
});
test("CI publishes the verified tarball with temporary token config and cleans up on failure", async (t) => {
  const f = fixture(t);
  let config,
    published = false;
  const ci = {
    ...env,
    CI: "true",
    CI_COMMIT_TAG: `v${f.manifest.version}`,
    CI_PROJECT_PATH: "daisu-ui/cli",
    CI_COMMIT_REF_PROTECTED: "true",
    NPM_TOKEN: "npm_TEST_ONLY_NOT_A_SECRET",
  };
  const result = await publishNpmRelease({
    root: f.root,
    env: ci,
    args: [],
    fetcher: absent,
    execute: (command, args, options) => {
      published = true;
      assert.equal(command, "npm");
      assert(args.includes(f.archive));
      assert.equal(args.at(-1), "beta");
      config = options.env.npm_config_userconfig;
      const text = readFileSync(config, "utf8");
      assert(text.includes("${NPM_TOKEN}"));
      assert(!text.includes(ci.NPM_TOKEN));
      assert.equal(statSync(config).mode & 0o777, 0o600);
    },
  });
  assert(published);
  assert.equal(result.status, "published");
  assert(!existsSync(config));
  await assert.rejects(
    publishNpmRelease({
      root: f.root,
      env: ci,
      args: [],
      fetcher: absent,
      execute: (_command, _args, options) => {
        config = options.env.npm_config_userconfig;
        throw Error("failed");
      },
    }),
    /failed/,
  );
  assert(!existsSync(config));
});
test("a concurrent successful upload is verified before treating a failed publish as a retry", async (t) => {
  const f = fixture(t);
  let requests = 0;
  const result = await publishNpmRelease({
    root: f.root,
    env,
    args: [],
    fetcher: async () =>
      ++requests === 1
        ? new Response("", { status: 404 })
        : new Response(
            JSON.stringify({ dist: { integrity: f.manifest.integrity } }),
          ),
    execute: () => {
      throw Error("another job finished first");
    },
  });
  assert.equal(result.status, "already-published");
  assert.equal(requests, 2);
});
