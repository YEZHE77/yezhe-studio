import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== C 端套系详情页（/package?id= 主链路读 B 端 packages；/package?token= 兼容旧 photo_package 分享链接）=====
// 版式（参照设计稿）：固定毛玻璃顶栏 + 全宽封面 + 名称/价格/定金 + 2×3 规格图标网格
//                   + 服务详情 + 更多服务（可展开：加购/优惠/标签/详情图/视频）
//                   + 固定底部水印 + 立即预约
// 数据：GET /api/packages/public/:id（B端 parseRow 全列）；GET /api/settings/studio（品牌水印）
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';
const PRICE_RED = '#FF5A5F';
const MORE_RED = '#FF5A5F';
const DIV = '#EEF0F3';
const PAGE_BG = '#F5F5F7';

// 线性 SVG 图标（与 components/Icon.jsx 风格一致；规格网格用到 6 个）
const IcoClock = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
const IcoCamera = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>);
const IcoSparkle = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/></svg>);
const IcoLayers = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>);
const IcoShirt = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 7l4-3 2 2h4l2-2 4 3-2 4-2-1v9H8v-9l-2 1z"/></svg>);
const IcoPlus = (p) => (<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>);
// 顶栏图标
const IcoBack = (p) => (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 18l-6-6 6-6"/></svg>);
const IcoShare = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/></svg>);
const IcoMore = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" {...p}><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>);
// 展开/收起箭头
const IcoChevron = ({ open, ...p }) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} {...p}><path d="M6 9l6 6 6-6"/></svg>);

export default function PackagePublic() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const [data, setData] = useState(null);
  const [studio, setStudio] = useState({ name: '叶哲 STUDIO', slogan: '' });
  const [extrasOpen, setExtrasOpen] = useState(false); // 更多服务展开
  const extrasRef = useRef(null); // 更多服务卡片锚点（点击网格入口时滚动到展开区）
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 品牌水印（公开接口）
    http.get('/api/settings/studio').then((r) => setStudio(r.data || {})).catch(() => {});
    if (id) {
      http.get('/api/packages/public/' + id)
        .then((r) => setData(r.data))
        .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
        .finally(() => setLoading(false));
    } else if (token) {
      // 旧分享链接兼容：读 photo_package，映射到统一字段
      http.get('/api/photo-package/public/' + token)
        .then((r) => {
          const d = r.data || {};
          setData({
            name: d.package_name, price: d.price, description: d.package_desc, cover_url: d.cover_image,
            duration: d.shoot_duration, raw_policy: d.shoot_scope, retouch_count: d.retouch_count,
            addon_price: d.additional_price, service_detail: d.other_service, warm_tips: d.notice,
            deposit: 0, service_spec: '', negative_count: 0, addon_discount: '', raw_save: '',
            refund_policy: '', clothing: '', clothing_note: '', makeup: '', makeup_note: '',
            album_service: '', album_note: '', location_mode: '', location_text: '',
            quick_tags: [], addons: [], marketing: {}, detail_images: [], video_url: '',
            subtitle: ''
          });
        })
        .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
        .finally(() => setLoading(false));
    } else {
      setErr('链接无效'); setLoading(false);
    }
  }, [id, token]);

  const back = () => { if (window.history.length > 1) nav(-1); else nav('/package-center'); };
  const goBook = () => { nav('/customer/book?packageId=' + (data && (data.id || id) || '')); };

  // 点击网格「更多服务」：展开 + 平滑滚动到展开区（手机上展开区在屏下方，必须滚动可见，否则像没反应）
  const openExtras = () => {
    const next = !extrasOpen;
    setExtrasOpen(next);
    if (next) {
      setTimeout(() => {
        if (extrasRef.current) extrasRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  };

  // ===== 加载中 =====
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14, paddingTop: 44 }}>
        加载中…
      </div>
    );
  }

  // ===== 出错 =====
  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 20, background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
            <button onClick={back} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: TEXT, cursor: 'pointer' }} aria-label="返回">
              <IcoBack /><span style={{ fontSize: 15, marginLeft: 2 }}>返回</span>
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
          <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '该套系不存在'}</div>
          <div style={{ fontSize: 13, color: FAINT, lineHeight: 1.7 }}>该套系不存在或链接已失效，请联系摄影师获取最新链接。</div>
        </div>
      </div>
    );
  }

  // ===== 解析复合字段 =====
  // 数据模型双兼容：B 端 PackageEdit 新版把展示字段存 details JSON（新模型，键名如 raw_count/cloth_provide/service_detail_text）；
  // 旧数据直接存顶层列（如 negative_count/clothing/service_detail/detail_images/quick_tags）。C 端一律 details 优先、顶层兜底。
  const det = data.details && typeof data.details === 'object' ? data.details : {};
  const addons = Array.isArray(data.addons) ? data.addons : [];
  const marketing = data.marketing && typeof data.marketing === 'object' ? data.marketing : {};
  const marketingEntries = Object.entries(marketing).filter(([, v]) => v);
  const tags = Array.isArray(det.tags) ? det.tags : (Array.isArray(data.quick_tags) ? data.quick_tags : []);
  const detailImages = Array.isArray(det.detail_images) ? det.detail_images : (Array.isArray(data.detail_images) ? data.detail_images : []);
  const videoUrl = det.video_url || data.video_url || '';
  const warmTips = det.warm_tips || data.warm_tips || '';
  const serviceDetail = det.service_detail_text || data.service_detail || '';

  // 更多服务展开区是否有内容（加购/优惠/标签/温馨提示/详情图/视频 任一有则视为有）
  const hasExtras = addons.length > 0 || marketingEntries.length > 0 || tags.length > 0 || detailImages.length > 0 || !!videoUrl || !!warmTips;

  // ===== 规格网格（数据驱动，数据为空则隐藏该格；「更多服务」仅在有附加内容时显示，避免点击无反应）=====
  // 拍摄时长：新模型为枚举（全天/半天/指定时长），旧模型可能是具体时间段（如 6:00-20:00），原样展示
  const durationTxt = det.duration || data.duration || '';
  // 拍摄张数：新模型 raw_count，旧模型 negative_count
  const shootCount = det.raw_count || data.negative_count;
  const shootTxt = shootCount ? `拍摄${shootCount}张` : '';
  // 精修张数：retouch_count（B 端保存时同步到顶层列，这里双读）
  const retouchCount = det.retouch_count || data.retouch_count;
  const retouchTxt = retouchCount ? `${retouchCount}张精修` : '';
  // 底片：新模型 raw_all_included（底片全送 bool）；旧模型 raw_policy 文案（含「全部」规整为「全部原片」）
  let rawTxt = '';
  if (det.raw_all_included) rawTxt = '全部原片';
  else if (data.raw_policy) rawTxt = /全部/.test(data.raw_policy) ? '全部原片' : data.raw_policy;
  // 服装：新模型 cloth_provide（provide=提供服装 / not=服装自备）；旧模型 clothing + clothing_note
  let clothingTxt = '';
  if (det.cloth_provide === 'provide') clothingTxt = '提供服装';
  else if (det.cloth_provide === 'not') clothingTxt = '服装自备';
  else if (data.clothing === 'provide') clothingTxt = data.clothing_note || '含服装';
  else if (data.clothing === 'self') clothingTxt = data.clothing_note || '服装自备';
  else if (data.clothing_note) clothingTxt = data.clothing_note;

  const gridItems = [
    { key: 'duration', Ico: IcoClock, text: durationTxt, color: TEXT },
    { key: 'shoot', Ico: IcoCamera, text: shootTxt, color: TEXT },
    { key: 'retouch', Ico: IcoSparkle, text: retouchTxt, color: TEXT },
    { key: 'raw', Ico: IcoLayers, text: rawTxt, color: TEXT },
    { key: 'clothing', Ico: IcoShirt, text: clothingTxt, color: TEXT },
    { key: 'more', Ico: IcoPlus, text: '更多服务', color: MORE_RED, isMore: true }
  ].filter((it) => (it.isMore ? hasExtras : !!it.text));

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BG, paddingBottom: 96 }}>
      {/* 顶部毛玻璃导航（fixed，叠加在封面上方） */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 20, background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={back} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: TEXT, cursor: 'pointer' }} aria-label="返回">
            <IcoBack /><span style={{ fontSize: 15, marginLeft: 2 }}>返回</span>
          </button>
          <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => {
                try {
                  if (navigator.share) navigator.share({ title: data.name, url: window.location.href }).catch(() => {});
                  else { navigator.clipboard.writeText(window.location.href); }
                } catch (e) {}
              }}
              style={{ background: 'none', border: 'none', padding: 6, color: TEXT, cursor: 'pointer', display: 'flex' }} aria-label="分享">
              <IcoShare />
            </button>
            <button style={{ background: 'none', border: 'none', padding: 6, color: TEXT, cursor: 'pointer', display: 'flex' }} aria-label="更多">
              <IcoMore />
            </button>
          </div>
        </div>
      </div>

      {/* 封面（全宽，高度 240，顶栏 fixed 叠加其顶部 44px） */}
      {data.cover_url && (
        <div style={{ width: '100%', height: 240, overflow: 'hidden', background: '#EEE' }}>
          <img src={img(data.cover_url)} alt={data.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
      {!data.cover_url && <div style={{ width: '100%', height: 120, background: 'linear-gradient(160deg,#E8F3EF 0%,#D6E7E0 100%)' }} />}

      <div style={{ padding: '14px 14px 0' }}>
        {/* 名称 + 价格 + 定金 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '18px 18px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 20, color: TEXT, lineHeight: 1.3 }}>{data.name}</div>
          {data.subtitle && <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>{data.subtitle}</div>}
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <span style={{ fontSize: 26, color: PRICE_RED, lineHeight: 1 }}>¥{Number(data.price || 0).toFixed(0)}</span>
            {data.deposit ? (
              <span style={{ fontSize: 13, color: SUB }}>定金：¥{Number(data.deposit).toFixed(0)}</span>
            ) : null}
          </div>
        </div>

        {/* 2×3 规格图标网格 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '14px 6px', marginTop: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 14 }}>
            {gridItems.map((it) => {
              const Ico = it.Ico;
              return (
                <div
                  key={it.key}
                  onClick={it.isMore ? openExtras : undefined}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 4px', cursor: it.isMore ? 'pointer' : 'default', color: it.color }}
                >
                  <Ico />
                  <span style={{ fontSize: 13, lineHeight: 1.3, textAlign: 'center' }}>{it.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 服务详情（始终展示，无数据时不渲染；新模型读 details.service_detail_text，旧模型读顶层 service_detail） */}
        {serviceDetail && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ display: 'inline-block', width: 4, height: 14, borderRadius: 2, background: PRICE_RED }} />
              <span style={{ fontSize: 15, color: TEXT }}>服务详情</span>
            </div>
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{serviceDetail}</div>
          </div>
        )}

        {/* 更多服务展开区（点击网格「更多服务」/卡片展开按钮触发） */}
        {hasExtras && (
          <div ref={extrasRef} style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
            <button
              onClick={() => setExtrasOpen((v) => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: TEXT }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 4, height: 14, borderRadius: 2, background: PRICE_RED }} />
                <span style={{ fontSize: 15 }}>更多服务</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: SUB, fontSize: 13 }}>
                {extrasOpen ? '收起' : '展开'}
                <IcoChevron open={extrasOpen} />
              </span>
            </button>

            {extrasOpen && (
              <div style={{ marginTop: 14 }}>
                {/* 特色标签 */}
                {tags.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>特色标签</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {tags.map((t, i) => (
                        <span key={i} style={{ padding: '5px 12px', borderRadius: 14, background: 'rgba(126,205,187,0.12)', color: BRAND, fontSize: 13 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 加购项目 */}
                {addons.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>加购项目</div>
                    <div>
                      {addons.map((a, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: i < addons.length - 1 ? '1px solid ' + DIV : 'none', gap: 12 }}>
                          <span style={{ fontSize: 14, color: TEXT }}>{a.name || ''}</span>
                          <span style={{ fontSize: 14, color: BRAND, flexShrink: 0 }}>¥{Number(a.price || 0).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 优惠活动 */}
                {marketingEntries.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>优惠活动</div>
                    <div>
                      {marketingEntries.map(([k, v], i) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: i < marketingEntries.length - 1 ? '1px solid ' + DIV : 'none', gap: 12 }}>
                          <span style={{ fontSize: 14, color: TEXT }}>{k === 'coupon' ? '优惠券' : k === 'activity' ? '活动' : k}</span>
                          <span style={{ fontSize: 14, color: PRICE_RED, maxWidth: '60%', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 温馨提示 */}
                {warmTips && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>温馨提示</div>
                    <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{warmTips}</div>
                  </div>
                )}

                {/* 详情图片 */}
                {detailImages.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>详情图片</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {detailImages.map((u, i) => (
                        <img key={i} src={img(u)} alt="" style={{ width: 'calc(33.333% - 6px)', height: 100, objectFit: 'cover', borderRadius: 8 }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 视频 */}
                {videoUrl && (
                  <div>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>视频</div>
                    <a href={videoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: BRAND, textDecoration: 'none' }}>查看视频 ›</a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 描述（如果有，作为补充说明放在底部） */}
        {data.description && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ display: 'inline-block', width: 4, height: 14, borderRadius: 2, background: PRICE_RED }} />
              <span style={{ fontSize: 15, color: TEXT }}>套餐简介</span>
            </div>
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{data.description}</div>
          </div>
        )}
      </div>

      {/* 底部固定水印 + 立即预约 */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid rgba(0,0,0,0.05)', padding: '10px 14px calc(10px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, color: TEXT, letterSpacing: 1 }}>{(studio.name || '叶哲 STUDIO').toUpperCase ? (studio.name || '叶哲 STUDIO') : '叶哲 STUDIO'}</div>
            {studio.slogan ? <div style={{ fontSize: 11, color: FAINT, marginTop: 2, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{studio.slogan}</div> : null}
          </div>
          <button
            onClick={goBook}
            style={{ flexShrink: 0, padding: '12px 28px', borderRadius: 24, background: MORE_RED, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 6px 18px rgba(255,90,95,0.32)' }}
          >
            立即预约
          </button>
        </div>
      </div>
    </div>
  );
}