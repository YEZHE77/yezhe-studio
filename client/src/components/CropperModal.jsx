import React, { useState, useRef, useEffect, useCallback } from 'react';

/* 自由裁切弹窗组件
 * props:
 *   - src: 待裁切图片的 dataURL（已选中的本地图片）
 *   - onCancel(): 取消，丢弃选中图片
 *   - onConfirm(dataUrl): 确认裁切，返回裁切后的图片 dataURL（image/jpeg）
 * 交互：拖动图片平移 / 滚轮 or 双指缩放 / 拖动四角控制点自由比例改裁切框 / 拖动框体移动
 * 桌面用鼠标，移动端用单指拖拽 + 双指 pinch 缩放；舞台尺寸响应式避免小屏溢出。
 * 弹窗：白底 + 右上× + 蒙层 rgba(0,0,0,0.45)
 */

const STAGE_W = 460;
const STAGE_H = 340;
const MIN_CROP = 24;

const IconClose = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

// 根据视口返回舞台尺寸：>=640px 用固定桌面尺寸，移动端自适应宽度并等比缩放高度
function getStage() {
  if (typeof window === 'undefined' || window.innerWidth >= 640) return { w: STAGE_W, h: STAGE_H };
  const w = Math.max(260, Math.min(STAGE_W, window.innerWidth - 48));
  return { w, h: Math.round(w * (STAGE_H / STAGE_W)) };
}

function clampCrop(c, W, H) {
  let { x, y, w, h } = c;
  w = Math.max(MIN_CROP, Math.min(w, W));
  h = Math.max(MIN_CROP, Math.min(h, H));
  x = Math.max(0, Math.min(x, W - w));
  y = Math.max(0, Math.min(y, H - h));
  return { x, y, w, h };
}

// 统一从鼠标 / 触摸事件中取坐标
const getXY = (e) => {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
};

export default function CropperModal({ src, onCancel, onConfirm }) {
  const stageRef = useRef(null);
  const natRef = useRef(null);
  const dragRef = useRef(null);

  const [stage, setStage] = useState(getStage);
  const stageRef2 = useRef(stage);
  useEffect(() => { stageRef2.current = stage; }, [stage]);

  const [img, setImg] = useState(null);
  const [view, setView] = useState({ scale: 1, pos: { x: 0, y: 0 }, crop: { x: 60, y: 50, w: 340, h: 240 } });
  const viewRef = useRef(view);
  const update = (patch) => { viewRef.current = { ...viewRef.current, ...patch }; setView(viewRef.current); };

  // 视口变化重新计算舞台尺寸（不改变图片内容，仅舞台外框）
  useEffect(() => {
    const compute = () => setStage(getStage());
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // 加载图片，初始化缩放与初始裁切框（居中、占舞台 70%）
  useEffect(() => {
    if (!src) return;
    const im = new Image();
    im.onload = () => {
      natRef.current = im;
      const nw = im.naturalWidth, nh = im.naturalHeight;
      const W = stageRef2.current.w, H = stageRef2.current.h;
      const fit = Math.min(W / nw, H / nh, 1);
      const s = fit > 0 ? fit : 1;
      const dispW = nw * s, dispH = nh * s;
      const x = (W - dispW) / 2;
      const y = (H - dispH) / 2;
      const cw = Math.min(W * 0.7, dispW * 0.9);
      const ch = Math.min(H * 0.7, dispH * 0.9);
      viewRef.current = {
        scale: s,
        pos: { x, y },
        crop: { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch }
      };
      setView(viewRef.current);
      setImg(im);
    };
    im.src = src;
  }, [src]);

  // 滚轮缩放（围绕舞台中心，非 passive 以便 preventDefault）
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const v = viewRef.current;
    const nat = natRef.current;
    if (!nat) return;
    const W = stageRef2.current.w, H = stageRef2.current.h;
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.min(5, Math.max(0.1, v.scale * delta));
    const nx = W / 2 - (nat.naturalWidth * ns) / 2;
    const ny = H / 2 - (nat.naturalHeight * ns) / 2;
    update({ scale: ns, pos: { x: nx, y: ny } });
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const { x: cx, y: cy } = getXY(e);
    const dx = cx - d.startX;
    const dy = cy - d.startY;
    const sv = d.startView;
    const W = stageRef2.current.w, H = stageRef2.current.h;
    if (d.type === 'pan') {
      update({ pos: { x: sv.pos.x + dx, y: sv.pos.y + dy } });
    } else if (d.type === 'move') {
      update({ crop: clampCrop({ ...sv.crop, x: sv.crop.x + dx, y: sv.crop.y + dy }, W, H) });
    } else {
      const h0 = d.handle;
      let { x, y, w, h } = sv.crop;
      if (h0.includes('e')) w = sv.crop.w + dx;
      if (h0.includes('s')) h = sv.crop.h + dy;
      if (h0.includes('w')) { w = sv.crop.w - dx; x = sv.crop.x + dx; }
      if (h0.includes('n')) { h = sv.crop.h - dy; y = sv.crop.y + dy; }
      update({ crop: clampCrop({ x, y, w, h }, W, H) });
    }
  }, []);

  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }, [onMove]);
  const onTouchEnd = onUp;

  // 双指 pinch 缩放（围绕舞台中心）
  const onTouchMove = (e) => {
    if (dragRef.current && dragRef.current.type === 'pinch') {
      e.preventDefault();
      if (e.touches.length < 2) return;
      const d = dragRef.current;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const nat = natRef.current;
      if (!nat) return;
      const W = stageRef2.current.w, H = stageRef2.current.h;
      const ns = Math.min(5, Math.max(0.1, d.startScale * (dist / d.startDist)));
      const nx = W / 2 - (nat.naturalWidth * ns) / 2;
      const ny = H / 2 - (nat.naturalHeight * ns) / 2;
      update({ scale: ns, pos: { x: nx, y: ny } });
      return;
    }
    onMove(e);
  };

  const startDrag = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    const isTouch = !!(e.touches && e.touches.length);
    const { x, y } = getXY(e);
    const handle = type !== 'pan' && type !== 'move' ? type : null;
    dragRef.current = {
      type,
      handle,
      startX: x,
      startY: y,
      startView: JSON.parse(JSON.stringify(viewRef.current))
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    if (isTouch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
    }
  };

  // 触摸起点：双指进入 pinch；单指委托给 startDrag
  const onTouchStart = (e, type) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      dragRef.current = { type: 'pinch', startDist: dist, startScale: viewRef.current.scale };
      return;
    }
    startDrag(e, type);
  };

  const handlePos = (h) => {
    const base = { position: 'absolute', width: 12, height: 12, background: '#fff', border: '1px solid #333', borderRadius: 2 };
    if (h === 'nw') return { ...base, left: -6, top: -6, cursor: 'nwse-resize' };
    if (h === 'ne') return { ...base, right: -6, top: -6, cursor: 'nesw-resize' };
    if (h === 'sw') return { ...base, left: -6, bottom: -6, cursor: 'nesw-resize' };
    return { ...base, right: -6, bottom: -6, cursor: 'nwse-resize' };
  };

  const confirm = () => {
    const v = viewRef.current;
    const nat = natRef.current;
    if (!nat) return;
    const sx = (v.crop.x - v.pos.x) / v.scale;
    const sy = (v.crop.y - v.pos.y) / v.scale;
    const sw = v.crop.w / v.scale;
    const sh = v.crop.h / v.scale;
    let ow = v.crop.w, oh = v.crop.h;
    const MAX = 1080;
    const ratio = Math.min(1, MAX / Math.max(ow, oh));
    ow = Math.round(ow * ratio);
    oh = Math.round(oh * ratio);
    const out = document.createElement('canvas');
    out.width = ow;
    out.height = oh;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ow, oh);
    try {
      ctx.drawImage(nat, sx, sy, sw, sh, 0, 0, ow, oh);
    } catch (err) {
      return;
    }
    const dataUrl = out.toDataURL('image/jpeg', 0.92);
    onConfirm(dataUrl);
  };

  const nw = img ? img.naturalWidth : 0;
  const nh = img ? img.naturalHeight : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg overflow-hidden max-w-[95vw]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: '100%', maxWidth: STAGE_W + 40 }}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0f3' }}>
          <div className="text-[15px]" style={{ color: '#222222' }}>裁切封面</div>
          <button type="button" onClick={onCancel}
            className="p-1 rounded hover:bg-gray-100" style={{ color: '#6b7280' }} aria-label="关闭"><IconClose /></button>
        </div>

        {/* 裁切舞台 */}
        <div className="flex justify-center py-4 bg-[#f3f4f6]">
          <div ref={stageRef}
            className="relative overflow-hidden bg-black select-none"
            style={{ width: stage.w, height: stage.h, cursor: 'grab', touchAction: 'none' }}
            onMouseDown={(e) => startDrag(e, 'pan')}
            onTouchStart={(e) => onTouchStart(e, 'pan')}>
            {img && (
              <img src={src} alt="" draggable={false}
                style={{
                  position: 'absolute',
                  left: view.pos.x,
                  top: view.pos.y,
                  width: nw * view.scale,
                  height: nh * view.scale,
                  pointerEvents: 'none',
                  userSelect: 'none'
                }} />
            )}
            {/* 裁切框 */}
            <div
              onMouseDown={(e) => startDrag(e, 'move')}
              onTouchStart={(e) => onTouchStart(e, 'move')}
              style={{
                position: 'absolute',
                left: view.crop.x,
                top: view.crop.y,
                width: view.crop.w,
                height: view.crop.h,
                border: '1.5px solid #fff',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                cursor: 'move',
                boxSizing: 'border-box'
              }}>
              {['nw', 'ne', 'sw', 'se'].map((h) => (
                <div key={h}
                  onMouseDown={(e) => startDrag(e, h)}
                  onTouchStart={(e) => onTouchStart(e, h)}
                  style={handlePos(h)} />
              ))}
            </div>
          </div>
        </div>

        {/* 提示 */}
        <div className="px-5 pb-1 text-[12px]" style={{ color: '#9aa0a8' }}>
          拖动图片移动 · 滚轮/双指缩放 · 拖动四角自由调整裁切范围
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t" style={{ borderColor: '#eef0f3' }}>
          <button type="button" onClick={onCancel}
            className="h-[34px] px-4 rounded text-sm hover:opacity-90"
            style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#333333' }}>取消</button>
          <button type="button" onClick={confirm}
            className="h-[34px] px-4 rounded text-sm text-white"
            style={{ background: '#3488EB' }}>确认裁切</button>
        </div>
      </div>
    </div>
  );
}
