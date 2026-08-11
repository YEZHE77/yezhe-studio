import React, { useState, useRef, useEffect, useCallback } from 'react';

// aspectRatio: 数字=固定比例（宽/高）；null 或 0=自由构图（可任意拖拽裁剪框比例）
export default function ImageCropper({ file, aspectRatio = 1, outputWidth = 1200, outputHeight = 1200, onCancel, onConfirm, title = '裁剪图片' }) {
  const free = !aspectRatio || aspectRatio <= 0;
  // 舞台宽度随视口自适应，避免窄屏（≈320px）溢出面板
  const [stageW, setStageW] = useState(() =>
    typeof window === 'undefined' ? 320 : Math.min(320, Math.max(240, window.innerWidth - 72))
  );
  useEffect(() => {
    const onResize = () => setStageW(Math.min(320, Math.max(240, window.innerWidth - 72)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const STAGE_W = stageW;
  const STAGE_H = free ? stageW : Math.round(stageW / aspectRatio);

  const [src, setSrc] = useState('');
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState(null); // 裁剪框在 stage 坐标 {x,y,w,h}
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, px: 0, py: 0 });
  const [resizing, setResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, bw: 0, bh: 0 });
  const imgRef = useRef();

  // 读取图片原始尺寸
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 默认裁剪框 + 初始缩放/居中
  const boxDef = useCallback(() => {
    if (!free) return { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
    const w = Math.round(STAGE_W * 0.8);
    const h = Math.round(STAGE_H * 0.8);
    return { x: Math.round((STAGE_W - w) / 2), y: Math.round((STAGE_H - h) / 2), w, h };
  }, [free, STAGE_W, STAGE_H]);

  useEffect(() => {
    if (!imgSize.w || !imgSize.h) return;
    const b = boxDef();
    setBox(b);
    const s = Math.max(b.w / imgSize.w, b.h / imgSize.h); // 等比铺满裁剪框（cover）
    setScale(s);
    setPos({ x: b.x + (b.w - imgSize.w * s) / 2, y: b.y + (b.h - imgSize.h * s) / 2 });
  }, [imgSize.w, imgSize.h, boxDef]);

  // 缩放时以 stage 中心为锚点
  const setScaleCentered = useCallback((newScale) => {
    setScale((old) => {
      const ratio = newScale / old;
      setPos((p) => ({
        x: STAGE_W / 2 - (STAGE_W / 2 - p.x) * ratio,
        y: STAGE_H / 2 - (STAGE_H / 2 - p.y) * ratio
      }));
      return newScale;
    });
  }, [STAGE_W, STAGE_H]);

  // 限制图片必须覆盖当前裁剪框
  const clampPos = useCallback((x, y, s, b) => {
    const bx = b || { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
    const minX = bx.x + bx.w - imgSize.w * s;
    const minY = bx.y + bx.h - imgSize.h * s;
    return {
      x: Math.min(bx.x, Math.max(x, minX)),
      y: Math.min(bx.y, Math.max(y, minY))
    };
  }, [imgSize.w, imgSize.h, STAGE_W, STAGE_H]);

  useEffect(() => {
    if (box) setPos((p) => clampPos(p.x, p.y, scale, box));
  }, [scale, box, clampPos]);

  // 平移图片
  const onMouseDown = (e) => {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging(true);
    setDragStart({ x: clientX, y: clientY, px: pos.x, py: pos.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragStart.x;
      const dy = clientY - dragStart.y;
      const next = clampPos(dragStart.px + dx, dragStart.py + dy, scale, box);
      setPos(next);
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [dragging, dragStart, scale, box, clampPos]);

  // 自由模式：拖拽右下角调整裁剪框比例/尺寸
  const onResizeDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!box) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setResizing(true);
    setResizeStart({ x: clientX, y: clientY, bw: box.w, bh: box.h });
  };

  useEffect(() => {
    if (!resizing) return;
    const move = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - resizeStart.x;
      const dy = clientY - resizeStart.y;
      const minS = 40;
      let w = Math.max(minS, Math.min(resizeStart.bw + dx, STAGE_W - box.x));
      let h = Math.max(minS, Math.min(resizeStart.bh + dy, STAGE_H - box.y));
      const nb = { ...box, w, h };
      setBox(nb);
      setPos((p) => clampPos(p.x, p.y, scale, nb));
    };
    const up = () => setResizing(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [resizing, resizeStart, box, scale, STAGE_W, STAGE_H, clampPos]);

  const doCrop = () => {
    const img = imgRef.current;
    if (!img || !imgSize.w || !box) return;
    const canvas = document.createElement('canvas');
    let outW = Math.round(box.w / scale);
    let outH = Math.round(box.h / scale);
    if (outW > outputWidth || outH > outputHeight) {
      const ratio = Math.min(outputWidth / outW, outputHeight / outH);
      outW = Math.round(outW * ratio);
      outH = Math.round(outH * ratio);
    }
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const sx = Math.round((box.x - pos.x) / scale);
    const sy = Math.round((box.y - pos.y) / scale);
    const sW = Math.round(box.w / scale);
    const sH = Math.round(box.h / scale);
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const name = (file.name || 'crop').replace(/\.[^.]+$/, '.jpg');
      onConfirm(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div className="bg-panel border border-line rounded-xl2 p-5 max-w-[92vw]" style={{ width: STAGE_W + 40 }} onClick={(e) => e.stopPropagation()}>
        <div className="text-fg mb-4">{free ? `${title}（自由构图）` : title}</div>
        <div
          className="relative mx-auto overflow-hidden bg-ink cursor-move select-none"
          style={{ width: STAGE_W, height: STAGE_H }}
          onMouseDown={onMouseDown}
          onTouchStart={onMouseDown}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              className="absolute top-0 left-0 origin-top-left max-w-none max-h-none"
              style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, width: imgSize.w, height: imgSize.h }}
            />
          )}
          {box && !free && (
            <div className="absolute inset-0 pointer-events-none border-2 border-white/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.3)]">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="border border-white/30" />
                ))}
              </div>
            </div>
          )}
          {box && free && (
            <div
              className="absolute pointer-events-none border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            >
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="border border-white/30" />
                ))}
              </div>
              {/* 右下角拖拽手柄 */}
              <div
                onMouseDown={onResizeDown}
                onTouchStart={onResizeDown}
                className="absolute -bottom-2 -right-2 w-5 h-5 bg-white rounded-full border-2 border-brand cursor-nwse-resize pointer-events-auto"
                style={{ touchAction: 'none' }}
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          <span>缩小</span>
          <input
            type="range" min={0.3} max={3} step={0.01} value={scale}
            onChange={(e) => setScaleCentered(Number(e.target.value))}
            className="flex-1 accent-brand"
          />
          <span>放大</span>
        </div>
        {free && <div className="mt-2 text-[11px] text-muted text-center">拖动右下角白点可自由调整裁剪比例，拖动画面可重新构图</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded text-sm text-muted hover:text-fg">取消</button>
          <button onClick={doCrop} className="px-4 py-2 rounded bg-brand text-white text-sm">确认裁剪</button>
        </div>
      </div>
    </div>
  );
}
