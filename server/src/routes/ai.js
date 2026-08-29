// routes/ai.js —— AI Skill 模板服务（后端内部 Prompt 模板，前端直连大模型）
// 职责边界（对照《Skill + 大模型全链路互通实现规范》）：
//   1) Skill 模板（system_prompt / user_template + {{占位符}}）全部保存在后端 ai_skill 表，可经 /api/ai/skills 管理；
//   2) 本路由【不调用】任何大模型：/render 仅按 skill 取业务数据填充占位符，返回完整 { system, user } prompt；
//   3) 真正的大模型推理由 Web 运行时（client/src/pages/media/aiClient.js）用 OpenAI 兼容接口独立完成，
//      大模型永远不直接访问数据库——DB 读写只在本后端业务接口内发生。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

// ---------- 工具 ----------
function str(v, d = '') { return v == null ? d : String(v); }
function num(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function jstr(v) { if (v == null) return ''; if (Array.isArray(v)) return JSON.stringify(v); if (typeof v === 'string') return v; return JSON.stringify(v); }

// 占位符替换（null 安全：缺失/空值替换为空串，绝不让 {{x}} 透传到大模型）
function fill(tpl, data) {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => {
    const v = data == null ? null : data[k];
    if (v == null) return '';
    if (Array.isArray(v)) return v.join('\n');
    return String(v);
  });
}

// 各 Skill 的业务数据绑定：返回占位符数据 map（部分来自 DB，部分来自前端传入的 context）
// —— 此处是「后端取出业务数据」的唯一入口，大模型拿到的只有填充后的文本。
async function bindData(skill, context) {
  const c = context || {};
  switch (skill) {
    case 'inspiration_parse':
      // 纯前端输入：粘贴的链接 / 文案，无 DB 依赖
      return { url: str(c.url), rawText: str(c.rawText) };
    case 'topic_generate': {
      const id = num(c.inspirationId);
      const ins = id ? await get('SELECT * FROM media_inspiration WHERE id = ? AND deleted = 0', [id]) : null;
      return {
        inspirationTitle: ins ? str(ins.title) : '(未提供)',
        inspirationContent: ins ? str(ins.content) : '(未提供)',
        painPoints: ins ? str(ins.content) : '(未提供)',
        sourceType: ins ? str(ins.source_type) : '(未提供)'
      };
    }
    case 'draft_generate': {
      const id = num(c.topicId);
      const t = id ? await get('SELECT * FROM media_topic WHERE id = ? AND deleted = 0', [id]) : null;
      return {
        topicTitle: t ? str(t.title) : '(未命名)',
        corePain: t ? str(t.core_pain) : '(未填)',
        targetPlatform: t ? str(t.target_platform) : '(未填)',
        contentForm: t ? str(t.content_form) : '图文',
        referenceUrl: t ? str(t.reference_url) : '(无)'
      };
    }
    case 'banned_check':
      return { text: str(c.text) };
    case 'competitor_analyze': {
      const id = num(c.competitorId);
      const acc = id ? await get('SELECT * FROM media_competitor_account WHERE id = ?', [id]) : null;
      return {
        accountName: acc ? str(acc.account_name) : '(未填)',
        platform: acc ? str(acc.platform) : '(未填)',
        homeUrl: acc ? str(acc.home_url) : '(未填)',
        brief: acc ? str(acc.brief) : '(未填)',
        manualNote: acc ? str(acc.manual_note) : '(无)',
        links: str(c.links)
      };
    }
    case 'review_report': {
      const ids = Array.isArray(c.recordIds) ? c.recordIds.map(num).filter((x) => x) : [];
      const rows = ids.length
        ? await query('SELECT * FROM media_publish_record WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids)
        : [];
      const lines = rows.map((r, i) =>
        `记录${i + 1}：选题#${r.topic_id || '未关联'} 平台=${r.platform || '未知'} 点赞=${r.likes || 0} 收藏=${r.favorites || 0} 评论=${r.comments || 0} 私信咨询=${r.inquiries || 0} 备注=${r.note || '无'}`);
      return { recordsText: lines.join('\n') || '(无记录)' };
    }
    default:
      return {};
  }
}

// GET /api/ai/skills —— 列表（管理面板用，仅返回 key/name/description）
router.get('/skills', async (req, res) => {
  try {
    const rows = await query('SELECT id, key, name, description FROM ai_skill ORDER BY id ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ai/skills/:key —— 单条（含模板，供编辑）
router.get('/skills/:key', async (req, res) => {
  try {
    const r = await get('SELECT * FROM ai_skill WHERE key = ?', [req.params.key]);
    if (!r) return res.status(404).json({ error: 'Skill 不存在' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/ai/skills/:key —— 更新模板（保存后端配置）
router.put('/skills/:key', async (req, res) => {
  try {
    const r = await get('SELECT * FROM ai_skill WHERE key = ?', [req.params.key]);
    if (!r) return res.status(404).json({ error: 'Skill 不存在' });
    const b = req.body || {};
    const sets = [];
    const params = [];
    if (b.name != null) { sets.push('name = ?'); params.push(str(b.name)); }
    if (b.description != null) { sets.push('description = ?'); params.push(str(b.description)); }
    if (b.system_prompt != null) { sets.push('system_prompt = ?'); params.push(str(b.system_prompt)); }
    if (b.user_template != null) { sets.push('user_template = ?'); params.push(str(b.user_template)); }
    if (b.placeholders != null) { sets.push('placeholders = ?'); params.push(jstr(b.placeholders)); }
    if (!sets.length) return res.status(400).json({ error: '无更新字段' });
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(req.params.key);
    await run('UPDATE ai_skill SET ' + sets.join(', ') + ' WHERE key = ?', params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ai/render —— 后端取业务数据填占位符，返回完整 prompt（不调用大模型）
// body: { skill: 'draft_generate', context: { topicId: 123 } }
router.post('/render', async (req, res) => {
  try {
    const { skill, context } = req.body || {};
    if (!skill) return res.status(400).json({ error: '缺少 skill' });
    const r = await get('SELECT * FROM ai_skill WHERE key = ?', [skill]);
    if (!r) return res.status(404).json({ error: 'Skill 不存在：' + skill });
    const data = await bindData(skill, context);
    res.json({
      system: fill(r.system_prompt, data),
      user: fill(r.user_template, data)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
