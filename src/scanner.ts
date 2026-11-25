import {
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  existsSync,
} from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import ts from "typescript";
import { satisfies } from "semver";
import { parse as parseJsonc } from "jsonc-parser";
import {
  loadKnowledge,
  findProjectPackage,
  detectLibraryVersion,
  libraryPackageNames,
} from "./knowledge.js";
import type { Knowledge, QueryOptions, Issue, Component } from "./types.js";

const ignored = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "dist",
  "dist-web",
  "h5-dist",
  "build",
  "coverage",
  "artifacts",
  "vendor",
]);
export function sourceFiles(directory: string): {
  root: string;
  files: string[];
} {
  const root = realpathSync(resolve(directory));
  if (!statSync(root).isDirectory()) throw new Error("项目路径必须是目录。");
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith("."))
          walk(join(dir, entry.name));
      } else if (
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      )
        files.push(join(dir, entry.name));
    }
  }
  walk(root);
  return { root, files };
}
function position(source: ts.SourceFile, node: ts.Node) {
  const p = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: p.line + 1, column: p.character + 1 };
}
function literalValue(value?: ts.JsxAttributeValue): string | undefined {
  if (!value) return "true";
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression) {
    const e = value.expression;
    if (ts.isStringLiteral(e) || ts.isNumericLiteral(e)) return e.text;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (e.kind === ts.SyntaxKind.FalseKeyword) return "false";
  }
}
export function analyzeProject(directory: string, data: Knowledge) {
  const { root, files } = sourceFiles(directory);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    noResolve: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const issues: Issue[] = [];
  const usage = new Map<
    string,
    { name: string; importFrom: string; count: number; files: Set<string> }
  >();
  const imports = new Set<string>();
  const components = new Map(data.components.map((c) => [c.name, c]));
  for (const path of files) {
    const source = program.getSourceFile(path);
    if (!source) continue;
    const file = relative(root, path).split("\\").join("/");
    const bindings = new Map<
      ts.Symbol,
      { name: string; component?: Component; namespace?: boolean; from: string }
    >();
    const issue = (
      node: ts.Node,
      rule: string,
      severity: "warning" | "error",
      message: string,
    ) =>
      issues.push({ file, ...position(source, node), rule, severity, message });
    const count = (component: Component) => {
      let item = usage.get(component.name);
      if (!item) {
        item = {
          name: component.name,
          importFrom: component.importFrom,
          count: 0,
          files: new Set(),
        };
        usage.set(component.name, item);
      }
      item.count++;
      item.files.add(file);
    };
    function register(
      identifier: ts.Identifier,
      name: string,
      from: string,
      namespace = false,
    ) {
      const symbol = checker.getSymbolAtLocation(identifier);
      if (symbol)
        bindings.set(symbol, {
          name,
          from,
          namespace,
          component: components.get(name),
        });
    }
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const from = statement.moduleSpecifier.text;
      if (from === "@lynx-js/react")
        for (const specifier of statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements
          : []) {
          if (
            (specifier.propertyName?.text || specifier.name.text) ===
            "useLayoutEffect"
          )
            issue(
              specifier,
              "unsupported-hook",
              "error",
              "ReactLynx 不支持 useLayoutEffect；请按生命周期需求使用 useEffect 或主线程布局事件。",
            );
        }
      const libraryName = libraryPackageNames.find(
        (name) => from === name || from.startsWith(name + "/"),
      );
      if (!libraryName) continue;
      imports.add(from);
      if (
        from === `${libraryName}/styles.css` ||
        from === `${libraryName}/package.json`
      )
        continue;
      if (
        !Object.hasOwn(data.publicExports, from) &&
        from !== `${libraryName}/styles.css` &&
        from !== `${libraryName}/package.json`
      ) {
        issue(
          statement.moduleSpecifier,
          "private-import",
          "error",
          `请使用公开入口，不能导入 ${from}。`,
        );
        continue;
      }
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name)
        issue(
          clause.name,
          "default-import",
          "error",
          "Daisu UI 使用具名导出，没有默认导出。",
        );
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named))
        register(named.name, "*", from, true);
      if (named && ts.isNamedImports(named))
        for (const specifier of named.elements) {
          const name = specifier.propertyName?.text || specifier.name.text;
          if (!data.publicExports[from]?.includes(name))
            issue(
              specifier,
              "unknown-export",
              "error",
              `${from} 没有公开导出 ${name}。`,
            );
          register(specifier.name, name, from);
        }
    }
    function binding(node: ts.Node):
      | {
          name: string;
          component?: Component;
          namespace?: boolean;
          from: string;
        }
      | undefined {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        return symbol ? bindings.get(symbol) : undefined;
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression)
      ) {
        const symbol = checker.getSymbolAtLocation(node.expression),
          ns = symbol ? bindings.get(symbol) : undefined;
        if (ns?.namespace)
          return {
            name: node.name.text,
            component: components.get(node.name.text),
            from: ns.from,
          };
      }
    }
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const imported = binding(node.tagName);
        if (imported) {
          const component = imported.component;
          if (!data.publicExports[imported.from]?.includes(imported.name))
            issue(
              node.tagName,
              "unknown-component",
              "error",
              `${imported.from} 没有组件 ${imported.name}。`,
            );
          else if (component) {
            count(component);
            if (component.deprecated)
              issue(
                node.tagName,
                "deprecated-component",
                "warning",
                `${component.name} 已弃用。${component.deprecationMessage || ""}${component.replacement ? " 请改用 " + component.replacement + "。" : ""}`,
              );
            const fields = [
              ...component.props,
              ...component.events,
              ...component.slots,
            ];
            const known = new Set(fields.map((p) => p.name));
            const attributes = node.attributes.properties;
            const spread = attributes.some(ts.isJsxSpreadAttribute);
            for (const attribute of attributes) {
              if (!ts.isJsxAttribute(attribute)) continue;
              const name = attribute.name.getText(source);
              const field = fields.find((field) => field.name === name);
              if (field?.deprecated)
                issue(
                  attribute.name,
                  "deprecated-prop",
                  "warning",
                  `${component.name}.${name} 已弃用。${field.deprecationMessage || ""}${field.replacement ? " 请改用 " + field.replacement + "。" : ""}`,
                );
              if (
                !known.has(name) &&
                !["key", "ref"].includes(name) &&
                !component.allowUnknownProps
              )
                issue(
                  attribute.name,
                  "unknown-prop",
                  "error",
                  `${component.name} 没有公开属性 ${name}。请运行 daisu info ${component.name} 核对。`,
                );
              if (
                /^on[A-Z]/.test(name) &&
                attribute.initializer &&
                ts.isJsxExpression(attribute.initializer) &&
                attribute.initializer.expression
              ) {
                const expression = attribute.initializer.expression;
                if (
                  ts.isArrowFunction(expression) ||
                  ts.isFunctionExpression(expression)
                ) {
                  const marked =
                    ts.isBlock(expression.body) &&
                    expression.body.statements.some(
                      (s, index) =>
                        index === 0 &&
                        ts.isExpressionStatement(s) &&
                        ts.isStringLiteral(s.expression) &&
                        s.expression.text === "background only",
                    );
                  if (!marked)
                    issue(
                      attribute,
                      "background-callback",
                      "warning",
                      `${component.name}.${name} 的内联回调跨越组件边界；有状态更新或副作用时请在函数开头标记 'background only'。`,
                    );
                }
              }
            }
            if (component.name === "Button" && !spread) {
              const hasContent = attributes.some(
                (attribute) =>
                  ts.isJsxAttribute(attribute) &&
                  ["label", "icon", "loading"].includes(
                    attribute.name.getText(source),
                  ) &&
                  !["", "false"].includes(
                    literalValue(attribute.initializer) || "dynamic",
                  ),
              );
              if (!hasContent)
                issue(
                  node.tagName,
                  "empty-button",
                  "warning",
                  "Button 没有 label、icon 或 loading 内容；文本通过 label 设置。",
                );
              if (
                ts.isJsxOpeningElement(node) &&
                ts.isJsxElement(node.parent) &&
                node.parent.children.some(
                  (c) => !ts.isJsxText(c) || c.text.trim(),
                )
              )
                issue(
                  node.tagName,
                  "button-children",
                  "error",
                  "Button 不使用 children 展示文本，请改用 label 或 icon。",
                );
            }
          }
        }
      } else if (ts.isCallExpression(node)) {
        const imported = binding(node.expression);
        if (imported?.component && imported.component.kind !== "component") {
          count(imported.component);
          if (imported.component.deprecated)
            issue(
              node.expression,
              "deprecated-api",
              "warning",
              `${imported.component.name} 已弃用。${imported.component.deprecationMessage || ""}${imported.component.replacement ? " 请改用 " + imported.component.replacement + "。" : ""}`,
            );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  issues.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.rule.localeCompare(b.rule),
  );
  return {
    dir: root,
    scannedFiles: files.length,
    imports: [...imports].sort(),
    components: [...usage.values()]
      .map((v) => ({ ...v, files: [...v.files].sort() }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    issues,
  };
}
export function usageProject(directory: string, options: QueryOptions = {}) {
  const selected = loadKnowledge({ ...options, cwd: options.cwd || directory });
  const report = analyzeProject(directory, selected.data);
  return {
    version: selected.version,
    versionSource: selected.versionSource,
    warnings: selected.warnings,
    dir: report.dir,
    scannedFiles: report.scannedFiles,
    imports: report.imports,
    components: report.components,
  };
}
export function lintProject(directory: string, options: QueryOptions = {}) {
  const selected = loadKnowledge({ ...options, cwd: options.cwd || directory });
  const report = analyzeProject(directory, selected.data);
  return {
    version: selected.version,
    versionSource: selected.versionSource,
    warnings: selected.warnings,
    dir: report.dir,
    scannedFiles: report.scannedFiles,
    issues: report.issues,
    errors: report.issues.filter((i) => i.severity === "error").length,
    warningsCount: report.issues.filter((i) => i.severity === "warning").length,
  };
}
export function doctorProject(directory: string, options: QueryOptions = {}) {
  const dir = realpathSync(resolve(directory));
  if (!statSync(dir).isDirectory()) throw new Error("项目路径必须是目录。");
  const checks: {
    name: string;
    status: "pass" | "warn" | "fail";
    message: string;
  }[] = [];
  checks.push({
    name: "node",
    status: satisfies(process.version, ">=20.19.0") ? "pass" : "fail",
    message: `Node.js ${process.version}，需要 >=20.19.0`,
  });
  const project = findProjectPackage(dir);
  checks.push({
    name: "package.json",
    status: project ? "pass" : "fail",
    message: project
      ? relative(dir, project.path) || "package.json"
      : "未找到 package.json",
  });
  const detected = detectLibraryVersion(dir);
  checks.push({
    name: "daisu-ui",
    status: detected.version ? "pass" : "warn",
    message: detected.version
      ? `${detected.version}（${detected.source}）`
      : "没有找到 @daisu-ui/ui（或历史 daisu-ui）依赖；本工具仍可查询随包知识库。",
  });
  let selected;
  try {
    selected = loadKnowledge({ ...options, cwd: dir });
    checks.push({
      name: "offline-data",
      status: selected.warnings.length ? "warn" : "pass",
      message: `离线数据 ${selected.version}${selected.warnings.length ? "；" + selected.warnings.join("；") : ""}`,
    });
  } catch (error) {
    checks.push({
      name: "offline-data",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const dependencies = {
    ...project?.data.peerDependencies,
    ...project?.data.devDependencies,
    ...project?.data.dependencies,
  };
  const react = dependencies["@lynx-js/react"];
  checks.push({
    name: "reactlynx",
    status: react ? "pass" : "warn",
    message: react
      ? `@lynx-js/react ${react}`
      : "没有声明 @lynx-js/react，请核对目标工程是否为 ReactLynx。",
  });
  const configPath = join(
    project ? resolve(project.path, "..") : dir,
    "tsconfig.json",
  );
  if (existsSync(configPath)) {
    const errors: any[] = [];
    const config = parseJsonc(readFileSync(configPath, "utf8"), errors, {
      allowTrailingComma: true,
    });
    checks.push({
      name: "typescript-jsx",
      status:
        !errors.length &&
        config?.compilerOptions?.jsxImportSource === "@lynx-js/react"
          ? "pass"
          : "warn",
      message: errors.length
        ? "tsconfig.json 无法解析，请先修复 JSONC。"
        : config?.compilerOptions?.jsxImportSource === "@lynx-js/react"
          ? "JSX 使用 @lynx-js/react"
          : "请核对 tsconfig 或继承配置中的 jsxImportSource；ReactLynx 项目使用 @lynx-js/react。",
    });
  }
  checks.push({
    name: "styles",
    status: "pass",
    message: "组件公开入口自动加载样式，不要求额外导入组件样式入口。",
  });
  return {
    dir,
    checks,
    errors: checks.filter((c) => c.status === "fail").length,
  };
}
