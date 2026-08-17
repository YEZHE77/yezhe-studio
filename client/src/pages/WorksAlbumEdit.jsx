import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img } from '../api.js';

// ============ 设计令牌（对齐 picbling 参考 + 项目规范） ============
// 颜色（禁字体加粗；灰度/字号分层；圆角柔和）
const TEXT = '#1f2329';
const SUB = '#6b7280';
const MUTED = '#9ca3af';
const BORDER = '#e8e8eb';
const BRAND = '#2f7cf6';
const BRAND_LIGHT = '#e8f2ff';
// 左侧深色侧栏
const SIDEBAR_BG = '#2c2c2c';
const SIDEBAR_SUB = 'rgba(255,255,255,0.55)';
const SIDEBAR_TEXT = 'rgba(255,255,255,0.85)';
// 页面背景（中央 + 右侧的浅灰）
const PAGE_BG = '#F5F5F7';
// iPhone 13 真实比例（屏 390×844 + 黑框 + notch + home indicator）
const DEVICE = {
  screenW: 390, screenH: 844,
  frameW: 410, frameH: 890,
  notchW: 110, notchH: 28,
  radius: 44, homeW: 134,
  pad: 10
};

// 相册分区（与后端 works.albums.zone 对齐；sample=对外展示 local=原片 final=成片）
const ZONES = [
  { key: 'sample', label: '样片', desc: '对外展示，C端小程序可见' },
  { key: 'local', label: '原片', desc: '仅后台可见，不对外' },
  { key: 'final', label: '成片', desc: '交付客户的精修成片' }
];

export default function WorksAlbumEdit() {
  const { id } = useParams();
  const nav = useNavigate();

  // ============ 数据状态 ============
  const [work, setWork] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ============ 编辑态（与 work 分离，dirty 标记） ============
  const [title, setTitle] = useState('');
  const [blessing, setBlessing] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);

  // ============ UI 状态 ============
  const [activeZone, setActiveZone] = useState('sample');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sortMode, setSortMode] = useState(false);
  const [busyText, setBusyText] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const fileInputRef = useRef(null);

  // ============ 加载：作品 + 全部相册 ============
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      http.get('/api/works/' + id),
      http.get('/api/works/' + id + '/albums')
    ]).then(([workRes, albumsRes]) => {
      const w = workRes.data && workRes.data.work;
      setWork(w || null);
      if (w) {
        setTitle(w.title || '');
        setBlessing(w.blessing || '');
        setDescription(w.description || '');
      }
      setAlbums((albumsRes.data && albumsRes.data.items) || []);
    }).catch(() => {
      setWork(null);
    }).finally(() => setLoading(false));
  }, [id]);

  // ============ 派生数据 ============
  const albumsByZone = useMemo(() => {
    const map = { sample: [], local: [], final: [] };
    for (const a of albums) {
      if (map[a.zone]) map[a.zone].push(a);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((x, y) => (x.sort || 0) - (y.sort || 0));
    }
    return map;
  }, [albums]);

  const zoneCounts = useMemo(() => ({
    sample: albumsByZone.sample.length,
    local: albumsByZone.local.length,
    final: albumsByZone.final.length
  }), [albumsByZone]);

  const currentZoneItems = albumsByZone[activeZone] || [];
  const allSelected = currentZoneItems.length > 0 && currentZoneItems.every((p) => selectedIds.has(p.id));
  const previewItems = albumsByZone.sample; // 模拟器内显示样片（与 C 端公开页一致）

  // ============ 操作 ============
  function markDirty() { if (!dirty) setDirty(true); }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      // 只传最小必需字段，避免把后端不期望的字段覆盖回去
      const payload = {
        title,
        blessing,
        description
      };
      await http.put('/api/works/' + id, payload);
      setWork({ ...work, title, blessing, description });
      setDirty(false);
    } catch (e) {
      const msg = (e.response && e.response.data && e.response.data.error) || e.message || '保存失败';
      alert('保存失败：' + msg);
    } finally {
      setSaving(false);
    }
  }

  function togglePhoto(pid) {
    const next = new Set(selectedIds);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentZoneItems.map((p) => p.id)));
    }
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`确认从「${ZONES.find((z) => z.key === activeZone).label}」删除选中的 ${selectedIds.size} 张照片？`)) return;
    setBusyText('正在删除…');
    Promise.all(Array.from(selectedIds).map((pid) => http.delete('/api/works/albums/' + pid).catch(() => null)))
      .then(() => {
        setAlbums((arr) => arr.filter((a) => !selectedIds.has(a.id)));
        setSelectedIds(new Set());
      })
      .finally(() => setBusyText(null));
  }

  // 上传：触发原生 input → 调 /api/upload?type=client → /api/works/:id/albums
  function onPickFiles(files) {
    if (!files || !files.length) return;
    setBusyText('正在上传到「' + ZONES.find((z) => z.key === activeZone).label + '」…');
    setUploading(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const token = localStorage.getItem('token') || '';
    fetch((window.__API_BASE__ || '') + '/api/upload?type=client', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd
    })
      .then((r) => r.json())
      .then((j) => {
        const items = (j.items || []).filter((x) => x && x.url).map((x) => ({ url: x.url, originalName: x.originalName, size: x.size }));
        if (!items.length) throw new Error('上传未返回可用图片');
        return http.post('/api/works/' + id + '/albums', { zone: activeZone, items });
      })
      .then(() => http.get('/api/works/' + id + '/albums'))
      .then((r) => setAlbums((r.data && r.data.items) || []))
      .catch((e) => alert('上传失败：' + (e.message || '未知错误')))
      .finally(() => { setBusyText(null); setUploading(false); });
  }

  // ============ 渲染：加载/异常 ============
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="inline-block w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (!work) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 14, color: MUTED }}>作品不存在或已删除</div>
        <button onClick={() => nav('/works')} style={{ fontSize: 14, color: BRAND, background: 'none', border: 'none', cursor: 'pointer' }}>← 返回作品列表</button>
      </div>
    );
  }

  // ============ 渲染：主体 ============
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: PAGE_BG, alignItems: 'flex-start', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      {/* ========== 左侧：深色侧栏（picbling 1:1 复刻） ========== */}
      <aside style={{ width: 150, background: SIDEBAR_BG, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部 LOGO 占位（与 picbling 顶部黑圆风格一致） */}
        <div style={{ padding: '24px 16px 16px', display: 'flex', justifyContent: 'flex-start' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {work.cover_url ? (
              <img src={img(work.cover_url, 'thumb')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 14, color: '#1f2329' }}>叶</span>
            )}
          </div>
        </div>

        {/* 项目标题（不可编辑，只显示） */}
        <div style={{ padding: '0 16px', color: SIDEBAR_TEXT, fontSize: 13, lineHeight: 1.4, wordBreak: 'break-all' }}>
          {work.title || '未命名作品'}
        </div>

        {/* 保存按钮（点亮色 = 蓝，禁用时灰色） */}
        <div style={{ padding: '16px 16px 24px' }}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{
              width: '100%',
              padding: '8px 0',
              borderRadius: 6,
              border: 'none',
              background: (!dirty || saving) ? 'rgba(255,255,255,0.12)' : BRAND,
              color: (!dirty || saving) ? SIDEBAR_SUB : '#fff',
              fontSize: 13,
              cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>

        {/* 返回作品列表（深底浅色文字，左箭头 + 文字） */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '12px 16px' }}>
          <button
            onClick={() => nav('/works')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: SIDEBAR_SUB, fontSize: 12, cursor: 'pointer', padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回作品列表
          </button>
        </div>
      </aside>

      {/* ========== 中央：iPhone 模拟器（可编辑标题/文案，鼠标滚轮滑动） ========== */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ position: 'relative', width: DEVICE.frameW, height: DEVICE.frameH, background: '#0e0e0e', borderRadius: DEVICE.radius, boxShadow: '0 25px 60px rgba(0,0,0,0.18)', padding: DEVICE.pad, boxSizing: 'border-box' }}>
          {/* notch */}
          <div style={{ position: 'absolute', top: DEVICE.pad + 4, left: '50%', transform: 'translateX(-50%)', width: DEVICE.notchW, height: DEVICE.notchH, background: '#000', borderRadius: 14, zIndex: 10 }} />
          {/* 屏幕：可滚动的移动端版式 */}
          <div
            style={{
              width: DEVICE.screenW,
              height: DEVICE.screenH,
              margin: '0 auto',
              background: '#fff',
              borderRadius: DEVICE.radius - 10,
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            {/* 滚动容器（鼠标滚轮可上下滑） */}
            <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>
              {/* 封面图 + 「点击编辑标题」蒙层 */}
              <div style={{ position: 'relative', width: '100%', height: 220, background: '#f0f0f0' }}>
                {work.cover_url ? (
                  <img src={img(work.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>暂无封面</div>
                )}
                <div style={{ position: 'absolute', top: 8, left: 8, color: '#fff', fontSize: 11, background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 3, pointerEvents: 'none' }}>点击编辑标题</div>
              </div>

              {/* 标题（可编辑输入框） */}
              <div style={{ padding: '14px 16px 4px' }}>
                <input
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); markDirty(); }}
                  placeholder="作品标题"
                  style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 17, color: TEXT, fontWeight: 500, padding: 0 }}
                />
              </div>

              {/* 文案（祝福语，可编辑 textarea） */}
              <div style={{ padding: '0 16px 4px' }}>
                <textarea
                  value={blessing}
                  onChange={(e) => { setBlessing(e.target.value); markDirty(); }}
                  placeholder="添加一段祝福语…"
                  rows={2}
                  style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', fontSize: 12, color: SUB, lineHeight: 1.55, padding: 0, minHeight: 32 }}
                />
              </div>

              {/* 日期（自动生成 = 不可编辑展示） */}
              <div style={{ padding: '2px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: MUTED }}>
                  {work.created_at ? new Date(work.created_at).toLocaleDateString('zh-CN') : ''}
                </span>
                <button
                  type="button"
                  onClick={() => { /* 模拟器内按钮仅展示；自动生成逻辑由后端实现 */ }}
                  style={{ background: 'none', border: 'none', color: BRAND, fontSize: 11, cursor: 'pointer', padding: 0 }}
                >
                  自动生成
                </button>
              </div>

              {/* 描述/视频（模拟器内仅展示） */}
              <div style={{ padding: '0 16px 12px' }}>
                <button
                  type="button"
                  onClick={() => { /* 占位 */ }}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 6, border: `1px dashed ${BORDER}`, background: '#fafafa', color: MUTED, fontSize: 12, cursor: 'pointer' }}
                >
                  + 添加视频
                </button>
              </div>

              {/* 照片网格（移动端 3 列瀑布） */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: '0 2px 80px' }}>
                {previewItems.length === 0 && (
                  <div style={{ gridColumn: 'span 3', padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 12 }}>还没有样片，去右侧添加</div>
                )}
                {previewItems.map((p) => (
                  <div key={p.id} style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', background: '#f5f5f5' }}>
                    <img src={img(p.photo_url, 'thumb')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* 底部蓝色「完成」按钮（移动端固定底栏，模拟器内展示） */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0))', background: 'linear-gradient(to top, #fff 70%, rgba(255,255,255,0))' }}>
              <button
                type="button"
                onClick={() => { /* 模拟器内按钮仅展示；保存逻辑在左侧「保存」按钮 */ }}
                style={{ width: '100%', padding: '10px 0', borderRadius: 999, background: BRAND, color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
              >
                ✓ 完成
              </button>
            </div>
          </div>
          {/* home indicator */}
          <div style={{ position: 'absolute', bottom: DEVICE.pad - 2, left: '50%', transform: 'translateX(-50%)', width: DEVICE.homeW, height: 5, background: '#fff', borderRadius: 3, opacity: 0.85, pointerEvents: 'none' }} />
        </div>
      </div>

      {/* ========== 右侧：照片管理面板（picbling 1:1 复刻） ========== */}
      <div style={{ flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720, height: 'calc(100vh - 0px)' }}>
        {/* 工具栏：添加照片 / 排序 / 水印设置 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          {/* 添加照片：点击触发原生 file input；显示当前 zone 计数 */}
          <button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, background: BRAND, color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            添加照片 {zoneCounts[activeZone]}/{zoneCounts[activeZone]}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { onPickFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
          />
          <button
            onClick={() => setSortMode((v) => !v)}
            style={{ padding: '8px 14px', borderRadius: 6, background: sortMode ? BRAND_LIGHT : '#fff', color: sortMode ? BRAND : TEXT, border: `1px solid ${sortMode ? BRAND : BORDER}`, fontSize: 13, cursor: 'pointer' }}
          >
            {sortMode ? '完成排序' : '排序'}
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => alert('水印设置：待与全局设置打通')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: BRAND, fontSize: 13, cursor: 'pointer', padding: '8px 4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            水印设置
          </button>
        </div>

        {/* 主体面板：Tab + 全选 + 照片网格 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          {/* Tab 行 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, borderBottom: `1px solid ${BORDER}` }}>
            {ZONES.map((z) => {
              const active = activeZone === z.key;
              return (
                <button
                  key={z.key}
                  onClick={() => { setActiveZone(z.key); setSelectedIds(new Set()); }}
                  style={{
                    padding: '8px 0',
                    fontSize: 13,
                    color: active ? BRAND : SUB,
                    background: 'none',
                    border: 'none',
                    borderBottom: active ? `2px solid ${BRAND}` : '2px solid transparent',
                    marginBottom: -1,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {z.label} <span style={{ color: active ? BRAND : MUTED }}>({zoneCounts[z.key]})</span>
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', padding: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                删除选中 ({selectedIds.size})
              </button>
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: SUB, cursor: 'pointer' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ accentColor: BRAND }} />
              全选
            </label>
          </div>

          {/* Tab 说明 */}
          <div style={{ fontSize: 11, color: MUTED }}>对外展示，C端小程序可见</div>

          {/* 照片网格（5 列） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, overflowY: 'auto', flex: 1, alignContent: 'start', paddingRight: 4 }}>
            {currentZoneItems.length === 0 && (
              <div style={{ gridColumn: 'span 5', padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 12 }}>
                「{ZONES.find((z) => z.key === activeZone).label}」相册为空，点击上方「添加照片」上传
              </div>
            )}
            {currentZoneItems.map((p) => {
              const checked = selectedIds.has(p.id);
              return (
                <div
                  key={p.id}
                  onMouseEnter={() => setHoverId(p.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => togglePhoto(p.id)}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#f5f5f5',
                    border: checked ? `2px solid ${BRAND}` : `1px solid ${BORDER}`,
                    boxSizing: 'border-box',
                    cursor: sortMode ? 'grab' : 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <img src={img(p.photo_url, 'thumb')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {/* 选框 */}
                  <div
                    onClick={(e) => { e.stopPropagation(); togglePhoto(p.id); }}
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: checked ? BRAND : 'rgba(255,255,255,0.85)',
                      border: checked ? `2px solid ${BRAND}` : '1.5px solid #fff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    {checked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </div>
                  {/* hover 时显示删除 */}
                  {!sortMode && hoverId === p.id && !checked && (
                    <div
                      onClick={(e) => { e.stopPropagation(); if (confirm('删除这张照片？')) http.delete('/api/works/albums/' + p.id).then(() => setAlbums((arr) => arr.filter((a) => a.id !== p.id))); }}
                      style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 全屏操作中遮罩 */}
      {busyText && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span className="inline-block w-6 h-6 border-2 border-gray-300 border-t-brand rounded-full animate-spin" />
          <span style={{ fontSize: 13, color: SUB }}>{busyText}</span>
        </div>
      )}
    </div>
  );
}
