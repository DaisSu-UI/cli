# CLI 本地 GitLab Runner

CLI 使用独立名称 `daisu-cli-local-youzi-PC`，避免覆盖 UI 项目 Runner 的注册配置。GitLab 10.5.2 需要已验证的 Runner 11.11.2；Runner 10.5 的 Docker API 太旧，12 及以后版本不适用于当前服务器的旧协议。

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
