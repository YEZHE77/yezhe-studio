// consistencyCheck.js —— 数据一致性自动巡检（每日凌晨定时 + 手动触发）
// 四类校验：档期冲突 / 精修超额 / 合同快照不匹配 / 套系开协议未绑模板
// 异常统一写入 consistency_issues 表（只存最近一次巡检清单），有异常时推送 system_message 提醒管理员。
import { query, get, insert, run } from './db.js';
import { emitMessage } from './routes/message.js';

// 合同快照比对字段（与前端 client/src/utils/contract.js 的 COMPARE_FIELDS 对齐）
const COMPARE_FIELDS = [
  'groom_name', 'bride_name', 'groom_phone', 'bride_phone', 'shoot_date', 'address',
  'shoot_position', 'total_negatives', 'retouch_count', 'album_electronic_num', 'album_price',
  'shoot_cost', 'quick_repair_cost', 'total_amount', 'deposit', 'balance',
  'pay_cash', 'pay_wechat', 'pay_alipay', 'pay_account_info', 'contract_extra_text'
];

// ① 档期冲突：同一日期 + 同一摄影师 存在多条 booked（历史脏数据兜底；正常流程保存时已拦截）
async function checkScheduleConflict() {
  const rows = await query(
    "SELECT id, date, order_no, photographer, executor_id, executor_name, groom_name, bride_name FROM schedules WHERE status = 'booked'"
  );
  const map = new Map();
  for (const r of rows) {
    const key = String(r.date || '') + '|' + (r.executor_id != null && r.executor_id !== '' ? String(r.executor_id) : String(r.photographer || ''));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const issues = [];
  for (const list of map.values()) {
    if (list.length > 1) {
      issues.push({
        type: 'schedule_conflict',
        rel_id: list.map((x) => x.order_no).filter(Boolean).join(','),
        summary: `档期冲突：${list[0].date} 同一天同摄影师存在 ${list.length} 个订单（${list.map((x) => x.order_no || ('#' + x.id)).join('、')}）`,
        detail: JSON.stringify(list.map((x) => ({ date: x.date, order_no: x.order_no, photographer: x.photographer || x.executor_name || '' })))
      });
    }
  }
  return issues;
}

// ② 精修超额：订单 order_photos.retouched 长度 > 订单 retouch_count（数据源=订单当前数值，0=不限）
async function checkRetouchExceed() {
  const rows = await query(
    "SELECT id, order_no, retouch_count, order_photos FROM orders WHERE cancelled = 0 AND is_deleted = 0 AND order_photos IS NOT NULL AND order_photos != ''"
  );
  const issues = [];
  for (const r of rows) {
    let photos = {};
    try { photos = JSON.parse(r.order_photos) || {}; } catch { continue; }
    const retouched = Array.isArray(photos.retouched) ? photos.retouched : [];
    const limit = Number(r.retouch_count) || 0;
    if (limit > 0 && retouched.length > limit) {
      issues.push({
        type: 'retouch_exceed',
        rel_id: String(r.order_no || r.id),
        summary: `精修超额：订单 ${r.order_no || r.id} 已上传精修 ${retouched.length} 张，超出额度 ${limit} 张`,
        detail: JSON.stringify({ order_id: r.id, uploaded: retouched.length, limit })
      });
    }
  }
  return issues;
}

// ③ 合同快照不匹配：存在有效 PDF，但订单业务字段已相对生成时快照变更（需手动重新生成）
async function checkContractStale() {
  const rows = await query(
    "SELECT * FROM orders WHERE contract_file_key IS NOT NULL AND contract_file_key != '' AND contract_invalid = 0 AND contract_order_snapshot IS NOT NULL AND contract_order_snapshot != ''"
  );
  const issues = [];
  for (const r of rows) {
    let snap = {};
    try { snap = JSON.parse(r.contract_order_snapshot) || {}; } catch { continue; }
    const changed = COMPARE_FIELDS.filter((f) => {
      const a = r[f] == null ? '' : String(r[f]);
      const b = snap[f] == null ? '' : String(snap[f]);
      return a !== b;
    });
    if (changed.length) {
      issues.push({
        type: 'contract_stale',
        rel_id: String(r.order_no || r.id),
        summary: `合同待更新：订单 ${r.order_no || r.id} 业务字段已变更（${changed.slice(0, 5).join('、')}${changed.length > 5 ? '等' : ''}），当前 PDF 未同步`,
        detail: JSON.stringify({ changed })
      });
    }
  }
  return issues;
}

// ④ 套系开启协议但未绑定合同模板（PRD 场景1.3 拦截的兜底巡检）
async function checkPkgMissingTemplate() {
  const rows = await query(
    "SELECT id, name, details, contract_template_id FROM packages WHERE details IS NOT NULL AND details != ''"
  );
  const issues = [];
  for (const r of rows) {
    let details = {};
    try { details = JSON.parse(r.details) || {}; } catch { continue; }
    if (details.customer_agreement_enabled && !r.contract_template_id) {
      issues.push({
        type: 'pkg_missing_template',
        rel_id: String(r.id),
        summary: `套系「${r.name || r.id}」已开启顾客协议但未绑定合同模板`,
        detail: JSON.stringify({ package_id: r.id, name: r.name })
      });
    }
  }
  return issues;
}

// ⑤ 选片统计漂移：task 缓存统计(like_count/exclude_count) vs mark 真实数据不一致 → 告警
async function checkSelectionStatsDrift() {
  const tasks = await query(
    "SELECT id, order_id, like_count, exclude_count FROM order_select_task WHERE status IN ('selecting','pending_payment','completed')"
  );
  const issues = [];
  for (const t of tasks) {
    const real = await get(
      "SELECT SUM(CASE WHEN status='keep' THEN 1 ELSE 0 END) AS keep, SUM(CASE WHEN status='reject' THEN 1 ELSE 0 END) AS reject FROM order_select_mark WHERE task_id = ?",
      [t.id]
    );
    const keep = Number(real.keep) || 0;
    const reject = Number(real.reject) || 0;
    if (keep !== Number(t.like_count) || reject !== Number(t.exclude_count)) {
      issues.push({
        type: 'selection_stats_drift',
        rel_id: String(t.order_id),
        summary: `选片统计漂移：订单 ${t.order_id} 缓存(保留${t.like_count}/淘汰${t.exclude_count}) 与真实标记(保留${keep}/淘汰${reject}) 不一致`,
        detail: JSON.stringify({ task_id: t.id, order_id: t.order_id, cached: { like: t.like_count, exclude: t.exclude_count }, real: { keep, reject } })
      });
    }
  }
  return issues;
}

// 主巡检：执行四类校验 → 异常入库（清空旧的，只存本次）→ 有异常推送提醒
export async function runConsistencyCheck() {
  const checkRun = new Date().toISOString();
  const all = [];
  const safe = async (name, fn) => { try { all.push(...await fn()); } catch (e) { console.error('[check] ' + name + ' 失败：', e.message); } };
  await safe('档期冲突', checkScheduleConflict);
  await safe('精修超额', checkRetouchExceed);
  await safe('合同快照', checkContractStale);
  // 跳过「套系绑定合同模板」巡检：顾客服务协议走默认文案快照（customer_agreement_enabled），与 contract_template（合同模板/PDF）是两套体系，
  // 套系开协议不要求必须绑 contract_template（用户复盘反馈：当前填写的就是固定/默认模板）。如未来需强制绑，自行开启下方注释。
  // await safe('套系绑定', checkPkgMissingTemplate);
  await safe('选片统计', checkSelectionStatsDrift);

  // 只存最近一次巡检异常清单（巡检报告反映当前状态，历史脏数据已实时拦截，无需累积）
  await run('DELETE FROM consistency_issues');
  for (const it of all) {
    await insert(
      'INSERT INTO consistency_issues (check_run, check_type, rel_id, summary, detail) VALUES (?,?,?,?,?)',
      [checkRun, it.type, it.rel_id, it.summary, it.detail]
    );
  }

  if (all.length) {
    await emitMessage({
      message_type: 'system',
      business_event: 'consistency_alert',
      title: `数据一致性巡检发现 ${all.length} 处异常`,
      content: all.map((x) => x.summary).join('\n').slice(0, 800),
      rel_id: checkRun.slice(0, 10),
      rel_model: 'system'
    });
  }

  const summary = {};
  for (const it of all) summary[it.type] = (summary[it.type] || 0) + 1;
  return { checkRun, total: all.length, summary, issues: all };
}

// 定时调度：每日凌晨 02:00（与每日备份 03:10 错开）
let _timer = null;
export function scheduleConsistencyCheck() {
  if (_timer) return;
  const run = async () => {
    try {
      const r = await runConsistencyCheck();
      console.log('[check] 巡检完成：', r.total, '处异常', JSON.stringify(r.summary));
    } catch (e) { console.error('[check] 巡检失败：', e.message); }
  };
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  const ms = 24 * 60 * 60 * 1000;
  setTimeout(() => { run(); _timer = setInterval(run, ms); }, delay);
  console.log('[check] 已调度每日数据一致性巡检，首次于', next.toISOString());
}
