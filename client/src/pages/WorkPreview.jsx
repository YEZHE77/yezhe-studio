import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img } from '../api.js';

/* ==========================================================================
   作品预览页（1:1 复刻小程序风格）
   —— 点击作品相册后先进入预览，右上角 ⋯ 菜单可选编辑
   ========================================================================== */

const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';

// 内联 SVG 图标
function IconBack() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
function IconGrid() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
}
function IconShare() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}
function IconMore() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>;
}
function IconComment() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
}
function IconChart() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}
function IconPlay() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>;
}

export default function WorkPreview() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  // 幻灯片播放
  const [slideOpen, setSlideOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [slidePaused, setSlidePaused] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/works/' + id).then((r) => {
      setData(r.data || null);
    }).catch(() => { setData(null); }).finally(() => setLoading(false));
  }, [id]);

  // 工作室资料（底部品牌栏：头像 logo + 名称 + Slogan，接口驱动不写死）
  useEffect(() => {
    http.get('/api/settings/studio').then((r) => {
      setStudio(r.data || null);
    }).catch(() => { /* 无数据不渲染品牌行，不 fallback 假数据 */ });
  }, []);

  // 幻灯片照片总数（顶层无条件计算，hooks 规则：禁止放在条件 return 之后）
  const slideCount = (data?.albums || []).filter((a) => a.zone === 'sample' && a.photo_url).length;
  useEffect(() => {
    if (!slideOpen || slidePaused || slideCount < 2) return;
    const t = setInterval(() => setSlideIdx((i) => (i + 1) % slideCount), 3000);
    return () => clearInterval(t);
  }, [slideOpen, slidePaused, slideCount]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }
  if (!data || !data.work) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', paddingTop: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#999' }}>作品不存在或已删除</div>
        <button onClick={() => nav('/works')} style={{ marginTop: 16, fontSize: 14, color: MRED, background: 'none', border: 'none' }}>返回作品列表</button>
      </div>
    );
  }

  const w = data.work || {};
  // 当前相册照片：sample 分区的真实照片（字段 photo_url / thumb_url）
  const albums = (data.albums || []).filter((a) => a.zone === 'sample' && a.photo_url);
  const cover = w.cover_url;
  const catName = w.category_name || (w.category_id ? '作品' : '');
  // 品牌栏：头像 logo / 名称 / Slogan 全部来自设置接口
  const brandName = studio?.name || '';
  const brandSlogan = studio?.slogan || '';
  const brandLogo = studio?.logo || '';
  // 关于我们卡片：简介/品牌故事（intro）+ 微信 / 电话 / 地址（接口驱动，不写死）
  const brandIntro = studio?.intro || '';
  const contact = studio?.contact || {};
  const socials = studio?.socials || {};
  const wechat = socials.wechat || contact.wechat || '';
  const phone = socials.phone || contact.phone || '';
  const address = studio?.address || contact.address || '';

  // 幻灯片照片源 = 当前相册
  const slidePhotos = albums.map((a) => img(a.photo_url));

  const startSlide = () => { setSlideIdx(0); setSlidePaused(false); setSlideOpen(true); };

  // 下架（is_public 0：C 端不可见）—— 与套系预览一致：确认后返回列表
  const handleOff = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认下架该作品？下架后 C 端不可见')) return;
    try {
      await http.patch('/api/works/' + id + '/public', { is_public: 0 });
      alert('已下架');
      nav('/works');
    } catch (e) {
      alert(e?.response?.data?.error || '下架失败');
    }
  };

  // 上架（is_public 1：C 端可见）—— 刷新当前页数据
  const handleOn = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认上架该作品？上架后 C 端可见')) return;
    try {
      await http.patch('/api/works/' + id + '/public', { is_public: 1 });
      alert('已上架');
      const r = await http.get('/api/works/' + id);
      setData(r.data || null);
    } catch (e) {
      alert(e?.response?.data?.error || '上架失败');
    }
  };

  // 删除（不可恢复）
  const handleDelete = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认删除该作品？删除后不可恢复')) return;
    try {
      await http.delete('/api/works/' + id);
      alert('已删除');
      nav('/works');
    } catch (e) {
      alert(e?.response?.data?.error || '删除失败');
    }
  };

  // 分享（与套系预览 1:1）
  const handleShare = async () => {
    if (shareData) { setShareModalOpen(true); return; }
    setShareBusy(true);
    try {
      const r = await http.post('/api/shares', { type: 'work', ref_id: parseInt(id, 10) });
      setShareData(r.data);
      setShareModalOpen(true);
    } catch (e) {
      alert(e?.response?.data?.error || '生成分享失败');
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = () => {
    if (!shareData?.share_url) return;
    navigator.clipboard?.writeText(shareData.share_url);
    alert('链接已复制');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航（透明背景，悬浮在图片上） */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', paddingTop: 'calc(8px + env(safe-area-inset-top))',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)'
      }}>
        <button onClick={() => nav('/works')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
          <IconBack />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={handleShare} disabled={shareBusy} style={{ width: 32, height: 32, borderRadius: '50%', background: MRED, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: shareBusy ? 0.5 : 1 }}>
            <IconShare />
          </button>
          <button onClick={() => setActionSheetOpen(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}>
            <IconMore />
          </button>
        </div>
      </div>

      {/* 封面大图 */}
      <div style={{ width: '100%', aspectRatio: '3/4', background: '#1a1a1a', position: 'relative', overflow: 'hidden' }}>
        {cover ? (
          <img src={img(cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : albums[0] ? (
          <img src={img(albums[0].photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>暂无封面</div>
        )}
      </div>

      {/* 标题 + 分类 + 描述 */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#1f2329', lineHeight: 1.4 }}>{w.title || '未命名作品'}</div>
        {catName && (
          <div style={{ marginTop: 8, display: 'inline-block', fontSize: 12, color: '#999', background: '#f5f5f5', padding: '3px 10px', borderRadius: 4 }}>{catName}</div>
        )}
        {w.description && (
          <div style={{ marginTop: 12, fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{w.description}</div>
        )}
      </div>

      {/* 相册样片网格 */}
      {albums.length > 0 && (
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
            作品相册
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: showGrid ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 4 }}>
            {albums.map((a, i) => (
              <div key={a.id || i} style={{ aspectRatio: '1', background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
                <img src={img(a.thumb_url || a.photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 关于我们（资料设置：简介/品牌故事 + 微信 / 电话 / 地址） */}
      {studio ? (
        <div style={{ padding: '24px 16px 40px', borderTop: `1px solid ${MBORDER}` }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#333', textAlign: 'center', marginBottom: 20 }}>关于我们</div>
          {(studio.serviceQr || studio.logo) ? (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img src={img(studio.serviceQr || studio.logo)} alt="" style={{ width: 120, height: 120, objectFit: 'contain' }} />
            </div>
          ) : null}
          <div style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 }}>{studio.name}</div>
          {brandIntro ? (
            <div style={{ fontSize: 13, color: '#666', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 12, padding: '0 4px' }}>{brandIntro}</div>
          ) : null}
          {wechat ? (
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${MBORDER}`, fontSize: 14 }}>
              <span style={{ color: '#999', width: 60, flexShrink: 0 }}>微信</span>
              <span style={{ color: '#333', flex: 1 }}>{wechat}</span>
            </div>
          ) : null}
          {phone ? (
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${MBORDER}`, fontSize: 14 }}>
              <span style={{ color: '#999', width: 60, flexShrink: 0 }}>电话</span>
              <span style={{ color: '#333', flex: 1 }}>{phone}</span>
            </div>
          ) : null}
          {address ? (
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${MBORDER}`, fontSize: 14 }}>
              <span style={{ color: '#999', width: 60, flexShrink: 0 }}>地址</span>
              <span style={{ color: '#333', flex: 1 }}>{address}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 底部品牌栏（模拟截图底部） */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: '#fff', borderTop: '1px solid ' + MBORDER,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f2f2f2', overflow: 'hidden', flexShrink: 0 }}>
            {brandLogo ? <img src={img(brandLogo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandName}</div>
            {brandSlogan ? <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandSlogan}</div> : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <IconComment />
          <IconChart />
          <button onClick={startSlide} disabled={slidePhotos.length === 0} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', opacity: slidePhotos.length === 0 ? 0.4 : 1 }}>
            <IconPlay />
          </button>
        </div>
      </div>

      {/* 全屏幻灯片播放（点击播放按钮进入，3s 自动切换） */}
      {slideOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#000' }}>
          {/* 顶部控制条：关闭 + 序号 + 暂停/继续 */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)'
          }}>
            <button onClick={() => setSlideOpen(false)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}>
              <IconBack />
            </button>
            <span style={{ color: '#fff', fontSize: 13 }}>{slideIdx + 1} / {slidePhotos.length}</span>
            <button onClick={() => setSlidePaused(!slidePaused)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>
              {slidePaused ? '▶' : '❚❚'}
            </button>
          </div>
          {/* 主图：点击切换 暂停/继续 */}
          <div
            onClick={() => setSlidePaused(!slidePaused)}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <img src={slidePhotos[slideIdx]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {/* 底部进度点 */}
          <div style={{
            position: 'absolute', bottom: 'calc(24px + env(safe-area-inset-bottom))', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: 6
          }}>
            {slidePhotos.map((_, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === slideIdx ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'background 0.2s' }} />
            ))}
          </div>
        </div>
      )}

      {/* 右上角操作弹窗（Action Sheet，与套系预览 1:1） */}
      {actionSheetOpen && (
        <>
          <div onClick={() => setActionSheetOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 111, background: '#fff', borderRadius: '16px 16px 0 0', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
            <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 15, fontWeight: 500, color: '#333', borderBottom: `1px solid ${MBORDER}` }}>编辑</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 40, padding: '24px 20px' }}>
              <div onClick={() => { setActionSheetOpen(false); nav('/works/' + id + '/edit', { state: { from: 'preview' } }); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>编辑</span>
              </div>
              <div onClick={w.is_public ? handleOff : handleOn} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {w.is_public ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  )}
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>{w.is_public ? '下架' : '上架'}</span>
              </div>
              <div onClick={handleDelete} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>删除</span>
              </div>
            </div>
            <button onClick={() => setActionSheetOpen(false)} style={{ display: 'block', width: 'calc(100% - 32px)', margin: '0 16px', padding: '12px 0', borderRadius: 8, border: 'none', background: '#f5f5f5', fontSize: 15, color: '#333', textAlign: 'center' }}>
              取消
            </button>
          </div>
        </>
      )}

      {/* 分享弹窗（与套系预览 1:1） */}
      {shareModalOpen && (
        <>
          <div onClick={() => setShareModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 121, width: 'calc(100% - 48px)', maxWidth: 320, background: '#fff', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#333', marginBottom: 8 }}>分享作品</div>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>扫码或复制链接分享给客户</div>
            {shareData?.qr_url ? (
              <>
                <img src={shareData.qr_url} alt="分享二维码" style={{ width: 180, height: 180, margin: '0 auto', borderRadius: 8, background: '#fff', padding: 8, border: '1px solid ' + MBORDER }} />
                <div style={{ fontSize: 12, color: '#666', marginTop: 12, wordBreak: 'break-all' }}>{shareData.share_url}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
                  <button onClick={copyShareLink} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: MRED, color: '#fff', fontSize: 14 }}>复制链接</button>
                  <button onClick={() => setShareModalOpen(false)} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid ' + MBORDER, background: '#fff', color: '#333', fontSize: 14 }}>关闭</button>
                </div>
              </>
            ) : (
              <div style={{ color: '#999', fontSize: 14, padding: 32 }}>生成中…</div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
