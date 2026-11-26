# CLI 本地 GitLab Runner

CLI 使用独立名称 `daisu-cli-local-youzi-PC`，避免覆盖 UI 项目 Runner 的注册配置。GitLab 10.5.2 需要已验证的 Runner 11.11.2；Runner 10.5 的 Docker API 太旧，12 及以后版本不适用于当前服务器的旧协议。

## 当前运行配置

本机 `youzi-PC` 已注册并启动 CLI 专属 Runner，与 UI 使用相同的 Runner 版本和 Docker executor。

| 项目               | 配置                                 |
| ------------------ | ------------------------------------ |
| GitLab Runner 名称 | `daisu-cli-local-youzi-PC`           |
| 容器               | `daisu-cli-local-runner`             |
| Runner 版本        | `11.11.2`                            |
| 构建镜像           | `node:24-bookworm`                   |
| 并发任务           | 1                                    |
| 单个构建容器       | 2 CPU、3 GiB 内存，Node 堆上限 2 GiB |
| 配置卷             | `daisu-cli-runner-config`            |
| 自动恢复           | `restart: unless-stopped`            |

Runner 锁定到 CLI 项目并允许无标签任务。Runner 注册令牌用于登记执行机器；GitLab 的 `NPM_TOKEN` 用于 npm 发布，两者分别配置。仅向 npm 发布 CLI 无需 SSH 私钥。

## 首次注册或迁移

构建镜像为 node:24-bookworm。先在 GitLab CLI 项目的 CI/CD → Runners 中取得本项目 registration token，再在本机终端交互注册；不要将 Token 放入仓库或聊天。

```bash
docker volume create daisu-cli-runner-config
docker run --rm -it \
  -v daisu-cli-runner-config:/etc/gitlab-runner \
  -v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro \
  gitlab/gitlab-runner:v11.11.2 register
```

依次使用 GitLab URL `https://git.zilueit.com/`、CLI 项目的 registration token、Runner 名称、留空 tags、Docker executor 和默认镜像 `node:24-bookworm`。在项目设置中允许无标签任务，并锁定到本项目。完成后启动：

```bash
docker compose -f ops/local-runner/compose.yaml up -d
docker logs --tail 50 daisu-cli-local-runner
```

配置只存放在 Docker 外部卷，不提交 config.toml；不要在终端输出完整认证文件。管理容器挂载 Docker socket 用于创建构建容器，构建任务本身不挂载 socket。机器关机、休眠或 Docker 关闭时任务会等待。

如管理员已为 CLI 明确启用现有共享 Runner，可直接使用，无需再注册第二个。设置 NPM_TOKEN 不会自动让其他项目的锁定 Runner 执行 CLI 作业。

## 日常维护

在 CLI 仓库根目录执行：

```bash
docker compose -f ops/local-runner/compose.yaml up -d
docker compose -f ops/local-runner/compose.yaml ps
docker logs --tail 50 daisu-cli-local-runner
# 暂时停止或恢复；保留 Docker 配置卷
docker compose -f ops/local-runner/compose.yaml stop
docker compose -f ops/local-runner/compose.yaml start
```

Runner 启动后会领取 CLI 项目可运行的作业。版本标签会按 `.gitlab-ci.yml` 依次执行验证与自动 npm 发布；不要在查看日志时输出完整认证配置或环境变量。
