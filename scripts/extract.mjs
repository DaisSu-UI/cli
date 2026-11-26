import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, basename, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import ts from "typescript";

import { metadataTags } from "./metadata-tags.mjs";
import { saveSnapshot } from "./snapshot-files.mjs";

const { values } = parseArgs({
  options: {
    "ui-dir": { type: "string" },
    output: { type: "string" },
    check: { type: "boolean", default: false },
  },
});
if (!values["ui-dir"])
  throw new Error(
    "请传入 --ui-dir <Daisu UI 仓库>；提取只读取仓库，不修改组件或文档。",
  );
const root = realpathSync(resolve(values["ui-dir"])),
  output = resolve(
    values.output || fileURLToPath(new URL("../data", import.meta.url)),
  );
const digest = createHash("sha256");
const inputs = new Map();
function read(path) {
  const full = resolve(root, path);
  const rel = relative(root, realpathSync(full));
  if (rel === ".." || rel.startsWith(".." + sep))
    throw new Error("源码路径越界");
  const value = readFileSync(full, "utf8");
  inputs.set(path, value);
  return value;
}
const pkg = JSON.parse(read("packages/daisu-ui/package.json"));
if (!["@daisu-ui/ui", "daisu-ui"].includes(pkg.name))
  throw new Error("指定目录不是 Daisu UI 仓库");
const manifest = JSON.parse(read("docs/ui/component-sources.json"));
const configFile = resolve(root, "packages/daisu-ui/tsconfig.json");
const parsed = ts.readConfigFile(configFile, ts.sys.readFile);
if (parsed.error) throw new Error("无法读取组件库 tsconfig");
const config = ts.parseJsonConfigFileContent(
  parsed.config,
  ts.sys,
  dirname(configFile),
);
const entries = Object.entries(pkg.exports).filter(
  ([key, value]) =>
    typeof value === "object" && value.types && !key.endsWith(".css"),
);
const sourceEntries = entries
  .map(([key]) => [
    key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`,
    resolve(
      root,
      "packages/daisu-ui/src",
      key === "." ? "index.ts" : `${key.slice(2)}.ts`,
    ),
  ])
  .filter(([, path]) => existsSync(path));
if (
  existsSync(resolve(root, "packages/daisu-ui/src/router/index.ts")) &&
  !sourceEntries.some(([from]) => from === `${pkg.name}/router`)
)
  sourceEntries.push([
    `${pkg.name}/router`,
    resolve(root, "packages/daisu-ui/src/router/index.ts"),
  ]);
if (
  existsSync(resolve(root, "packages/daisu-ui/src/web/index.ts")) &&
  !sourceEntries.some(([from]) => from === `${pkg.name}/web`)
)
  sourceEntries.push([
    `${pkg.name}/web`,
    resolve(root, "packages/daisu-ui/src/web/index.ts"),
  ]);
const program = ts.createProgram(
  sourceEntries.map(([, path]) => path),
  { ...config.options, noEmit: true },
);
for (const source of program.getSourceFiles()) {
  const path = relative(root, source.fileName).split(sep).join("/");
  if (path.startsWith("packages/daisu-ui/src/")) read(path);
}
const checker = program.getTypeChecker();
const symbols = new Map(),
  publicExports = {};
for (const [from, path] of sourceEntries) {
  const source = program.getSourceFile(path);
  if (!source) continue;
  const mod = checker.getSymbolAtLocation(source);
  if (!mod) continue;
  const exports = checker.getExportsOfModule(mod);
  publicExports[from] = exports.map((s) => s.name).sort();
  for (let symbol of exports) {
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!symbols.has(symbol.name)) symbols.set(symbol.name, { symbol, from });
  }
}
function literal(node) {
  if (!node) return undefined;
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties
        .filter(ts.isPropertyAssignment)
        .map((p) => [
          p.name.getText().replace(/^['"]|['"]$/g, ""),
          literal(p.initializer),
        ]),
    );
  return undefined;
}
const catalogSource = ts.createSourceFile(
  "catalog.ts",
  read("apps/demo/src/features/ui-demo/catalog.ts"),
  ts.ScriptTarget.Latest,
  true,
);
let groups = [];
function catalogVisit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(catalogSource) === "componentGroups"
  )
    groups = literal(node.initializer) || [];
  ts.forEachChild(node, catalogVisit);
}
catalogVisit(catalogSource);
if (!groups.length) throw new Error("未找到组件分类目录");
const pages = new Map();
for (const group of groups)
  for (const item of group.items)
    pages.set(item.id, {
      ...item,
      category: group.label,
      categoryId: group.id,
    });
function cells(line) {
  const result = [];
  let field = "",
    tick = false,
    escaped = false;
  for (const c of line.trim().replace(/^\||\|$/g, "")) {
    if (escaped) {
      field += c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === "`") tick = !tick;
    if (c === "|" && !tick) {
      result.push(field.trim());
      field = "";
    } else field += c;
  }
  result.push(field.trim());
  return result.map((s) => s.replace(/`/g, ""));
}
function docTables(doc) {
  const fields = new Map(),
    tokens = new Map(),
    methods = [];
  let section = "",
    columns = [];
  let fenced = false;
  for (const line of doc.split("\n")) {
    if (/^```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^#{2,3} /.test(line)) {
      section = line.replace(/^#+ /, "");
      columns = [];
    }
    if (!/^\|/.test(line)) continue;
    const row = cells(line);
    if (row.every((s) => /^[-: ]+$/.test(s))) continue;
    if (
      /参数|变量|事件|名称|方法/.test(row[0]) &&
      /说明|描述/.test(row.join(" "))
    ) {
      columns = row;
      continue;
    }
    if (!columns.length) continue;
    const description =
      row[columns.findIndex((c) => /说明|描述/.test(c))] || "";
    const type = row[columns.findIndex((c) => /类型|参数/.test(c))] || "";
    const defaultValue = row[columns.findIndex((c) => /默认/.test(c))];
    if (row[0]?.startsWith("--"))
      tokens.set(row[0], {
        name: row[0],
        description,
        ...(defaultValue ? { defaultValue } : {}),
      });
    else if (/Methods|方法/.test(section))
      methods.push({ name: row[0], description, type });
    else if (row[0])
      fields.set(row[0], {
        description,
        ...(defaultValue && !["—", "-", ""].includes(defaultValue)
          ? { defaultValue }
          : {}),
      });
  }
  return { fields, tokens, methods };
}
function demos(doc) {
  const examples = [];
  let section = "",
    title = "",
    description = "",
    blocks = [],
    fenced = false,
    language = "",
    code = [];
  const flush = () => {
    if (
      title &&
      blocks.some((b) =>
        ["tsx", "jsx", "ts", "typescript"].includes(b.language),
      ) &&
      !/Attributes|Events|Methods|属性|事件|主题|插槽|数据类型|源代码/.test(
        section,
      )
    ) {
      const index = examples.length + 1;
      examples.push({
        name: index === 1 ? "basic" : `demo-${index}`,
        aliases: [`demo-${index}`, title],
        title,
        section,
        description: description.trim(),
        language: blocks.find((b) =>
          ["tsx", "jsx", "ts", "typescript"].includes(b.language),
        ).language,
        code: blocks.find((b) =>
          ["tsx", "jsx", "ts", "typescript"].includes(b.language),
        ).code,
        blocks,
      });
    }
    blocks = [];
    description = "";
  };
  for (const line of doc.split("\n")) {
    if (/^```/.test(line)) {
      if (!fenced) {
        language = line.slice(3).trim();
        code = [];
        fenced = true;
      } else {
        blocks.push({ language, code: code.join("\n") + "\n" });
        fenced = false;
      }
      continue;
    }
    if (fenced) {
      code.push(line);
      continue;
    }
    if (/^## /.test(line)) {
      flush();
      section = line.slice(3);
      title = "";
    } else if (/^### /.test(line)) {
      flush();
      title = line.slice(4);
    } else if (title && !blocks.length) description += line + "\n";
  }
  flush();
  return examples;
}
const allCss = new Map(),
  cssByFile = new Map();
for (const name of readdirSync(resolve(root, "packages/daisu-ui/src")).filter(
  (n) => n.endsWith(".css"),
)) {
  const css = read(`packages/daisu-ui/src/${name}`),
    vars = new Map();
  const declarations = /((?:--)[\w-]+)\s*:\s*([^;}]+)/g;
  let m;
  while ((m = declarations.exec(css))) {
    const v = { name: m[1], defaultValue: m[2].trim(), description: "" };
    if (v.name.startsWith("--cso-ui-")) {
      if (!allCss.has(v.name)) allCss.set(v.name, v);
      if (!vars.has(v.name)) vars.set(v.name, v);
    }
  }
  const pattern = /var\((--[\w-]+)\s*([,)])/g;
  while ((m = pattern.exec(css))) {
    let fallback;
    if (m[2] === ",") {
      let depth = 1,
        end = pattern.lastIndex;
      for (; end < css.length; end++) {
        if (css[end] === "(") depth++;
        else if (css[end] === ")" && !--depth) break;
      }
      fallback = css.slice(pattern.lastIndex, end).trim();
    }
    const v = {
      name: m[1],
      ...(fallback ? { defaultValue: fallback } : {}),
      description: "",
    };
    if (v.name.startsWith("--cso-ui-")) {
      if (!vars.has(v.name)) vars.set(v.name, v);
      if (!allCss.has(v.name)) allCss.set(v.name, v);
    }
  }
  cssByFile.set(name, vars);
}
const themeCss = read("packages/daisu-ui/src/styles.css");
for (const [selector, key] of [
  [":root", "defaultValue"],
  [".theme-dark", "darkValue"],
]) {
  const body =
    themeCss
      .slice(themeCss.indexOf(selector))
      .match(/^[^{]*\{([^}]+)\}/)?.[1] || "";
  for (const m of body.matchAll(/(--cso-ui-[\w-]+)\s*:\s*([^;]+)/g)) {
    allCss.set(m[1], {
      ...allCss.get(m[1]),
      name: m[1],
      [key]: m[2].trim(),
      description: allCss.get(m[1])?.description || "共享语义主题变量",
    });
  }
}
const components = [],
  bySource = new Map();
for (const [id, entry] of Object.entries(manifest)) {
  for (const component of entry.components || [])
    bySource.set(component.name, { id, entry });
}
for (const [name, { symbol, from }] of symbols) {
  if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
  const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
  if (!declaration) continue;
  const valueType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  if (!valueType.getCallSignatures().length) continue;
  const kind = /^use[A-Z]/.test(name)
    ? "hook"
    : /^[A-Z]/.test(name)
      ? "component"
      : "utility";
  let mapped = bySource.get(name);
  if (!mapped) {
    const file = declaration.getSourceFile().fileName;
    mapped = [...bySource.values()].find(({ entry }) =>
      entry.components.some((c) => resolve(root, c.path) === file),
    );
    if (!mapped && /^use[A-Z]/.test(name)) mapped = bySource.get(name.slice(3));
  }
  let entry = mapped?.entry,
    id =
      mapped?.id || name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const page = pages.get(id);
  let doc = entry?.doc ? read(entry.doc) : "";
  if (!doc && kind === "utility" && from.startsWith(`${pkg.name}/router`))
    doc = read("docs/ui/components/router.md");
  const tables = docTables(doc);
  const propsName = name === "Tabs" ? "StandardTabsProps" : `${name}Props`;
  let propsType;
  const typeSymbol = symbols.get(propsName)?.symbol;
  if (kind === "component" && typeSymbol)
    propsType = checker.getDeclaredTypeOfSymbol(typeSymbol);
  else if (kind === "component")
    propsType =
      valueType.getCallSignatures()[0]?.parameters[0] &&
      checker.getTypeOfSymbolAtLocation(
        valueType.getCallSignatures()[0].parameters[0],
        declaration,
      );
  const defaults = new Map();
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      (node.name?.text === name || node.name?.text === `Standard${name}`)
    )
      for (const p of node.parameters)
        if (ts.isObjectBindingPattern(p.name))
          for (const e of p.name.elements)
            if (e.initializer)
              defaults.set(
                e.propertyName?.getText() || e.name.getText(),
                e.initializer.getText().replace(/\s+/g, " "),
              );
    ts.forEachChild(node, visit);
  }
  visit(declaration.getSourceFile());
  const fields = propsType
    ? checker.getPropertiesOfType(propsType).map((field) => {
        const decl =
          field.valueDeclaration || field.declarations?.[0] || declaration;
        const fieldType = checker.getTypeOfSymbolAtLocation(field, decl);
        const details = tables.fields.get(field.name);
        const description =
          details?.description ||
          ts.displayPartsToString(field.getDocumentationComment(checker));
        const defaultValue = defaults.get(field.name) || details?.defaultValue;
        const alternatives = (
          fieldType.isUnion() ? fieldType.types : [fieldType]
        ).filter((type) => !(type.flags & ts.TypeFlags.Undefined));
        const literals =
          alternatives.length &&
          alternatives.every(
            (type) =>
              type.flags &
              (ts.TypeFlags.StringLiteral |
                ts.TypeFlags.NumberLiteral |
                ts.TypeFlags.BooleanLiteral),
          );
        const values = literals
          ? alternatives.map((type) =>
              type.flags & ts.TypeFlags.BooleanLiteral
                ? type.intrinsicName === "true"
                : type.value,
            )
          : undefined;
        return {
          ...metadataTags(field, checker),
          name: field.name,
          type: (
            decl.type?.getText() ||
            checker.typeToString(
              fieldType,
              decl,
              ts.TypeFormatFlags.NoTruncation,
            )
          ).replace(/\s+/g, " "),
          optional: !!(field.flags & ts.SymbolFlags.Optional),
          description,
          ...(defaultValue ? { defaultValue } : {}),
          ...(values ? { values } : {}),
        };
      })
    : [];
  const vars = new Map(
    [...(cssByFile.get(`${id}.css`) || [])].map(([key, value]) => [
      key,
      { ...value, ...allCss.get(key) },
    ]),
  );
  for (const [token, info] of tables.tokens) {
    vars.set(token, { ...allCss.get(token), ...vars.get(token), ...info });
    allCss.set(token, { ...allCss.get(token), ...info });
  }
  const description =
    doc
      .split("\n")
      .find(
        (line, index) => index > 0 && line.trim() && !line.startsWith("#"),
      ) ||
    ts.displayPartsToString(symbol.getDocumentationComment(checker)) ||
    `${name} 公开 ${kind === "hook" ? "Hook" : "API"}`;
  components.push({
    ...metadataTags(symbol, checker),
    name,
    id,
    label: page?.label || name,
    category: page?.category || "公共 API",
    categoryId: page?.categoryId || "api",
    kind,
    description,
    importFrom: from,
    source: relative(root, declaration.getSourceFile().fileName)
      .split(sep)
      .join("/"),
    ...(entry?.doc ? { docPath: entry.doc } : {}),
    doc,
    ...(entry?.demo ? { demoSource: read(entry.demo) } : {}),
    props: fields.filter(
      (f) =>
        !/^on[A-Z]/.test(f.name) && !/^render[A-Z]|^children$/.test(f.name),
    ),
    events: fields.filter((f) => /^on[A-Z]/.test(f.name)),
    slots: fields.filter(
      (f) => /^render[A-Z]|^children$/.test(f.name) || /ReactNode/.test(f.type),
    ),
    methods: tables.methods,
    cssVars: [...vars.values()].sort((a, b) => a.name.localeCompare(b.name)),
    demos: demos(doc),
    allowUnknownProps: !!propsType?.getStringIndexType(),
  });
}
if (!components.find((c) => c.name === "Button")?.props.length)
  throw new Error("Button API 提取失败，未生成空知识库");
const log = read("packages/daisu-ui/CHANGELOG.md");
const changelog = [
  ...log.matchAll(/^##\s+v?([\d][^\s]*)\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm),
].map((m) => ({
  version: m[1],
  date: m[2].match(/\d{4}-\d{2}-\d{2}/)?.[0],
  content: m[2].trim(),
  components: components
    .filter((c) => new RegExp(`\\b${c.name}\\b`, "i").test(m[2]))
    .map((c) => c.name),
}));
let commit = null,
  dirty = true;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  dirty = Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );
} catch {}
const guides = Object.fromEntries(
  [
    ["llms", "文档索引", "docs/ui/llms.txt"],
    ["llms-full", "完整使用约束", "docs/ui/llms-full.txt"],
    ["component-ai-notes", "逐组件生成约束", "docs/ui/COMPONENT_AI_NOTES.md"],
  ].map(([id, title, path]) => [id, { title, path, content: read(path) }]),
);
for (const [path, value] of [...inputs].sort(([a], [b]) => a.localeCompare(b)))
  digest.update(path).update("\0").update(value).update("\0");
const data = {
  schemaVersion: 1,
  library: "daisu-ui",
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  source: { commit, dirty, digest: digest.digest("hex") },
  guides,
  peerDependencies: pkg.peerDependencies || {},
  publicExports,
  components: components.sort((a, b) => a.name.localeCompare(b.name)),
  cssVars: [...allCss.values()].sort((a, b) => a.name.localeCompare(b.name)),
  changelog,
};
const destination = resolve(output, `${pkg.version}.json`);
if (values.check) {
  if (!existsSync(destination))
    throw new Error(
      `没有 ${pkg.version} 的快照，请运行 npm run sync -- --ui-dir <仓库>。`,
    );
  const currentText = readFileSync(destination, "utf8");
  const index = JSON.parse(
    readFileSync(resolve(output, "versions.json"), "utf8"),
  );
  if (
    !index.versions?.includes(pkg.version) ||
    index.digests?.[pkg.version] !==
      createHash("sha256").update(currentText).digest("hex")
  )
    throw new Error("快照索引或摘要不一致，请重新同步数据。");
  const existing = JSON.parse(currentText);
  const semantic = (value) => {
    const { generatedAt, source, ...rest } = value;
    return rest;
  };
  if (
    existing.source?.digest !== data.source.digest ||
    JSON.stringify(semantic(existing)) !== JSON.stringify(semantic(data))
  )
    throw new Error("知识快照与组件源码/文档不一致，请运行 npm run sync。");
  console.log(`知识快照与 ${pkg.name}@${pkg.version} 一致，未写入文件。`);
} else saveSnapshot(output, data);

console.log(
  `已提取 ${pkg.name}@${pkg.version}：${components.filter((c) => c.kind === "component").length} 个组件、${components.filter((c) => c.kind === "hook").length} 个 Hook、${components.reduce((n, c) => n + c.demos.length, 0)} 个文档示例、${allCss.size} 个 CSS 变量。`,
);
