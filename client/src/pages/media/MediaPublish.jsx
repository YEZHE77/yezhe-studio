// pages/media/MediaPublish.jsx —— 分发记录
// 手动录入发布链接/时间/点赞/收藏/评论/私信咨询线索/备注（禁止自动发布、禁止爬取，数据全部人工回填）
// 支持表格视图 / 内容日历视图（基于选题 expect_publish_time 渲染排期）
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import http from '../../api.js';
import { toast, fmtDate, fmtDateTime } from './common.js';

const EMPTY = { id: null, topic_id: null, platform: '', publish_url: '', publish_time: '', likes: 0, favorites: 0, comments: 0, inquiries: 0, note: '' };

export default function MediaPublish() {
  const [params] = useSearchParams();
  const [view, setView] = useState('table');
  const [records, setRecords] = useState([]);
  const [topics, setTopics] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });

  const load = useCallback(() => {
    http.get('/api/media/publish-records').then((r) => setRecords(r.data || [])).catch(() => toast('分发记录加载失败', 'err'));
    http.get('/api/media/topics', { params: { includeArchived: 1 } }).then((r) => setTopics(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // ?topic_id= 预选新增
  useEffect(() => {
    const tid = params.get('topic_id');
    if (tid) { setForm({ ...EMPTY, topic_id: Number(tid) }); }
  }, [params]);

  const topicName = (id) => {
    const t = topics.find((x) => x.id === Number(id));
    return t ? t.title : ('选题#' + id);
  };
  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (r) => setForm({ ...r });
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!String(form.platform || '').trim() && !String(form.publish_url || '').trim()) { toast('请填写发布平台或发布链接', 'warn'); return; }
    setBusy(true);
    try {
      const payload = { ...form, topic_id: form.topic_id || null };
      if (form.id) { await http.put('/api/media/publish-records/' + form.id, payload); toast('记录已更新'); }
      else { await http.post('/api/media/publish-records', payload); toast('记录已保存'); }
      setForm(null);
      load();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  const remove = async (r) => {
    if (!window.confirm('确定删除该分发记录？')) return;
    try { await http.delete('/api/media/publish-records/' + r.id); toast('已删除'); load(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  // ---------- 表格视图 ----------
  const renderTable = () => (
    <div className="bg-white border overflow-x-auto" style={{ borderRadius: 6, borderColor: '#EEEEEE' }}>
      <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse', minWidth: 940 }}>
        <thead>
          <tr style={{ background: '#FAFAFA', color: '#666666', textAlign: 'left' }}>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>选题</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>平台</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>发布链接</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>发布时间</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>点赞</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>收藏</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>评论</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>私信咨询</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>备注</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #F5F5F5' }}>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#333333', maxWidth: 160 }}>
                <span className="truncate block">{r.topic_id ? topicName(r.topic_id) : '—'}</span>
              </td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#666666' }}>{r.platform || '—'}</td>
              <td className="px-3 py-2.5">
                {r.publish_url ? <a href={r.publish_url} target="_blank" rel="noreferrer" className="text-xs truncate block" style={{ color: '#2DB7F6', textDecoration: 'none', maxWidth: 150 }} title={r.publish_url}>链接</a> : <span className="text-xs" style={{ color: '#BBBBBB' }}>—</span>}
              </td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#999999' }}>{r.publish_time ? fmtDate(r.publish_time) : fmtDateTime(r.created_at)}</td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#F47175' }}>{r.likes || 0}</td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#E6A23C' }}>{r.favorites || 0}</td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#666666' }}>{r.comments || 0}</td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#49C5AE' }}>{r.inquiries || 0}</td>
              <td className="px-3 py-2.5 text-xs" style={{ color: '#888888', maxWidth: 140 }}><span className="truncate block" title={r.note || ''}>{r.note || '—'}</span></td>
              <td className="px-3 py-2.5">
                <button type="button" className="text-[11px] mr-2" style={{ color: '#2DB7F6', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => openEdit(r)}>编辑</button>
                <button type="button" className="text-[11px]" style={{ color: '#F47175', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => remove(r)}>删除</button>
              </td>
            </tr>
          ))}
          {!records.length && <tr><td colSpan={10} className="px-3 py-10 text-center text-sm" style={{ color: '#999999' }}>暂无分发记录，点击右上角「+ 录入记录」（发布后人工回填数据）</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // ---------- 内容日历视图（基于选题 expect_publish_time） ----------
  const renderCalendar = () => {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const startPad = first.getDay(); // 0=周日
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    const topicFor = (day) => {
      const key = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      return topics.filter((t) => t.expect_publish_time && String(t.expect_publish_time).slice(0, 10) === key);
    };
    const weekday = ['日', '一', '二', '三', '四', '五', '六'];
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button type="button" className="text-xs" style={{ padding: '4px 12px', border: '1px solid #E0E0E0', background: '#fff', borderRadius: 100, cursor: 'pointer', color: '#666666' }} onClick={() => { const d = new Date(y, m - 2, 1); setCalMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }}>‹ 上月</button>
            <span className="text-[15px]" style={{ color: '#333333' }}>{y} 年 {m} 月</span>
            <button type="button" className="text-xs" style={{ padding: '4px 12px', border: '1px solid #E0E0E0', background: '#fff', borderRadius: 100, cursor: 'pointer', color: '#666666' }} onClick={() => { const d = new Date(y, m, 1); setCalMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }}>下月 ›</button>
          </div>
          <span className="text-xs" style={{ color: '#999999' }}>基于选题「预计发布时间」渲染排期</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {weekday.map((w) => <div key={w} className="text-center text-[11px] py-1" style={{ color: '#999999' }}>周{w}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div key={'e' + i} />;
            const tps = topicFor(d);
            return (
              <div key={d} className="border" style={{ borderColor: '#EEEEEE', borderRadius: 6, minHeight: 88, background: '#fff', padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="text-[11px]" style={{ color: tps.length ? '#2DB7F5' : '#BBBBBB', fontWeight: tps.length ? 600 : 400 }}>{d}</span>
                {tps.slice(0, 3).map((t) => (
                  <div key={t.id} className="text-[10px] px-1 py-0.5 rounded truncate" style={{ background: (t.card_color || '#2DB7F5') + '1A', color: '#555555' }} title={t.title}>{t.title || '未命名'}</div>
                ))}
                {tps.length > 3 && <span className="text-[10px]" style={{ color: '#999999' }}>+{tps.length - 3}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>分发记录</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>禁止自动发布、禁止爬取平台数据；点赞 / 收藏 / 评论 / 私信咨询线索请人工回填</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-full overflow-hidden" style={{ borderColor: '#E0E0E0' }}>
            <button type="button" onClick={() => setView('table')} className="text-xs" style={{ padding: '6px 16px', background: view === 'table' ? '#2DB7F5' : '#fff', color: view === 'table' ? '#fff' : '#666666', border: 'none', cursor: 'pointer' }}>表格</button>
            <button type="button" onClick={() => setView('calendar')} className="text-xs" style={{ padding: '6px 16px', background: view === 'calendar' ? '#2DB7F5' : '#fff', color: view === 'calendar' ? '#fff' : '#666666', border: 'none', cursor: 'pointer' }}>内容日历</button>
          </div>
          <button type="button" onClick={openNew} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 16px', height: 32, borderRadius: 100, cursor: 'pointer' }}>+ 录入记录</button>
        </div>
      </div>

      {view === 'table' ? renderTable() : renderCalendar()}

      {/* 录入/编辑弹窗 */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !busy && setForm(null)}>
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] overflow-auto" style={{ borderRadius: 10, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] mb-4" style={{ color: '#333333' }}>{form.id ? '编辑分发记录' : '录入分发记录'}</div>
            <div className="space-y-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>关联选题（可空）</div>
                <select value={form.topic_id || ''} onChange={(e) => setF('topic_id', e.target.value ? Number(e.target.value) : null)} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                  <option value="">不关联</option>
                  {(topics || []).map((t) => <option key={t.id} value={t.id}>{t.title || ('选题#' + t.id)}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>发布平台</div>
                  <input value={form.platform || ''} onChange={(e) => setF('platform', e.target.value)} placeholder="小红书 / 抖音 / 视频号…" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>发布时间</div>
                  <input type="date" value={form.publish_time || ''} onChange={(e) => setF('publish_time', e.target.value)} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>发布链接</div>
                <input value={form.publish_url || ''} onChange={(e) => setF('publish_url', e.target.value)} placeholder="https://…" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: 'likes', label: '点赞' }, { k: 'favorites', label: '收藏' }, { k: 'comments', label: '评论' }, { k: 'inquiries', label: '私信咨询' }
                ].map((it) => (
                  <div key={it.k}>
                    <div className="text-xs mb-1" style={{ color: '#666666' }}>{it.label}</div>
                    <input type="number" min="0" value={form[it.k] || 0} onChange={(e) => setF(it.k, Math.max(0, Number(e.target.value) || 0))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 8px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>发布备注</div>
                <textarea value={form.note || ''} onChange={(e) => setF('note', e.target.value)} rows={2} placeholder="投放情况、评论区维护、客户反馈等" style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setForm(null)} className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={save} disabled={busy} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
