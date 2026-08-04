# 上线部署清单（Go-Live）

本地已跑通（小程序 + 网页后台 + 后端 `localhost:4000`）。要放给真实客户用，按下面四步走。
**带 ⚙️ 的是你（在外部控制台）操作，我改不了；带 💻 的是我准备的代码/配置。**

---

## 0. 准备（一次性）

| 资源 | 用途 | 获取处 |
|---|---|---|
| Neon Postgres 连接串 | 生产数据库（替代本地 SQLite） | neon.tech → 建 project → 复制 connection string |
| 微信小程序 AppID + AppSecret | 真实登录 `code→openid` | 微信公众平台 → 开发 → 开发管理 → 开发设置 |
| 已备案域名（如 `studio.你的域名.com`） | 作为微信 request 合法域名（微信强制要求备案） | 你的域名服务商 |
| （选填）Cloudflare R2 | 图片持久化（Render 临时盘重启会丢图） | cloudflare.com → R2 |

> 没有已备案域名时，微信开发者工具勾「不校验合法域名」只能本地/预览用，无法正式提审发布。

---

## 1. ⚙️ 部署后端到 Render

1. Render 控制台 → **New → Blueprint** → 关联本 Git 仓库（仓库根目录含 `render.yaml`）。
2. Render 读取 `render.yaml` 自动建好 `yezhe-studio-server`（web 服务，`rootDir: server`）。
3. 在 Render 服务 **Environment** 里填变量（render.yaml 已列出，标 `sync:false` 的需手动填）：
   - `DATABASE_URL` = Neon 连接串（形如 `postgresql://user:pass@ep-xxx-pooler.aws.neon.tech/neondb?sslmode=require`）
   - `WX_APPID` / `WX_SECRET` = 微信小程序后台获取
   - `CORS_ORIGIN` = 网页后台域名（如 `https://yezhe.netlify.app`）
   - `JWT_SECRET` 已自动生成，无需动
   - （选填）`R2_*` 四项 = Cloudflare R2 凭据，填齐后图片自动存 R2
4. 部署完成后，记下分配的 **后端域名**，形如 `https://yezhe-studio-server.onrender.com`。
   - 先访问 `https://你的后端域名/api/health`，返回 `{"ok":true}` 即正常。

> 💻 我已写好 `render.yaml`（含 healthCheck、NODE 22、自动部署）。`DATABASE_URL` 命中即自动切 Postgres，业务代码零改动。

---

## 2. ⚙️ 部署网页后台到 Netlify

1. Netlify → **Add new site → Import from Git**，选本仓库。
2. Build 设置：
   - **Base directory**：`client`
   - **Build command**：`npm install && npm run build`
   - **Publish directory**：`client/dist`
   （或保持仓库根 `netlify.toml` 已配好，直接导入即可）
3. **Environment variables** 加：`VITE_API_BASE` = 第 1 步的后端域名（必须 `https`）。
4. 部署完成得到网页后台地址（如 `https://yezhe.netlify.app`）。用 `admin / admin123` 登录，先**改密码**（后端未强制，建议在 `server/.env` 的 `JWT_SECRET` 之外自行加固，或联系我加首次改密）。

> `netlify.toml` 已存在；唯一需你填的是 `VITE_API_BASE`（构建时注入前端）。

---

## 3. ⚙️💻 小程序上线

💻 我先改好本地配置（`miniprogram/utils/config.js`）：
- 把 `API_BASE` 从 `http://localhost:4000` 改成 **第 1 步的 Render https 域名**。
- `miniprogram/project.config.json` 的 `appid` 改成**真实小程序 AppID**（或保留 `touristappid` 仅供本地调试）。

⚙️ 你（微信公众平台）：
1. **开发 → 开发管理 → 开发设置 → 服务器域名 → 修改**：
   - `request 合法域名`：`https://你的render域名`
   - `uploadFile 合法域名`：`https://你的render域名`（评价传图用）
   - `downloadFile 合法域名`：`https://你的render域名`（成片保存用）
2. 微信开发者工具里**取消勾选**「不校验合法域名、web-view、TLS 版本」（否则提审会被拒）。
3. **上传代码** → 微信公众平台 **提交审核** → 审核通过**发布**。

> ⚠️ `*.onrender.com` 自带子域名一般**未备案**，微信会拒。请用你自己**已备案域名做 CNAME 指向 Render**，再把备案域名填进 request 合法域名。

---

## 4. 自测（上线后必做）

- [ ] 网页后台登录、建作品并设「公开」、上架套系
- [ ] 小程序首页能看到该作品/套系
- [ ] 小程序走完：预约 → 网页后台「预约管理」转订单 → 客户在小程序看到订单
- [ ] 评价提交 → 网页后台「评价审核」通过 → 首页好评墙出现
- [ ] 成片 `allow_download` 开关在小程序相册生效

---

## 已知限制 / 后续

- **Render 免费档会休眠**：15 分钟无请求后冷启动慢（首屏 1~2 秒延迟），量上来建议升档。
- **不配 R2 时图片存 Render 临时盘**：每次重新部署会清空上传图片，正式运营请配 R2（变量已预留）。
- **账号体系简化**：目前 `admin/admin123` 为种子账号，生产建议加「首次强制改密」或多账号（架构已支持 `photographer/selector/finance` 角色，前端可按需放开）。
- **ICP 备案**：request 合法域名必须备案；网页后台/后端域名如有中国大陆访问需求也需备案。
