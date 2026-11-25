import { prerelease, valid, gt } from "semver";
import { cliPackage } from "./knowledge.js";
export interface UpdateOptions {
  check?: boolean;
  registry?: string;
  tag?: string;
  timeout?: number;
  fetcher?: typeof fetch;
}
export async function updateStatus(options: UpdateOptions = {}) {
  const base = {
    package: cliPackage.name,
    currentVersion: cliPackage.version,
    checked: false,
    updateAvailable: false,
  };
  if (!options.check)
    return {
      ...base,
      status: "offline",
      message: "未联网。需要检查 npm 版本时显式使用 daisu update --check。",
    };
  const timeout = options.timeout ?? 3000;
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 30000)
    throw new Error("更新检查超时应在 100–30000ms 之间。");
  const registry = new URL(options.registry || "https://registry.npmjs.org/");
  if (
    !["https:", "http:"].includes(registry.protocol) ||
    registry.username ||
    registry.password ||
    registry.search ||
    registry.hash
  )
    throw new Error("registry 需为不含凭据、查询参数或片段的 HTTP(S) 地址。");
  registry.pathname = registry.pathname.replace(/\/?$/, "/");
  const url = new URL(encodeURIComponent(cliPackage.name), registry),
    tag = options.tag || (prerelease(cliPackage.version) ? "beta" : "latest");
  if (!/^[a-zA-Z][\w.-]*$/.test(tag)) throw new Error("无效 npm dist-tag。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetcher || fetch)(url, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (response.status === 404)
      return {
        ...base,
        checked: true,
        status: "not-published",
        tag,
        message: "注册表中尚未找到该包；本地 CLI 与离线知识查询仍可使用。",
      };
    if (!response.ok) throw new Error("registry-response");
    const value = (await response.json()) as any,
      latest = value?.["dist-tags"]?.[tag];
    if (!valid(latest))
      return {
        ...base,
        checked: true,
        status: "tag-unavailable",
        tag,
        message: "注册表没有提供该 dist-tag 的有效版本。",
      };
    const updateAvailable = gt(latest, cliPackage.version);
    return {
      ...base,
      checked: true,
      status: updateAvailable ? "available" : "current",
      tag,
      latestVersion: latest,
      updateAvailable,
      ...(updateAvailable
        ? { suggestedCommand: `npm install -g ${cliPackage.name}@${latest}` }
        : {}),
    };
  } catch {
    return {
      ...base,
      checked: true,
      status: "unavailable",
      tag,
      message: controller.signal.aborted
        ? "更新检查超时；离线能力不受影响。"
        : "无法获取更新状态；离线能力不受影响。",
    };
  } finally {
    clearTimeout(timer);
  }
}
