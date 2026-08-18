import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';
import AlbumGrid from '../components/AlbumGrid.jsx';

// 公开作品相册页 /w/:id —— 复用 AlbumGrid（与小程序相册详情页一致）
export default function WorkPublic() {
  const { id } = useParams();
  const nav = useNavigate();
  const [gallery, setGallery] = useState(null);
  const [locked, setLocked] = useState(false);
  const [meta, setMeta] = useState(null);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    http.get('/api/works/public/' + id + '/album')
      .then((r) => {
        const d = r.data;
        if (d.locked) { setLocked(true); setMeta(d.albumLock || {}); }
        else { setGallery(d.gallery); setMeta(null); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const verify = async (e) => {
    e.preventDefault();
    setPwBusy(true); setPwErr('');
    try {
      const r = await http.post('/api/works/public/' + id + '/album/verify', { password: pw });
      setGallery(r.data.gallery);
      setLocked(false);
    } catch (e2) {
      setPwErr('密码错误');
    } finally { setPwBusy(false); }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-white/60">加载中…</div>;
  }

  if (locked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-white">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="mb-3 text-2xl">🔒</div>
          <div className="text-lg font-medium">{meta && meta.title ? meta.title : '受保护的相册'}</div>
          <div className="mb-5 mt-1 text-xs text-white/50">该内容已设置访问密码，请输入密码查看</div>
          <form onSubmit={verify}>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              placeholder="请输入访问密码"
              className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-center text-white outline-none" />
            {pwErr && <div className="mt-2 text-xs text-red-400">{pwErr}</div>}
            <button type="submit" disabled={pwBusy}
              className="mt-4 w-full rounded-lg py-3 text-sm text-white disabled:opacity-40" style={{ background: 'var(--brand-green)' }}>查看内容</button>
          </form>
        </div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white/70">
        <div className="mb-3 text-2xl">🔗</div>
        <div className="text-lg">链接无效</div>
        <div className="mt-2 text-sm text-white/40">该作品相册可能已失效或已关闭，请联系摄影师。</div>
      </div>
    );
  }

  return <AlbumGrid gallery={gallery} albumId={id} onBack={() => nav('/home')} />;
}
