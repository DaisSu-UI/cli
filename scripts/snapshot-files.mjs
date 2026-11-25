import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  openSync,
  closeSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { valid, rcompare } from "semver";
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function saveSnapshot(output, data) {
  if (valid(data.version) !== data.version)
    throw new Error("组件库版本必须是精确 semver。");
  mkdirSync(output, { recursive: true });
  const lock = resolve(output, ".sync.lock");
  let handle;
  try {
    handle = openSync(lock, "wx", 0o600);
  } catch {
    throw new Error("数据同步锁已存在，请确认没有其他同步进程。");
  }
  const pending = [];
  let snapshotChanged = false,
    indexChanged = false;
  let destination, index, oldSnapshot, oldIndex;
  const atomic = (path, content) => {
    const temp = path + `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    pending.push(temp);
    writeFileSync(temp, content);
    renameSync(temp, path);
  };
  try {
    destination = resolve(output, `${data.version}.json`);
    index = resolve(output, "versions.json");
    oldSnapshot = existsSync(destination)
      ? readFileSync(destination)
      : undefined;
    oldIndex = existsSync(index) ? readFileSync(index) : undefined;
    const prior = oldIndex ? JSON.parse(oldIndex.toString()) : undefined;
    const versions = [
      ...new Set([
        ...readdirSync(output)
          .filter((name) => /^\d.*\.json$/.test(name))
          .map((name) => name.slice(0, -5)),
        data.version,
      ]),
    ];
    if (versions.some((version) => valid(version) !== version))
      throw new Error("数据目录包含无效版本文件名，未更新快照。");
    if (prior?.versions?.some((version) => !versions.includes(version)))
      throw new Error("版本索引引用的数据文件缺失，未更新快照。");
    // Keep timestamps and file mtimes stable when automatic builds find no changes.
    if (oldSnapshot) {
      const previous = JSON.parse(oldSnapshot.toString());
      const { generatedAt: previousTime, ...previousContent } = previous;
      const { generatedAt, ...nextContent } = data;
      if (JSON.stringify(previousContent) === JSON.stringify(nextContent))
        data = { ...data, generatedAt: previousTime };
    }
    const text = JSON.stringify(data) + "\n",
      digests = {};
    for (const version of versions) {
      const content =
        version === data.version
          ? text
          : readFileSync(resolve(output, `${version}.json`), "utf8");
      const value = JSON.parse(content);
      if (
        value.version !== version ||
        value.library !== "daisu-ui" ||
        value.schemaVersion !== 1
      )
        throw new Error("历史快照结构或文件名不一致，未更新快照。");
      const hash = digest(content);
      if (
        version !== data.version &&
        prior?.digests?.[version] &&
        prior.digests[version] !== hash
      )
        throw new Error("历史快照摘要不匹配，未更新快照。");
      digests[version] = hash;
    }
    versions.sort(rcompare);
    const nextIndex =
      JSON.stringify({ latest: versions[0], versions, digests }, null, 2) +
      "\n";
    if (oldSnapshot?.toString() !== text) {
      atomic(destination, text);
      snapshotChanged = true;
    }
    if (oldIndex?.toString() !== nextIndex) {
      atomic(index, nextIndex);
      indexChanged = true;
    }
  } catch (error) {
    if (snapshotChanged) {
      if (oldSnapshot === undefined)
        try {
          unlinkSync(destination);
        } catch {}
      else atomic(destination, oldSnapshot);
    }
    if (indexChanged) {
      if (oldIndex === undefined)
        try {
          unlinkSync(index);
        } catch {}
      else atomic(index, oldIndex);
    }
    throw error;
  } finally {
    for (const path of pending)
      try {
        unlinkSync(path);
      } catch {}
    closeSync(handle);
    unlinkSync(lock);
  }
}
