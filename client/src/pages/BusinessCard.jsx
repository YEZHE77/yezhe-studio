import React, { useState, useEffect, useRef } from 'react';
import http, { img } from '../api.js';

function loadImg(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src.startsWith('http') ? src : img(src);
  });
}

export default function BusinessCard() {
  const [form, setForm] = useState({ name: '叶哲 Studio', intro: '海口婚礼 / 人像摄影', logo: '', phone: '', wechat: '', address: '' });
  const [qr, setQr] = useState(null); // dataURL
  const qrRef = useRef();
  const canvasRef = useRef();

  useEffect(() => {
    http.get('/api/settings/studio').then((r) => {
      const d = r.data || {};
      setForm({
        name: d.name || '叶哲 Studio',
        intro: d.intro || '海口婚礼 / 人像摄影',
        logo: d.logo || '',
        phone: (d.contact && d.contact.phone) || '',
        wechat: (d.contact && d.contact.wechat) || '',
        address: (d.contact && d.contact.address) || ''
      });
    }).catch(() => {});
  }, []);

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [form, qr]);

  async function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 640, H = 360;
    canvas.width = W; canvas.height = H;

    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2f7cf6'); g.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 装饰圆
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.arc(W - 60, -40, 160, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-40, H + 20, 140, 0, Math.PI * 2); ctx.fill();

    // logo
    const logo = await loadImg(form.logo);
    const lx = 48, ly = 56, lr = 40;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx + lr, ly + lr, lr, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (logo) ctx.drawImage(logo, lx, ly, lr * 2, lr * 2);
    else { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(lx, ly, lr * 2, lr * 2); }
    ctx.restore();
    if (!logo) {
      ctx.fillStyle = '#2f7cf6'; ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((form.name || '叶').slice(0, 1), lx + lr, ly + lr);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    // 名称 + 简介
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif';
    ctx.fillText(form.name || '工作室', 48, 178);
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = '15px sans-serif';
    ctx.fillText(form.intro || '', 48, 206);

    // 联系方式
    ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.92)';
    let y = 248;
    if (form.phone) { ctx.fillText('📞  ' + form.phone, 48, y); y += 26; }
    if (form.wechat) { ctx.fillText('💬  微信 ' + form.wechat, 48, y); y += 26; }
    if (form.address) { ctx.fillText('📍  ' + form.address, 48, y); }

    // 二维码
    const qx = W - 168, qy = H - 168, qs = 128;
    ctx.fillStyle = '#fff'; ctx.fillRect(qx - 8, qy - 8, qs + 16, qs + 16);
    const qrImg = await loadImg(qr);
    if (qrImg) ctx.drawImage(qrImg, qx, qy, qs, qs);
    else { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(qx, qy, qs, qs); ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('上传二维码', qx + qs / 2, qy + qs / 2); ctx.textAlign = 'left'; }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px sans-serif'; ctx.fillText('长按识别 · 添加微信', qx + qs / 2 - 48, qy + qs + 18);
  }

  function onQr(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setQr(reader.result);
    reader.readAsDataURL(file);
  }

  function save() {
    const url = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = (form.name || '工作室') + '名片.png';
    a.click();
  }

  const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-panel text-fg outline-none focus:border-brand';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-fg">生成名片</h1>
        <p className="text-xs text-muted mt-0.5">一键生成工作室分享名片，保存图片后可发朋友圈 / 微信群获客</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="bg-panel border border-line rounded-xl2 p-5 space-y-3">
          <label className="block"><div className="text-xs text-muted mb-1.5">名称</div>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block"><div className="text-xs text-muted mb-1.5">简介</div>
            <input className={inputCls} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} /></label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block"><div className="text-xs text-muted mb-1.5">电话</div>
              <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block"><div className="text-xs text-muted mb-1.5">微信</div>
              <input className={inputCls} value={form.wechat} onChange={(e) => setForm({ ...form, wechat: e.target.value })} /></label>
            <label className="block"><div className="text-xs text-muted mb-1.5">地址</div>
              <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          </div>
          <div>
            <div className="text-xs text-muted mb-1.5">二维码（微信 / 公众号）</div>
            <div className="flex items-center gap-3">
              {qr && <img src={qr} className="w-14 h-14 rounded-lg border border-line object-cover" />}
              <button onClick={() => qrRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand">上传二维码</button>
              <input ref={qrRef} type="file" accept="image/*" className="hidden" onChange={(e) => onQr(e.target.files[0])} />
            </div>
          </div>
          <button onClick={save} className="w-full px-4 py-2.5 rounded-lg bg-brand text-white text-sm hover:opacity-90">保存图片（PNG）</button>
        </div>

        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-xs text-muted mb-3">名片预览</div>
          <canvas ref={canvasRef} className="w-full rounded-xl shadow-sm" />
        </div>
      </div>
    </div>
  );
}
