import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import http, { img, thumb } from '../api.js';

// ===== 选片工具 · C 端客户选片页（100% 原版复刻） =====
// 鉴权：token 短链免登录（= orders.customer_token，强绑定 order_id）+ 可选访问密码二重校验
// 原版核心逻辑：无加片费提交直接锁定（已完成）；有加片费提交进入待支付，选片不锁定可继续改标记
// 交互：顶部常驻统计栏；网格缩略图角标；大图左右滑 + 双指缩放；标记互斥可取消；仅保留可编辑备注；批量清空
// UI：玻璃拟态 + SoftUI；层级靠字号/灰度/间距，不滥用加粗（fontWeight ≤ 400）
const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BG = '#F5F5F7';
const KEEP = '#FF5A5F';
const REJECT = '#8E8E93';

const STATUS_LABEL = { keep: '保留', reject: '淘汰' };

function toMap(arr) {
  const m = {};
  (arr || []).forEach((x) => { m[x.photo_id] = { status: x.status, remark: x.remark || '' }; });
  return m;
}

export default function SelectionClient() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | error | locked | not_started | ready | completed
  const [errMsg, setErrMsg] = useState('');
  const [selectToken, setSelectToken] = useState('');
  const [meta, setMeta] = useState({});
  const [task, setTask] = useState({});
  const [photos, setPhotos] = useState([]);
  const [marks, setMarks] = useState({});
  const [stats, setStats] = useState({ keep: 0, reject: 0, unmarked: 0, total: 0 });
  const [extra, setExtra] = useState({ extraCount: 0, extraFee: 0 });
  const [pendingFee, setPendingFee] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [view, setView] = useState('grid');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const touchX = useRef(0);
  const pinchRef = useRef(null);

  const authHeaders = useCallback(() => (selectToken ? { 'x-select-token': selectToken } : {}), [selectToken]);

  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!task.expire_at) { setCountdown(''); return; }
    const tick = () => {
      const d = new Date(task.expire_at).getTime() - Date.now();
      if (d <= 0) { setCountdown('已过期'); return; }
      const days = Math.floor(d / 86400000);
      const h = Math.floor((d % 86400000) / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      setCountdown(days > 0 ? `${days}天${h}小时` : `${h}小时${m}分`);
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [task.expire_at]);

  useEffect(() => {
    http.get('/api/selection/c/' + token)
      .then((r) => {
        const d = r.data || {};
        if (d.not_started) { setPhase('not_started'); return; }
        if (d.locked) { setMeta(d.meta || {}); setPhase('locked'); return; }
        setMeta(d.meta || {});
        setTask(d.task || {});
        setPhase('ready');
        loadPhotos(1);
      })
      .catch((e) => { setErrMsg((e.response && e.response.data && e.response.data.error) || '加载失败'); setPhase('error'); });
  }, [token]);

  const loadPhotos = useCallback((p, append) => {
    http.get('/api/selection/c/' + token + '/photos?page=' + p + '&size=60', { headers: authHeaders() })
      .then((r) => {
        const d = r.data || {};
        setPhotos((prev) => (append ? [...prev, ...(d.photos || [])] : (d.photos || [])));
        setMarks((prev) => (append ? { ...prev, ...toMap(d.marks) } : toMap(d.marks)));
        setStats(d.stats || { keep: 0, reject: 0, unmarked: 0, total: 0 });
        setExtra(d.extra || { extraCount: 0, extraFee: 0 });
        setTotal(d.total || 0);
        setPage(p);
        setHasMore(p * 60 < (d.total || 0));
        setPendingFee((d.task && d.task.pending_fee) || d.pending_fee || 0);
        if (d.status === 'completed') setPhase('completed');
        else if (d.status === 'pending_payment') setPhase('ready');
      })
      .catch((e) => { if (e.response && e.response.status === 401) setPhase('locked'); });
  }, [token, authHeaders]);

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'completed') return;
    const t = setInterval(() => {
      http.get('/api/selection/c/' + token + '/state')
        .then((r) => {
          const d = r.data || {};
          if (d.completed) { setPhase('completed'); return; }
          setStats(d.stats || stats);
          setExtra(d.extra || extra);
          setPendingFee(d.pending_fee || 0);
          setTask((tk) => (tk ? { ...tk, status: d.status } : tk));
        }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [phase, token]);

  useEffect(() => {
    if (phase !== 'ready') return;
    setNotice('为保护照片版权，请勿截图或录屏');
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const verify = async (e) => {
    e.preventDefault();
    setPwBusy(true); setPwErr('');
    try {
      const r = await http.post('/api/selection/c/' + token + '/verify', { password: pw });
      const d = r.data || {};
      setSelectToken(d.select_token || '');
      setTask((d.data && d.data.task) || {});
      setMeta((d.data && d.data.order) || {});
      setMarks(toMap(d.data && d.data.marks));
      setStats((d.data && d.data.stats) || { keep: 0, reject: 0, unmarked: 0, total: 0 });
      setExtra((d.data && d.data.extra) || { extraCount: 0, extraFee: 0 });
      setPhotos((d.data && d.data.photos) || []);
      setTotal((d.data && d.data.photos) ? d.data.photos.length : 0);
      setPendingFee((d.data && d.data.task && d.data.task.pending_fee) || 0);
      setPhase((d.data && d.data.task && d.data.task.status) === 'completed' ? 'completed' : 'ready');
    } catch (e2) { setPwErr((e2.response && e2.response.data && e2.response.data.error) || '密码错误'); }
    finally { setPwBusy(false); }
  };

  const applyMark = async (photoId, status) => {
    const prev = marks[photoId];
    const optimistic = status === null ? undefined : { status, remark: (prev && prev.remark) || '' };
    setMarks((m) => {
      const n = { ...m };
      if (optimistic) n[photoId] = optimistic; else delete n[photoId];
      return n;
    });
    setSyncing(true);
    try {
      const r = await http.post('/api/selection/c/' + token + '/mark', { photoId, status, remark: (optimistic && optimistic.remark) || '' }, { headers: authHeaders() });
      setStats(r.data.stats); setExtra(r.data.extra);
    } catch (e) {
      setMarks((m) => { const n = { ...m }; if (prev) n[photoId] = prev; else delete n[photoId]; return n; });
      toast((e.response && e.response.data && e.response.data.error) || '标记失败');
    } finally { setSyncing(false); }
  };

  const toggleMark = (photoId, status) => {
    const cur = marks[photoId] && marks[photoId].status;
    applyMark(photoId, cur === status ? null : status);
  };

  const saveRemark = async (photoId, remark) => {
    const cur = marks[photoId];
    if (!cur || cur.status !== 'keep') return;
    setMarks((m) => ({ ...m, [photoId]: { ...cur, remark } }));
    try {
      const r = await http.post('/api/selection/c/' + token + '/mark', { photoId, status: 'keep', remark }, { headers: authHeaders() });
      setStats(r.data.stats); setExtra(r.data.extra);
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '备注保存失败'); }
  };

  const clearAll = async () => {
    if (!window.confirm('确定清空全部标记？所有「保留 / 淘汰」将回到未标记状态。')) return;
    try {
      const r = await http.post('/api/selection/c/' + token + '/clear', {}, { headers: authHeaders() });
      setMarks({}); setStats(r.data.stats); setExtra(r.data.extra);
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '清空失败'); }
  };

  const submit = async () => {
    const keep = stats.keep || 0;
    const extraTxt = extra.extraCount > 0 ? `，超出免费额度 ${extra.extraCount} 张（加片费 ¥${extra.extraFee.toFixed(2)}）` : '';
    if (!window.confirm(`确认提交选片？\n已选保留 ${keep} 张${extraTxt}。`)) return;
    setSubmitting(true);
    try {
      const r = await http.post('/api/selection/c/' + token + '/submit', {}, { headers: authHeaders() });
      setStats(r.data.stats); setExtra(r.data.extra); setPendingFee(r.data.pending_fee || 0);
      if (r.data.status === 'completed') { setPhase('completed'); toast('选片已完成，感谢您的选择！'); }
      else { setPhase('ready'); toast(`已提交，待支付加片费 ¥${(r.data.pending_fee || 0).toFixed(2)}，可继续调整选片`); }
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '提交失败'); }
    finally { setSubmitting(false); }
  };

  const onTouchStart = (e) => {
    touchX.current = e.touches[0].clientX;
    if (e.touches.length === 2) pinchRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(Math.min(3, Math.max(1, d / pinchRef.current)));
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length === 0 && e.changedTouches.length === 1 && pinchRef.current == null) {
      const dx = e.changedTouches[0].clientX - touchX.current;
      if (Math.abs(dx) > 50) {
        const n = photos.length;
        setPreviewIndex((i) => (dx < 0 ? (i + 1) % n : (i - 1 + n) % n));
        setZoom(1);
      }
    }
    pinchRef.current = null;
  };
  const dblTap = () => setZoom((z) => (z > 1 ? 1 : 2));

  if (phase === 'loading') return <Center><div style={{ color: FAINT, fontSize: 14 }}>加载中…</div></Center>;
  if (phase === 'error') return <Center><div style={{ fontSize: 40 }}>🔗</div><div style={{ fontSize: 16, color: TEXT, marginTop: 12 }}>{errMsg || '链接无效'}</div><div style={{ fontSize: 13, color: FAINT, marginTop: 6, textAlign: 'center', lineHeight: 1.7 }}>该选片链接可能已失效、被关闭或已过期，请联系摄影师获取最新链接。</div></Center>;
  if (phase === 'not_started') return <Center><div style={{ fontSize: 40 }}>🖼️</div><div style={{ fontSize: 16, color: TEXT, marginTop: 12 }}>选片尚未开启</div><div style={{ fontSize: 13, color: FAINT, marginTop: 6 }}>摄影师上传底片并开启选片后即可访问。</div></Center>;
  if (phase === 'locked') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F7FAF9 0%,#EEF4F1 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Glass style={{ width: '100%', maxWidth: 360, padding: '32px 24px' }}>
          <div style={{ textAlign: 'center', fontSize: 42, marginBottom: 12 }}>🔒</div>
          <div style={{ textAlign: 'center', fontSize: 17, color: TEXT }}>{meta.package_name || '选片相册'}</div>
          <div style={{ textAlign: 'center', fontSize: 13, color: SUB, marginTop: 4, marginBottom: 24 }}>请输入访问密码查看</div>
          <form onSubmit={verify}>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="访问密码"
              style={{ width: '100%', padding: '13px 16px', borderRadius: 14, border: '1px solid #E4E4E7', background: 'rgba(255,255,255,0.85)', fontSize: 15, color: TEXT, outline: 'none', textAlign: 'center', boxSizing: 'border-box' }} />
            {pwErr && <div style={{ color: KEEP, fontSize: 12, marginTop: 10, textAlign: 'center' }}>{pwErr}</div>}
            <button type="submit" disabled={pwBusy}
              style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', opacity: pwBusy ? 0.5 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>进入选片</button>
          </form>
        </Glass>
      </div>
    );
  }

  const cur = photos[previewIndex];
  const curMark = cur ? marks[cur.id] : null;
  const locked = phase === 'completed';
  const pending = task.status === 'pending_payment';

  if (view === 'preview' && cur) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0B0B0C', zIndex: 999, display: 'flex', flexDirection: 'column' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', color: '#fff', zIndex: 2 }}>
          <button onClick={() => { setView('grid'); setZoom(1); }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer' }}>‹ 返回</button>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>{previewIndex + 1} / {photos.length}</span>
          <span style={{ width: 50 }} />
        </div>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src={img(cur.url || cur.thumb_url)} alt="" draggable={false} onDoubleClick={dblTap}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none', WebkitUserSelect: 'none', transform: `scale(${zoom})`, transition: 'transform .15s' }} />
          {task.thumb_only && !task.delivered && !cur.url && (
            <div style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.45)', padding: '4px 12px', borderRadius: 10 }}>成片交付后可见高清原图，当前仅预览</span>
            </div>
          )}
          {task.watermark_enabled && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 18, letterSpacing: 4, transform: 'rotate(-20deg)', whiteSpace: 'nowrap' }}>YEZHE WORKSHOP</span>
            </div>
          )}
          {task.screenshot_guard && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.12)' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, letterSpacing: 2, background: 'rgba(0,0,0,0.4)', padding: '6px 14px', borderRadius: 10 }}>请勿截屏/录屏，尊重客户隐私</span>
            </div>
          )}
        </div>
        <div style={{ padding: '14px 16px calc(16px + env(safe-area-inset-bottom))', background: 'rgba(20,20,22,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {['keep', 'reject'].map((s) => {
              const active = curMark && curMark.status === s;
              const c = s === 'keep' ? KEEP : REJECT;
              return (
                <button key={s} onClick={() => toggleMark(cur.id, s)} disabled={locked}
                  style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: active ? '1.5px solid ' + c : '1px solid rgba(255,255,255,0.15)', background: active ? 'rgba(255,255,255,0.12)' : 'transparent', color: active ? c : 'rgba(255,255,255,0.75)', fontSize: 15, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1 }}>
                  {STATUS_LABEL[s]}{active ? ' ✓' : ''}
                </button>
              );
            })}
            {curMark && (
              <button onClick={() => applyMark(cur.id, null)} disabled={locked}
                style={{ padding: '13px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 14, cursor: 'pointer' }}>取消</button>
            )}
          </div>
          {curMark && curMark.status === 'keep' && (
            <input value={curMark.remark || ''} onChange={(e) => saveRemark(cur.id, e.target.value)} placeholder="修图备注（仅保留照片可填写）" disabled={locked}
              style={{ width: '100%', marginTop: 10, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(245,245,247,0.82)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ fontSize: 16, color: TEXT }}>{meta.package_name || '选片相册'}</div>
          <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
            {locked ? '选片已完成，标记已锁定' : '点击照片标记 保留 / 淘汰'}
            {countdown && <span style={{ marginLeft: 8, color: countdown === '已过期' ? KEEP : SUB }}>⏱ {countdown}</span>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 12px 0' }}>
        {!photos.length && <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '60px 0' }}>相册暂无照片</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {photos.map((p, i) => {
            const m = marks[p.id];
            const badge = m ? (m.status === 'keep' ? KEEP : REJECT) : null;
            return (
              <div key={p.id} onClick={() => { setPreviewIndex(i); setView('preview'); setZoom(1); }}
                style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <img src={thumb(p.thumb_url || p.url, 400)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {task.watermark_enabled && (
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10, letterSpacing: 2, transform: 'rotate(-20deg)' }}>YEZHE</span>
                  </div>
                )}
                {badge && (
                  <span style={{ position: 'absolute', top: 5, right: 5, padding: '2px 8px', borderRadius: 10, background: badge, color: '#fff', fontSize: 11, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>
                    {STATUS_LABEL[m.status]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {hasMore && (
          <button onClick={() => loadPhotos(page + 1, true)} disabled={loadingMore}
            style={{ width: '100%', marginTop: 12, padding: '11px 0', borderRadius: 12, border: '1px solid #E4E4E7', background: '#fff', color: SUB, fontSize: 13, cursor: 'pointer' }}>
            {loadingMore ? '加载中…' : `加载更多（${total - photos.length} 张）`}
          </button>
        )}
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, background: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 -6px 24px rgba(0,0,0,0.06)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }}>
          {pending && (
            <div style={{ fontSize: 12, color: '#C77B00', marginBottom: 8 }}>已提交，待支付加片费 ¥{pendingFee.toFixed(2)}，支付前可继续调整选片</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Stat label="免费额度" value={`${task.min_retouch || 0} 张`} color={TEXT} />
            <Stat label="已选保留" value={`${stats.keep} 张`} color={KEEP} />
            <Stat label="加选数量" value={`${extra.extraCount} 张`} color={extra.extraCount > 0 ? '#F5A623' : TEXT} />
            <Stat label="加选合计" value={`¥${extra.extraFee.toFixed(2)}`} color={extra.extraCount > 0 ? '#F5A623' : TEXT} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {locked ? (
              <button style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: 'none', background: '#C7C7CC', color: '#fff', fontSize: 15, cursor: 'default' }}>已完成选片</button>
            ) : (
              <>
                <button onClick={clearAll} style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid #E4E4E7', background: '#fff', color: SUB, fontSize: 14, cursor: 'pointer' }}>清空</button>
                <button onClick={submit} disabled={submitting}
                  style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: 'pointer', boxShadow: '0 8px 20px rgba(126,205,187,0.35)', opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? '提交中…' : (pending ? '重新提交' : '提交选片')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: 'rgba(29,29,31,0.92)', color: '#fff', fontSize: 13, padding: '12px 20px', borderRadius: 20, maxWidth: '80%', textAlign: 'center' }}>{notice}</div>
      )}
      {syncing && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: 'rgba(29,29,31,0.7)', color: '#fff', fontSize: 12, padding: '6px 16px', borderRadius: 14 }}>正在同步…</div>
      )}
    </div>
  );
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</div>;
}
function Glass({ children, style }) {
  return <div style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7)', ...style }}>{children}</div>;
}
function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11, color: FAINT }}>{label}</div>
      <div style={{ fontSize: 16, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
function toast(msg) {
  const id = '__sel_toast__';
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1f2329;color:#fff;padding:10px 20px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}
