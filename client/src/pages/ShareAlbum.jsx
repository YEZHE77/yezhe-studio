import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import http, { img } from '../api.js';
import AlbumGrid from '../components/AlbumGrid.jsx';

const ZONE_LABEL = { sample: '样片', final: '成片' };

export default function ShareAlbum() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null); // 实际业务数据（按 type 不同结构不同）
  const [meta, setMeta] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    http.get('/api/share/' + token)
      .then((r) => {
        const d = r.data;
        if (d.locked) { setLocked(true); setMeta(d.meta); }
        else { setPayload(d.data); setMeta(d.meta); }
        setErr('');
      })
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const verify = async (e) => {
    e.preventDefault();
    setPwBusy(true); setPwErr('');
    try {
      const r = await http.post('/api/share/' + token + '/verify', { password: pw });
      setPayload(r.data.data);
      setMeta(r.data.meta);
      setLocked(false);
    } catch (e2) {
      setPwErr((e2.response && e2.response.data && e2.response.data.error) || '密码错误');
    } finally { setPwBusy(false); }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white/60">加载中…</div>;
  }

  // 密码校验页
  if (locked) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
          <div className="text-2xl mb-3">🔒</div>
          <div className="text-lg font-medium">{meta && meta.title ? meta.title : '受保护的分享'}</div>
          <div className="text-xs text-white/50 mt-1 mb-5">该内容已设置访问密码，请输入密码查看</div>
          <form onSubmit={verify}>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              autoFocus placeholder="请输入访问密码"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/15 text-white text-center outline-none" />
            {pwErr && <div className="text-red-400 text-xs mt-2">{pwErr}</div>}
            <button type="submit" disabled={pwBusy}
              className="w-full mt-4 px-4 py-3 rounded-lg bg-brand text-white text-sm disabled:opacity-40">查看内容</button>
          </form>
        </div>
      </div>
    );
  }

  if (err || !payload) {
    // 文案由后端统一给出（share.js）：链接失效 / 合集已关闭 / 链接格式不正确，三种语义分开，
    // 此处不再自行拼装，避免与验收清单要求文案不一致（清单 3.2 / 3.3 / 3.4 / 3.5）
    return (
      <div style={{ minHeight: '100vh', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
        <div style={{ fontSize: 17, color: '#fff', lineHeight: 1.6 }}>{err || '链接无效'}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 10 }}>如有疑问，请联系摄影师</div>
      </div>
    );
  }

  // 客片电子相册（album）类型：网格 / 流式大图 双视图（与小程序相册详情页一致）
  if (payload.gallery) {
    return <AlbumGrid gallery={payload.gallery} />;
  }

  // 订单影集（专属相册）类型
  if (payload.order) {
    const { order, works } = payload;
    const photoCount = works.reduce((s, w) => s + w.photos.length, 0);
    const now = Date.now();
    const rawLeft = order.raw_expire_at ? Math.ceil((new Date(order.raw_expire_at).getTime() - now) / 86400000) : null;
    const retLeft = order.retouch_expire_at ? Math.ceil((new Date(order.retouch_expire_at).getTime() - now) / 86400000) : null;

    return (
      <div className="min-h-screen bg-black text-white px-4 py-6 max-w-md mx-auto">
        <div className="text-center mb-5">
          <div className="text-lg font-medium">{order.customer_name} 的专属影集</div>
          <div className="text-xs text-white/50 mt-1">
            {order.packageName ? order.packageName + ' · ' : ''}共 {photoCount} 张
          </div>
        </div>

        {(rawLeft !== null || retLeft !== null) && (
          <div className="text-[11px] text-white/40 mb-4 text-center">
            文件保存提醒：原片{rawLeft === null ? '未设置' : rawLeft >= 0 ? `剩 ${rawLeft} 天` : '已过期'}
            {' · '}成片{retLeft === null ? '未设置' : retLeft >= 0 ? `剩 ${retLeft} 天` : '已过期'}，请尽快下载留存。
          </div>
        )}

        {photoCount === 0 && (
          <div className="text-center text-white/50 py-16">该影集暂未上传成品照片，敬请期待。</div>
        )}

        {works.map((w) => (
          <div key={w.id} className="mb-6">
            {w.title && <div className="text-sm text-white/70 mb-2">{w.title}</div>}
            <div className="grid grid-cols-2 gap-2">
              {w.photos.map((p, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden bg-white/5">
                  <img src={img(p.url)} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" />
                  <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/80">
                    {ZONE_LABEL[p.zone] || p.zone}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="text-center text-[11px] text-white/30 mt-8 pb-8">
          YEZHE WORKSHOP · 海口婚礼 / 人像摄影
        </div>
      </div>
    );
  }

  // 其他类型（work/package/schedule/bill）暂由对应模块页承接；此处给通用占位
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-white/70 px-6 text-center">
      <div className="text-2xl mb-3">🖼️</div>
      <div className="text-lg">{meta && meta.title ? meta.title : '分享内容'}</div>
      <div className="text-sm text-white/40 mt-2">该分享类型正在接入中，请稍后或联系摄影师。</div>
    </div>
  );
}
