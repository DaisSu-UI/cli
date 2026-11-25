import {
  lstat,
  readFile,
  mkdir,
  open,
  rename,
  unlink,
  realpath,
} from "node:fs/promises";
import { resolve, relative, dirname, join, isAbsolute, sep } from "node:path";
import { randomBytes, createHash } from "node:crypto";
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export interface FileChange {
  path: string;
  before: string | undefined;
  after: string | undefined;
  reason: string;
}
export function within(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
export async function safePath(path: string, roots: string[]) {
  const full = resolve(path),
    root = roots
      .filter((r) => within(r, full))
      .sort((a, b) => b.length - a.length)[0];
  if (!root) throw new Error("配置写入路径不在选定的项目或用户目录内。");
  let cursor = root;
  for (const part of relative(root, full).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new Error(`配置路径包含符号链接，未修改：${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
async function atomic(path: string, text: string, mode?: number) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(
    dirname(path),
    `.daisu-${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temp, "wx", mode || 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
  } catch (error) {
    await handle?.close();
    await unlink(temp).catch(() => {});
    throw error;
  }
}
export async function applyChanges(changes: FileChange[], roots: string[]) {
  for (const change of changes) {
    await safePath(change.path, roots);
    if ((await readText(change.path)) !== change.before)
      throw new Error(`文件在计划后发生变化，未执行：${change.path}`);
  }
  const applied: FileChange[] = [];
  try {
    for (const change of changes) {
      await safePath(change.path, roots);
      if ((await readText(change.path)) !== change.before)
        throw new Error(`检测到并发修改：${change.path}`);
      let mode;
      try {
        mode = (await lstat(change.path)).mode & 0o777;
      } catch {}
      if (change.after === undefined) await unlink(change.path);
      else await atomic(change.path, change.after, mode);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if ((await readText(change.path)) !== change.after) continue;
      if (change.before === undefined)
        await unlink(change.path).catch(() => {});
      else await atomic(change.path, change.before).catch(() => {});
    }
    throw error;
  }
}
export async function lockProject(cwd: string, run: () => Promise<unknown>) {
  const parent = join(cwd, ".daisu");
  await safePath(join(parent, "cli.lock"), [cwd]);
  await mkdir(parent, { recursive: true });
  const path = join(parent, "cli.lock");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "另一个 Daisu 配置操作正在进行；若进程已退出，请检查 .daisu/cli.lock。",
      );
    throw error;
  }
  try {
    return await run();
  } finally {
    await handle.close();
    await unlink(path).catch(() => {});
  }
}
