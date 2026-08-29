// pages/media/MediaReview.jsx —— 复盘报告
// 勾选多条已发布分发记录 → 生成复盘报告（AI 只读取库内真实录入数据，禁止编造；未配置 AI 用真实数据模板）
// 简易柱状图：点赞 / 收藏 / 私信咨询线索
// 一键回流：复盘识别出的痛点生成新灵感，自动打上「高转化」标签存入灵感库
import React, { useState, useEffect, useCallback } from 'react';
import http from '../../api.js';
import { toast, fmtDateTime, runSkill } from './common.js';

export default function MediaReview() {
  const [records, setRecords] = useState([]);
  const [topics, setTopics] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selected, setSelected] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState(null); // 待保存的生成结果

  const load = useCallback(() => {
    http.get('/api/media/publish-records').then((r) => setRecords(r.data || [])).catch(() => {});
    http.get('/api/media/topics', { params: { includeArchived: 1 } }).then((r) => setTopics(r.data || [])).catch(() => {});
    http.get('/api/media/reviews').then((r) => setReviews(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const topicName = (id) => {
    const t = topics.find((x) => x.id === Number(id));
    return t ? t.title : ('选题#' + id);
  };
  const selRecords = records.filter((r) => selected.includes(r.id));

  const toggleSel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // 生成复盘：只读真实数据（走后端 Skill 模板 review_report，后端用发布记录业务数据填占位符）
  const generate = async () => {
    if (!selRecords.length) { toast('请先勾选已发布的分发记录', 'warn'); return; }
    setGenerating(true);
    const totals = {
      likes: selRecords.reduce((a, r) => a + (r.likes || 0), 0),
      favs: selRecords.reduce((a, r) => a + (r.favorites || 0), 0),
      cmts: selRecords.reduce((a, r) => a + (r.comments || 0), 0),
      inqs: selRecords.reduce((a, r) => a + (r.inquiries || 0), 0)
    };
    const fallback = `【数据概览】本期共 ${selRecords.length} 条发布记录，合计：点赞 ${totals.likes}、收藏 ${totals.favs}、评论 ${totals.cmts}、私信咨询 ${totals.inqs}。\n【表现亮点】${totals.inqs > 0 ? '私信咨询 ' + totals.inqs + ' 条，说明内容具备转化潜力。' : '暂无私信咨询线索。'}${totals.likes > 0 ? '点赞 ' + totals.likes + ' 个。' : ''}\n【待改进】${totals.cmts === 0 ? '评论互动较少，可在文末增加互动引导。' : '评论区活跃，可继续维护。'}\n【下期建议】延续高互动选题方向，针对咨询集中的痛点做内容深化。\n【识别出的用户痛点】\n${(selRecords || []).map((r, i) => `痛点${i + 1}|${(r.note || '内容相关）用户关注度较高。').slice(0, 30)}`).join('\n')}\n\n（本报告由本地模板基于真实回填数据生成；配置 AI 接口后调用真实模型生成更深入洞察）`;
    try {
      const r = await runSkill('review_report', { recordIds: selected.slice() }, { fallback, temperature: 0.5 });
      const pains = parsePains(r.text);
      setDraft({ content: r.text, recordIds: selected.slice(), pains, source: r.source });
      toast(r.source === 'ai' ? 'AI 复盘已生成（基于真实数据）' : '已生成模板复盘（未配置 AI 接口）', r.source === 'ai' ? 'ok' : 'warn');
    } finally { setGenerating(false); }
  };

  // 解析"痛点标题|痛点说明"行
  const parsePains = (text) => {
    const out = [];
    String(text || '').split('\n').forEach((line) => {
      const m = line.match(/^(.+?)[|｜](.+)$/);
      if (m && m[1].trim() && !/痛点\d+/.test(m[1]) === false) {
        out.push({ title: m[1].trim(), content: m[2].trim() });
      }
    });
    // 兜底：若格式未命中，取最后若干行非空文本
    if (!out.length) {
      String(text || '').split('\n').filter((l) => l.trim()).slice(-3).forEach((l) => out.push({ title: l.trim().slice(0, 20), content: l.trim() }));
    }
    return out;
  };

  // 保存复盘到库
  const saveReview = async () => {
    if (!draft) return;
    try {
      await http.post('/api/media/reviews', { record_ids: draft.recordIds, content: draft.content, pain_points: draft.pains });
      toast('复盘报告已保存');
      setDraft(null);
      setSelected([]);
      load();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  const removeReview = async (r) => {
    if (!window.confirm('确定删除该复盘报告？')) return;
    try { await http.delete('/api/media/reviews/' + r.id); toast('已删除'); load(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  // 一键回流
  const backflow = async (r) => {
    try {
      const res = await http.post('/api/media/reviews/' + r.id + '/backflow');
      toast('已回流 ' + (res.data && res.data.created || 0) + ' 条灵感至灵感库（已打「高转化」标签）');
      load();
    } catch (e) { toast('回流失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  // 简易柱状图（纯 SVG，点赞红 / 收藏橙 / 咨询青）
  const BarChart = ({ rec }) => {
    const items = [
      { label: '点赞', v: rec.likes || 0, color: '#F47175' },
      { label: '收藏', v: rec.favorites || 0, color: '#E6A23C' },
      { label: '私信咨询', v: rec.inquiries || 0, color: '#49C5AE' }
    ];
    const max = Math.max(1, ...items.map((i) => i.v));
    return (
      <div className="flex items-end justify-center gap-6" style={{ height: 120, paddingTop: 8 }}>
        {items.map((it) => (
          <div key={it.label} className="flex flex-col items-center gap-1">
            <span className="text-[11px]" style={{ color: '#666666' }}>{it.v}</span>
            <div style={{ width: 34, height: Math.max(4, Math.round((it.v / max) * 80)), background: it.color, borderRadius: '4px 4px 0 0' }} />
            <span className="text-[11px]" style={{ color: '#999999' }}>{it.label}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>复盘报告</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>勾选已发布记录生成复盘（AI 仅读取库内真实回填数据，禁止编造）· 识别痛点可一键回流到灵感库</div>
        </div>
        <button type="button" onClick={generate} disabled={generating || !selected.length} className="text-xs" style={{ padding: '0 16px', height: 32, borderRadius: 100, border: 'none', background: selected.length ? '#2DB7F5' : '#D0D0D0', color: '#fff', cursor: selected.length && !generating ? 'pointer' : 'default' }}>{generating ? '生成中…' : '生成复盘（已选 ' + selected.length + ' 条）'}</button>
      </div>

      {/* 已发布记录（勾选区） */}
      <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 12 }}>
        <div className="text-xs mb-2" style={{ color: '#666666' }}>已发布分发记录（勾选参与复盘）</div>
        {records.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(records || []).map((r) => {
              const on = selected.includes(r.id);
              return (
                <div key={r.id} onClick={() => toggleSel(r.id)} className="border flex items-center gap-2 cursor-pointer" style={{ borderColor: on ? '#2DB7F5' : '#EEEEEE', borderRadius: 6, padding: '8px 10px', background: on ? '#F0F7FF' : '#fff' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleSel(r.id)} style={{ accentColor: '#2DB7F5' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs truncate" style={{ color: '#333333' }}>{r.topic_id ? topicName(r.topic_id) : (r.platform || '未关联选题')}</div>
                    <div className="text-[11px]" style={{ color: '#999999' }}>👍{r.likes || 0} ⭐{r.favorites || 0} 💬{r.comments || 0} ✉️{r.inquiries || 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm" style={{ color: '#999999' }}>暂无已发布记录，先到「分发记录」录入</div>
        )}
      </div>

      {/* 生成结果预览 */}
      {draft && (
        <div className="bg-white border mt-4" style={{ borderRadius: 6, borderColor: '#2DB7F5', padding: 16 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[14px]" style={{ color: '#333333' }}>复盘预览{draft.source === 'ai' ? '（AI 生成 · 基于真实数据）' : '（本地模板 · 基于真实数据）'}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="text-xs" style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>丢弃</button>
              <button type="button" onClick={saveReview} className="text-xs" style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: 'pointer' }}>保存报告</button>
            </div>
          </div>
          <div className="text-[13px] leading-[1.8] whitespace-pre-wrap" style={{ color: '#444444' }}>{draft.content}</div>
          {draft.pains.length > 0 && (
            <div className="mt-3">
              <div className="text-xs mb-1" style={{ color: '#666666' }}>识别出的痛点（保存后可用作回流灵感）：</div>
              <div className="flex flex-wrap gap-1.5">
                {draft.pains.map((p, i) => <span key={i} className="text-[11px] px-2 py-1 rounded" style={{ background: '#FDF6EC', color: '#E6A23C' }}>{p.title}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 报告列表 */}
      <div className="mt-5">
        <div className="text-[15px] mb-2" style={{ color: '#333333' }}>历史报告（{reviews.length}）</div>
        {reviews.length ? (
          <div className="space-y-3">
            {(reviews || []).map((r) => {
              const recs = records.filter((x) => r.record_ids.includes(x.id));
              return (
                <div key={r.id} className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs" style={{ color: '#BBBBBB' }}>{fmtDateTime(r.created_at)} · 基于 {recs.length} 条记录</span>
                    <div className="flex gap-2">
                      <button type="button" className="text-[11px]" style={{ padding: '4px 12px', borderRadius: 100, border: '1px solid #FFD9A8', background: '#FFF7EC', color: '#E6A23C', cursor: 'pointer' }} onClick={() => backflow(r)}>↺ 一键回流痛点</button>
                      <button type="button" className="text-[11px]" style={{ padding: '4px 12px', borderRadius: 100, border: '1px solid #F5C2C2', background: '#FDECEC', color: '#F47175', cursor: 'pointer' }} onClick={() => removeReview(r)}>删除</button>
                    </div>
                  </div>
                  {recs.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                      {(recs || []).map((rec) => (
                        <div key={rec.id} className="border rounded" style={{ borderColor: '#F0F0F0', padding: 10 }}>
                          <div className="text-xs truncate mb-1" style={{ color: '#333333' }}>{rec.topic_id ? topicName(rec.topic_id) : (rec.platform || '未关联')}</div>
                          <BarChart rec={rec} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="text-[13px] leading-[1.8] whitespace-pre-wrap mt-3" style={{ color: '#444444', maxHeight: 220, overflowY: 'auto' }}>{r.content}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-sm" style={{ color: '#999999' }}>暂无复盘报告</div>
        )}
      </div>
    </div>
  );
}
