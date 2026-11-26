import { readFile, open, unlink, realpath, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const here = fileURLToPath(new URL("../", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export const isCi = (env = process.env) =>
  Boolean(env.CI && !/^(0|false)$/i.test(env.CI));
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function resolveUi(cliDir = here, uiDir, env = process.env) {
  const explicit = uiDir || env.DAISU_UI_SOURCE;
  const path = resolve(explicit || join(cliDir, "../daisu-ui"));
  if (!(await exists(path))) {
    if (explicit) throw new Error(`指定的 UI 仓库不存在：${path}`);
    return;
  }
  let pkg;
  try {
    pkg = JSON.parse(
      await readFile(join(path, "packages/daisu-ui/package.json"), "utf8"),
    );
  } catch (error) {
    if (!explicit && error.code === "ENOENT") return;
    throw error;
  }
  if (!["@daisu-ui/ui", "daisu-ui"].includes(pkg.name)) {
    if (explicit) throw new Error("指定目录不是 Daisu UI 仓库。");
    return;
  }
  if (!(await exists(join(path, "node_modules/typescript")))) {
    if (explicit)
      throw new Error("UI 开发依赖尚未安装，请在 UI 仓库运行 npm ci。");
    return;
  }
  return realpath(path);
}
export function runNode(root, args, { signal } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      signal,
      detached: process.platform !== "win32",
    });
    const stopGroup = () => {
      if (process.platform !== "win32" && child.pid)
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
    };
    signal?.addEventListener("abort", stopGroup, { once: true });
    child.once("exit", () => signal?.removeEventListener("abort", stopGroup));
    child.once("error", fail);
    child.once("exit", (code, killed) =>
      code === 0
        ? done()
        : fail(new Error(`${args.join(" ")} 失败（${killed || code}）。`)),
    );
  });
}
async function acquireLock(cliDir, uiDir, signal) {
  const id = createHash("sha256")
    .update(cliDir + "\0" + uiDir)
    .digest("hex")
    .slice(0, 24);
  const path = join(tmpdir(), `daisu-auto-sync-${id}.lock`);
  const started = Date.now();
  for (;;) {
    signal?.throwIfAborted();
    let file;
    try {
      file = await open(path, "wx", 0o600);
      await file.writeFile(String(process.pid));
      return async () => {
        await file.close();
        await unlink(path);
      };
    } catch (error) {
      if (file) {
        await file.close();
        await unlink(path);
        throw error;
      }
      if (error.code !== "EEXIST") throw error;
      // Recover a lock whose owning process has exited. A newly created empty
      // lock belongs to a live writer until its PID has been written.
      let owner;
      try {
        owner = Number(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
        } catch (error) {
          if (error.code === "ESRCH") {
            await unlink(path).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
            continue;
          }
        }
      }
      if (Date.now() - started > 120000)
        throw new Error("自动同步仍被其他进程占用，请检查正在运行的构建。");
      await delay(100);
    }
  }
}
/** Local build integration only. Installed CLI queries never invoke this. */
export async function synchronize({
  cliDir = here,
  uiDir,
  compile = true,
  check,
  env = process.env,
  buildDocs = false,
  buildDemo = false,
  uiGenerated = false,
  signal,
} = {}) {
  if (env.DAISU_UI_AUTO_SYNC === "0") return { skipped: "disabled" };
  cliDir = await realpath(cliDir);
  const root = await resolveUi(cliDir, uiDir, env);
  if (!root) return { skipped: "standalone" };
  check ??= isCi(env);
  const release = check
    ? async () => {}
    : await acquireLock(cliDir, root, signal);
  const run = (cwd, args) => runNode(cwd, args, { signal });
  try {
    if (compile && !check) await run(cliDir, ["scripts/compile.mjs"]);
    if (!(await exists(join(cliDir, "dist/index.js"))))
      throw new Error("CLI 构建产物不存在；请先构建 CLI 后再进行只读检查。");
    if (
      !uiGenerated &&
      !check &&
      (await exists(join(root, "packages/daisu-ui/scripts/build.mjs")))
    )
      await run(root, ["packages/daisu-ui/scripts/build.mjs"]);
    if (!uiGenerated)
      await run(root, [
        "apps/docs/generate.mjs",
        ...(check ? ["--check"] : []),
      ]);
    await run(cliDir, [
      "dist/index.js",
      "docs",
      "export",
      "--ui-dir",
      root,
      ...(check ? ["--check"] : []),
    ]);
    await run(cliDir, [
      "scripts/extract.mjs",
      "--ui-dir",
      root,
      ...(check ? ["--check"] : []),
    ]);
    await run(cliDir, ["scripts/validate-data.mjs"]);
    if (buildDocs && !check) {
      if (buildDemo) await run(root, ["scripts/build-docs-demo.mjs"]);
      await run(root, ["apps/docs/check-ai-docs.mjs"]);
      await run(root, ["apps/docs/build.mjs"]);
    }
    console.log(
      `[daisu] ${check ? "自动同步检查通过（只读）" : "组件知识与接入文档已自动同步"}。`,
    );
    return { uiDir: root, check };
  } finally {
    await release();
  }
}

/** Ignore generated outputs so a successful synchronization cannot trigger itself. */
export function relevantChange(kind, name) {
  const path = name.split(sep).join("/");
  if (
    path
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") ||
          [
            "node_modules",
            "dist",
            "dist-web",
            "h5-dist",
            "artifacts",
            "build",
          ].includes(part),
      )
  )
    return false;
  if (kind === "cli")
    return (
      /^(src\/|scripts\/|skills\/)/.test(path) ||
      /^(package(?:-lock)?\.json|README\.md|AGENTS\.md|CHANGELOG\.md)$/.test(
        path,
      )
    );
  if (/^docs\/ui\/components\//.test(path))
    return path === "docs/ui/components/button.md";
  if (
    path === "docs/ui/component-sources.json" ||
    path === "docs/ui/llms.txt" ||
    path === "apps/docs/pages/compatibility.md" ||
    /^apps\/docs\/ai\/(overview|cli|mcp|skills)\.md$/.test(path) ||
    path === "apps/docs/ai/cli-manifest.json"
  )
    return false;
  return (
    /^(packages\/daisu-ui\/src\/|apps\/demo\/(src|web)\/|apps\/docs\/|examples\/(quickstart|flutter-host)\/|docs\/(ui|ci)\/)/.test(
      path,
    ) ||
    /^packages\/daisu-ui\/(package\.json|CHANGELOG\.md|tsconfig\.json)$/.test(
      path,
    )
  );
}
export function createScheduler(
  action,
  { debounce = 300, onError = console.error } = {},
) {
  let running = false,
    closed = false,
    timer;
  const pending = new Set();
  async function drain() {
    if (running || closed || !pending.size) return;
    running = true;
    const changes = new Set(pending);
    pending.clear();
    try {
      await action(changes);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (!closed && pending.size) timer = setTimeout(drain, debounce);
    }
  }
  return {
    schedule(kind) {
      if (closed) return;
      pending.add(kind);
      clearTimeout(timer);
      timer = setTimeout(drain, debounce);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      pending.clear();
    },
  };
}
export async function watchSynchronization(options = {}) {
  const cliDir = await realpath(options.cliDir || here);
  const env = options.env || process.env;
  if (env.DAISU_UI_AUTO_SYNC === "0") return { close() {} };
  const uiDir = await resolveUi(cliDir, options.uiDir, env);
  if (!uiDir) return { close() {} };
  if (isCi(env))
    throw new Error("CI 不运行持续监听；构建会自动执行只读同步检查。");
  const controller = new AbortController(),
    watchers = [];
  const scheduler = createScheduler(
    (changes) =>
      synchronize({
        cliDir,
        uiDir,
        env,
        signal: controller.signal,
        buildDocs: options.buildDocs,
        buildDemo: changes.has("ui-demo"),
      }),
    {
      onError: (error) => {
        if (!controller.signal.aborted)
          console.error(
            `[daisu] 自动同步失败，等待下次修改重试：${error.message}`,
          );
      },
    },
  );
  for (const [kind, root, paths] of [
    ["cli", cliDir, ["", "src", "scripts", "skills"]],
    [
      "ui",
      uiDir,
      [
        "packages/daisu-ui",
        "packages/daisu-ui/src",
        "apps/demo",
        "apps/demo/src",
        "apps/demo/web",
        "apps/docs",
        "apps/docs/guides",
        "apps/docs/public",
        "apps/docs/pages",
        "apps/docs/ai",
        "examples",
        "examples/quickstart",
        "examples/quickstart/src",
        "examples/quickstart/web",
        "examples/flutter-host",
        "examples/flutter-host/lib",
        "examples/flutter-host/test",
        "docs/ui",
        "docs/ui/components",
        "docs/ci",
      ],
    ],
  ])
    for (const path of paths) {
      const directory = join(root, path);
      if (!(await exists(directory))) continue;
      const recursive = [
        "src",
        "scripts",
        "skills",
        "packages/daisu-ui/src",
        "apps/demo/src",
        "apps/demo/web",
        "apps/docs/guides",
        "apps/docs/public",
        "apps/docs/pages",
        "examples/quickstart/src",
        "examples/quickstart/web",
        "examples/flutter-host/lib",
        "examples/flutter-host/test",
      ].includes(path);
      const watcher = watch(directory, { recursive }, (_event, name) => {
        const file = relative(root, join(directory, name?.toString() || ""));
        if (!relevantChange(kind, file)) return;
        const needsDemo =
          kind === "ui" &&
          /^(packages\/daisu-ui\/|apps\/demo\/)/.test(
            file.split(sep).join("/"),
          );
        scheduler.schedule(needsDemo ? "ui-demo" : kind);
      });
      watcher.on("error", (error) =>
        console.error(`[daisu] 文件监听异常：${error.message}`),
      );
      watchers.push(watcher);
    }
  const close = () => {
    scheduler.close();
    watchers.forEach((watcher) => watcher.close());
    controller.abort();
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeListener(signal, close);
  };
  // Register before the initial build so Ctrl+C also stops its process tree.
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, close);
  try {
    if (!options.skipInitial)
      await synchronize({
        cliDir,
        uiDir,
        env,
        signal: controller.signal,
        buildDocs: options.buildDocs,
      });
  } catch (error) {
    close();
    throw error;
  }
  console.log(
    "[daisu] 正在监听 UI / CLI 源文件，修改后自动同步。Ctrl+C 退出。",
  );
  return { close };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      "ui-dir": { type: "string" },
      check: { type: "boolean" },
      watch: { type: "boolean" },
      "build-docs": { type: "boolean" },
      "skip-initial": { type: "boolean" },
      "ui-generated": { type: "boolean" },
    },
  });
  if (values.watch && values.check)
    throw new Error("--watch 与 --check 不能同时使用。");
  if (values.watch) {
    await watchSynchronization({
      uiDir: values["ui-dir"],
      buildDocs: values["build-docs"],
      skipInitial: values["skip-initial"],
    });
  } else
    await synchronize({
      uiDir: values["ui-dir"],
      check: values.check,
      uiGenerated: values["ui-generated"],
    });
}
