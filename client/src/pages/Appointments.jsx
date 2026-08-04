import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const STATUS_LABEL = { pending: '待处理', converted: '已转订单' };

export default function Appointments() {
  const [state, setState] = useViewState('appointments', { status: '', q: '' });
  const [list, setList] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [conv, setConv] = useState(null); // 转单结果弹层
  const nav = useNavigate();

  const load = () => {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    http.get('/api/admin/appointments?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, [state]);
  useEffect(() => { http.get('/api/packages?status=all').then((r) => setPkgs(r.data)).catch(() => {}); }, []);

  async function convert(a) {
    if (!confirm(`确认将「${a.name}」的预约转为订单？\n套系：${a.package_name || '未选套系'}\n转单后客户可在小程序看到该订单。`)) return;
    try {
      const r = await http.post('/api/admin/appointments/' + a.id + '/convert');
      setConv({ name: a.name, ...r.data });
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '转单失败');
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">预约管理</h1>
        <span className="text-xs text-muted">来自 C 端小程序客户提交的预约</span>
      </div>

      {/* 状态筛选 + 搜索 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setState((s) => ({ ...s, status: '' }))} className={btn(state.status === '', '全部')}>全部</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'pending' }))} className={btn(state.status === 'pending', '待处理')}>待处理</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'converted' }))} className={btn(state.status === 'converted', '已转订单')}>已转订单</button>
        <input value={state.q} onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))} placeholder="搜索称呼 / 电话"
          className="ml-auto w-56 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
      </div>

      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="p-3 font-medium">称呼</th>
              <th className="p-3 font-medium">联系电话</th>
              <th className="p-3 font-medium">意向套系</th>
              <th className="p-3 font-medium">期望日期</th>
              <th className="p-3 font-medium">备注</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0 hover:bg-panel2">
                <td className="p-3 text-white">{a.name}</td>
                <td className="p-3 text-white">{a.phone}</td>
                <td className="p-3 text-muted">{a.package_name || '—'}</td>
                <td className="p-3 text-muted">{a.hope_date || '—'}</td>
                <td className="p-3 text-muted max-w-[180px] truncate">{a.remark || '—'}</td>
                <td className="p-3"><span className={'px-2 py-1 rounded-full text-xs ' + badge(a.status)}>{STATUS_LABEL[a.status] || a.status}</span></td>
                <td className="p-3">
                  {a.status === 'pending' ? (
                    <button onClick={() => convert(a)} className="px-3 py-1.5 rounded bg-brand text-white text-xs hover:opacity-90">转订单</button>
                  ) : (
                    <span className="text-xs text-muted">已转订单</span>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-muted">暂无预约</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 转单结果 */}
      {conv && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setConv(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6 text-center">
            <div className="text-emerald-400 text-2xl mb-2">✓</div>
            <div className="text-white font-medium mb-1">已转为订单</div>
            <div className="text-sm text-muted mb-4">客户「{conv.name}」的订单已创建并绑定其小程序账号</div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { setConv(null); nav('/orders'); }} className="px-4 py-2 rounded bg-panel2 border border-line text-white text-sm">去订单中心</button>
              <button onClick={() => setConv(null)} className="px-4 py-2 rounded bg-brand text-white text-sm">知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    pending: 'bg-amber-500/15 text-amber-400',
    converted: 'bg-emerald-500/15 text-emerald-400'
  }[status] || 'bg-line text-muted';
}
