import { readFileSync } from "node:fs";
import { valid } from "semver";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (!valid(pkg.version)) throw new Error("CLI 版本不是精确 semver。");
const tag = process.env.CI_COMMIT_TAG;
if (tag && tag !== `v${pkg.version}`)
  throw new Error("版本 Tag 与 package.json 的 CLI 版本不一致。");
if (tag) {
  const { checkReleaseSource } = await import("./check-release-source.mjs");
  checkReleaseSource();
}
console.log(
  `PASS: CLI ${pkg.version}${tag ? " 与版本 Tag 一致" : ""}。只检查发布条件，不执行发布。`,
);
