// pages/media/MediaInspirations.jsx —— 灵感库
// 手动新增 / 粘贴抖音小红书链接解析（禁止爬取，仅提取链接语义）→ 解析失败弹窗提示，不静默保存无效数据
// 自定义标签（关联 media_tag）· 搜索 · 多标签筛选 · 卡片颜色 · 一键复制生成选题（数据互相独立）
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../../api.js';
import { toast, fmtDateTime, COLOR_PRESETS, SOURCE_OPTS } from './common.js';

const EMPTY = { id: null, title: '', content: '', source_type: 'manual', source_url: '', pain_strength: 3, tags: [], card_color: '#2DB7F5' };

export default function MediaInspirations() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState([]); // 多标签筛选（AND）
  const [form, setForm] = useState(null); // 弹窗表单
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    http.get('/api/media/inspirations', { params: { search: search || undefined, page: 1, pageSize: 100 } })
      .then((r) => setList(r.data ? r.data.list || [] : []))
      .catch(() => toast('灵感列表加载失败', 'err'));
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { http.get('/api/media/tags').then((r) => setAllTags(r.data || [])).catch(() => {}); }, []);

  // 多标签筛选（前端 AND 过滤）
  const shown = filterTags.length ? list.filter((it) => filterTags.every((f) => (it.tags || []).includes(String(f)))) : list;

  const tagById = (id) => allTags.find((t) => String(t.id) === String(id));

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (it) => setForm({ id: it.id, title: it.title || '', content: it.content || '', source_type: it.source_type || 'manual', source_url: it.source_url || '', pain_strength: Number(it.pain_strength) || 3, tags: (it.tags || []).map(String), card_color: it.card_color || '#2DB7F5' });

  // 解析链接（抖音/小红书）：读取该链接页面公开内容并【回填到表单，不自动保存】
  // 用户可继续编辑内容/打标签，点「保存」才写入灵感库；解析失败弹窗报错，不生成空灵感记录。
  const doParse = async () => {
    let url = String(form.source_url || '').trim();
    if (!url) { toast('请先粘贴抖音 / 小红书链接', 'warn'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    setForm((f) => ({ ...f, source_url: url }));
    setParsing(true);
    try {
      const r = await http.post('/api/media/inspirations/fetch', { url }, { skipToast: true });
      const d = r.data || {};
      // 成功：只回填表单（标题+正文+来源），绝不自动存库
      setForm((f) => ({
        ...f,
        title: d.title || f.title,
        content: d.content || f.content,
        source_type: d.source_type || 'manual',
        source_url: url
      }));
      toast('已解析并回填，请编辑后点「保存」');
    } catch (e) {
      const status = e.status || (e.response && e.response.status);
      const msg = (e.data && e.data.error) || e.message || '解析失败';
      if (status === 400) {
        window.alert('链接格式无效，请粘贴小红书/抖音作品链接');
      } else if (status === 422) {
        // 内容获取不到 → 明确失败，不回填、不生成空记录
        window.alert('解析失败，无法获取内容，请手动录入灵感');
      } else {
        window.alert('解析失败：' + msg + '\n\n小提示：仅支持抖音 / 小红书作品链接');
      }
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!String(form.title || '').trim() && !String(form.content || '').trim()) { toast('标题和内容不能同时为空', 'warn'); return; }
    setBusy(true);
    try {
      const payload = { ...form, title: String(form.title || '').trim(), content: String(form.content || '').trim(), tags: form.tags };
      if (form.id) {
        await http.put('/api/media/inspirations/' + form.id, payload);
        toast('灵感已更新');
      } else {
        await http.post('/api/media/inspirations', payload);
        toast('灵感已保存');
      }
      setForm(null);
      load();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  const toggleFormTag = (id) => setForm((f) => {
    const s = String(id);
    return { ...f, tags: f.tags.includes(s) ? f.tags.filter((t) => t !== s) : [...f.tags, s] };
  });

  const copyToTopic = async (it) => {
    try {
      const r = await http.post('/api/media/inspirations/' + it.id + '/to-topic');
      toast('已生成选题，两份数据互相独立');
      setTimeout(() => nav('/media/production/' + r.data.id), 400);
    } catch (e) { toast('生成失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  const remove = async (it) => {
    if (!window.confirm('确定删除该灵感？')) return;
    try { await http.delete('/api/media/inspirations/' + it.id); toast('已删除'); load(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  const field = (k) => String(form ? form[k] : '');

  return (
    <div style={{ maxWidth: 1050 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>灵感库</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>共 {list.length} 条灵感 · 粘贴抖音/小红书链接可解析标题（禁止爬取平台数据，评论痛点请人工补充）</div>
        </div>
        <button type="button" onClick={openNew} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 16px', height: 32, borderRadius: 100, cursor: 'pointer' }}>+ 新增灵感</button>
      </div>

      {/* 搜索 + 标签筛选 */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题 / 内容"
          style={{ width: 220, height: 32, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none' }}
        />
        {(allTags || []).map((t) => {
          const on = filterTags.includes(String(t.id));
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilterTags((f) => (on ? f.filter((x) => x !== String(t.id)) : [...f, String(t.id)]))}
              className="text-xs"
              style={on ? { background: t.color || '#2DB7F5', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' } : { background: '#fff', color: '#666666', border: '1px solid #E0E0E0', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' }}
            >{t.name}</button>
          );
        })}
        {filterTags.length > 0 && (
          <button type="button" className="text-xs" style={{ color: '#F47175', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFilterTags([])}>清除筛选</button>
        )}
      </div>

      {/* 卡片列表 */}
      {shown.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(shown || []).map((it) => {
            const src = SOURCE_OPTS.find((s) => s.value === it.source_type);
            return (
              <div key={it.id} className="bg-white border flex flex-col" style={{ borderRadius: 6, borderColor: '#EEEEEE', overflow: 'hidden' }}>
                <div style={{ height: 4, background: it.card_color || '#2DB7F5' }} />
                <div className="p-3 flex-1 flex flex-col gap-2" style={{ minWidth: 0 }}>
                  <div className="text-[14px] font-medium truncate" style={{ color: '#333333' }} title={it.title || '未命名灵感'}>{it.title || '未命名灵感'}</div>
                  {it.content ? <div className="text-xs leading-[18px] line-clamp-3" style={{ color: '#888888' }}>{it.content}</div> : null}
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="px-1.5 py-0.5 rounded" style={{ background: '#F0F7FF', color: '#2DB7F6' }}>{src ? src.label : it.source_type}</span>
                    <span className="px-1.5 py-0.5 rounded" style={{ background: '#FDF6EC', color: '#E6A23C' }}>痛点强度 {'★'.repeat(Math.max(1, Math.min(5, Number(it.pain_strength) || 1)))}</span>
                    {(it.tags || []).map((id) => {
                      const t = tagById(id);
                      return t ? <span key={id} className="px-1.5 py-0.5 rounded" style={{ background: '#F0F0F0', color: '#666666' }}>{t.name}</span> : null;
                    })}
                  </div>
                  {it.source_url ? (
                    <a href={it.source_url} target="_blank" rel="noreferrer" className="text-[11px] truncate" style={{ color: '#2DB7F6', textDecoration: 'none' }} title={it.source_url}>{it.source_url}</a>
                  ) : null}
                  <div className="text-[11px] mt-auto pt-1" style={{ color: '#BBBBBB' }}>{fmtDateTime(it.created_at)}</div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" className="text-[11px] flex-1" style={{ color: '#fff', background: '#2DB7F5', border: 'none', padding: '6px 0', borderRadius: 4, cursor: 'pointer' }} onClick={() => copyToTopic(it)}>复制生成选题</button>
                    <button type="button" className="text-[11px]" style={{ color: '#666666', background: '#F5F5F5', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }} onClick={() => openEdit(it)}>编辑</button>
                    <button type="button" className="text-[11px]" style={{ color: '#F47175', background: '#FDECEC', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }} onClick={() => remove(it)}>删除</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border mt-2 py-12 text-center text-sm" style={{ borderRadius: 6, borderColor: '#EEEEEE', color: '#999999' }}>
          {list.length ? '没有符合筛选条件的灵感' : '暂无灵感，点击右上角「+ 新增灵感」开始录入'}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !busy && setForm(null)}>
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] overflow-auto" style={{ borderRadius: 10, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] mb-4" style={{ color: '#333333' }}>{form.id ? '编辑灵感' : '新增灵感'}</div>
            <div className="space-y-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>标题</div>
                <input value={field('title')} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="灵感标题" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>内容 / 评论痛点</div>
                <textarea value={field('content')} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="记录内容、用户评论、痛点洞察…" rows={4} style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>来源类型</div>
                  <select value={field('source_type')} onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    {SOURCE_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>痛点强度</div>
                  <select value={field('pain_strength')} onChange={(e) => setForm((f) => ({ ...f, pain_strength: Number(e.target.value) }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {'★'.repeat(n)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>来源链接（支持抖音 / 小红书各种形式）</div>
                <div className="flex gap-2">
                  <input value={field('source_url')} onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))} placeholder="粘贴链接或整段分享文案，如 v.douyin.com/xxx、xhslink.cn/o/xxx…" style={{ flex: 1, height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={doParse} disabled={parsing} style={{ height: 36, padding: '0 12px', borderRadius: 6, border: '1px solid #ABE2FB', background: '#F0F7FF', color: '#2DB7F6', fontSize: 12.5, cursor: parsing ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>{parsing ? '解析中…' : '解析链接'}</button>
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>自定义标签（点击选择，可多选）</div>
                <div className="flex flex-wrap gap-1.5">
                  {(allTags || []).map((t) => {
                    const on = form.tags.includes(String(t.id));
                    return (
                      <button key={t.id} type="button" onClick={() => toggleFormTag(t.id)} className="text-xs" style={on ? { background: t.color || '#2DB7F5', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' } : { background: '#fff', color: '#666666', border: '1px solid #E0E0E0', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' }}>{t.name}</button>
                    );
                  })}
                  {!allTags.length && <span className="text-xs" style={{ color: '#AAAAAA' }}>暂无标签，可先到「标签管理」创建</span>}
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>卡片颜色</div>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, card_color: c }))} style={{ width: 22, height: 22, borderRadius: 4, background: c, border: form.card_color === c ? '2px solid #333' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
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
