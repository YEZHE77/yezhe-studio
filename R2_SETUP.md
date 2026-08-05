# 图片持久化配置：Cloudflare R2（私有桶）+ Worker 代理

## 为什么需要它
目前后端图片默认存 **Render 临时磁盘**，Render 免费档重启/重建会导致已上传图片丢失。
配置 R2 后图片永久保存（10GB 存储免费、流出流量免费），并通过 Cloudflare Worker 代理改善国内访问。

## 架构
```
小程序 / 网页端
   ↓ 只请求 Worker 代理域名（不直接请求 R2）
Cloudflare Worker（私有 R2 只读代理 + 30天缓存）
   ↓ 内网读取
Cloudflare R2 私有桶（不公开）
```
- **前端/小程序永远只拿到 Worker 代理 URL**，拿不到 R2 桶地址和密钥。
- Worker 仅做「读」代理，写入/删除只发生在 Render 后端（密钥只在服务端）。

## 桶目录规划
```
/biz-works/       公开工作室作品（封面、作品图）
/customer-demo/   客户相册选片小样（样片/原片/成片）
/temp-upload/     临时上传
```
原图（原始底片）**不上传 R2**，只在本地硬盘归档。

---

## 一、Cloudflare R2 配置
1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **R2** → **Create bucket**，桶名例如 `yezhe-studio-img`，**不要**开启公开访问。
2. 桶建好后 → **Settings** → 开 **Notifications / Usage alerts**（存储容量告警、A/B 操作告警），邮箱接收。
3. **Manage R2 API Tokens** → Create API token，拿到：
   - `Access Key ID` → `R2_ACCESS_KEY`
   - `Secret Access Key` → `R2_SECRET_KEY`
4. 桶详情页能看到 **S3 Endpoint**（含 account id），形如 `https://<accountid>.r2.cloudflarestorage.com` → 这就是 `R2_ENDPOINT`。
5. `R2_BUCKET` = 桶名 `yezhe-studio-img`。

## 二、部署 Worker 代理
仓库里已提供 `cloudflare/worker.js`（只读代理脚本）。
1. 安装 wrangler：`npm i -g wrangler`（或 `npx wrangler`）。
2. 复制 `cloudflare/wrangler.toml.example` 为 `cloudflare/wrangler.toml`，填入 `bucket_name` 与账号信息。
3. `wrangler login` → `wrangler deploy`。
4. 部署后你会得到一个免费子域，形如 `https://yezhe-img-proxy.<sub>.workers.dev`，这就是 `R2_WORKER_DOMAIN`（结尾不要带斜杠）。
   - 开发/体验模式：直接用这个免费子域即可，**无需买域名**。
   - 正式发布微信小程序：需要一个**已备案**域名托管在 Cloudflare，在域名 → Workers Routes 添加路由（如 `shturl.cc/Z/*`）指向该 Worker；`.cc` 等境外域名**无法备案**，不能用于微信正式版。

## 三、Render 后端填环境变量
Render 控制台 → `yezhe-studio-server` → **Environment** 新增/修改：
```
R2_ENDPOINT        = https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET          = yezhe-studio-img
R2_WORKER_DOMAIN   = https://yezhe-img-proxy.<sub>.workers.dev   （或你的备案域名路由）
R2_ACCESS_KEY      = <Access Key ID>
R2_SECRET_KEY      = <Secret Access Key>
```
⚠️ **填这些变量前，必须先完成第二步部署好 Worker**——否则图片会全部 404。
填好后 Render 自动重新部署，之后新上传的图片自动存 R2，数据库只保存 `Worker 域名/r2/...` 的 URL。

## 四、微信小程序 downloadFile 合法域名
小程序管理后台 → 开发 → 开发设置 → **downloadFile 合法域名** 加入 Worker 域名（如 `yezhe-img-proxy.<sub>.workers.dev`）。
正式发布时该域名必须已备案；开发预览勾选「不校验合法域名」即可跳过。

## 环境变量清单（Render）
| 变量 | 说明 |
|---|---|
| `R2_ENDPOINT` | R2 S3 Endpoint（含 accountId） |
| `R2_BUCKET` | 桶名 |
| `R2_WORKER_DOMAIN` | Worker 代理域名（数据库保存此值） |
| `R2_ACCESS_KEY` | R2 API Access Key |
| `R2_SECRET_KEY` | R2 API Secret Key |

五项齐全才启用 R2；任意缺失则回退到本地磁盘（兼容现有行为）。

## 成本
- R2 免费：10GB 存储 / 100万 A 类写 / 1000万 B 类读 / **流出流量免费**。
- Worker 免费：每日 10 万请求。本项目图片量完全够用。
- 约束：只存压缩小样（宽度 200–1200px），原图本地归档，保持在免费额度内 + 开用量告警。
