import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { satisfies, valid, rcompare } from "semver";
import type {
  Component,
  Knowledge,
  QueryOptions,
  ResolvedKnowledge,
} from "./types.js";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const cliPackage = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { name: string; version: string };
import {
  validateVersionIndex,
  readSnapshot,
  type VersionIndex,
} from "./data-validation.js";
const cache = new Map<string, Knowledge>();
export function availableVersions(): VersionIndex {
  const index = JSON.parse(
    readFileSync(join(packageRoot, "data/versions.json"), "utf8"),
  );
  validateVersionIndex(index);
  return index;
}
export function findProjectPackage(
  cwd: string,
): { path: string; data: Record<string, any> } | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      try {
        return { path, data: JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        throw new Error(`package.json 不是有效 JSON：${path}`);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
export const libraryPackageNames = ["@daisu-ui/ui", "daisu-ui"] as const;
export function detectLibraryVersion(cwd: string): {
  version?: string;
  source: string;
} {
  const require = createRequire(join(resolve(cwd), "package.json"));
  for (const name of libraryPackageNames) {
    try {
      const path = require.resolve(`${name}/package.json`);
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      if (valid(pkg.version))
        return { version: pkg.version, source: "node_modules" };
    } catch {}
  }
  const pkg = findProjectPackage(cwd)?.data;
  const version = libraryPackageNames
    .map(
      (name) =>
        pkg?.dependencies?.[name] ||
        pkg?.devDependencies?.[name] ||
        pkg?.peerDependencies?.[name],
    )
    .find(Boolean);
  return { version, source: version ? "package.json" : "bundled" };
}
export function loadKnowledge(options: QueryOptions = {}): ResolvedKnowledge {
  const index = availableVersions();
  const cwd = resolve(options.cwd || process.cwd());
  const detected = options.version
    ? { version: options.version, source: "flag" }
    : detectLibraryVersion(cwd);
  const requested = detected.version?.replace(/^v(?=\d)/, "");
  let version: string | undefined;
  const warnings: string[] = [];
  if (!requested || requested === "latest") version = index.latest;
  else if (index.versions.includes(requested)) version = requested;
  else if (!valid(requested))
    version = [...index.versions]
      .sort(rcompare)
      .find((value) =>
        satisfies(value, requested, { includePrerelease: true }),
      );
  if (!version) {
    if (
      detected.source === "package.json" &&
      /^(file:|link:|workspace:|https?:|git)/.test(requested || "")
    ) {
      version = index.latest;
      warnings.push(
        "依赖声明不能确定实际版本，使用随 CLI 打包的数据；安装 @daisu-ui/ui 后可自动识别。",
      );
    } else
      throw new Error(
        `没有匹配 ${detected.version} 的离线数据。可用版本：${index.versions.join(", ")}。请更新数据，或显式传入 --version <可用版本>。`,
      );
  }
  let data = cache.get(version);
  if (!data) {
    if (
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(version)
    )
      throw new Error("无效的数据版本。");
    const value = readSnapshot(join(packageRoot, "data"), index, version);
    cache.set(version, value);
    data = value;
  }
  return { data, version, versionSource: detected.source, warnings };
}
const normalized = (value: string) =>
  value
    .replace(/^(?:@daisu-ui\/ui|daisu-ui)\//i, "")
    .replace(/[\s_-]/g, "")
    .toLowerCase();
export function findComponent(query: string, data: Knowledge): Component {
  const key = normalized(query);
  const exact = data.components.find(
    (component) => normalized(component.name) === key,
  );
  if (exact) return exact;
  const matches = data.components.filter((component) =>
    [
      component.id,
      component.label,
      component.label.replace(/^[a-z\s]+/i, ""),
    ].some((value) => normalized(value) === key),
  );
  if (matches.length)
    return matches.find((c) => c.kind === "component") || matches[0];
  const suggestions = data.components
    .filter(
      (c) =>
        normalized(c.name).includes(key) || key.includes(normalized(c.name)),
    )
    .slice(0, 5)
    .map((c) => c.name);
  throw new Error(
    `找不到组件或 API：${query}${suggestions.length ? `。可能是：${suggestions.join("、")}` : ""}。请先运行 daisu list。`,
  );
}
export function componentSummary(component: Component) {
  const {
    name,
    id,
    label,
    category,
    categoryId,
    kind,
    description,
    importFrom,
  } = component;
  return {
    name,
    id,
    label,
    category,
    categoryId,
    kind,
    description,
    importFrom,
  };
}
export function listComponents(data: Knowledge, keyword = "") {
  const terms = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return data.components
    .filter((c) =>
      terms.every((term) =>
        `${c.name} ${c.id} ${c.label} ${c.category} ${c.kind} ${c.description}`
          .toLowerCase()
          .includes(term),
      ),
    )
    .map(componentSummary);
}
/** Search each source document once, including aliases sharing a component page. */
export function searchDocuments(data: Knowledge, query: string, limit = 8) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error("搜索词不能为空。");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("搜索条数必须是 1–20 的整数。");
  const pages = new Map<
    string,
    { id: string; title: string; names: string[]; content: string }
  >();
  for (const component of data.components) {
    if (!component.doc) continue;
    const key = component.docPath || component.doc;
    const existing = pages.get(key);
    if (existing) existing.names.push(component.name);
    else
      pages.set(key, {
        id: component.id,
        title: component.label,
        names: [component.name],
        content: component.doc,
      });
  }
  for (const [id, guide] of Object.entries(data.guides || {}))
    pages.set(`guide:${id}`, {
      id,
      title: guide.title,
      names: [],
      content: guide.content,
    });
  return [...pages.values()]
    .flatMap((page) => {
      const title = `${page.title} ${page.names.join(" ")}`;
      const source = `${title}\n${page.content}`,
        lower = source.toLowerCase();
      if (!terms.every((term) => lower.includes(term))) return [];
      const index = lower.indexOf(terms[0]);
      return [
        {
          id: page.id,
          title: page.title,
          components: page.names,
          excerpt: source.slice(Math.max(0, index - 80), index + 320),
          score: terms.filter((term) => title.toLowerCase().includes(term))
            .length,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ score, ...result }) => result);
}
export function queryKnowledge(
  command: string,
  args: string[] = [],
  options: QueryOptions = {},
): any {
  const selected = loadKnowledge(options);
  const { data, ...context } = selected;
  if (command === "search")
    return {
      ...context,
      results: searchDocuments(data, args[0] || "", options.limit),
    };
  if (command === "list")
    return { ...context, components: listComponents(data, args[0]) };
  if (command === "changelog") {
    let [version, component] = args;
    if (version && !/^v?\d/.test(version)) {
      component = version;
      version = undefined!;
    }
    const name = component ? findComponent(component, data).name : undefined;
    const entries = data.changelog.filter(
      (entry) =>
        (!version || entry.version === version.replace(/^v/, "")) &&
        (!name || entry.components.includes(name)),
    );
    return { ...context, entries };
  }
  if (command === "token" && !args[0])
    return { ...context, cssVars: data.cssVars };
  const component = findComponent(args[0] || "", data);
  if (command === "info") {
    const { doc, demos, demoSource, ...info } = component;
    return {
      ...context,
      ...info,
      demos: demos.map(({ code, blocks, ...d }) => d),
    };
  }
  if (command === "doc")
    return {
      ...context,
      name: component.name,
      doc:
        component.doc ||
        `# ${component.name}\n\n${component.description}\n\n公开入口：\`${component.importFrom}\`。\n`,
    };
  if (command === "token")
    return { ...context, name: component.name, cssVars: component.cssVars };
  if (command === "demo") {
    const demo = args[1];
    if (!demo)
      return {
        ...context,
        name: component.name,
        demos: component.demos.map(({ code, blocks, ...value }) => value),
        hasSource: !!component.demoSource,
      };
    if (demo === "source") {
      if (!component.demoSource)
        throw new Error("该 API 没有独立交互示例源码。");
      return {
        ...context,
        name: component.name,
        demo: { name: "source", language: "tsx", code: component.demoSource },
      };
    }
    const match = component.demos.find(
      (item) =>
        item.name.toLowerCase() === demo.toLowerCase() ||
        item.aliases.some(
          (alias) => alias.toLowerCase() === demo.toLowerCase(),
        ),
    );
    if (!match)
      throw new Error(
        `找不到示例 ${demo}。可用示例：${component.demos.map((d) => d.name).join(", ") || "无"}。`,
      );
    return { ...context, name: component.name, demo: match };
  }
  throw new Error(`未知查询命令：${command}`);
}
