// pages/media/aiClient.js —— AI 调用层（OpenAI Chat-Completions 标准接口）
// 架构（对照《Skill + 大模型全链路互通实现规范》）：
//   - Skill 模板保存在后端（ai_skill 表）；runSkill 先请求 /api/ai/render 取「已用业务数据填好占位符」的完整 prompt；
//   - 本文件再用 OpenAI 兼容接口【直连】大模型（兼容 Ollama 本地 / 第三方 API），大模型永不接触数据库；
//   - 配置来源：Vite 环境变量 VITE_AI_BASE_URL / VITE_AI_API_KEY / VITE_AI_MODEL_NAME 为默认值，
//     localStorage 'media.aiConfig' 可运行时覆盖（用于在 OpenAI / Ollama / 第三方之间切换）。
import http from '../../api.js';
import { toast } from './toast.js';

// 合并配置：环境变量为默认，localStorage 覆盖（支持运行时切换 Ollama/第三方）
export function getAiConfig() {
  const env = {
    baseUrl: (import.meta.env && import.meta.env.VITE_AI_BASE_URL) || '',
    apiKey: (import.meta.env && import.meta.env.VITE_AI_API_KEY) || '',
    model: (import.meta.env && import.meta.env.VITE_AI_MODEL_NAME) || ''
  };
  let local = {};
  try { local = JSON.parse(localStorage.getItem('media.aiConfig') || '{}') || {}; } catch { local = {}; }
  return {
    baseUrl: local.baseUrl || env.baseUrl || '',
    apiKey: local.apiKey || env.apiKey || '',
    model: local.model || env.model || 'gpt-4o-mini'
  };
}

export function saveAiConfig(cfg) {
  try { localStorage.setItem('media.aiConfig', JSON.stringify(cfg || {})); } catch {}
}

// 前端直连 OpenAI 兼容接口（chat/completions）。失败抛错，由调用方统一 toast。
export async function runLLM({ system, user, temperature = 0.7, signal, cfg }) {
  const c = cfg || getAiConfig();
  if (!c.baseUrl || !c.apiKey) throw new Error('未配置 AI 接口（在「主页概览 → 配置 AI 接口」中设置）');
  const ctrl = signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 60000) : null;
  try {
    const res = await fetch(String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
      body: JSON.stringify({
        model: c.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system || '' },
          { role: 'user', content: user || '' }
        ],
        temperature
      }),
      signal: signal || (ctrl ? ctrl.signal : undefined)
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text || !String(text).trim()) throw new Error('模型返回为空');
    return String(text).trim();
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }
}

// 运行一个 Skill：后端渲染 prompt → 前端直连 LLM → 返回 { text, source }。
// source: 'ai' 成功；'fallback' 失败/未配置（返回 fallback 文本）。
// 异常统一捕获并 toast（规范第 6 条：AI 调用异常捕获，失败弹出 toast 提示）。
export async function runSkill(skillKey, context, { fallback = '', temperature = 0.7, signal } = {}) {
  const cfg = getAiConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { text: fallback, source: 'fallback', reason: 'no-config' };
  }
  try {
    const render = await http.post('/api/ai/render', { skill: skillKey, context: context || {} }, { skipToast: true });
    const payload = (render && render.data) || {};
    const text = await runLLM({ system: payload.system, user: payload.user, temperature, signal, cfg });
    return { text: text || fallback, source: 'ai' };
  } catch (e) {
    toast('AI 调用失败：' + (e && e.message ? e.message : '未知错误') + '（已用本地模板）', 'err');
    return { text: fallback, source: 'fallback', reason: 'error' };
  }
}
