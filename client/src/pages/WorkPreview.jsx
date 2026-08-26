import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img } from '../api.js';
import { useVisitorGate } from '../hooks/useVisitorGate.js';
import { VisitorBlockedView, VisitorPasswordView } from '../components/VisitorGateViews.jsx';
import Lightbox from '../components/Lightbox.jsx';

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
function IconVisitor() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function IconPlay() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>;
}

// PC 端元信息行：标签 + 值（灰度、字号、间距分层，不加粗）
function MetaItem({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

// PC 端标签行：JSON 数组形式，浅灰胶囊
function MetaTags({ tags }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#999' }}>标签</span>
      {tags.map((t, i) => (
        <span key={i} style={{ fontSize: 12, color: '#666', background: '#f5f5f5', padding: '3px 10px', borderRadius: 4 }}>{t}</span>
      ))}
    </div>
  );
}

export default function WorkPreview() {
  const { id } = useParams();
  const nav = useNavigate();
  const gate = useVisitorGate({ page: '/works/' + (id || ''), source: 'h5', needPassword: true });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('grid'); // 移动端相册视图：grid 宫格 / list 列表
  const [gridLayout, setGridLayout] = useState(null); // 宫格瀑布流布局：{ left:[索引], right:[索引] }，null 时奇偶双列兜底
  // 响应式：PC 端走受限布局（封面不全屏、标题卡片化、相册 3 列、品牌栏 static），移动端保持原 3/4 全屏 + fixed 品牌栏
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : true));
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // 工作室资料（品牌栏 + 关于我们，接口驱动）
  const [studio, setStudio] = useState(null);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  // 幻灯片播放
  const [slideOpen, setSlideOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [slidePaused, setSlidePaused] = useState(false);
  // 访客记录 + 评论弹窗
  const [visitsModalOpen, setVisitsModalOpen] = useState(false);
  const [commentsModalOpen, setCommentsModalOpen] = useState(false);
  const [visitsList, setVisitsList] = useState([]);
  const [commentsList, setCommentsList] = useState([]);
  // PC 端相册单图预览（Lightbox）：单击打开，← → 切换，ESC 关闭
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);

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

  // 宫格瀑布流：与 C 端 AlbumGrid 同一套——切到宫格时预加载 ?w=40 极窄缩略图测每张真实宽高比，
  // 贪心分配两列（第 1 张强制左列，之后每张放入当前较矮列），两列底部几乎齐平；测量完成前奇偶双列兜底
  useEffect(() => {
    if (view !== 'grid') { setGridLayout(null); return; }
    const list = (data?.albums || []).filter((a) => a.zone === 'sample' && a.photo_url);
    if (!list.length) { setGridLayout(null); return; }
    let cancelled = false;
    const ratios = new Array(list.length).fill(1.4);
    let done = 0;
    const finish = () => {
      done += 1;
      if (done >= list.length && !cancelled) {
        const left = [], right = [];
        let lh = 0, rh = 0;
        list.forEach((_, i) => {
          const h = ratios[i] || 1.4;
          if (left.length === 0 || lh <= rh) { left.push(i); lh += h; }
          else { right.push(i); rh += h; }
        });
        setGridLayout({ left, right });
      }
    };
    list.forEach((a, i) => {
      const base = img(a.thumb_url || a.photo_url);
      if (!base) { finish(); return; }
      const im = new Image();
      im.onload = () => { if (!cancelled && im.naturalWidth > 0) ratios[i] = im.naturalHeight / im.naturalWidth; finish(); };
      im.onerror = finish;
      im.src = base + (base.includes('?') ? '&w=40' : '?w=40');
    });
    return () => { cancelled = true; };
  }, [view, data]);

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

  // 幻灯片照片源 = 当前相册
  const slidePhotos = albums.map((a) => img(a.photo_url));

  const startSlide = () => { setSlideIdx(0); setSlidePaused(false); setSlideOpen(true); };
  const openPreview = (i) => { setPreviewIdx(i); setPreviewOpen(true); };

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

  // 加载访客记录
  const loadVisits = async () => {
    try {
      const r = await http.get('/api/works/' + id + '/visits');
      setVisitsList(r.data?.list || []);
    } catch (e) { /* ignore */ }
  };

  // 加载评论
  const loadComments = async () => {
    try {
      const r = await http.get('/api/works/' + id + '/comments');
      setCommentsList(r.data?.list || []);
    } catch (e) { /* ignore */ }
  };

  const openVisits = () => { loadVisits(); setVisitsModalOpen(true); };
  const openComments = () => { loadComments(); setCommentsModalOpen(true); };

  if (gate.status === 'blocked') return <VisitorBlockedView />;
  if (gate.status === 'needPwd') return <VisitorPasswordView gate={gate} />;

  return (
    <div style={{
      minHeight: '100vh',
      background: isMobile ? '#fff' : '#f8f8f8',
      paddingBottom: isMobile ? 'calc(70px + env(safe-area-inset-bottom))' : 40
    }}>
      {/* 顶部导航：移动端 fixed 透明悬浮在图片上 / PC 端 static 白底栏 */}
      {isMobile ? (
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
      ) : (
        <div style={{ background: '#fff', borderBottom: '1px solid ' + MBORDER }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', padding: '12px 24px', gap: 16 }}>
            <button onClick={() => nav('/works')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回列表
            </button>
            <div style={{ flex: 1, fontSize: 16, color: '#1f2329', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title || '未命名作品'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={handleShare} disabled={shareBusy} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: '1px solid ' + MBORDER, background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }}>
                <IconShare /> 分享
              </button>
              <button onClick={() => setActionSheetOpen(true)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid ' + MBORDER, background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <IconMore /> 更多
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 封面大图：移动端原比例 100%宽 + maxHeight 85vh 居中不裁 / PC 端 max-height:60vh 居中 contain */}
      {isMobile ? (
        <div style={{ width: '100%', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '85vh', overflow: 'hidden' }}>
          {cover ? (
            <img src={img(cover)} alt="" style={{ width: '100%', height: 'auto', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
          ) : albums[0] ? (
            <img src={img(albums[0].photo_url)} alt="" style={{ width: '100%', height: 'auto', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>暂无封面</div>
          )}
        </div>
      ) : (
        <div style={{ maxWidth: 900, margin: '24px auto 0', padding: '0 24px' }}>
          <div style={{ width: '100%', maxHeight: '60vh', minHeight: 320, background: '#1a1a1a', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {cover ? (
              <img src={img(cover)} alt="" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
            ) : albums[0] ? (
              <img src={img(albums[0].photo_url)} alt="" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: '#666', fontSize: 14 }}>暂无封面</div>
            )}
          </div>
        </div>
      )}

      {/* 标题 + 元信息 + 描述：移动端单列 / PC 端卡片化 */}
      {isMobile ? (
        <div style={{ padding: '16px 16px 12px' }}>
          <div style={{ fontSize: 20, color: '#1f2329', lineHeight: 1.4 }}>{w.title || '未命名作品'}</div>
          {catName && (
            <div style={{ marginTop: 8, display: 'inline-block', fontSize: 12, color: '#999', background: '#f5f5f5', padding: '3px 10px', borderRadius: 4 }}>{catName}</div>
          )}
          {w.description && (
            <div style={{ marginTop: 12, fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{w.description}</div>
          )}
        </div>
      ) : (
        <div style={{ maxWidth: 900, margin: '20px auto 0', padding: '0 24px' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', boxShadow: '0 1px 3px rgba(31,35,41,0.04), 0 6px 20px rgba(31,35,41,0.04)' }}>
            <div style={{ fontSize: 22, color: '#1f2329', lineHeight: 1.4 }}>{w.title || '未命名作品'}</div>
            {/* 元信息网格：分类 / 客户 / 浏览量 / 创建时间 */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 24px' }}>
              {catName && (
                <MetaItem label="分类" value={catName} />
              )}
              {w.customer_name && (
                <MetaItem label="关联客户" value={w.customer_name} />
              )}
              <MetaItem label="浏览量" value={Number(w.views) || 0} />
              <MetaItem label="创建时间" value={w.created_at ? new Date(w.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} />
            </div>
            {/* 标签 */}
            {w.tags && (() => { try { const arr = JSON.parse(w.tags); return Array.isArray(arr) && arr.length > 0; } catch { return false; } })() && (
              <MetaTags tags={(() => { try { return JSON.parse(w.tags); } catch { return []; } })()} />
            )}
            {/* 描述 */}
            {w.description && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid ' + MBORDER }}>
                <div style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>作品描述</div>
                <div style={{ fontSize: 14, color: '#333', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{w.description}</div>
              </div>
            )}
            {/* 温馨寄语 */}
            {w.blessing && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: '#faf5f0', borderRadius: 8, borderLeft: '3px solid #C9A876' }}>
                <div style={{ fontSize: 12, color: '#a8825a', marginBottom: 4 }}>温馨寄语</div>
                <div style={{ fontSize: 14, color: '#5b4a2f', lineHeight: 1.7 }}>{w.blessing}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 相册样片：移动端支持列表/宫格切换 / PC 端 3 列方形卡片 */}
      {albums.length > 0 && (
        isMobile ? (
          <div style={{ padding: '0 16px 20px' }}>
            {/* 标签行：作品相册标题 + 右侧视图切换图标 */}
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
                <span style={{ fontSize: 15, color: '#333' }}>作品相册</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setView('list')} title="列表视图" aria-label="列表视图" aria-pressed={view === 'list'}
                  style={{ background: 'none', border: 'none', padding: 4, color: view === 'list' ? '#1f2329' : '#bbb', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>
                  ☰
                </button>
                <button onClick={() => setView('grid')} title="宫格视图" aria-label="宫格视图" aria-pressed={view === 'grid'}
                  style={{ background: 'none', border: 'none', padding: 4, color: view === 'grid' ? '#1f2329' : '#bbb', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>
                  ▦
                </button>
              </div>
            </div>
            {view === 'grid' ? (
              // 宫格：动态瀑布流平衡（与 C 端 AlbumGrid 同一套）——按实测宽高比贪心分配两列，两列底部几乎齐平；
              // 测量未完成时（gridLayout=null）用奇偶双列兜底；列内 flex-column 紧贴 4px gap；img 失败半透明占位防列坍缩
              (() => {
                const cols = gridLayout || {
                  left: albums.map((_, i) => i).filter((i) => i % 2 === 0),
                  right: albums.map((_, i) => i).filter((i) => i % 2 === 1),
                };
                const renderThumb = (idx) => (
                  <div key={albums[idx]?.id || idx} style={{ width: '100%', background: '#f5f5f5', borderRadius: 0, overflow: 'hidden' }}>
                    <img src={img(albums[idx].thumb_url || albums[idx].photo_url)} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0.3'; }} />
                  </div>
                );
                return (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {cols.left.map(renderThumb)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {cols.right.map(renderThumb)}
                    </div>
                  </div>
                );
              })()
            ) : (
              // 列表：每个相册一行（封面缩略图 + 标题 + 照片数）
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {albums.map((a, i) => (
                  <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: '#f9f9f9', borderRadius: 0, overflow: 'hidden' }}>
                    <img src={img(a.thumb_url || a.photo_url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', flexShrink: 0, background: '#f5f5f5' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: '#1f2329', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title || a.album_name || `相册 ${i + 1}`}</div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{a.photo_count || 0} 张</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ maxWidth: 900, margin: '20px auto 0', padding: '0 24px' }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '20px 28px', boxShadow: '0 1px 3px rgba(31,35,41,0.04), 0 6px 20px rgba(31,35,41,0.04)' }}>
              <div style={{ fontSize: 15, color: '#333', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
                作品相册
                <span style={{ fontSize: 12, color: '#999' }}>（{albums.length} 张）</span>
              </div>
              {/* PC 端相册：flex 多列 + 按索引轮询分配，视觉顺序从左到右 1.2.3 / 4.5.6，列内独立堆叠无行内空白 */}
              {(() => {
                const cols = [[], [], []];
                albums.forEach((_, i) => cols[i % 3].push(i));
                const renderThumb = (idx) => (
                  <div key={albums[idx]?.id || idx} onClick={() => openPreview(idx)} style={{ marginBottom: 8, background: '#f5f5f5', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}>
                    <img src={img(albums[idx].thumb_url || albums[idx].photo_url)} alt="" style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }} loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0.3'; }} />
                  </div>
                );
                return (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    {cols.map((col, ci) => (
                      <div key={ci} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        {col.map(renderThumb)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )
      )}

      {/* 底部品牌栏：移动端 fixed 浮层 / PC 端 static 内嵌在文档流（不遮挡内容） */}
      {isMobile ? (
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
              <div style={{ fontSize: 13, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandName}</div>
              {brandSlogan ? <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandSlogan}</div> : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <button onClick={openComments} style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}>
              <IconComment />
            </button>
            <button onClick={openVisits} style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}>
              <IconVisitor />
            </button>
            <button onClick={startSlide} disabled={slidePhotos.length === 0} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', opacity: slidePhotos.length === 0 ? 0.4 : 1 }}>
              <IconPlay />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 900, margin: '20px auto 0', padding: '0 24px 24px' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(31,35,41,0.04), 0 6px 20px rgba(31,35,41,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f2f2f2', overflow: 'hidden', flexShrink: 0 }}>
                {brandLogo ? <img src={img(brandLogo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandName}</div>
                {brandSlogan ? <div style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brandSlogan}</div> : null}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
              <button onClick={openComments} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer' }}>
                <IconComment /> 评论
              </button>
              <button onClick={openVisits} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer' }}>
                <IconVisitor /> 访客
              </button>
              <button onClick={startSlide} disabled={slidePhotos.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: slidePhotos.length === 0 ? '#ccc' : '#666', fontSize: 13, cursor: slidePhotos.length === 0 ? 'not-allowed' : 'pointer' }}>
                <IconPlay /> 幻灯片
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 单张大图预览：PC 端相册单击打开，← → 切换，ESC 关闭 */}
      {previewOpen && (
        <Lightbox photos={albums.map((a) => img(a.photo_url))} index={previewIdx} open={previewOpen} onClose={() => setPreviewOpen(false)} title={w.title || ''} />
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

      {/* 访客记录弹窗 */}
      {visitsModalOpen && (
        <>
          <div onClick={() => setVisitsModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 121, width: 'calc(100% - 48px)', maxWidth: 360, background: '#fff', borderRadius: 16, padding: '20px 0', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#333', textAlign: 'center', marginBottom: 12, padding: '0 20px' }}>访问客户</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
              {visitsList.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '24px 0' }}>暂无访问记录</div>
              ) : (
                visitsList.map((v) => (
                  <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid ' + MBORDER }}>
                    <div>
                      <div style={{ fontSize: 14, color: '#333' }}>{v.visitor_name || '匿名访客'}</div>
                      {v.visitor_phone ? <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{v.visitor_phone}</div> : null}
                    </div>
                    <div style={{ fontSize: 12, color: '#999' }}>{v.created_at ? new Date(v.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setVisitsModalOpen(false)} style={{ display: 'block', width: 'calc(100% - 40px)', margin: '12px 20px 0', padding: '10px 0', borderRadius: 8, border: 'none', background: '#f5f5f5', fontSize: 15, color: '#333', textAlign: 'center' }}>关闭</button>
          </div>
        </>
      )}

      {/* 评论弹窗 */}
      {commentsModalOpen && (
        <>
          <div onClick={() => setCommentsModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 121, width: 'calc(100% - 48px)', maxWidth: 360, background: '#fff', borderRadius: 16, padding: '20px 0', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#333', textAlign: 'center', marginBottom: 12, padding: '0 20px' }}>评论</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
              {commentsList.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '24px 0' }}>暂无评论</div>
              ) : (
                commentsList.map((c) => (
                  <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid ' + MBORDER }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>{c.author_name || '匿名'}</span>
                      <span style={{ fontSize: 11, color: '#999' }}>{c.created_at ? new Date(c.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>{c.content}</div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setCommentsModalOpen(false)} style={{ display: 'block', width: 'calc(100% - 40px)', margin: '12px 20px 0', padding: '10px 0', borderRadius: 8, border: 'none', background: '#f5f5f5', fontSize: 15, color: '#333', textAlign: 'center' }}>关闭</button>
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
