# CLI 开发与 npm 自动发布

默认仓库为 [DaisSu-UI/cli](https://github.com/DaisSu-UI/cli)，发布 npm 包 `@daisu-ui/cli`。组件库 `@daisu-ui/ui` 的源码、版本与流水线独立维护。

## GitHub Actions

工作流位于 [publish.yml](../.github/workflows/publish.yml)，使用 GitHub 托管的 Ubuntu Runner 和 Node.js 24。

| 触发方式                        | 行为                                           |
| ------------------------------- | ---------------------------------------------- |
| 推送 `developer` / `main`       | 验证、打包并保存产物，不发布 npm               |
| 向 `developer` / `main` 提交 PR | 验证、打包，不读取发布凭据                     |
| 在 Actions 页面手动运行         | 验证、打包，不发布 npm                         |
| 推送 `v<版本>` 标签             | 验证版本及 main 来源，再发布已经验证的 tarball |

发布作业仅运行于 `DaisSu-UI/cli` 的标签推送。标签必须与 `package.json` 的版本完全一致，且源码必须已合入 GitHub 的 `main`。发布作业重新检出同一提交，从验证作业下载 tarball 与 `npm-release.json`，核对源码、版本、文件名和 SHA-512 后上传，不重新构建。

## 首次设置

在 [Actions Secrets](https://github.com/DaisSu-UI/cli/settings/secrets/actions) 中添加 Repository secret `NPM_TOKEN`。

Token 使用 npm Granular Access Token，对 `@daisu-ui/cli` 有 Read and write 权限，启用 Bypass two-factor authentication；到期后更新同名 Secret。不要将 Token 写入源码或聊天。工作流只在发布步骤注入该 Secret，安装依赖、测试与打包时不读取。临时 npmrc 只写环境变量引用，权限 0600，发布结束后删除。

在 GitHub Settings → Actions → General 确认允许工作流运行和使用 `actions/*`。建议为 `main` 设置分支规则，限制版本标签的创建与修改。默认 `GITHUB_TOKEN` 仅需 `contents: read`，不需要仓库写权限或单独的 GitHub PAT。

可先在 [Actions](https://github.com/DaisSu-UI/cli/actions) 页面运行工作流，或查看配置提交触发的分支验证。此时不会向 npm 发布。

## 日常发布

1. 从 `developer` 更新 CLI 版本、`package-lock.json`、CHANGELOG 与需要发布的知识快照。发布版本应当是尚未使用的新版本，不能覆盖已有 npm 包。
2. 运行 `npm run verify` 并提交，经 PR 合入 `main`，等待验证通过。
3. 在该 main 提交创建与包版本一致的标签并推送。

例如 `package.json` 为 `0.1.0-beta.6`，且已经合入 main：

```bash
git fetch origin main
git tag v0.1.0-beta.6 origin/main
git push origin v0.1.0-beta.6
```

版本号必须按当次 package.json 修改，不要重复创建示例标签，也不要移动已发布的标签。

打开 Actions 中的 **CLI CI and npm release**，查看 Verify and package / Publish to npm。验证完成后可下载 `npm-<提交 SHA>` 产物，保留 7 天。发布成功后检查：

```bash
npm view @daisu-ui/cli version dist-tags --json
```

## 发布渠道与 npm 首页

渠道优先使用 `package.json` 的 `publishConfig.tag`；未指定时，预发布版本使用 beta，正式版本使用 latest。当前配置是 latest，因此 beta 版本号也会更新 npm 默认安装版本与首页 README。仅需测试渠道时，在发布前将配置改为 beta，并随版本一起提交评审。

npm 默认页展示 latest 的说明。只移动 dist-tag 可能保留旧 README；需要更新默认页时，以正确的发布渠道上传新的版本。

## 本地检查与备用发布

```bash
npm run verify
npm run npm:prepare
npm run npm:publish -- --dry-run
```

以上命令必须在已提交且无工作区修改的发布源码上执行。预演会刷新远端 `origin/main` 并验证产物，不向 npm 写入，也不创建认证文件。知识快照和 README 必须进入发布提交，安装后的 CLI 不读取本地源码。

本地手工发布可显式传入 `--tag`；CI 使用已提交的渠道，不接受临时覆盖。本地未设置 NPM_TOKEN 时可使用 npm 自身登录流程，可能要求浏览器二次认证。

## 重试与故障处理

| 现象                      | 处理                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| 推送后没有工作流          | 确认该分支或标签包含 `.github/workflows/publish.yml`，并已启用 Actions |
| 提示缺少 NPM_TOKEN        | 确认 Secret 位于本仓库的 Actions Repository secrets，名称为 NPM_TOKEN  |
| npm 返回 EOTP / 401 / 403 | 检查 Token 有效期、包写权限、组织发布权限及 Bypass 2FA                 |
| 版本或来源不符            | 将发布提交合入 GitHub main，使用与 package.json 一致的新版本标签       |
| npm 版本已存在且产物不同  | 使用新版本；不能强推标签或覆盖 npm 包                                  |
| 构建或测试失败            | 根据失败步骤日志修复，再提交并使用新的版本标签发布                     |
| 产物已超过保留期          | 对该标签重新运行所有作业，重新验证和生成产物                           |

基础设施故障修复后，可在 Actions 页面选择 Re-run failed jobs；如果 npm 已存在同版本且摘要一致，脚本会跳过上传。摘要不同或 npm API 状态无法确认时停止，不将网络错误当作版本不存在。

## 旧 GitLab 配置

`.gitlab-ci.yml` 与 [本地 Runner](local-runner.md) 保留用于旧环境兼容；GitLab 10.5 / Runner 11.11 仍使用 only/except 与 dependencies。GitHub 的 NPM_TOKEN 不会同步到 GitLab。默认发布操作使用 GitHub 的 origin；不要同时向多个 CI 仓库推送发布标签。

## GitHub → GitLab 分支同步

工作流 [sync-gitlab.yml](../.github/workflows/sync-gitlab.yml) 在 GitHub 的 main / developer 推送后，将本次提交同步到 GitLab 的同名分支。也可在 Actions 的 **Sync branches to GitLab** 页面选择相应分支手动运行。

GitLab 项目需要添加专用的 Deploy Key 并允许写入；对应私钥保存在 GitHub Repository secret `GITLAB_SSH_PRIVATE_KEY`。密钥仅供同步作业使用，临时文件权限为 0600，结束时清理。GitLab 必须可从 GitHub Runner 通过 SSH 访问。

主机公钥使用已核对的 `.github/gitlab_known_hosts`，启用严格主机校验。服务端更换主机密钥时，应核对新指纹并更新该文件。

同步使用普通分支推送；GitLab 出现独立提交导致分支分叉时，任务会失败，需要先协调合并历史。工作流不同步 Tag、不删除分支；npm 发布继续由 GitHub 的版本标签触发，避免旧 GitLab 流水线重复发布。
