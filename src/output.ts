import type { OutputFormat } from "./types.js";
const table = (title: string, rows: any[]) =>
  rows.length
    ? `${title}\n${rows.map((p) => `- ${p.name}: ${p.type || p.defaultValue || ""}${p.defaultValue && p.type ? " = " + p.defaultValue : ""}${p.optional === false ? "（必填）" : ""}${p.values?.length ? " [" + p.values.map((v: any) => JSON.stringify(v)).join(" | ") + "]" : ""}${p.since ? " 起于 " + p.since : ""}${p.deprecated ? " [已弃用] " + (p.deprecationMessage || "") + (p.replacement ? "；改用 " + p.replacement : "") : ""}${p.description ? " — " + p.description : ""}`).join("\n")}\n`
    : "";
export function renderOutput(
  command: string,
  result: any,
  format: OutputFormat,
): string {
  if (format === "json") return JSON.stringify(result, null, 2) + "\n";
  if (command === "docs-export")
    return `${result.message} (${result.generator.package}@${result.generator.version})\n`;
  if (command === "update")
    return `${result.package} ${result.currentVersion}\n${result.message || "注册表 " + result.tag + "：" + result.latestVersion}\n${result.suggestedCommand ? result.suggestedCommand + "\n" : ""}`;
  if (command.startsWith("data-"))
    return `离线数据校验通过，latest=${result.latest}\n${result.versions.map((v: any) => `${v.version}: ${v.components} 组件，${v.hooks} Hooks，${v.demos} 示例`).join("\n")}\n`;
  if (command.endsWith("-list") && result.clients?.[0]?.evidence)
    return (
      result.clients
        .map(
          (c: any) =>
            `${c.active ? "[当前]" : c.installed ? "[已检测]" : "[未检测]"} ${c.id} · ${c.name}\n${c.evidence.map((e: any) => "  " + e.kind + ": " + e.value).join("\n")}`,
        )
        .join("\n") + "\n"
    );
  if (command.endsWith("-doctor"))
    return (
      result.clients
        .map(
          (c: any) =>
            `${c.name}: ${c.readiness}\n${c.configurationProblems?.length ? c.configurationProblems.map((p: string) => "  配置问题：" + p).join("\n") + "\n" : ""}  服务握手：${c.serverReady ? "通过" : "未通过/未检查"}\n  客户端登记：${c.registration.status} · ${c.registration.message}\n  ${c.nextStep}`,
        )
        .join("\n") + "\n"
    );
  if (command === "search")
    return (
      result.results
        .map((item: any) => `- ${item.title} (${item.id})\n  ${item.excerpt}`)
        .join("\n\n") + (result.results.length ? "\n" : "没有匹配的文档。\n")
    );
  if (command === "doc") return result.doc;
  if (command === "demo" && result.demo) {
    if (format === "markdown")
      return `### ${result.demo.title || result.demo.name}\n\n\`\`\`${result.demo.language || "tsx"}\n${result.demo.code}\`\`\`\n`;
    return result.demo.code;
  }
  if (command === "info")
    return `${format === "markdown" ? "# " : ""}${result.name} · ${result.label}\n${result.description}\n\n版本：${result.version}\n公开入口：${result.importFrom}\n\n${table("Props", result.props)}${table("Events", result.events)}${table("Slots / Render Props", result.slots)}${table("Methods", result.methods)}${table("CSS Variables", result.cssVars)}`;
  if (command === "list")
    return `${format === "markdown" ? "# " : ""}Daisu UI ${result.version}\n\n${result.components.map((c: any) => `- ${c.name} · ${c.label} [${c.category}/${c.kind}]\n  ${c.description}`).join("\n")}\n`;
  if (command === "token")
    return (
      table(`${result.name || "Daisu UI"} CSS Variables`, result.cssVars) ||
      "没有单独的组件 CSS 变量。\n"
    );
  if (command === "demo")
    return `${result.name} 示例\n${result.demos.map((d: any) => `- ${d.name}: ${d.title}`).join("\n")}\n${result.hasSource ? "\nsource: 完整交互示例源码\n" : ""}`;
  if (command === "changelog")
    return (
      result.entries
        .map(
          (e: any) =>
            `## ${e.version}${e.date ? " · " + e.date : ""}\n\n${e.content}\n`,
        )
        .join("\n") || "没有匹配的更新记录。\n"
    );
  if (command === "lint")
    return `${result.dir} · ${result.scannedFiles} 个源码文件\n${result.issues.map((i: any) => `${i.file}:${i.line}:${i.column} [${i.severity}] ${i.rule}: ${i.message}`).join("\n")}\n${result.errors} 个错误，${result.warningsCount} 个警告。\n`;
  if (command === "usage")
    return `${result.dir} · ${result.scannedFiles} 个源码文件\n${result.components.map((c: any) => `${c.name}: ${c.count} 次，${c.files.length} 个文件\n${c.files.map((f: string) => "  " + f).join("\n")}`).join("\n")}\n`;
  if (command === "doctor")
    return `${result.dir}\n${result.checks.map((c: any) => `[${c.status.toUpperCase()}] ${c.name}: ${c.message}`).join("\n")}\n`;
  if (result.changedFiles)
    return `${result.operation} ${result.dryRun ? "(dry-run)" : ""} · ${result.clients.join(", ")}\n${result.changedFiles.length ? result.changedFiles.map((c: any) => `[${c.action}] ${c.path}`).join("\n") : "没有需要修改的文件。"}\n${result.warnings.map((w: string) => "提示：" + w).join("\n")}\n`;
  return JSON.stringify(result, null, 2) + "\n";
}
