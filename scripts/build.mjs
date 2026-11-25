import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { synchronize } from "./auto-sync.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/compile.mjs"], {
  cwd: root,
  stdio: "inherit",
});
await synchronize({ cliDir: root, compile: false });
