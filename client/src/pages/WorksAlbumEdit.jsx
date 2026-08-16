import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http from '../api.js';

// 颜色 / 字号常量（禁字体加粗；灰度、字号、间距分层）
const TEXT = '#1f2329';
const SUB = '#6b7280';
const MUTED = '#9ca3af';
const BORDER = '#E8E8EB';

// iPhone 13 真实比例（屏 390×844 + 黑框 + notch + home indicator）
const DEVICE = {
  screenW: 390, screenH: 844,
  frameW: 410, frameH: 890,
  notchW: 110, notchH: 28,
  radius: 44, homeW: 134,
  pad: 10
};

export default function WorksAlbumEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // 加载 B 端作品数据（含全部相册照片，包括 local 区域）
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/works/' + id)
      .then((r) => setData(r.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="inline-block w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || !data.work) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', paddingTop: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: MUTED }}>作品不存在或已删除</div>
        <button onClick={() => nav('/works')} style={{ marginTop: 16, fontSize: 14, color: '#2DB7F5', background: 'none', border: 'none', cursor: 'pointer' }}>返回作品列表</button>
      </div>
    );
  }

  const w = data.work || {};
  // iframe 加载 C 端公开预览页（顾客手机端所看）：/w/:id
  const previewSrc = `${window.location.origin}/w/${id}`;

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      {/* 顶部导航 */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${BORDER}`, padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => nav('/works')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: SUB, fontSize: 14, cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          返回列表
        </button>
        <div style={{ flex: 1, fontSize: 16, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title || '作品相册编辑'}</div>
        <div style={{ fontSize: 12, color: MUTED }}>左侧实时预览 · 右侧工具栏</div>
      </div>

      {/* 主体：左侧手机模拟器 + 右侧工具栏占位 */}
      <div style={{ flex: 1, display: 'flex', gap: 24, padding: 24, minHeight: 0 }}>
        {/* 左侧：iPhone 手机壳 + iframe 嵌入 C 端预览 */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', background: '#f0f1f3', borderRadius: 12 }}>
          <div style={{ position: 'relative', width: DEVICE.frameW, height: DEVICE.frameH, background: '#0e0e0e', borderRadius: DEVICE.radius, boxShadow: '0 25px 60px rgba(0,0,0,0.18)', padding: DEVICE.pad, boxSizing: 'border-box' }}>
            {/* notch */}
            <div style={{ position: 'absolute', top: DEVICE.pad + 4, left: '50%', transform: 'translateX(-50%)', width: DEVICE.notchW, height: DEVICE.notchH, background: '#000', borderRadius: 14, zIndex: 10 }} />
            {/* iframe */}
            <iframe
              src={previewSrc}
              title="作品预览（与顾客手机端同步）"
              style={{ display: 'block', width: DEVICE.screenW, height: DEVICE.screenH, margin: '0 auto', background: '#fff', border: 'none', borderRadius: DEVICE.radius - 10 }}
            />
            {/* home indicator */}
            <div style={{ position: 'absolute', bottom: DEVICE.pad - 2, left: '50%', transform: 'translateX(-50%)', width: DEVICE.homeW, height: 5, background: '#fff', borderRadius: 3, opacity: 0.85, pointerEvents: 'none' }} />
          </div>
        </div>

        {/* 右侧：工具栏 + 照片网格（第二阶段完善） */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 工具栏（第二阶段完善） */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button disabled style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, fontSize: 13, cursor: 'not-allowed' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              添加照片（待完善）
            </button>
            <button disabled style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, fontSize: 13, cursor: 'not-allowed' }}>
              排序（待完善）
            </button>
            <button disabled style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, fontSize: 13, cursor: 'not-allowed' }}>
              水印 / 描述（待完善）
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: MUTED }}>共 0 张</span>
          </div>

          {/* 照片网格（第二阶段完善） */}
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, color: MUTED }}>照片网格区域（第二阶段完善）</span>
          </div>
        </div>
      </div>
    </div>
  );
}