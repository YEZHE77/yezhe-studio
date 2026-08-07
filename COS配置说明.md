# 腾讯云 COS 图片存储配置说明

> 背景：Cloudflare R2 的 `*.workers.dev` 域名在**中国大陆直连不稳定**（需开代理才能访问），
> 导致小程序/网页图片加载失败。现把图片存储后端切换为**腾讯云 COS（S3 兼容）**，
> 国内 CDN 直连无需代理。R2 保留为兜底后端。

## 1. 代码已就绪（无需改代码）

存储层已做「全环境变量驱动 + provider 抽象」：

- 填齐 `COS_*` → 用 COS（优先）
- 未填 COS 但填齐 `R2_*` → 用 R2（兜底）
- 都未填 → 明确报错（绝不写本地磁盘）

所有业务逻辑（同步上传 → 算 hash → 写 media → 返回 URL、去重、前端压缩、缩略图、分片合并）保持不变。

## 2. 在 Render 配置环境变量

打开 Render 后端服务的 Environment，新增 / 修改以下变量（`.env.example` 中也有完整说明）：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `COS_SECRET_ID` | 腾讯云 API 密钥 SecretId | `AKIDxxxx` |
| `COS_SECRET_KEY` | 腾讯云 API 密钥 SecretKey | `xxxx` |
| `COS_BUCKET` | 桶名称 | `yezhe-studio-1250000000` |
| `COS_REGION` | 地域简称 | `ap-guangzhou` |
| `COS_CDN_DOMAIN` | 图片对外访问域名（桶默认域名或自定义加速域名，**末尾不要斜杠**） | `https://yezhe-studio-1250000000.cos.ap-guangzhou.myqcloud.com` |
| `COS_STORAGE_LIMIT` | 可选，存储告警阈值（字节），如 10GB=`10737418240` | 留空=不限 |

> 桶默认访问域名格式：`https://<bucket>.cos.<region>.myqcloud.com`
> 也可在 COS 控制台绑定自定义 CDN 加速域名（需备案），填那个域名到 `COS_CDN_DOMAIN` 即可。

配置后 Render 自动重启即生效，新上传的图片会落到 COS。

## 3. 微信小程序后台加域名（真机必做）

小程序后台 **开发 → 开发设置 → 服务器域名**，`downloadFile 合法域名` 增加：

- `https://yezhe-studio-server.onrender.com`
- 你的 `COS_CDN_DOMAIN`（如 `https://yezhe-studio-1250000000.cos.ap-guangzhou.myqcloud.com`）

（若仍保留 R2 兜底，也保留 `https://yezhe-img-proxy.yezhe128627.workers.dev`。）

同时把 `miniprogram/utils/config.js` 里的 `IMG_CDN` 填上你的 COS CDN 域名，便于真机诊断提示。

## 4. 迁移存量 R2 图片到 COS

历史已存 R2 的图片不会自动搬家。运行迁移脚本（需 `server/.env` 同时具备 R2_* 与 COS_*）：

```bash
# 先 dry 预览将迁移哪些 key
node scripts/migrate-r2-to-cos.mjs --dry

# 确认无误后正式迁移（相同 key 拷到 COS，并把数据库 URL 改写为 COS 域名）
node scripts/migrate-r2-to-cos.mjs
```

脚本幂等：COS 已有的 key 跳过下载；DB 已是 COS 域名的行跳过改写。迁移后旧 R2 对象可保留或手动清理。

## 5. 验证

- 后端 `/api/admin/storage` 应返回 `{"cloudEnabled":true,"provider":"cos","r2Enabled":false}`。
- 网页后台「容量管理」应显示 COS 真实桶用量。
- 真机扫码：相册/作品图片正常加载，无需代理。
