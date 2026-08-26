// routes/clientError.js —— 三端统一前端异常收集 + 告警分发
// POST /           收集前端上报的结构化异常报告（公开，无需登录）
// GET  /           后台查看异常列表（需管理员登录），支持 page / end / severity 过滤
//
// 告警分发（当任一端出现运行异常 / 接口报错 / 兼容性故障 / 崩溃时）：
//   1) 始终入库 client_error_log（审计留痕，最近 5000 条自动轮转）
//   2) 若配置了 ALERT_WEBHOOK_URL 环境变量 → POST 结构化报告到该「指定监控/告警渠道」
//      （如自建告警网关 / Feishu-ScP / Slack-ScP 等接收 JSON 的中介；格式见下方 buildWebhookPayload）
//   3) 始终再发一条内部 biz_message（sub_type=client_error）到 B 端消息中心，
//      作为开箱即用的兜底告警渠道（无需任何配置即可在「消息」Tab 看到前端异常）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import { emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';

const router = Router();

// 内部告警去重：相同 type|end|message 在 5 分钟内只发一次内部消息，避免崩溃循环刷屏
const alertThrottle = new Map();
const ALERT_THROTTLE_MS = 5 * 60 * 1000;

const END_LABEL = { mobile: '移动端', desktop: '桌面端', cend: 'C端客户', unknown: '未知端' };
const TYPE_LABEL = {
  js: 'JS 运行时错误',
  unhandledrejection: '未处理 Promise 拒绝',
  react_boundary: 'React 渲染崩溃',
  api: '接口错误'
};

function str(v, max) { return String(v == null ? '' : v).slice(0, max); }

// 严重级别：渲染崩溃 / 5xx 接口错误视为 high，其余 normal
function severityOf(type, status) {
  if (type === 'react_boundary') return 'high';
  if (type === 'api' && typeof status === 'number' && status >= 500) return 'high';
  return 'normal';
}

function buildWebhookPayload(report) {
  const text = `[${END_LABEL[report.end] || report.end}] ${TYPE_LABEL[report.type] || report.type}\n` +
    `时间：${report.timestamp}\n` +
    `路由：${report.url}\n` +
    `信息：${report.message}\n` +
    (report.context ? `上下文：${report.context}` : '');
  return { ...report, text, source: 'yezhe-studio-client' };
}

// 异步、尽力而为地分发告警（绝不阻塞上报主流程）
async function dispatchAlert(report, opts = {}) {
  // 1) 指定监控/告警渠道（可配置 webhook）
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWebhookPayload(report)),
        signal: ctrl.signal
      }).catch(() => {});
      clearTimeout(timer);
    } catch { /* 告警渠道不可达不影响主流程 */ }
  }

  // 2) 内部兜底：B 端消息中心（开箱即用，无需配置）
  //    E2E 探针（message 以 E2E_PROBE: 开头）仅验证入库链路，不向消息中心发告警，避免污染。
  if (opts.skipInternal) return;
  try {
    const key = `${report.type}|${report.end}|${report.message}`;
    const now = Date.now();
    const last = alertThrottle.get(key) || 0;
    if (now - last < ALERT_THROTTLE_MS) return;
    alertThrottle.set(key, now);
    await emitBizToStaff({
      title: `【前端异常·${END_LABEL[report.end] || report.end}】${TYPE_LABEL[report.type] || report.type}`,
      content: `${report.message}\n路由：${report.url}\n时间：${report.timestamp}`,
      biz_type: BIZ_TYPE.SYSTEM,
      sub_type: 'client_error',
      biz_extra: JSON.stringify({ type: report.type, end: report.end, severity: report.severity })
    });
  } catch { /* 内部告警失败不阻塞 */ }
}

// POST /api/client-error —— 收集前端异常
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const type = str(b.type || 'js', 30) || 'js';
    const end = ['mobile', 'desktop', 'cend', 'unknown'].includes(b.end) ? b.end : 'unknown';
    const message = str(b.message || '未知错误', 500);
    const stack = str(b.stack || '', 4000);
    const url = str(b.url || '', 500);
    const ua = str(b.ua || '', 500);
    const appVersion = str(b.appVersion || '', 50);
    const context = str(b.context || '', 2000);
    const clientTs = str(b.timestamp || new Date().toISOString(), 50);
    const severity = severityOf(type, b.status);

    if (!message) return res.status(400).json({ error: 'message 不能为空' });

    // 列名 end 是 PostgreSQL 保留字，必须用双引号 "end" 转义（详见 schema.js 注释）。
    const id = await insert(
      `INSERT INTO client_error_log (type, "end", severity, message, stack, url, ua, app_version, context, client_ts)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [type, end, severity, message, stack, url, ua, appVersion, context, clientTs]
    );

    // 异步分发告警（webhook + 内部消息）
    // E2E 探针不向消息中心发告警；api 类型的网络/超时错误（status 为空，通常是 Render 冷启动或用户网络抖动）
    // 只入库 + webhook，不向 B 端消息中心发系统通知，避免非关键超时刷屏。
    const isNetworkTimeout = type === 'api' && !b.status && /\b(timeout|network|ECONNABORTED|ERR_NETWORK)\b/i.test(message);
    const skipInternal = message.startsWith('E2E_PROBE:') || isNetworkTimeout;
    dispatchAlert({ id, type, end, severity, message, stack, url, ua, appVersion, context, timestamp: clientTs }, { skipInternal }).catch(() => {});

    // 自动轮转：超过 5000 条保留最近 5000 条
    try {
      const cnt = (await get('SELECT COUNT(*) AS c FROM client_error_log')).c;
      if (Number(cnt) > 5000) {
        await run(`DELETE FROM client_error_log WHERE id NOT IN (SELECT id FROM client_error_log ORDER BY id DESC LIMIT 5000)`);
      }
    } catch { /* 轮转失败不影响上报 */ }

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/client-error —— 后台查看异常列表（管理员）
router.get('/', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const end = str(req.query.end || '', 20);
    const severity = str(req.query.severity || '', 20);
    const where = [];
    const params = [];
    if (end) { where.push('"end" = ?'); params.push(end); }
    if (severity) { where.push('severity = ?'); params.push(severity); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get(`SELECT COUNT(*) AS c FROM client_error_log ${whereSql}`, params)).c;
    const rows = await query(
      `SELECT id, type, "end", severity, message, url, app_version, client_ts, created_at
       FROM client_error_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ total, page, pageSize, list: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
