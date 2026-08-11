#!/usr/bin/env node
/**
 * GLM-Vision MCP Server
 * 零依赖 stdio MCP 服务，底层调用智谱免费视觉模型 glm-4.6v-flash
 * （OpenAI 兼容接口：POST https://open.bigmodel.cn/api/paas/v4/chat/completions）
 *
 * 环境变量：
 *   ZHIPU_API_KEY  （必填）智谱开放平台 API Key
 *   GLM_API_BASE   （可选）接口地址，默认 https://open.bigmodel.cn/api/paas/v4/chat/completions
 *   GLM_MODEL      （可选）模型 ID，默认 glm-4.6v-flash
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || "";
const API_BASE =
  process.env.GLM_API_BASE ||
  "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = process.env.GLM_MODEL || "glm-4.6v-flash";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB 单图上限

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

/* ============================ MCP 协议（stdio JSON-RPC 2.0） ============================ */

let buffer = "";
let pendingOps = 0;
let stdinEnded = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // 忽略坏消息
    }
    pendingOps++;
    handleMessage(msg).finally(() => {
      pendingOps--;
      maybeExit();
    });
  }
});
process.stdin.on("end", () => {
  stdinEnded = true;
  maybeExit();
});

function maybeExit() {
  if (stdinEnded && pendingOps === 0) process.exit(0);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(msg) {
  const { id, method, params = {} } = msg;
  if (!method) return;
  try {
    switch (method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "glm-vision", version: "1.0.0" },
          },
        });
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        // 通知无需响应
        break;
      case "ping":
        send({ jsonrpc: "2.0", id, result: {} });
        break;
      case "tools/list":
        send({
          jsonrpc: "2.0",
          id,
          result: { tools: [ANALYZE_IMAGE_TOOL, TEST_API_TOOL] },
        });
        break;
      case "tools/call": {
        const { name, arguments: args = {} } = params;
        if (name === "analyze_image") {
          const text = await analyzeImage(args);
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        } else if (name === "test_api") {
          const text = await testApi(args);
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        } else {
          send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `未知工具: ${name}` },
          });
        }
        break;
      }
      default:
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `不支持的方法: ${method}` },
        });
    }
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: String(err?.message || err) },
    });
  }
}

/* ============================ 工具定义 ============================ */

const ANALYZE_IMAGE_TOOL = {
  name: "analyze_image",
  description:
    "调用智谱免费视觉模型 GLM-4.6V-Flash 分析图片。支持本地绝对路径或 http(s) 图片 URL，可传单张或多张（多图对比）。返回模型对图片的详细文字描述。",
  inputSchema: {
    type: "object",
    properties: {
      images: {
        type: ["string", "array"],
        items: { type: "string" },
        description:
          "图片来源：本地绝对路径（如 /Users/xx/1.png）或 http(s):// URL。多张图传数组。",
      },
      prompt: {
        type: "string",
        description:
          "自定义分析指令。默认：详细描述图片的布局、文字、颜色、元素位置与细节。",
      },
      thinking: {
        type: "boolean",
        description: "是否开启模型思考模式（默认关闭；开启更深入但响应更慢）。",
      },
      temperature: {
        type: "number",
        description: "采样温度 0~2，默认 0.6。",
      },
    },
    required: ["images"],
  },
};

const TEST_API_TOOL = {
  name: "test_api",
  description:
    "测试智谱 API Key 是否有效（发送一条纯文本请求）。用于排查配置问题，不涉及图片。",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "发送的测试文本，默认：请回复 OK。" },
    },
  },
};

/* ============================ 核心逻辑 ============================ */

function assertKey() {
  if (!API_KEY) {
    throw new Error(
      "未配置智谱 API Key。请在 ~/.codex/config.toml 的 [mcp_servers.glm_vision.env] 中设置 ZHIPU_API_KEY，然后重启 Codex。注册免费 Key：https://bigmodel.cn"
    );
  }
}

async function toDataUri(input) {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) return s; // 远程 URL 直接透传
  const resolved = path.resolve(s);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`图片不存在或不是文件: ${s}`);
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），超过 25MB 上限: ${s}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`不支持的文件类型 ${ext || "(无扩展名)"}，支持: ${Object.keys(MIME_BY_EXT).join(" ")}`);
  }
  const b64 = (await fs.readFile(resolved)).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function callGLM(messages, opts = {}) {
  assertKey();
  const body = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0.6,
  };
  if (opts.thinking) {
    body.thinking = { type: "enabled" };
  }
  let res;
  try {
    res = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`请求智谱接口失败（网络/超时）: ${err.message}`);
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const hint =
      res.status === 401
        ? "API Key 无效，请到 https://bigmodel.cn 检查并重新生成。"
        : res.status === 429
          ? "触发免费模型速率限制，请稍后重试。"
          : "";
    throw new Error(
      `智谱接口返回 ${res.status} ${hint} ${data?.error?.message || data?.error || raw.slice(0, 300)}`
    );
  }
  const content = data?.choices?.[0]?.message?.content ?? "";
  const reasoning = data?.choices?.[0]?.message?.reasoning_content ?? "";
  const text = String(content).trim();
  if (text) return text;
  if (reasoning) return `[仅返回思考过程] ${String(reasoning).trim()}`;
  throw new Error(`模型未返回有效内容: ${raw.slice(0, 300)}`);
}

async function analyzeImage(args) {
  const { images, prompt, thinking, temperature } = args;
  const list = Array.isArray(images) ? images : [images];
  if (!list.length) throw new Error("images 不能为空");
  const parts = await Promise.all(list.map(toDataUri));
  const content = [
    {
      type: "text",
      text:
        prompt ||
        (parts.length === 1
          ? "请详细描述这张图片：整体布局、所有可见文字、颜色、元素位置、按钮/控件以及细节。"
          : `请逐张描述并对比这 ${parts.length} 张图片：整体布局、可见文字、颜色、元素位置与差异细节。`),
    },
    ...parts.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  return callGLM([{ role: "user", content }], { thinking, temperature });
}

async function testApi(args) {
  const prompt = args?.prompt || "请只回复两个字母：OK";
  return callGLM(
    [{ role: "user", content: [{ type: "text", text: prompt }] }],
    { temperature: 0.2 }
  );
}

/* 启动时打印一行日志（可被 Codex 忽略，不影响协议） */
process.stderr.write(
  `[glm-vision] ready, model=${MODEL}, api_key=${API_KEY ? "set" : "MISSING"}\n`
);
