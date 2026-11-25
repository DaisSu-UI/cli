# CLI 开发与 npm 自动发布

当前项目为 `daisu-ui/cli`，只发布 npm 包 `@daisu-ui/cli`。组件库 `@daisu-ui/ui` 的源码、版本与流水线独立维护。

## 分支约定

| 分支           | 用途                                        | 推送后的行为                                    |
| -------------- | ------------------------------------------- | ----------------------------------------------- |
| `developer`    | 日常功能、组件知识与文档维护                | 自动执行验证、打包，不发布 npm                  |
| `main`         | 已合入且可验收的发布源码                    | 自动执行验证、打包；在其提交创建版本 Tag 后发布 |
| 功能分支       | 从 developer 开出，经合并请求进入 developer | 验证，不发布 npm                                |
| `v<版本>` 标签 | 指向已合入 main 的发布提交                  | 先验证来源与版本，再自动发布已验证的 tarball    |

CLI 与组件库统一使用 developer/main 命名。推荐将 GitLab 默认分支设置为 developer，保护 main 和 v* 标签，只允许发布负责人合并或创建。不要移动已发布的版本标签。

## 一次性设置

本项目使用 GitLab 10.5.2 与 Runner 11.11.2，CI 使用 only/except、dependencies，不能直接套用新版 GitLab 的 rules/needs/OIDC 发布配置。

1. 在 CLI 项目或 daisu-ui 组的 Secret variables 配置 `NPM_TOKEN` 并开启 Protected。使用 npm granular access token，对 `@daisu-ui/cli` 有 Read and write 权限，开启 Bypass two-factor authentication。不要将 Token 写入源码或聊天。到期后在 GitLab 中更换。
2. 保护 `main` 分支和 `v*` 标签；仅向可信发布负责人开放合并、推送和创建标签。
3. 为 CLI 项目启用一个允许无标签任务的 Docker Runner。现有 UI 项目 Runner 如果被锁定，只能执行 UI 项目任务，CLI 需要另行注册 Runner 或由管理员明确允许共享。参考 [本地 Runner](local-runner.md)。
4. 将 CLI 默认分支设为 `developer`。原有 main 保留为发布分支。

设置入口：<https://git.zilueit.com/daisu-ui/cli/settings/ci_cd> 与 <https://git.zilueit.com/daisu-ui/cli/settings/repository>。不同 GitLab 版本的菜单名称可能显示为 CI/CD、Secret variables、Protected branches 或 Protected tags。

自动发布从受保护的 GitLab 变量读取 Token，临时 npmrc 只写环境变量引用，权限 0600，结束后删除。发布作业没有交互式登录，不需要每次点击 npm 浏览器授权。

## 日常发布

在 developer 完成改动，更新 CLI 版本、package-lock 和 CHANGELOG，运行验证并提交。发布版本的组件知识快照和 README 都需要进入提交；安装后的 CLI 不读取工作目录。

```bash
git switch developer
git pull --ff-only origin developer
# 修改源码、知识快照与版本
npm run verify
git add <本次发布文件>
git commit -m "chore: prepare CLI release"
git push origin developer
```

通过 GitLab 合并请求将 developer 合入 main，等待 main 的 verify 流水线通过。在该 main 提交创建 `v<package.json版本>` 标签：

```bash
git switch main
git pull --ff-only origin main
git tag v0.1.0-beta.4
git push origin v0.1.0-beta.4
```

上例版本需按当次 package.json 更新，不是每次重复创建同一标签。普通分支推送不会发布；标签提交尚未合入远端 main、标签版本不符、校验或构建失败时，发布会停止。来源检查会重新读取远端 main，也支持 CI 的浅克隆。

## 发布渠道与 npm 首页

优先使用已提交在 `package.json` 的 `publishConfig.tag`；未指定时，预发布版本默认 beta、正式版本默认 latest。修改渠道与版本一起评审。当前配置为 latest，使 npm 默认页面与这次居中 README 修复保持一致；若只想发布测试渠道，将发布版本的 tag 改为 beta。

npm 默认页展示 latest 的说明。将新版本只发布到 beta，或事后只移动 dist-tag，可能保留旧的首页 README；需要更新默认页时，以正确的 publishConfig.tag 直接发布新的版本。不能覆盖已发布版本。

## 流水线内容

| 作业        | 行为                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| verify      | 格式、类型、测试、知识摘要、版本、独立 tarball 安装验证；生成 tarball 和 npm-release.json      |
| publish:npm | 从上游 artifacts 读取经过验证的 tarball，核对版本、源提交、文件名与 SHA-512，再通过 npmjs 发布 |

发布作业只依赖 Node、git、npm 与流水线产物，不重新安装依赖或重新构建包，不读取相邻 UI 仓库。CI 关闭本地跨仓库自动同步。维护者如显式提供 UI 源目录，verify 可额外进行知识和文档的一致性检查。

重复执行时先查询 npm：版本不存在才上传；相同版本且包摘要一致则跳过；摘要不同则停止并要求新版本。npm API 无法确认版本状态时停止，不把网络错误当作版本不存在。两个任务并行上传同一产物时，失败任务会再次核对注册表。

## 检查与备用发布

```bash
npm run verify
npm run npm:prepare
npm run npm:publish -- --dry-run
```

发布预演会检查远端 main、源码与产物，但不向 npm 写入、也不创建认证文件。CI 不允许通过命令行临时改渠道；手工备用发布可显式传入 `--tag`，发布版本与 main 来源检查仍会执行。

Runner 离线且确需本地备用时，在已经合入 main 的干净源码上完成上述检查，再运行 `npm run npm:publish`。CI 中必须提供 NPM_TOKEN；本地未设置 Token 时可以使用 npm 自身登录流程，但可能要求浏览器二次认证。

## 故障处理

| 现象                   | 处理                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| 作业一直 pending       | CLI 没有可用 Runner，或本地 Runner/机器离线；检查项目是否启用该 Runner                           |
| 提示缺少 NPM_TOKEN     | 检查 CLI 项目或组变量、Protected 状态、v* 标签保护和变量作用范围                                 |
| npm 返回 EOTP/认证失败 | 检查 granular token 对本包的写权限、有效期与 Bypass 2FA；不要把交互登录 Token 当作 CI 发布 Token |
| 来源或版本不符         | 将发布提交合入 main，使用与 package.json 完全一致的新版本标签                                    |
| 相同版本摘要不同       | 确认是否已经发布；使用新的版本，不强推标签或覆盖 npm                                             |
| 产物源提交过期         | 在当前已提交源码重新运行 verify 和 npm:prepare                                                   |

网络或基础设施故障修复后，可重试失败作业；npm 发布已经成功且摘要相同时会跳过。超过 artifacts 保留期后重新执行该标签的 verify 以生成产物，再重试发布。发布后将 main 合并记录同步回 developer，继续开发。
