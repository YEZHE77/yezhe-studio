import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 预约管理（reservations 表）：状态 pending 待确认 / contacted 已沟通 / rejected 已拒绝 / converted 已转订单
const STATUS_LABEL = { pending: '待确认', contacted: '已沟通', rejected: '已拒绝', converted: '已转订单' };

export default function Reservations() {
  const [filter, setFilter] = useState('');
  const [list, setList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [convResult, setConvResult] = useState(null); // 转订单结果 {order_no, access_token, order_id, name}
  const nav = useNavigate();

  const load = () => {
    http.get('/api/reservations').then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, []);

  async function changeStatus(id, status) {
    try {
      await http.patch('/api/reservations/' + id + '/status', { status });
      setDetail(null);
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '操作失败');
    }
  }

  async function doConvert(r) {
    if (!confirm(`确认将「${r.groom_name || r.bride_name || '客户'}」的预约转为订单？`)) return;
    try {
      const res = await http.post('/api/reservations/' + r.id + '/convert');
      setConvResult({ name: r.groom_name || r.bride_name || '客户', ...res.data });
      setDetail(null);
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '转订单失败');
    }
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); alert('已复制链接'); } catch { alert('复制失败，请手动复制：' + t); }
  }

  const shown = filter ? list.filter((r) => r.status === filter) : list;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl text-white">预约管理</h1>
        <span className="text-xs text-muted">来自 C 端客户提交的预约 · 支持修改状态与转为订单</span>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setFilter('')} className={btn(filter === '', '全部')}>全部</button>
        <button onClick={() => setFilter('pending')} className={btn(filter === 'pending', '待确认')}>待确认</button>
        <button onClick={() => setFilter('contacted')} className={btn(filter === 'contacted', '已沟通')}>已沟通</button>
        <button onClick={() => setFilter('rejected')} className={btn(filter === 'rejected', '已拒绝')}>已拒绝</button>
        <button onClick={() => setFilter('converted')} className={btn(filter === 'converted', '已转订单')}>已转订单</button>
      </div>

      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="text-muted text-left border-b border-line">
                <th className="p-3">新郎 / 新娘</th>
                <th className="p-3">主 / 第二手机号</th>
                <th className="p-3">意向套系</th>
                <th className="p-3">意向日期 / 地点</th>
                <th className="p-3">状态</th>
                <th className="p-3">提交时间</th>
                <th className="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setDetail(r)} className="border-b border-line last:border-0 cursor-pointer hover:bg-panel2">
                  <td className="p-3 text-white">{[r.groom_name, r.bride_name].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="p-3 text-white">{r.phone}{r.phone_two ? ' / ' + r.phone_two : ''}</td>
                  <td className="p-3 text-muted">{r.package_name ? `${r.package_name}（¥${r.package_price}）` : '暂未确定套系'}</td>
                  <td className="p-3 text-muted">{r.expect_date || '—'}{r.shoot_location ? ' · ' + r.shoot_location : ''}</td>
                  <td className="p-3"><span className={'px-2 py-1 rounded-full text-xs ' + badge(r.status)}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td className="p-3 text-muted">{fmt(r.create_time)}</td>
                  <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.status !== 'converted' ? (
                      <button onClick={() => doConvert(r)} className="px-3 py-1.5 rounded bg-brand text-white text-xs hover:opacity-90">转为订单</button>
                    ) : (
                      <button onClick={() => nav('/orders/' + r.order_id)} className="px-3 py-1.5 rounded border border-line text-white text-xs hover:bg-panel2">查看订单 ›</button>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-muted">暂无预约</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white">预约详情</div>
              <button onClick={() => setDetail(null)} className="text-muted text-sm">✕</button>
            </div>
            <div className="space-y-2 text-sm mb-4">
              <Row label="新郎" value={detail.groom_name || '—'} />
              <Row label="新娘" value={detail.bride_name || '—'} />
              <Row label="主手机号" value={detail.phone} />
              <Row label="第二手机号" value={detail.phone_two || '—'} />
              <Row label="意向套系" value={detail.package_name ? `${detail.package_name}（¥${detail.package_price}）` : '暂未确定套系'} />
              <Row label="意向日期" value={detail.expect_date || '—'} />
              <Row label="拍摄地点" value={detail.shoot_location || '—'} />
              <Row label="备注" value={detail.remark || '—'} />
              <Row label="状态" value={STATUS_LABEL[detail.status] || detail.status} />
              <Row label="提交时间" value={fmt(detail.create_time)} />
              {detail.order_id ? <Row label="关联订单" value={'#' + detail.order_id} /> : null}
            </div>
            <div className="flex gap-2 justify-end flex-wrap">
              {detail.status === 'converted' ? (
                <button onClick={() => { setDetail(null); nav('/orders/' + detail.order_id); }} className="px-3 py-1.5 rounded bg-brand text-white text-xs">查看订单</button>
              ) : (
                <>
                  {detail.status !== 'contacted' && <button onClick={() => changeStatus(detail.id, 'contacted')} className="px-3 py-1.5 rounded border border-line text-white text-xs">标记已沟通</button>}
                  {detail.status !== 'rejected' && <button onClick={() => changeStatus(detail.id, 'rejected')} className="px-3 py-1.5 rounded border border-line text-red-400 text-xs">拒绝</button>}
                  {detail.status !== 'pending' && <button onClick={() => changeStatus(detail.id, 'pending')} className="px-3 py-1.5 rounded border border-line text-white text-xs">恢复待确认</button>}
                  <button onClick={() => doConvert(detail)} className="px-3 py-1.5 rounded bg-brand text-white text-xs">转为订单</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 转订单结果 */}
      {convResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setConvResult(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6 text-center">
            <div className="text-emerald-400 text-2xl mb-2">✓</div>
            <div className="text-white mb-1">已转为订单</div>
            <div className="text-sm text-muted mb-4">客户「{convResult.name}」的预约已转为订单 {convResult.order_no || '#' + convResult.order_id}</div>
            {convResult.access_token && (
              <div className="text-left mb-4">
                <div className="text-xs text-muted mb-1">订单免登录链接（accessToken）：</div>
                <div className="text-xs text-white bg-panel2 border border-line rounded p-2 break-all">
                  {window.location.origin + '/customer/order?accessToken=' + convResult.access_token}
                </div>
                <button onClick={() => copyText(window.location.origin + '/customer/order?accessToken=' + convResult.access_token)} className="mt-2 px-3 py-1.5 rounded border border-line text-white text-xs">复制链接</button>
              </div>
            )}
            <div className="flex gap-2 justify-center">
              <button onClick={() => { setConvResult(null); nav('/orders/' + convResult.order_id); }} className="px-4 py-2 rounded bg-brand text-white text-sm">去订单中心</button>
              <button onClick={() => setConvResult(null)} className="px-4 py-2 rounded border border-line text-white text-sm">知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(s) { if (!s) return '—'; try { return new Date(s).toLocaleString('zh-CN'); } catch { return s; } }
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  );
}
function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    pending: 'bg-amber-500/15 text-amber-400',
    contacted: 'bg-sky-500/15 text-sky-400',
    rejected: 'bg-red-500/15 text-red-400',
    converted: 'bg-emerald-500/15 text-emerald-400'
  }[status] || 'bg-line text-muted';
}
