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
