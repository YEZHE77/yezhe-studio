# 摄影工作室全链路管理系统（零成本公网部署）

对标「拾光盒子」的摄影工作室后台 + 客户小程序方案。技术栈：

- **前端**：React + Vite + TailwindCSS（SPA，打包后纯静态）
- **后端**：Node + Express（零依赖优先，仅用常见纯 JS 包）
- **数据库**：Neon Postgres（生产）/ 本地 SQLite（开发冒烟，零账号）
- **图片**：Cloudflare R2（生产）/ 本地文件夹（兜底）
- **前端托管**：Netlify（绑定 `https://yezhe.netlify.app`）
- **后端托管**：Render 免费版（保活 `/api/health`）
- **小程序**：微信原生小程序（C 端：浏览/预约/选片/成片/评价，不使用 web-view）

> 原则：**全程零付费、无 VIP 弹窗、无本地 file:// 依赖、图片全部输出 HTTPS 网络地址。**

---

## 一、目录结构

```
摄影工作室管理系统/
├── client/            # React 前端（Vite + Tailwind）
├── server/            # Express 后端（Node，支持 SQLite / Neon）
├── miniprogram/       # 微信原生小程序（C 端 10 页：首页/作品/套餐/我的/预约/订单/选片/成片/评价/订阅）
├── netlify.toml       # Netlify 构建/重写配置
├── .env.example       # 后端环境变量模板
└── README.md
```

## 二、本地开发（零账号，纯本地跑通）

```bash
# 1. 安装依赖
npm run install:all          # 同时装 server + client

# 2. 后端（默认用本地 SQLite，无需任何云账号）
cd server && npm run seed    # 建表 + 演示数据（admin/admin123）
npm run dev                  # 监听 http://localhost:4000

# 3. 前端（另开终端）
cd client && npm run dev     # http://localhost:5173，代理 /api → 4000
```
登录：账号 `admin` / 密码 `admin123`。

## 三、后端部署（Render 免费版）

1. 在 Render 新建 **Web Service**，仓库连本目录，Start Command 填：
   ```
   npm --prefix server install && node server/src/index.js
   ```
   （或构建命令 `npm --prefix server install`，运行命令 `node server/src/index.js`）
2. 在 Render 的 **Environment** 中设置：
   - `PORT`：Render 自动注入，无需手填
   - `CORS_ORIGIN`：`https://yezhe.netlify.app`
   - `JWT_SECRET`：随机长字符串
   - `DATABASE_URL`：填 **Neon** 连接串（见第四节）
   - `WX_APPID` / `WX_SECRET`：你的小程序凭证（留空则 openid 返回 `DEBUG_<code>` 兜底）
   - `R2_*`：Cloudflare R2 四项（见第五节；留空则图片存 Render 临时盘，仅兜底）
3. 部署后访问 `https://<你的render地址>.onrender.com/api/health` 应返回 `{"ok":true}`。
4. **保活**：Render 免费版会休眠，用外部定时 ping `/api/health`（如 UptimeRobot 每 14 分钟一次）。
5. 首次部署后执行一次种子（或在构建命令后追加 `&& npm --prefix server run seed`）。

> ⚠️ Render 免费版文件系统**重启会清空**：所以数据库必须接 Neon（外部持久化），图片建议接 R2。本地 SQLite / 本地 uploads 只用于开发冒烟。

## 四、数据库（Neon Postgres）

1. 注册 Neon，新建 project，拿到连接串（形如 `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`）。
2. 把该串填到 Render 的 `DATABASE_URL`。
3. 代码无需改动：`server/src/db.js` 检测到 `postgres://` 前缀自动切换 pg 驱动，表结构与本地一致。
4. 部署后跑一次种子：`npm --prefix server run seed`（创建 admin 与演示数据）。

## 五、图片存储（Cloudflare R2）

1. 注册 Cloudflare，开通 R2，新建 bucket，配置**公开访问**域名（或绑定自定义域）。
2. 在 Render 设置：`R2_ENDPOINT`（如 `https://<acctid>.r2.cloudflarestorage.com`）、`R2_ACCESS_KEY`、`R2_SECRET_KEY`、`R2_BUCKET`、`R2_PUBLIC_URL`。
3. 切换无需改业务代码：`server/src/storage.js` 检测到 R2 四项齐全即自动上传 R2，否则存本地兜底。
4. 注意：R2 免费额度需绑定支付方式，但**不产生费用**直到超出免费量；如不想用 R2，可保留本地兜底（仅开发/演示）。

## 六、前端部署（Netlify，绑定 yezhe.netlify.app）

1. Netlify 新建站点，连本仓库，构建配置：
   - Base directory：`client`
   - Build command：`npm install && npm run build`
   - Publish directory：`client/dist`
   - 或在 Netlify 控制台粘贴 `netlify.toml` 已写好的配置
2. 构建设置环境变量（或 `client/.env`）：`VITE_API_BASE=https://<你的render地址>.onrender.com`
3. 绑定自定义域名 `yezhe.netlify.app`（在 Netlify Domain settings）。
4. `netlify.toml` 已配置 `/* → /index.html` 重写，解决 SPA 刷新 404。
5. 前端每次激活会优先从后端拉取最新数据（见 `client/src/api.js`），Tab/筛选记忆仅存 `sessionStorage`，业务数据不以前端缓存为准。

## 七、微信小程序（原生 C 端，不使用 web-view）

架构：`微信原生小程序  ↔  Render 后端(同 Express) + Neon 数据库  ↔  商家 Web 后台(https://yezhe.netlify.app)`，三者共用一套数据库，数据双向实时同步。商家管理全部在网页后台完成，小程序只做 C 端浏览/预约/选片/成片/评价。

1. 打开微信开发者工具 → 导入项目 → 目录选 `miniprogram/`。
2. `project.config.json` 的 `appid` 改为你自己的小程序 AppID（测试期可用 `touristappid`，正式发布必须填真实 AppID）。
3. **request 合法域名**：在微信公众平台「开发管理 → 开发设置 → 服务器域名」的 **request 合法域名** 中添加后端 Render 的 HTTPS 域名（如 `https://xxx.onrender.com`）。uploadFile/downloadFile 域名按需添加（成片保存用 downloadFile）。
4. `miniprogram/utils/config.js` 把 `API_BASE` 改成 Render 分配的 https 域名（本地联调可临时改成局域网/公网地址）。
5. 小程序启动自动 `wx.login → /api/wx/login` 换 openid 并签发客户 token，客户接口自动带 `Authorization: Bearer <token>`。
6. TabBar 四个固定页：首页 / 作品 / 套餐 / 我的；其余页（预约/订单/选片/成片/评价/订阅）为非 tab 页，经 `navigateTo` 进入。
7. 详细对接、接口清单、安全边界、上线前 6 项校验见 `miniprogram/对接说明.md`。

**安全边界（强制）**：openid 不可信，客户 token 由后端签发；所有 `/api/customer/*` 按 token 中的可信 openid 做行级隔离，越权访问他人订单/相册/选片一律 403；小程序绝不调用商家内部接口（档期/财务/新建订单/批量导出）；作品/成片接口只返回 `sample`/`final` 小样，绝不返回 `local` 原片分区；`WX_SECRET` 只存在于后端环境变量，不下发前端。

## 八、功能自检清单

- [x] 后端 `/api/health` 返回 ok
- [x] 登录 admin/admin123 拿到 token
- [x] 工作台看板显示应收/实收/退款 + 待处理彩色块
- [x] 作品页：切换分类 Tab → 刷新页面/浏览器后退 → Tab 与筛选/页码恢复
- [x] 作品新建 → 列表出现 → 上传封面走 `/api/upload`
- [x] 相册三分区（本地原片路径 / 选片小样 / 精修）可写入
- [x] 选片保存 → 加片费用按梯度自动核算
- [x] 套系：CRUD + 增值定价 + 营销绑定 + 上下架 + 订单溯源 + 复用开单
- [x] 档期：月历排期 + 冲突拦截（同日同时段已占用返回 409）+ 派单 + 锁场
- [x] 订单中心：全生命周期 + 收款流水(payments) + 推进阶段 + 作废(不物理删除) + 退款 + 操作日志
- [x] 财务：营收汇总 / 月度报表 / 员工业绩 / 套系销量 / 资金流水
- [x] CORS 仅放行 yezhe.netlify.app
- [x] 大图超 15MB 被拦截提示
- [x] 微信 `code` 换 `openid` + 客户 token（或 DEBUG 兜底）
- [x] Netlify 部署后 `yezhe.netlify.app` 可访问，SPA 刷新不 404
- [x] C 端公开接口 `/api/works/public`、`/api/packages/public` 仅返回公开数据
- [x] C 端预约提交 → 后端落 `appointments` 表
- [x] C 端订单/相册/选片/评价均按 openid 行级隔离，越权 403、无 token 401
- [x] 原生小程序 10 页可编译运行（黑白简约摄影风、黑底白字导航栏、下拉刷新）

## 九、本期已交付 / 待续

**已交付（可运行）**：monorepo 骨架、DB 适配层（SQLite/Neon，零改业务代码）、JWT+RBAC、作品模块全 CRUD + 分类 + 相册三分区 + 选片计费、**套系管理**、**档期管理**、**订单中心全生命周期**、**财务管理**、首页看板、图片存储适配、前端深色侧栏布局、各模块 Tab 记忆、**微信登录（code→openid→客户 token）**、**C 端全套后端接口**（`/api/works/public`、`/api/packages/public`、`/api/wx/login`、`/api/customer/*` 行级隔离）、**微信原生小程序 10 页**（首页/作品/套餐/我的/预约/订单/选片/成片/评价/订阅）、部署文档与对接说明、**商家网页后台管理 UI**（预约管理/转订单、选片结果查看与修改、评价审核流转、成片下载开关 allow_download、订单关联 openid 列表）。

**下一迭代（可选增强）**：客户评价图片上传（后端已存 images 字段，前端小程序评价页可加选择）、分享海报/长图生成、预约时直接选套系并预填、选片结果导出。

## 十、上线部署

详细步骤见 **`DEPLOY.md`**（含 Render Blueprint `render.yaml`、Netlify 构建设置、微信 request 合法域名、自测清单、已知限制）。生产数据库填 `DATABASE_URL`(Neon Postgres) 自动切方言；图片持久化填 `R2_*` 四项（避免 Render 临时盘丢图）。小程序 `config.js` 的 `API_BASE` 上线前改为 Render https 域名，并取消开发者工具「不校验合法域名」。
