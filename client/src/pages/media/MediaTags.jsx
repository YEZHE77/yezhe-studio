// pages/media/MediaTags.jsx —— 标签管理
// 标签列表 + 关联统计（灵感/选题）；重命名 / 合并 / 删除废弃标签（治理标签泛滥）
import React, { useState, useEffect, useCallback } from 'react';
import http from '../../api.js';
import { toast, COLOR_PRESETS } from './common.js';

export default function MediaTags() {
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    http.get('/api/media/tags').then((r) => setTags(r.data || [])).catch(() => toast('标签加载失败', 'err'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const addTag = async () => {
    const name = window.prompt('新标签名称');
    if (!name || !String(name).trim()) return;
    setBusy(true);
    try { await http.post('/api/media/tags', { name: String(name).trim() }); toast('标签已创建'); load(); }
    catch (e) { toast('创建失败', 'err'); }
    finally { setBusy(false); }
  };

  const rename = async (t) => {
    const name = window.prompt('重命名标签', t.name);
    if (!name || !String(name).trim() || String(name).trim() === t.name) return;
    try { await http.put('/api/media/tags/' + t.id, { name: String(name).trim() }); toast('已重命名'); load(); }
    catch (e) { toast('重命名失败', 'err'); }
  };

  const changeColor = async (t) => {
    const color = window.prompt('输入颜色（HEX，如 #2DB7F5）', t.color || '#2DB7F5');
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(String(color).trim())) { if (color) toast('颜色格式应为 #RRGGBB', 'warn'); return; }
    try { await http.put('/api/media/tags/' + t.id, { color: String(color).trim() }); toast('颜色已更新'); load(); }
    catch (e) { toast('更新失败', 'err'); }
  };

  const merge = async (t) => {
    const target = window.prompt('合并到哪个标签？（输入目标标签 ID）\n\n当前标签：#' + t.id + ' ' + t.name + '\n可用标签：' + (tags || []).map((x) => '#' + x.id + ' ' + x.name).join('，'));
    const toId = Number(target);
    if (!target || !toId) return;
    if (toId === t.id) { toast('不能合并到自身', 'warn'); return; }
    if (!tags.some((x) => x.id === toId)) { toast('目标标签不存在', 'warn'); return; }
    if (!window.confirm('将「' + t.name + '」合并到标签 #' + toId + '？其关联的灵感/选题将全部改指目标标签，源标签被删除。')) return;
    try { await http.post('/api/media/tags/merge', { fromId: t.id, toId }); toast('标签已合并'); load(); }
    catch (e) { toast('合并失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  const remove = async (t) => {
    if (!window.confirm('删除标签「' + t.name + '」？其关联的灵感/选题将解除该标签（内容保留）。')) return;
    try { await http.delete('/api/media/tags/' + t.id); toast('标签已删除'); load(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  const totalRefs = tags.reduce((a, t) => a + (t.count || 0), 0);

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>标签管理</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>共 {tags.length} 个标签 · 关联 {totalRefs} 处 · 支持重命名 / 合并 / 删除，治理标签泛滥</div>
        </div>
        <button type="button" onClick={addTag} disabled={busy} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 16px', height: 32, borderRadius: 100, cursor: busy ? 'default' : 'pointer' }}>+ 新建标签</button>
      </div>

      {tags.length ? (
        <div className="bg-white border divide-y" style={{ borderRadius: 6, borderColor: '#EEEEEE' }}>
          {(tags || []).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: '#F5F5F5' }}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color || '#2DB7F5' }} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] truncate" style={{ color: '#333333' }}>{t.name}</div>
                <div className="text-[11px]" style={{ color: '#999999' }}>关联灵感 / 选题 {t.count || 0} 处</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" className="text-[11px]" style={{ padding: '5px 12px', borderRadius: 100, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }} onClick={() => rename(t)}>重命名</button>
                <button type="button" className="text-[11px]" style={{ padding: '5px 12px', borderRadius: 100, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }} onClick={() => changeColor(t)}>改色</button>
                <button type="button" className="text-[11px]" style={{ padding: '5px 12px', borderRadius: 100, border: '1px solid #FFD9A8', background: '#FFF7EC', color: '#E6A23C', cursor: 'pointer' }} onClick={() => merge(t)}>合并</button>
                <button type="button" className="text-[11px]" style={{ padding: '5px 12px', borderRadius: 100, border: '1px solid #F5C2C2', background: '#FDECEC', color: '#F47175', cursor: 'pointer' }} onClick={() => remove(t)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center text-sm" style={{ color: '#999999' }}>暂无标签，点击右上角「+ 新建标签」</div>
      )}

      <div className="mt-4 text-xs" style={{ color: '#AAAAAA' }}>
        提示：合并标签会将该标签在所有灵感 / 选题中的关联改指目标标签，并删除源标签；删除标签只解除关联，不影响内容本身。
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => <span key={c} className="text-[10px] px-1.5 py-0.5" style={{ background: '#F5F5F5', color: c }}>{c}</span>)}
      </div>
    </div>
  );
}
