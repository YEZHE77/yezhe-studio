import React, { useState, useEffect } from 'react';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';

const STATUS_LABEL = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
const STATUS_COLOR = { pending: 'bg-amber-500', approved: 'bg-emerald-500', rejected: 'bg-line' };

export default function Reviews() {
  const [state, setState] = useViewState('reviews', { status: 'pending' });
  const [list, setList] = useState([]);

  const load = () => {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    http.get('/api/admin/evaluates?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, [state]);

  async function review(id, action) {
    if (!confirm(action === 'approve' ? '通过该评价并展示到小程序好评墙？' : '驳回该评价（不展示）？')) return;
    try {
      await http.post('/api/admin/evaluates/' + id + '/review', { action });
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '操作失败');
    }
  }

  async function remove(id) {
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    try {
      await http.delete('/api/admin/evaluates/' + id);
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '删除失败');
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">评价审核</h1>
        <span className="text-xs text-muted">客户在小程序提交的评价在此审核后展示</span>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <button key={s} onClick={() => setState((x) => ({ ...x, status: s }))}
            className={'px-3 py-2 rounded-full text-sm border ' + (state.status === s ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>
            {s === '' ? '全部' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((e) => (
          <div key={e.id} className="bg-panel border border-line rounded-xl2 p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-white text-sm font-medium">{e.customer_name || '匿名客户'}</div>
              <span className={'px-2 py-1 rounded-full text-xs ' + badge(e.status)}>{STATUS_LABEL[e.status] || e.status}</span>
            </div>
            <div className="text-xs text-muted mb-2">订单 {e.order_no || '—'} · {new Date(e.created_at).toLocaleDateString('zh-CN')}</div>
            <div className="text-amber-400 mb-2">{'★'.repeat(e.stars)}{'☆'.repeat(5 - e.stars)} <span className="text-muted text-xs ml-1">{e.stars} 星</span></div>
            <div className="text-sm text-white/90 mb-3 whitespace-pre-wrap">{e.text || '（无文字评价）'}</div>
            {e.images && e.images.length > 0 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                {e.images.map((u, i) => (
                  <img key={i} src={img(u)} className="w-16 h-16 object-cover rounded-lg border border-line" />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {e.status === 'pending' && (
                <>
                  <button onClick={() => review(e.id, 'approve')} className="flex-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-xs hover:opacity-90">通过</button>
                  <button onClick={() => review(e.id, 'reject')} className="flex-1 px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">驳回</button>
                </>
              )}
              <button onClick={() => remove(e.id)} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs hover:bg-red-500/10">删除</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="col-span-full text-center text-muted py-10">暂无评价</div>}
      </div>
    </div>
  );
}

function badge(status) {
  return {
    pending: 'bg-amber-500/15 text-amber-400',
    approved: 'bg-emerald-500/15 text-emerald-400',
    rejected: 'bg-line text-muted'
  }[status] || 'bg-line text-muted';
}
