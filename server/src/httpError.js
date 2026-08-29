// httpError.js —— 后端统一错误出口（验收清单五.3 / 六.3 / 黑名单1）
//
// 背景：此前全后端有 302 处 `res.status(500).json({ error: e.message })`，
// 会把数据库报错原文（可能含 SQL、表结构、堆栈片段）直接返回给浏览器，
// 同时被前端 api.js 原样 toast 出来 —— 客户与后台都能看到原始错误。
//
// 约定（新增/修改接口时必须遵守）：
//   1) 任何未预期的异常，一律走 serverError(res, e, ctx)，只回通用文案给客户端；
//   2) 真实错误（含堆栈）只写服务端日志 console.error，便于排查；
//   3) 业务性失败请显式返回 4xx + 明确中文文案，不要扔给 serverError。
//
// 注意：4xx 业务错误（400/401/403/404/409/429）仍按各接口自己的文案返回，
// 本模块只负责「服务端内部错误」这一类。

export const SERVER_ERROR_MSG = '服务暂时繁忙，请稍后再尝试';

/**
 * 返回统一的 500 响应：客户端只看到通用文案，详细信息进服务端日志。
 * @param {object} res   Express response
 * @param {Error}  e      捕获到的异常
 * @param {string} ctx    可选上下文（如 'orders.list'），便于日志定位
 */
export function serverError(res, e, ctx = '') {
  try {
    // 服务端保留完整堆栈，供 Render 日志排查
    console.error('[serverError]' + (ctx ? ' ' + ctx : ''), e && e.stack ? e.stack : e);
  } catch (_) {
    /* 日志失败不影响响应 */
  }
  return res.status(500).json({ error: SERVER_ERROR_MSG });
}

/**
 * 统一的"无权查看"响应（验收清单二.4 / 黑名单：不能提示资源是否存在）。
 * 用于订单等需要防遍历探测的资源：无论「不存在」还是「不属于当前用户」，
 * 一律返回同一文案，避免攻击者据此枚举 ID。
 */
export const FORBIDDEN_VIEW_MSG = '您无权查看该内容';

export function forbiddenView(res) {
  return res.status(403).json({ error: FORBIDDEN_VIEW_MSG });
}

export default serverError;
