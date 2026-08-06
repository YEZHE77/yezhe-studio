import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';
import AlbumGrid from '../components/AlbumGrid.jsx';

export default function WorkPublic() {
  const { id } = useParams();
  const nav = useNavigate();
  const [gallery, setGallery] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    http.get('/api/works/public/' + id + '/album')
      .then((r) => {
        const d = r.data;
        if (d.locked) setLocked(true);
        else setGallery(d.gallery);
        setErr('');
      })
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
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
      setPwErr((e2.response && e2.response.data && e2.response.data.error) || '密码错误');
    } finally { setPwBusy(false); }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#999' }}>加载中…</div>;
  }

  if (locked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#111', color: '#fff' }}>
        <div className="w-full max-w-sm rounded-2xl p-7 text-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="text-2xl mb-3">🔒</div>
          <div className="text-lg font-medium">受密码保护的相册</div>
          <div className="text-xs opacity-50 mt-1 mb-5">该相册已设置访问密码，请输入密码查看</div>
          <form onSubmit={verify}>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="请输入访问密码"
              className="w-full px-4 py-3 rounded-lg text-center outline-none" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }} />
            {pwErr && <div className="text-red-400 text-xs mt-2">{pwErr}</div>}
            <button type="submit" disabled={pwBusy}
              className="w-full mt-4 px-4 py-3 rounded-lg text-white text-sm disabled:opacity-40" style={{ background: '#7ecdbb' }}>查看内容</button>
          </form>
          <button onClick={() => nav('/')} className="mt-4 text-xs opacity-50">返回首页</button>
        </div>
      </div>
    );
  }

  if (err || !gallery) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6" style={{ background: '#111', color: 'rgba(255,255,255,0.7)' }}>
        <div className="text-2xl mb-3">🔗</div>
        <div className="text-lg">{err || '相册不存在或已下架'}</div>
        <button onClick={() => nav('/')} className="mt-5 text-sm opacity-50">返回首页</button>
      </div>
    );
  }

  return <AlbumGrid gallery={gallery} onBack={() => nav('/')} />;
}
