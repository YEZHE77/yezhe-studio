import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== 选片工具 · C 端客户选片页（对标拾光盒子 Lite 交互，H5 实现） =====
// UI 规则：零加粗（fontWeight 仅 400/500）、灰度+字号+间距区分层级、卡片圆角、玻璃拟态+SoftUI、手机优先
// 三态标记：like 喜欢 / exclude 排除 / pending 待定；逐张实时回写；底部实时统计保底精修/已选/加片金额
const MARK_META = {
  like:    { label: '喜欢', color: '#FF5A5F', icon: '♥', bg: 'rgba(255,90,95,0.12)' },
  exclude: { label: '排除', color: '#8E8E93', icon: '✕', bg: 'rgba(142,142,147,0.12)' },
  pending: { label: '待定', color: '#8E8E93', icon: '', bg: 'transparent' }
};

const BRAND = '#7ECDBB';          // 品牌青绿
const TEXT = '#1D1D1F';           // 主文字
const SUB = '#6E6E73';            // 次级
const FAINT = '#AEAEB2';          // 弱
const BG = '#F5F5F7';             // SoftUI 底

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function SelectionClient() {
  const { token } = useParams();
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [data, setData] = useState(null);        // { task, photos, marks, stats, extra }
  const [marks, setMarks] = useState({});
  const [view, setView] = useState('grid');      // grid | preview
  const [previewIndex, setPreviewIndex] = useState(0);
  const [shuffled, setShuffled] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');       // 防截图 / 提示弹窗
  const touchX = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    http.get('/api/selection/c/' + token)
      .then((r) => {
        const d = r.data;
        if (d.locked) { setLocked(true); setErr(''); }
        else { setData(d.data); setMarks(d.data.marks || {}); setErr(''); }
      })
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [token]);

  // 防截图提示：进入页面首次弹一次；切后台（疑似截图）再弹
  useEffect(() => {
    if (!data || data.task.submitted) return;
    setNotice('为保护您的照片版权，请勿截图或录屏。感谢理解。');
    const t = setTimeout(() => setNotice(''), 3000);
    const onVis = () => { if (document.visibilityState === 'hidden') setNotice(''); else setNotice('请勿截图或录屏，照片版权归工作室所有。'); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [data]);

  // 实时同步：多人同 token，每 3 秒拉一次最新标记
  useEffect(() => {
    if (!data || locked) return;
    const t = setInterval(() => {
      http.get('/api/selection/c/' + token + '/state')
        .then((r) => {
          if (r.data && r.data.ok) {
            setMarks(r.data.marks || {});
            setData((d) => (d ? { ...d, stats: r.data.stats, extra: r.data.extra, submitted: r.data.submitted } : d));
          }
        }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [data, locked, token]);

  const verify = async (e) => {
    e.preventDefault();
    setPwBusy(true); setPwErr('');
    try {
      const r = await http.post('/api/selection/c/' + token + '/verify', { password: pw });
      setData(r.data.data);
      setMarks(r.data.data.marks || {});
      setLocked(false);
    } catch (e2) { setPwErr((e2.response && e2.response.data && e2.response.data.error) || '密码错误'); }
    finally { setPwBusy(false); }
  };

  const mark = async (photoKey, status) => {
    if (!data || data.task.submitted) return;
    const prev = marks[photoKey];
    setMarks((m) => ({ ...m, [photoKey]: status }));
    try {
      const r = await http.post('/api/selection/c/' + token + '/mark', { photoKey, status });
      if (r.data && r.data.stats) {
        setData((d) => (d ? { ...d, stats: r.data.stats, extra: r.data.extra } : d));
      }
    } catch (e) {
      setMarks((m) => ({ ...m, [photoKey]: prev })); // 回滚
      setNotice('标记失败，请重试');
      setTimeout(() => setNotice(''), 2000);
    }
  };

  const submit = async () => {
    if (!data) return;
    const like = data.stats ? data.stats.like : 0;
    if (!window.confirm(`确认提交选片？\n已选 ${like} 张${data.extra && data.extra.extraCount > 0 ? `，超出保底 ${data.extra.extraCount} 张（预估加片 ¥${data.extra.extraFee.toFixed(2)}）` : ''}。\n提交后不可再修改。`)) return;
    setSubmitting(true);
    try {
      const r = await http.post('/api/selection/c/' + token + '/submit');
      setData((d) => (d ? { ...d, task: { ...d.task, submitted: true }, stats: r.data.stats, extra: r.data.extra } : d));
      setNotice('选片已提交，感谢您的选择！');
    } catch (e) { setNotice((e.response && e.response.data && e.response.data.error) || '提交失败'); }
    finally { setSubmitting(false); }
  };

  const openPreview = (idx) => { setPreviewIndex(idx); setView('preview'); };
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 50) {
      const n = displayPhotos.length;
      if (dx < 0) setPreviewIndex((i) => (i + 1) % n);
      else setPreviewIndex((i) => (i - 1 + n) % n);
    }
  };

  if (loading) {
    return <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;
  }

  // 密码校验页
  if (locked) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F7FAF9 0%,#EEF4F1 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, padding: '32px 24px', boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7)' }}>
          <div style={{ textAlign: 'center', fontSize: 42, marginBottom: 12 }}>🔒</div>
          <div style={{ textAlign: 'center', fontSize: 17, color: TEXT, marginBottom: 4 }}>选片相册</div>
          <div style={{ textAlign: 'center', fontSize: 13, color: SUB, marginBottom: 24 }}>请输入访问密码查看</div>
          <form onSubmit={verify}>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="访问密码"
              style={{ width: '100%', padding: '13px 16px', borderRadius: 14, border: '1px solid #E4E4E7', background: 'rgba(255,255,255,0.85)', fontSize: 15, color: TEXT, outline: 'none', textAlign: 'center', boxSizing: 'border-box' }} />
            {pwErr && <div style={{ color: '#FF5A5F', fontSize: 12, marginTop: 10, textAlign: 'center' }}>{pwErr}</div>}
            <button type="submit" disabled={pwBusy}
              style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', opacity: pwBusy ? 0.5 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
              进入选片
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: SUB, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
        <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '链接无效'}</div>
        <div style={{ fontSize: 13, color: FAINT, lineHeight: 1.7 }}>该选片链接可能已失效、被关闭或已过期，请联系摄影师获取最新链接。</div>
      </div>
    );
  }

  const photos = data.photos || [];
  const displayPhotos = shuffled ? shuffleArr(photos) : photos;
  const task = data.task || {};
  const stats = data.stats || { like: 0, exclude: 0, pending: 0, total: 0 };
  const extra = data.extra || { extraCount: 0, extraFee: 0 };
  const submitted = !!task.submitted;

  // ===== 大图预览模式 =====
  if (view === 'preview') {
    const p = displayPhotos[previewIndex];
    const curStatus = p ? (marks[p.key] || 'pending') : 'pending';
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0B0B0C', zIndex: 999, display: 'flex', flexDirection: 'column' }}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* 顶部：返回 + 计数 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', color: '#fff' }}>
          <button onClick={() => setView('grid')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', padding: '4px 8px' }}>‹ 返回</button>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>{previewIndex + 1} / {displayPhotos.length}</span>
          <span style={{ width: 50 }} />
        </div>

        {/* 图片（水印叠加） */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {p && (
            <>
              <img src={img(p.url)} alt="" draggable={false}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none', WebkitUserSelect: 'none' }} />
              {task.watermark_enabled && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 18, letterSpacing: 4, transform: 'rotate(-20deg)', whiteSpace: 'nowrap' }}>YEZHE WORKSHOP</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部：三态按钮 */}
        <div style={{ padding: '18px 16px calc(20px + env(safe-area-inset-bottom))', background: 'rgba(20,20,22,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {['like', 'exclude', 'pending'].map((s) => {
              const m = MARK_META[s];
              const active = curStatus === s;
              return (
                <button key={s} onClick={() => mark(p.key, s)} disabled={submitted}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 14, border: active ? '1.5px solid ' + m.color : '1px solid rgba(255,255,255,0.15)',
                    background: active ? m.bg : 'transparent', color: active ? m.color : 'rgba(255,255,255,0.7)',
                    fontSize: 15, cursor: submitted ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: submitted ? 0.4 : 1
                  }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span>{m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ===== 网格模式 =====
  return (
    <div style={{ minHeight: '100vh', background: BG, paddingBottom: 'calc(92px + env(safe-area-inset-bottom))' }}>
      {/* 顶部 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(245,245,247,0.82)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 560, margin: '0 auto' }}>
          <div>
            <div style={{ fontSize: 16, color: TEXT, lineHeight: 1.4 }}>选片相册{submitted ? '' : ''}</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{submitted ? '已完成选片，感谢您的选择' : '点击照片标记喜欢 / 排除 / 待定'}</div>
          </div>
          <button onClick={() => setShuffled((v) => !v)} disabled={submitted}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1px solid #E4E4E7', background: shuffled ? 'rgba(126,205,187,0.15)' : '#fff', color: shuffled ? '#3E9C8B' : SUB, fontSize: 13, cursor: submitted ? 'not-allowed' : 'pointer' }}>
            {shuffled ? '已打乱' : '打乱顺序'}
          </button>
        </div>
      </div>

      {/* 网格 */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 12px 0' }}>
        {!photos.length && (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '60px 0' }}>相册暂无照片</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {displayPhotos.map((p, i) => {
            const s = marks[p.key] || 'pending';
            const m = MARK_META[s];
            return (
              <div key={p.key} onClick={() => openPreview(i)}
                style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <img src={img(p.url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {task.watermark_enabled && (
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10, letterSpacing: 2, transform: 'rotate(-20deg)' }}>YEZHE</span>
                  </div>
                )}
                {/* 标记角标 */}
                {s !== 'pending' && (
                  <span style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%', background: m.color, color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>{m.icon}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部实时统计栏 */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, background: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 -6px 24px rgba(0,0,0,0.06)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 11, color: FAINT }}>保底精修</div>
              <div style={{ fontSize: 17, color: TEXT, marginTop: 2 }}>{task.min_retouch} 张</div>
            </div>
            <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 11, color: FAINT }}>已选（喜欢）</div>
              <div style={{ fontSize: 17, color: '#FF5A5F', marginTop: 2 }}>{stats.like} 张</div>
            </div>
            <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 11, color: FAINT }}>预估加片</div>
              <div style={{ fontSize: 17, color: extra.extraCount > 0 ? '#F5A623' : TEXT, marginTop: 2 }}>¥{extra.extraFee.toFixed(2)}</div>
            </div>
          </div>
          <button onClick={submit} disabled={submitting || submitted}
            style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: submitted ? '#C7C7CC' : BRAND, color: '#fff', fontSize: 15, cursor: submitted ? 'default' : 'pointer', boxShadow: submitted ? 'none' : '0 8px 20px rgba(126,205,187,0.35)' }}>
            {submitted ? '已完成选片' : submitting ? '提交中…' : '提交选片'}
          </button>
        </div>
      </div>

      {/* 防截图提示弹窗 */}
      {notice && (
        <div style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(29,29,31,0.92)', color: '#fff', fontSize: 13, padding: '12px 20px', borderRadius: 20, boxShadow: '0 8px 30px rgba(0,0,0,0.25)', maxWidth: '80%', textAlign: 'center', lineHeight: 1.6 }}>{notice}</div>
      )}
    </div>
  );
}
