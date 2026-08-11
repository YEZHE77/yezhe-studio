# GLM-Vision MCP（自己做的 MCP，底层调用 GLM-4.6V-Flash）

一个零依赖的 MCP 服务器，让 Codex 通过 `analyze_image` 工具直接“看图”。
底层调用智谱开放平台的**免费**视觉模型 `glm-4.6v-flash`
（OpenAI 兼容接口，128K 上下文，支持图片/视频/文件输入）。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `analyze_image` | 分析图片：传本地绝对路径或 http(s) 图片 URL，可单张或多张对比，返回详细描述 |
| `test_api` | 只发一条文本请求验证 API Key 是否有效，用于排查配置 |

## 安装步骤

### 1. 获取免费 API Key

1. 打开 [智谱开放平台 bigmodel.cn](https://bigmodel.cn) 注册并实名认证
2. 进入「API Keys」页面创建一个 Key（`glm-4.6v-flash` 模型免费，不扣费）

### 2. 注册到 Codex 配置

编辑 `~/.codex/config.toml`，追加：

```toml
[mcp_servers.glm_vision]
command = "/Users/zheye/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
args = ["/Volumes/勿删勿动/Codex/叶哲STUDIO管理后台开发/mcp/glm-vision/server.mjs"]
startup_timeout_sec = 60

[mcp_servers.glm_vision.env]
ZHIPU_API_KEY = "在这里粘贴你的智谱APIKey"
```

### 3. 重启 Codex

重启后新会话里即可直接说“用 analyze_image 看一下这张图”：

```text
用 analyze_image 分析 /Users/xx/Desktop/截图.png
```

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `ZHIPU_API_KEY` | 是 | 无 | 智谱 API Key |
| `GLM_API_BASE` | 否 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | 接口地址 |
| `GLM_MODEL` | 否 | `glm-4.6v-flash` | 模型 ID |

## 本地自测（不用重启 Codex）

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' |
  /Users/zheye/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /Volumes/勿删勿动/Codex/叶哲STUDIO管理后台开发/mcp/glm-vision/server.mjs
```

## 说明与限制

- 免费模型有速率限制，超限返回 429，稍后重试即可
- 单张图片最大 25MB；支持 png / jpg / webp / gif / bmp / svg / avif / ico / tiff
- 本地路径只读文件，不做任何上传，密钥仅保存在 `~/.codex/config.toml`，不进 Git
