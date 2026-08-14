# 岛像工作室 — 摄影工作室全链路管理系统

> Codex 交接文档。本文件是项目入口，请先完整阅读再开始工作。

## 项目概述

对标「拾光盒子」的摄影工作室 B 端后台 + C 端微信小程序。覆盖客片管理、订单全生命周期、档期排班、套系定价、财务流水、在线选片、电子相册、客户预约等全链路。

**原则**：全程零付费第三方服务、无 VIP 弹窗、无本地 file:// 依赖、图片全部输出 HTTPS 网络地址。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + Vite 5 + TailwindCSS 3 + react-router-dom 6 + axios | SPA，打包纯静态 |
| 后端 | Node 20 + Express 4 + pg + bcryptjs + multer + lunar-javascript + qrcode | ESM 模块，零 TypeScript |
| 数据库 | Neon Postgres（生产）/ SQLite（开发，node:sqlite） | `server/src/db.js` 自动检测 `DATABASE_URL` 前缀切换 |
| 图片存储 | 腾讯云 COS（优先）→ Cloudflare R2（兜底） | `server/src/storage.js` 环境变量驱动，绝不写本地磁盘 |
| 前端托管 | Cloudflare Pages | 自动构建，域名 `yezhe-studio.pages.dev` |
| 后端托管 | Render 免费版 | 域名 `yezhe-studio-server.onrender.com` |
| 小程序 | 微信原生小程序 | 4 页 + 2 分包，不使用 web-view |

## 目录结构

```
摄影工作室管理系统/
├── client/                    # React 前端
│   ├── src/
│   │   ├── App.jsx            # 路由定义（B端 + 公共H5路由）
│   │   ├── api.js             # axios 实例 + img()/uploadBatch()/conflictOf()
│   │   ├── auth.jsx           # AuthProvider + useAuth()
│   │   ├── bgm.js             # 背景音乐单例
│   │   ├── tabMemory.js       # 页面Tab记忆（分类筛选等）
│   │   ├── index.css          # Tailwind 指令 + 全局样式
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx    # 左侧导航（PC展开/移动端折叠）
│   │   │   └── Topbar.jsx     # 顶部导航栏
│   │   ├── components/
│   │   │   ├── Icon.jsx       # 线性SVG图标集（viewBox="0 0 24 24"）
│   │   │   ├── OrderCreateModal.jsx  # 新建订单弹窗（672px）
│   │   │   ├── CropperModal.jsx      # 图片裁剪弹窗
│   │   │   ├── Slideshow.jsx          # 全屏幻灯片播放
│   │   │   ├── AlbumGrid.jsx          # 相册网格（双端共用）
│   │   │   ├── GalleryAlbum.jsx       # 电子相册组件
│   │   │   ├── Lightbox.jsx           # 图片预览
│   │   │   ├── Breadcrumb.jsx
│   │   │   ├── Chart.jsx              # SVG 图表
│   │   │   └── ErrorBoundary.jsx
│   │   └── pages/             # 25 个页面组件
│   │       ├── Dashboard.jsx       # 工作台首页
│   │       ├── Orders.jsx          # 订单列表
│   │       ├── OrderDetail.jsx     # 订单详情（/orders/:id）
│   │       ├── Schedule.jsx        # 档期管理（月历视图）
│   │       ├── Works.jsx           # 作品列表
│   │       ├── WorkDetail.jsx     # 作品编辑/详情
│   │       ├── Packages.jsx        # 套系列表
│   │       ├── PackageEdit.jsx    # 套系编辑（4 Tab）
│   │       ├── Finance.jsx        # 财务管理
│   │       ├── Customers.jsx      # 客户管理
│   │       ├── Categories.jsx     # 分类管理
│   │       ├── Channels.jsx      # 渠道管理
│   │       ├── Appointments.jsx   # 预约管理
│   │       ├── Reviews.jsx        # 评价审核
│   │       ├── Settings.jsx       # 系统设置（多Tab）
│   │       ├── SelectionAdmin.jsx # 在线选片管理
│   │       ├── CapacityManagement.jsx # 容量管理
│   │       ├── DataCharts.jsx     # 数据统计图表
│   │       ├── BusinessCard.jsx   # 生成名片
│   │       ├── ShareAlbum.jsx     # 分享相册H5
│   │       ├── Home.jsx           # C端首页H5
│   │       ├── My.jsx             # C端我的H5
│   │       ├── WorkPublic.jsx     # C端作品公开页
│   │       └── Login.jsx          # 登录页
│   ├── vite.config.js        # BUILD_ID 机制（git short hash 追加产物文件名）
│   ├── tailwind.config.js
│   ├── _headers              # Cloudflare Pages 缓存头
│   └── index.html
├── server/                   # Express 后端
│   ├── src/
│   │   ├── index.js          # 入口：CORS/multer/路由挂载（22个路由模块）
│   │   ├── db.js             # 数据库适配层（SQLite/Postgres 自动切换）
│   │   ├── schema.js         # 建表SQL（SQLite + Postgres 双语法）
│   │   ├── seed.js           # 种子数据（admin/admin123）
│   │   ├── auth.js           # JWT + RBAC（adminRequired/customerRequired）
│   │   ├── storage.js        # 图片存储适配（COS优先 → R2兜底）
│   │   ├── env.js            # 环境变量集中读取
│   │   ├── cf.js             # Cloudflare API 助手
│   │   ├── wx.js             # 微信 code2session
│   │   ├── r2Metrics.js      # R2 容量统计
│   │   ├── shareUtil.js      # 分享token生成
│   │   ├── backup.js         # 数据备份
│   │   ├── miniQr.js         # 小程序码生成
│   │   └── routes/           # 22 个路由模块
│   │       ├── auth.js       # 登录/注册
│   │       ├── orders.js     # 订单全生命周期
│   │       ├── packages.js   # 套系CRUD/规格/上下架
│   │       ├── works.js      # 作品/相册/选片
│   │       ├── schedules.js  # 档期/冲突/锁场
│   │       ├── finance.js    # 营收/周期/业绩/销量
│   │       ├── customer.js   # C端客户接口（行级隔离）
│   │       ├── admin.js      # 管理接口
│   │       ├── categories.js # 分类管理
│   │       ├── channels.js   # 渠道管理
│   │       ├── galleries.js  # 电子相册
│   │       ├── shares.js     # 分享管理
│   │       ├── share.js      # 分享网关（公开访问）
│   │       ├── settings.js   # 系统设置
│   │       ├── stats.js     # 统计数据
│   │       ├── payments.js  # 收款流水
│   │       ├── selection.js # 在线选片
│   │       ├── albums.js    # 相册管理
│   │       ├── uploadFile.js   # 单文件上传
│   │       ├── uploadChunk.js  # 分片上传
│   │       ├── health.js    # 健康检查
│   │       └── wx.js        # 微信登录
│   ├── data/                # SQLite 文件（开发用，.gitignore）
│   └── package.json
├── miniprogram/             # 微信原生小程序
│   ├── app.js / app.json     # 分包配置
│   ├── pages/
│   │   ├── index/           # 首页
│   │   ├── works/           # 作品列表
│   │   ├── package/         # 套系
│   │   └── my/              # 我的
│   ├── pkg/                 # 分包
│   │   ├── order/          # 订单
│   │   └── appointment/    # 预约
│   ├── components/
│   │   ├── customNav/      # 自定义导航栏
│   │   └── slideshow/      # 全屏幻灯片
│   └── utils/
│       ├── req.js          # 请求封装（超时+重试+取消）
│       ├── bgm.js         # 背景音乐
│       ├── config.js      # API 地址
│       └── imageUrl.js    # 图片URL处理
├── cloudflare/              # Cloudflare Worker 脚本
│   ├── worker.js           # 图片代理 + 缩略图裁剪
│   └── upload-worker.js    # 直传 Worker
├── scripts/
│   ├── migrate-r2-to-cos.mjs
│   └── verify-*.mjs        # 验证脚本
├── package.json             # monorepo 根
├── .env.example             # 环境变量模板
├── .gitignore
├── netlify.toml             # 前端部署配置（历史保留）
├── render.yaml              # Render 部署配置
├── README.md                # 完整部署文档
├── 记录日志.md               # 开发日志
└── AGENTS.md                # ← 本文件
```

## 开发命令

```bash
# 安装全部依赖
npm run install:all

# 启动后端（默认 SQLite，端口 4000）
npm run dev:server

# 启动前端（端口 5173，代理 /api → 4000）
npm run dev:client

# 构建前端（产出 client/dist/）
npm run build

# 初始化数据库 + 种子数据
npm run seed

# 启动后端生产模式
npm run start
```

登录账号：`admin` / `admin123`（seed 生成）

## 部署管线

```
GitHub push main
  ├─→ Cloudflare Pages 自动构建前端 → yezhe-studio.pages.dev
  └─→ Render 自动部署后端 → yezhe-studio-server.onrender.com
```

### 前端构建（Cloudflare Pages）

- 构建命令：`npm run install:all && npm run build`
- 输出目录：`client/dist`
- `vite.config.js` 的 `getBuildId()` 取 `git rev-parse --short HEAD` 追加到所有 chunk 文件名（如 `OrderDetail-a1b2c3d.js`），规避强缓存
- `_headers` 文件设置静态资源缓存头

### 后端部署（Render）

- Start Command：`npm --prefix server install && node server/src/index.js`
- 环境变量见 `.env.example`
- Render 免费版会休眠，需外部 ping `/api/health` 保活

## 数据库适配层

`server/src/db.js` 核心逻辑：

```javascript
const DATABASE_URL = process.env.DATABASE_URL || '';
export const dialect = DATABASE_URL.startsWith('postgres') ? 'pg' : 'sqlite';
// pg → node:pg Pool + $1/$2 占位符
// sqlite → node:sqlite DatabaseSync + ? 占位符
// toPg() 函数把 ? 转成 $1.. 格式
```

业务代码统一用 `?` 占位符 + `query(sql, params)` 调用，适配层自动转换。**禁止在业务代码中直接使用 `$1` 占位符。**

## 图片存储适配

`server/src/storage.js` 优先级：

1. 腾讯云 COS（`COS_*` 环境变量齐全时启用）— 国内 CDN，大陆直连
2. Cloudflare R2（`R2_*` 环境变量齐全时启用）— 兜底
3. 都未配置 → **报错，绝不写本地磁盘**

业务代码统一调用 `uploadBuffer(buffer, key, contentType)` 和 `deleteObject(key)`，无需关心底层。

## 编码规范（硬约束）

### 1. 禁止字体加粗

```javascript
// 禁止
fontWeight: 500
fontWeight: 600
fontWeight: 'bold'
className="font-bold"

// 正确
fontWeight: 400   // 或省略，默认 400
```

全项目统一 `fontWeight: 400`，包括标题、标签、按钮、数值。**这是最高优先级规范，违反即视为构建失败。**

### 2. 样式写法

- 内联 `style={{}}` 与 Tailwind 原子类混用
- 复杂布局用内联 style，简单间距/颜色用 Tailwind
- 设计令牌以 JS 常量定义在文件顶部：

```javascript
const TEAL = '#0D9488';
const BLUE = '#3B82F6';
const DIV = '#E5E7EB';
const CARD_BORDER = '#F0F0F0';
const TEXT_MAIN = '#222222';
const LABEL_COLOR = '#666666';
const CARD_BG = '#FFFFFF';
const PAGE_BG = '#F7F7F7';
```

### 3. SVG 图标

- 统一使用 `components/Icon.jsx` 组件
- 所有图标 `viewBox="0 0 24 24"`
- 线性风格，`stroke="currentColor"`，`fill="none"`
- 图标尺寸统一 `width={iconSize} height={iconSize}`，`iconSize` 默认 16

### 4. 弹窗规范

- 弹窗蒙层点击**不关闭**（防止误触丢数据）
- 弹窗宽度参考：新增订单 672px，编辑订单 700px，通用 480px
- 弹窗内容区最大高度 `70vh`，超出滚动

### 5. API 调用

- 统一通过 `src/api.js` 的 `http` 实例（axios）
- 请求超时 15s，上传超时 120s
- 图片地址转换统一用 `img(url)` 函数
- 分片上传用 `uploadBatch(files, opts)`

### 6. 订单状态单一数据源（最高优先级，与字体规范同级）

订单「当前阶段」在系统内有多套并行表示，**极易出现"详情页显示 X、列表显示 Y、待办显示 Z"的错位**。必须遵守：

- **前端进度条**：`client/src/pages/OrderDetail.jsx` 的 `ORDER_STEPS_11`（11 步 + 每步 kws 关键词）是**前端唯一权威**，`STEP_ACTIONS` 写入日志的文本必须能被对应步骤的 `kws` 命中。
- **后端统计/过滤**：`server/src/routes/stats.js` 与 `server/src/routes/orders.js` 里所有 `LIKE '%…%'` 状态关键词，必须是 `ORDER_STEPS_11.kws` 的子集（`scripts/check-order-status-consistency.mjs` 自动校验）。
- **改动任何一处**（新增步骤 / 改关键词 / 改 STEP_ACTIONS 写什么日志），必须同步其余各处，并跑 `node scripts/check-order-status-consistency.mjs` 确认全绿。
- **双壳路由**：`App.jsx` 与 `MobileShell.jsx` 的 B 端业务路由（works/packages/schedule/orders 等前缀）必须成对注册，尤其 `*/new` 这类新建路由。检查脚本同样覆盖。

## 当前状态

### 已完成模块

- [x] B 端后台 25 个页面（Dashboard/Orders/Schedule/Works/Packages/Finance/Customers 等）
- [x] C 端微信小程序（首页/作品/套系/我的 + 分包：订单/预约）
- [x] 后端 22 个 API 路由模块
- [x] 订单全生命周期（11步工作流状态机 + 4步展示进度条）
- [x] 套系 4-Tab 编辑（基本信息/服务详情/规格/分享）
- [x] 档期月历视图 + 冲突检测 + 锁场
- [x] 财务管理（营收/周期/业绩/销量/流水导出）
- [x] 在线选片 + 加片核算
- [x] 电子相册 + 全屏幻灯片
- [x] 图片存储（COS/R2 双后端 + 分片上传 + 重复检测）
- [x] 分享二维码 + 公开访问网关
- [x] 客户预约 + 日历选择
- [x] 合同范本 + 生成 + 快照
- [x] 数据统计图表（SVG）
- [x] 容量管理 + 清理

### 待续工作

- [ ] 后端：接受预约需收定金才建单/锁档期
- [ ] 小程序：首页与列表骨架屏
- [ ] 小程序：分包优化
- [ ] R2 → COS 迁移脚本（scripts/migrate-r2-to-cos.mjs 已有骨架）
- [ ] 订单详情页 UI 细节打磨（部分 fontWeight 违规待清理）

## 禁止事项

1. **禁止提交 `.env` 文件**（仅提交 `.env.example`）
2. **禁止提交 `.workbuddy/` 目录**（已在 .gitignore）
3. **禁止提交 `server/data/` 下的 SQLite 文件**
4. **禁止提交 `node_modules/`**
5. **禁止引入付费第三方服务**（全项目零成本原则）
6. **禁止在业务代码中写死数据库占位符语法**（用 `?`，适配层转换）
7. **禁止使用 `fontWeight > 400` 或 `font-bold`**
8. **禁止使用本地 `file://` 路径**（图片必须 HTTPS 网络地址）

## 发布约定

用户要求修改线上产品时：完成相关校验后，将本次变更提交并推送到 `main`。该仓库的 Cloudflare Pages 会由 GitHub 推送自动发布到 `https://yezhe-studio.pages.dev`。

提交前请仅包含本次任务相关文件，并在交付时说明构建与发布结果。

### 提交前校验清单

```bash
# 1. 前端构建通过
npm run build

# 2. 后端语法检查
node --check server/src/index.js

# 3. 双壳路由 + 订单状态关键词一致性（防漏注册 / 防前后端语义分叉）
node scripts/check-order-status-consistency.mjs

# 4. 确认无 fontWeight 违规
grep -rn 'fontWeight.*[5-9]00\|fontWeight.*bold\|font-bold' client/src/ --include='*.jsx'

# 5. 确认无 .env / .workbuddy 被暂存
git diff --cached --name-only | grep -E '\.env|\.workbuddy'
```

## GitHub 仓库

- 仓库地址：`https://github.com/YEZHE77/yezhe-studio`
- 分支：`main`（唯一长期分支）
- 线上前端：`https://yezhe-studio.pages.dev`
- 线上后端：`https://yezhe-studio-server.onrender.com`
