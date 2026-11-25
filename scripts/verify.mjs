import { execFileSync } from "node:child_process";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const script of [
  "format:check",
  "typecheck",
  "test",
  "data:check",
  "release:check",
  "check:package",
])
  execFileSync(npm, ["run", script], { stdio: "inherit", shell: false });
