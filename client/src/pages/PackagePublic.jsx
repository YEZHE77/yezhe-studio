import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== C 端套系详情页（/package?id= 主链路读 B 端 packages；/package?token= 兼容旧 photo_package 分享链接）=====
// 展示套餐完整信息；信息多可展开/收起；顶部返回键；底部「如需预定，请联系摄影师」；完全隐藏 B 端 UI
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';
const DIV = '#F0F0F2';

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid ' + DIV }}>
      <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '65%', lineHeight: 1.6 }}>{value}</span>
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
      // 新链路：读 B 端 packages（套系中心跳转）
      http.get('/api/customer/package-detail', { params: { id } })
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
            quick_tags: [], addons: [], marketing: {}, detail_images: [], video_url: ''
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
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
        <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '该套系不存在'}</div>
        <div style={{ fontSize: 13, color: FAINT, lineHeight: 1.7 }}>{err === '该套系已暂停查看' ? '该套系已暂停查看，请联系摄影师。' : '该套系不存在或链接已失效，请联系摄影师获取最新链接。'}</div>
      </div>
    );
  }

  const addons = Array.isArray(data.addons) ? data.addons : [];
  const tags = Array.isArray(data.quick_tags) ? data.quick_tags : [];
  const detailImages = Array.isArray(data.detail_images) ? data.detail_images : [];
  const marketing = data.marketing && typeof data.marketing === 'object' ? data.marketing : {};
  const marketingEntries = Object.entries(marketing).filter(([, v]) => v);

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', paddingBottom: 40 }}>
      {/* 顶部返回键 + 标题 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid ' + DIV }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={back} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: TEXT }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>套系详情</div>
        </div>
      </div>

      {data.cover_url && (
        <div style={{ height: 220, overflow: 'hidden' }}>
          <img src={img(data.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ padding: 16 }}>
        {/* 名称 / 价格 / 简介 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 19, color: TEXT }}>{data.name}</div>
          {data.subtitle && <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{data.subtitle}</div>}
          <div style={{ fontSize: 24, color: '#FF5A5F', marginTop: 8 }}>¥{Number(data.price || 0).toFixed(0)}</div>
          {data.description && <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7 }}>{data.description}</div>}
        </div>

        {/* 套餐核心信息 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '4px 18px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <Row label="拍摄时长" value={data.duration} />
          <Row label="服务规格" value={data.service_spec} />
          <Row label="精修张数" value={data.retouch_count ? data.retouch_count + ' 张' : ''} />
          <Row label="底片数量" value={data.negative_count ? data.negative_count + ' 张' : ''} />
          <Row label="加片单价" value={data.addon_price ? '¥' + Number(data.addon_price).toFixed(0) + '/张' : ''} />
          <Row label="加片优惠" value={data.addon_discount} />
          <Row label="定金" value={data.deposit ? '¥' + Number(data.deposit).toFixed(0) : ''} />
          <Row label="退订政策" value={data.refund_policy} />
          <Row label="底片保存" value={data.raw_save} />
          <Row label="底片政策" value={data.raw_policy} />
          {data.clothing === 'provide' && <Row label="服装" value={data.clothing_note} />}
          {data.makeup === 'provide' && <Row label="妆造" value={data.makeup_note} />}
          {data.album_service && data.album_service !== 'none' && <Row label="相册" value={data.album_note} />}
          {data.location_mode === 'show' && <Row label="拍摄地点" value={data.location_text} />}
        </div>

        {/* 展开 / 收起完整信息 */}
        {(data.service_detail || data.warm_tips || addons.length > 0 || marketingEntries.length > 0 || detailImages.length > 0 || data.video_url) && (
          <>
            <button onClick={() => setExpanded((v) => !v)}
              style={{ width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 14, background: '#fff', border: '1px solid ' + DIV, fontSize: 14, color: SUB, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {expanded ? '收起完整信息' : '展开完整信息'}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>

            {expanded && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                {data.service_detail && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>服务详情</div>
                    <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.service_detail}</div>
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>特色标签</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {tags.map((t, i) => (
                        <span key={i} style={{ padding: '3px 10px', borderRadius: 12, background: 'rgba(126,205,187,0.12)', color: BRAND, fontSize: 12 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {addons.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>加购项目</div>
                    {addons.map((a, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + DIV }}>
                        <span style={{ fontSize: 14, color: TEXT }}>{a.name || ''}</span>
                        <span style={{ fontSize: 14, color: BRAND }}>¥{Number(a.price || 0).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {marketingEntries.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>优惠活动</div>
                    {marketingEntries.map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + DIV }}>
                        <span style={{ fontSize: 14, color: TEXT }}>{k === 'coupon' ? '优惠券' : k === 'activity' ? '活动' : k}</span>
                        <span style={{ fontSize: 14, color: '#FF5A5F', maxWidth: '60%', textAlign: 'right' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.warm_tips && (
                  <div style={{ marginBottom: detailImages.length > 0 || data.video_url ? 16 : 0 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>温馨提示</div>
                    <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.warm_tips}</div>
                  </div>
                )}
                {detailImages.length > 0 && (
                  <div style={{ marginBottom: data.video_url ? 16 : 0 }}>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>详情图片</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {detailImages.map((u, i) => (
                        <img key={i} src={img(u)} alt="" style={{ width: '31%', height: 100, objectFit: 'cover', borderRadius: 8 }} />
                      ))}
                    </div>
                  </div>
                )}
                {data.video_url && (
                  <div>
                    <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>视频</div>
                    <a href={data.video_url} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: BRAND }}>查看视频 ›</a>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div style={{ textAlign: 'center', fontSize: 13, color: FAINT, marginTop: 24, paddingBottom: 20 }}>如需预定，请联系摄影师</div>
      </div>
    </div>
  );
}
