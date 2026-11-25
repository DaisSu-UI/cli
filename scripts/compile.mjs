import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!existsSync(new URL("../data/versions.json", import.meta.url)))
  throw new Error(
    "离线数据不存在。先运行 npm run extract -- --ui-dir <daisu-ui仓库>。",
  );
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
  { cwd: root, stdio: "inherit" },
);
chmodSync(new URL("../dist/index.js", import.meta.url), 0o755);
