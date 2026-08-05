import React, { useState, useEffect } from 'react';
import http, { img } from '../api.js';

export default function SelectionAdmin() {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);   // 当前编辑的订单
  const [photos, setPhotos] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState('');

  useEffect(() => {
    http.get('/api/admin/selections').then((r) => setList(r.data)).catch(() => setList([]));
  }, []);

  async function openOrder(o) {
    setActive(o); setLoading(true); setPhotos([]); setMarks([]);
    try {
      const r = await http.get('/api/admin/photo-select/' + o.id);
      const d = r.data || {};
      setPhotos(d.photos || []);
      setMarks((d.selection && d.selection.marks) || []);
    } catch (e) { setTip('加载失败：' + e.message); }
    setLoading(false);
  }

  function toggle(id) {
    setMarks((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function save() {
    setSaving(true); setTip('');
    try {
      await http.post('/api/admin/photo-select/' + active.id, { marks });
      setTip('已保存并提交给客户（共 ' + marks.length + ' 张）');
      setList((l) => l.map((x) => (x.id === active.id ? { ...x, submitted: true, selCount: marks.length } : x)));
    } catch (e) { setTip('保存失败：' + (e.response?.data?.error || e.message)); }
    setSaving(false);
    setTimeout(() => setTip(''), 3000);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-fg">在线选片管理</h1>
        <p className="text-xs text-muted mt-0.5">代客户查看 / 修正选片 · 双向实时同步小程序</p>
      </div>

      {tip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{tip}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 选片中订单列表 */}
        <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
          <div className="px-4 py-3 text-xs text-muted border-b border-line">选片中订单（{list.length}）</div>
          {list.map((o) => (
            <div key={o.id} onClick={() => openOrder(o)}
              className={'px-4 py-3 border-b border-line last:border-0 cursor-pointer hover:bg-panel2 transition ' + (active && active.id === o.id ? 'bg-brand/5' : '')}>
              <div className="flex items-center justify-between">
                <span className="text-fg font-medium text-sm">{o.customer_name || '客户'}</span>
                <span className={'text-xs px-2 py-0.5 rounded-full ' + (o.submitted ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                  {o.submitted ? '已提交' : '待提交'}
                </span>
              </div>
              <div className="text-xs text-muted mt-1">单号 {o.order_no} · 已选 {o.selCount} 张</div>
            </div>
          ))}
          {!list.length && <div className="py-10 text-center text-xs text-faint">当前没有选片中的订单</div>}
        </div>

        {/* 选片编辑 */}
        <div className="bg-panel border border-line rounded-xl2 p-5 min-h-[300px]">
          {!active && <div className="h-full flex items-center justify-center text-xs text-faint">← 从左侧选择一个订单开始管理</div>}
          {active && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-fg font-semibold">{active.customer_name}</div>
                  <div className="text-xs text-muted">单号 {active.order_no} · 勾选/取消小样，保存后同步客户</div>
                </div>
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">保存</button>
              </div>

              {loading && <div className="py-10 text-center text-xs text-faint">加载小样…</div>}
              {!loading && (
                <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-auto pr-1">
                  {photos.map((p) => {
                    const on = marks.includes(p.id);
                    return (
                      <div key={p.id} onClick={() => toggle(p.id)} className="relative cursor-pointer group">
                        <img src={img(p.photo_url)} alt="" className={'w-full h-24 object-cover rounded-lg border-2 transition ' + (on ? 'border-brand' : 'border-transparent group-hover:border-brand/40')} />
                        <div className={'absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs ' + (on ? 'bg-brand text-white' : 'bg-black/40 text-white')}>
                          {on ? '✓' : ''}
                        </div>
                        {p.workTitle && <div className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 px-1 rounded">{p.workTitle}</div>}
                      </div>
                    );
                  })}
                  {!photos.length && <div className="col-span-3 py-10 text-center text-xs text-faint">该订单暂无 sample 小样</div>}
                </div>
              )}
              <div className="mt-3 text-xs text-muted">已选 {marks.length} 张</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
