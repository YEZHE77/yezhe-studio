import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function ImageCropper({ file, aspectRatio = 1, outputWidth = 1200, outputHeight = 1200, onCancel, onConfirm, title = '裁剪图片' }) {
  const [src, setSrc] = useState('');
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, px: 0, py: 0 });
  const containerRef = useRef();
  const imgRef = useRef();

  // 容器固定视觉尺寸
  const VIEW_W = 320;
  const VIEW_H = Math.round(VIEW_W / aspectRatio);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      // 初始：图片完整包含在容器内并居中
      const s = Math.min(VIEW_W / img.naturalWidth, VIEW_H / img.naturalHeight, 1);
      setScale(s);
      setPos({ x: (VIEW_W - img.naturalWidth * s) / 2, y: (VIEW_H - img.naturalHeight * s) / 2 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, aspectRatio]);

  // 缩放时以容器中心为锚点
  const setScaleCentered = useCallback((newScale) => {
    setScale((old) => {
      const ratio = newScale / old;
      setPos((p) => ({
        x: VIEW_W / 2 - (VIEW_W / 2 - p.x) * ratio,
        y: VIEW_H / 2 - (VIEW_H / 2 - p.y) * ratio
      }));
      return newScale;
    });
  }, []);

  // 限制图片必须覆盖裁剪区域
  const clampPos = useCallback((x, y, s) => {
    const minX = VIEW_W - imgSize.w * s;
    const minY = VIEW_H - imgSize.h * s;
    return {
      x: Math.min(0, Math.max(x, minX)),
      y: Math.min(0, Math.max(y, minY))
    };
  }, [imgSize]);

  useEffect(() => {
    setPos((p) => clampPos(p.x, p.y, scale));
  }, [scale, clampPos]);

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
      const next = clampPos(dragStart.px + dx, dragStart.py + dy, scale);
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
  }, [dragging, dragStart, scale, clampPos]);

  const doCrop = () => {
    const img = imgRef.current;
    if (!img || !imgSize.w) return;
    const canvas = document.createElement('canvas');
    // 输出尺寸按原图比例/裁剪比例换算，不超过 outputWidth/outputHeight
    let outW = Math.round(VIEW_W / scale);
    let outH = Math.round(VIEW_H / scale);
    if (outW > outputWidth || outH > outputHeight) {
      const ratio = Math.min(outputWidth / outW, outputHeight / outH);
      outW = Math.round(outW * ratio);
      outH = Math.round(outH * ratio);
    }
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // 原图截取区域
    const sx = Math.round(-pos.x / scale);
    const sy = Math.round(-pos.y / scale);
    const sW = Math.round(VIEW_W / scale);
    const sH = Math.round(VIEW_H / scale);
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const name = (file.name || 'crop').replace(/\.[^.]+$/, '.jpg');
      onConfirm(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div className="bg-panel border border-line rounded-xl2 p-5 w-[360px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="text-fg font-medium mb-4">{title}</div>
        <div
          ref={containerRef}
          className="relative mx-auto overflow-hidden bg-ink cursor-move select-none"
          style={{ width: VIEW_W, height: VIEW_H }}
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
          {/* 裁剪框遮罩 */}
          <div className="absolute inset-0 pointer-events-none border-2 border-white/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.3)]">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="border border-white/30" />
              ))}
            </div>
          </div>
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
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded text-sm text-muted hover:text-fg">取消</button>
          <button onClick={doCrop} className="px-4 py-2 rounded bg-brand text-white text-sm">确认裁剪</button>
        </div>
      </div>
    </div>
  );
}
