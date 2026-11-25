import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(resolve(root, "artifacts"), { recursive: true });
const result = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", "artifacts"],
    { cwd: root, encoding: "utf8" },
  ),
)[0];
const files = result.files.map((f) => f.path);
for (const name of [
  "dist/index.js",
  "assets/daisu-ui-icon.svg",
  "dist/api.d.ts",
  "data/versions.json",
  "skills/daisu-ui/SKILL.md",
  "LICENSE",
  "README.md",
])
  assert(files.includes(name), name);
assert(!files.some((name) => /^(node_modules|tests|src|\.env)/.test(name)));
const consumer = mkdtempSync(join(tmpdir(), "daisu-packed-consumer-"));
try {
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefix",
      consumer,
      resolve(root, "artifacts", result.filename),
    ],
    { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] },
  );
  const bin = join(consumer, "node_modules/@daisu-ui/cli/dist/index.js");
  const info = JSON.parse(
    execFileSync(
      process.execPath,
      [bin, "info", "Button", "--format", "json"],
      { cwd: consumer, encoding: "utf8" },
    ),
  );
  assert.equal(info.name, "Button");
  assert(info.events.some((e) => e.name === "onTap"));
  const docs = execFileSync(process.execPath, [bin, "doc", "Segmented"], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert(docs.includes("renderLabel"));
  const search = JSON.parse(
    execFileSync(
      process.execPath,
      [bin, "search", "onTap", "--limit", "2", "--format", "json"],
      { cwd: consumer, encoding: "utf8" },
    ),
  );
  assert.equal(search.results.length, 2);
  execFileSync(process.execPath, [bin, "docs", "export", "--help"], {
    cwd: consumer,
    stdio: "pipe",
  });
  const { renderSiteDocs } = await import(
    new URL(
      "./node_modules/@daisu-ui/cli/dist/site-docs.js",
      pathToFileURL(consumer + "/"),
    ).href
  );
  assert((await renderSiteDocs())["mcp.md"].includes("daisu_search"));
  const dataCheck = JSON.parse(
    execFileSync(process.execPath, [bin, "data", "check", "--format", "json"], {
      cwd: consumer,
      encoding: "utf8",
    }),
  );
  assert(dataCheck.ok);
  const update = JSON.parse(
    execFileSync(process.execPath, [bin, "update", "--format", "json"], {
      cwd: consumer,
      encoding: "utf8",
    }),
  );
  assert.equal(update.status, "offline");
  const printed = JSON.parse(
    execFileSync(
      process.execPath,
      [bin, "mcp", "print", "--client", "cursor", "--format", "json"],
      { cwd: consumer, encoding: "utf8" },
    ),
  );
  assert.equal(
    JSON.parse(printed.clients[0].config).mcpServers["daisu-ui"].args[0],
    bin,
  );
  const plan = JSON.parse(
    execFileSync(
      process.execPath,
      [
        bin,
        "mcp",
        "init",
        "--client",
        "cursor",
        "--dry-run",
        "--format",
        "json",
      ],
      { cwd: consumer, encoding: "utf8" },
    ),
  );
  assert(plan.changedFiles.length);
  assert(!existsSync(join(consumer, ".cursor/mcp.json")));
  execFileSync(
    process.execPath,
    [bin, "mcp", "init", "--client", "cursor", "--yes"],
    { cwd: consumer, stdio: "pipe" },
  );
  const doctor = JSON.parse(
    execFileSync(
      process.execPath,
      [
        bin,
        "mcp",
        "doctor",
        "--client",
        "cursor",
        "--no-registration",
        "--format",
        "json",
      ],
      { cwd: consumer, encoding: "utf8" },
    ),
  );
  assert.equal(doctor.errors, 0);
  assert(doctor.clients[0].serverReady);
  execFileSync(
    process.execPath,
    [bin, "mcp", "remove", "--client", "cursor", "--yes"],
    { cwd: consumer, stdio: "pipe" },
  );
  console.log(
    `PASS: tarball 文件白名单；离线独立安装；Button API；Segmented 文档；安装后的 MCP 配置路径及真实工具调用；离线更新状态。\n产物：${resolve(root, "artifacts")}`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
