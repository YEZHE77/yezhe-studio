import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== C 端套系预览页（/package?token=share_token）=====
// 仅展示套系信息，无编辑；share_token 鉴权；底部「如需预定，请联系摄影师」；完全隐藏 B 端 UI
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F0F0F2' }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '65%' }}>{value}</span>
    </div>
  );
}

export default function PackagePublic() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setErr('链接无效'); setLoading(false); return; }
    http.get('/api/photo-package/public/' + token)
      .then((r) => setData(r.data))
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
  }, [token]);

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

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', paddingBottom: 40 }}>
      {data.cover_image && (
        <div style={{ height: 220, overflow: 'hidden' }}>
          <img src={img(data.cover_image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 19, color: TEXT }}>{data.package_name}</div>
          <div style={{ fontSize: 24, color: '#FF5A5F', marginTop: 8 }}>¥{Number(data.price || 0).toFixed(0)}</div>
          {data.package_desc && <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7 }}>{data.package_desc}</div>}
        </div>

        <div style={{ background: '#fff', borderRadius: 16, padding: '4px 18px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
          <Row label="拍摄时长" value={data.shoot_duration} />
          <Row label="拍摄范围" value={data.shoot_scope} />
          <Row label="照片总数" value={data.photo_total ? data.photo_total + ' 张' : ''} />
          <Row label="精修张数" value={data.retouch_count ? data.retouch_count + ' 张' : ''} />
          <Row label="原片文件" value={data.original_file} />
          <Row label="加片单价" value={data.additional_price ? '¥' + Number(data.additional_price).toFixed(0) + '/张' : ''} />
        </div>

        {(data.other_service || data.notice) && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 18, marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
            {data.other_service && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>其他服务</div>
                <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.other_service}</div>
              </div>
            )}
            {data.notice && (
              <div>
                <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>温馨提示</div>
                <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.notice}</div>
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 13, color: FAINT, marginTop: 24, paddingBottom: 20 }}>如需预定，请联系摄影师</div>
      </div>
    </div>
  );
}
