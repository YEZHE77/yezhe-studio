import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== C 端套系详情页（/package?id= 主链路读 B 端 packages；/package?token= 兼容旧 photo_package 分享链接）=====
// 顶部：白底导航 + 返回键 + 标题「套系详情」
// 主体：封面 + 名称/副标题/价格 + 简介 + 套餐核心信息（13 项）+ 展开/收起区（服务详情/温馨提示/特色标签/加购项目/优惠活动/详情图/视频）
// 底部：「如需预定，请联系摄影师」
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';
const DIV = '#EEF0F3';
const PRICE_RED = '#FF5A5F';

// 单行展示（label + value；value 为空则不渲染整行，避免视觉杂乱）
function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid ' + DIV, gap: 12 }}>
      <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '65%', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// 大段文字区（service_detail / warm_tips / description）
function TextBlock({ label, content }) {
  if (!content) return null;
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
    </div>
  );
}

export default function PackagePublic() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false); // 展开/收起完整信息
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      // 统一走 B 端公开接口：GET /api/packages/public/:id（parseRow 全列序列化，与 B 端套系中心同源同结构）
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

  if (loading) return <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;

  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid ' + DIV }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
            <button onClick={back} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: TEXT }} aria-label="返回">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>套系详情</div>
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

  // 解析复合字段
  const addons = Array.isArray(data.addons) ? data.addons : [];
  const tags = Array.isArray(data.quick_tags) ? data.quick_tags : [];
  const detailImages = Array.isArray(data.detail_images) ? data.detail_images : [];
  const marketing = data.marketing && typeof data.marketing === 'object' ? data.marketing : {};
  const marketingEntries = Object.entries(marketing).filter(([, v]) => v);

  // 「展开/收起」按钮显示条件：只要有 1 个扩展字段有数据就显示按钮
  const hasExpandContent =
    data.service_detail || data.warm_tips || addons.length > 0 || marketingEntries.length > 0 ||
    detailImages.length > 0 || data.video_url || tags.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', paddingBottom: 40 }}>
      {/* 顶部导航：返回键 + 标题 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid ' + DIV }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={back} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: TEXT }} aria-label="返回">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>套系详情</div>
        </div>
      </div>

      {/* 封面图 */}
      {data.cover_url && (
        <div style={{ height: 220, overflow: 'hidden' }}>
          <img src={img(data.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ padding: 16 }}>
        {/* 名称 / 副标题 / 价格 / 简介 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 19, color: TEXT }}>{data.name}</div>
          {data.subtitle && <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>{data.subtitle}</div>}
          <div style={{ fontSize: 24, color: PRICE_RED, marginTop: 8 }}>¥{Number(data.price || 0).toFixed(0)}</div>
          {data.description && <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{data.description}</div>}
        </div>

        {/* 套餐核心信息（13 项，按顺序） */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '4px 18px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <Row label="拍摄时长" value={data.duration} />
          <Row label="服务规格" value={data.service_spec} />
          <Row label="精修张数" value={data.retouch_count ? data.retouch_count + ' 张' : ''} />
          <Row label="底片数量" value={data.negative_count ? data.negative_count + ' 张' : ''} />
          <Row label="加片单价" value={data.addon_price ? '¥' + Number(data.addon_price).toFixed(0) + '/张' : ''} />
          <Row label="加片优惠" value={data.addon_discount} />
          <Row label="定金" value={data.deposit ? '¥' + Number(data.deposit).toFixed(0) : ''} />
          <Row label="退订政策" value={data.refund_policy} />
          <Row label="底片政策" value={data.raw_policy} />
          <Row label="底片保存" value={data.raw_save} />
          {data.clothing === 'provide' && <Row label="服装" value={data.clothing_note || '含'} />}
          {data.makeup === 'provide' && <Row label="妆造" value={data.makeup_note || '含'} />}
          {data.album_service && data.album_service !== 'none' && <Row label="相册" value={data.album_note || '含'} />}
          {data.location_mode === 'show' && data.location_text && <Row label="拍摄地点" value={data.location_text} />}
        </div>

        {/* 展开 / 收起完整信息（条件：扩展字段有任一数据时显示） */}
        {hasExpandContent && (
          <>
            <button onClick={() => setExpanded((v) => !v)}
              style={{ width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 14, background: '#fff', border: '1px solid ' + DIV, fontSize: 14, color: SUB, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {expanded ? '收起完整信息' : '展开完整信息'}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>

            {expanded && (
              <div style={{ marginTop: 12 }}>
                {/* 特色标签 */}
                {tags.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>特色标签</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {tags.map((t, i) => (
                        <span key={i} style={{ padding: '5px 12px', borderRadius: 14, background: 'rgba(126,205,187,0.12)', color: BRAND, fontSize: 13 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 服务详情 */}
                {data.service_detail && (
                  <TextBlock label="服务详情" content={data.service_detail} />
                )}

                {/* 加购项目 */}
                {addons.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: '4px 18px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ padding: '14px 0 6px', fontSize: 13, color: SUB }}>加购项目</div>
                    {addons.map((a, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: i < addons.length - 1 ? '1px solid ' + DIV : 'none', gap: 12 }}>
                        <span style={{ fontSize: 14, color: TEXT }}>{a.name || ''}</span>
                        <span style={{ fontSize: 14, color: BRAND, flexShrink: 0 }}>¥{Number(a.price || 0).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 优惠活动 */}
                {marketingEntries.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: '4px 18px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ padding: '14px 0 6px', fontSize: 13, color: SUB }}>优惠活动</div>
                    {marketingEntries.map(([k, v], i) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: i < marketingEntries.length - 1 ? '1px solid ' + DIV : 'none', gap: 12 }}>
                        <span style={{ fontSize: 14, color: TEXT }}>{k === 'coupon' ? '优惠券' : k === 'activity' ? '活动' : k}</span>
                        <span style={{ fontSize: 14, color: PRICE_RED, maxWidth: '60%', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 温馨提示 */}
                {data.warm_tips && (
                  <TextBlock label="温馨提示" content={data.warm_tips} />
                )}

                {/* 详情图片 */}
                {detailImages.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>详情图片</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {detailImages.map((u, i) => (
                        <img key={i} src={img(u)} alt="" style={{ width: 'calc(33.333% - 6px)', height: 100, objectFit: 'cover', borderRadius: 8 }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 视频 */}
                {data.video_url && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>视频</div>
                    <a href={data.video_url} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: BRAND, textDecoration: 'none' }}>查看视频 ›</a>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 底部提示 */}
        <div style={{ textAlign: 'center', fontSize: 13, color: FAINT, marginTop: 28, paddingBottom: 20 }}>如需预定，请联系摄影师</div>
      </div>
    </div>
  );
}