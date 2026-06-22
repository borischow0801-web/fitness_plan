# 个人锻炼计划安排与健康记录系统

移动端优先的 Web 应用，适合放到微信公众号菜单或文章链接中访问。后端使用 Node.js + Express + SQLite，前端为原生 HTML/CSS/JS 单页应用。

## 运行

```bash
npm install
cp .env.example .env
npm run dev
```

访问 `http://本机IP:9001`，本机也可以使用 `http://localhost:9001`。

## 默认说明

- 首次启动会自动创建 SQLite 数据库和表结构。
- 所有个人数据接口均要求 JWT 登录态。
- 密码使用 bcrypt 哈希保存。
- BMI、目标进度、训练完成率均在服务端计算，前端也会在录入时实时预览 BMI。


## systemd 服务

项目已提供服务文件模板：`deploy/fitness-plan.service`。

安装并启动：

```bash
sudo cp /app/fitness_plan/deploy/fitness-plan.service /etc/systemd/system/fitness-plan.service
sudo systemctl daemon-reload
sudo systemctl enable fitness-plan
sudo systemctl restart fitness-plan
sudo systemctl status fitness-plan
```

查看日志：

```bash
journalctl -u fitness-plan -f
```

## GitHub 同步

仓库地址：`https://github.com/borischow0801-web/fitness_plan.git`

本地已配置 remote。若当前机器没有 GitHub 凭据，可在终端完成认证后推送：

```bash
git push -u origin main
```

请勿提交 `.env` 或 `data/*.sqlite`，这些文件已在 `.gitignore` 中排除。

## 公网发布建议

- 将 `.env` 中的 `JWT_SECRET` 换成强随机字符串。
- 生产环境设置 `NODE_ENV=production`。
- 配置 `CORS_ORIGIN=https://你的域名`，多个域名用英文逗号分隔。
- 使用 Nginx 或 Caddy 反向代理到 `127.0.0.1:9001` 或内网地址。
- 启用 HTTPS，微信公众号菜单/文章链接建议直接使用 HTTPS 域名。
- 保留登录/注册限流：`AUTH_RATE_LIMIT_WINDOW_MS`、`AUTH_RATE_LIMIT_MAX`。
- 定期备份 `data/fitness.sqlite`。
- 多用户长期公网使用建议迁移到 MySQL 或 PostgreSQL。
