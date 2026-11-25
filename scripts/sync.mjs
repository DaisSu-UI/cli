import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const { values } = parseArgs({
  options: {
    "ui-dir": { type: "string" },
    check: { type: "boolean", default: false },
  },
});
if (!values["ui-dir"])
  throw new Error(
    "需要 --ui-dir <Daisu UI 仓库>。同步读取明确指定的当前源码版本，不自动拉取 Git。",
  );
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
  process.execPath,
  [
    "scripts/extract.mjs",
    "--ui-dir",
    values["ui-dir"],
    ...(values.check ? ["--check"] : []),
  ],
  { cwd: root, stdio: "inherit" },
);
if (!values.check) {
  execFileSync(process.execPath, ["scripts/compile.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["scripts/validate-data.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
}
