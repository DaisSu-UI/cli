import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { valid, rcompare } from "semver";
import type { Knowledge } from "./types.js";
export const dataHash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export interface VersionIndex {
  latest: string;
  versions: string[];
  digests?: Record<string, string>;
}
export function validateVersionIndex(
  value: any,
): asserts value is VersionIndex {
  if (
    !value ||
    typeof value.latest !== "string" ||
    valid(value.latest) !== value.latest ||
    !Array.isArray(value.versions) ||
    !value.versions.length ||
    !value.versions.every(
      (v: unknown) => typeof v === "string" && valid(v) === v,
    ) ||
    new Set(value.versions).size !== value.versions.length ||
    !value.versions.includes(value.latest) ||
    [...value.versions].sort(rcompare)[0] !== value.latest
  )
    throw new Error(
      "离线版本索引无效：需要唯一的精确 semver 版本及有效 latest。",
    );
  if (
    value.digests !== undefined &&
    (!value.digests ||
      typeof value.digests !== "object" ||
      value.versions.some(
        (v: string) => !/^[a-f\d]{64}$/.test(value.digests[v]),
      ))
  )
    throw new Error("离线版本索引的数据校验摘要无效。");
}
export function validateKnowledge(
  value: any,
  version: string,
): asserts value is Knowledge {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.library !== "daisu-ui" ||
    value.version !== version ||
    !valid(value.version) ||
    !Array.isArray(value.components) ||
    !value.components.length ||
    !Array.isArray(value.cssVars) ||
    !Array.isArray(value.changelog) ||
    !value.publicExports ||
    typeof value.publicExports !== "object"
  )
    throw new Error(`离线数据结构无效：${version}`);
  if (
    !value.source ||
    !/^[a-f\d]{64}$/.test(value.source.digest) ||
    Number.isNaN(Date.parse(value.generatedAt))
  )
    throw new Error(`数据来源或提取时间无效：${version}`);
  if (value.guides !== undefined) {
    if (
      !value.guides ||
      typeof value.guides !== "object" ||
      Array.isArray(value.guides)
    )
      throw new Error(`使用指南结构无效：${version}`);
    for (const [id, guide] of Object.entries(value.guides) as [string, any][])
      if (
        !/^[a-z][a-z-]*$/.test(id) ||
        !guide ||
        typeof guide.title !== "string" ||
        typeof guide.path !== "string" ||
        typeof guide.content !== "string" ||
        !guide.content.trim()
      )
        throw new Error(`使用指南内容无效：${version}`);
  }
  const names = new Set<string>();
  for (const component of value.components) {
    if (
      !component ||
      typeof component.name !== "string" ||
      names.has(component.name) ||
      typeof component.importFrom !== "string" ||
      !Array.isArray(value.publicExports[component.importFrom]) ||
      !value.publicExports[component.importFrom].includes(component.name) ||
      !["component", "hook", "utility"].includes(component.kind) ||
      !Array.isArray(component.props) ||
      !Array.isArray(component.events) ||
      !Array.isArray(component.slots) ||
      !Array.isArray(component.demos) ||
      typeof component.doc !== "string"
    )
      throw new Error(`组件元数据无效或重复：${version}`);
    for (const key of [
      "id",
      "label",
      "category",
      "categoryId",
      "description",
      "source",
    ])
      if (typeof component[key] !== "string")
        throw new Error(`组件字段缺失：${component.name}`);
    if (
      component.deprecated !== undefined &&
      typeof component.deprecated !== "boolean"
    )
      throw new Error(`弃用标记无效：${component.name}`);
    names.add(component.name);
    for (const field of [
      ...component.props,
      ...component.events,
      ...component.slots,
    ])
      if (
        !field ||
        typeof field.name !== "string" ||
        typeof field.type !== "string" ||
        typeof field.optional !== "boolean" ||
        (field.since !== undefined && typeof field.since !== "string") ||
        (field.deprecated !== undefined &&
          typeof field.deprecated !== "boolean")
      )
        throw new Error(`属性元数据无效：${component.name}`);
    const demos = new Set();
    for (const demo of component.demos) {
      if (
        typeof demo.name !== "string" ||
        typeof demo.code !== "string" ||
        !demo.code.trim() ||
        demos.has(demo.name)
      )
        throw new Error(`示例元数据无效：${component.name}`);
      demos.add(demo.name);
    }
  }
  if (!names.has("Button"))
    throw new Error(`离线数据缺少 Button 公共组件：${version}`);
}
export function readSnapshot(
  directory: string,
  index: VersionIndex,
  version: string,
): Knowledge {
  if (!index.versions.includes(version) || !valid(version))
    throw new Error("版本不在离线索引内。");
  const text = readFileSync(join(directory, `${version}.json`), "utf8");
  if (index.digests?.[version] && dataHash(text) !== index.digests[version])
    throw new Error(`离线数据校验失败：${version}，请重新同步数据或安装 CLI。`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`离线数据不是有效 JSON：${version}`);
  }
  validateKnowledge(value, version);
  return value;
}
export function checkDataDirectory(directory: string) {
  if (
    readdirSync(directory).some(
      (name) => name === ".sync.lock" || name.endsWith(".tmp"),
    )
  )
    throw new Error("检测到未结束的数据同步或临时文件，请确认同步完成。");
  const index = JSON.parse(
    readFileSync(join(directory, "versions.json"), "utf8"),
  );
  validateVersionIndex(index);
  const files = readdirSync(directory).filter((n) => /^\d.*\.json$/.test(n));
  if (files.some((name) => !index.versions.includes(name.slice(0, -5))))
    throw new Error("存在未登记到版本索引的数据文件，请运行数据同步。");
  if (!index.digests)
    throw new Error(
      "离线数据缺少校验摘要，请先运行 npm run sync -- --ui-dir <仓库>。",
    );
  const versions = [...index.versions].sort(rcompare).map((version) => {
    const data = readSnapshot(directory, index, version);
    return {
      version,
      components: data.components.filter((c) => c.kind === "component").length,
      hooks: data.components.filter((c) => c.kind === "hook").length,
      demos: data.components.reduce((n, c) => n + c.demos.length, 0),
      deprecated: data.components.filter((c) => c.deprecated).length,
      source: data.source,
      generatedAt: data.generatedAt,
    };
  });
  return { ok: true, latest: index.latest, versions };
}
