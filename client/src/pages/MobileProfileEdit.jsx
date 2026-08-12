import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Pencil, MapPin, Plus, ChevronRight, MessageCircle, AtSign, Smartphone, Music } from 'lucide-react';
import http, { img, uploadImage } from '../api.js';
import { useAuth } from '../auth.jsx';

const MINT = '#7ECDBB';
const MINT_DARK = '#5FBBA6';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#EFEFEF';
const RED = '#FF6B6B';

function safeArray(v) { return Array.isArray(v) ? v : []; }
function safeObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

// 微信/微博/抖音 简易图标
function WechatIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9.5 4C5.36 4 2 6.9 2 10.5c0 1.9 1 3.6 2.7 4.8-.1.8-.5 2-.8 2.6 1.2-.1 2.6-.6 3.4-1.1.7.2 1.5.3 2.3.3 4.1 0 7.5-2.9 7.5-6.5S13.6 4 9.5 4z" fill="#07C160"/>
      <circle cx="7" cy="10" r="1" fill="#fff"/>
      <circle cx="12" cy="10" r="1" fill="#fff"/>
      <path d="M17.5 9c3.1 0 5.5 2.2 5.5 5s-2.4 5-5.5 5c-.6 0-1.2-.1-1.8-.2-.6.4-1.6.8-2.5.9.2-.5.5-1.4.6-2-1.3-.9-2.1-2.3-2.1-3.7 0-2.8 2.4-5 5.3-5z" fill="#07C160"/>
      <circle cx="16" cy="12" r=".8" fill="#fff"/>
      <circle cx="20" cy="12" r=".8" fill="#fff"/>
    </svg>
  );
}
function WeiboIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10.2 19.5c-3.6.4-6.7-1.3-6.9-3.8-.2-2.5 2.6-4.9 6.2-5.3 3.6-.4 6.7 1.3 6.9 3.8.2 2.5-2.6 4.9-6.2 5.3z" fill="#E6162D"/>
      <path d="M17.8 10.3c-.3 0-.6-.1-.8-.2-.2-.1-.4-.4-.3-.7.1-.3.4-.4.7-.3.5.2 1.1.1 1.5-.3.4-.4.6-1 .4-1.5-.1-.3 0-.6.3-.7.3-.1.6 0 .7.3.3.9 0 1.9-.6 2.5-.6.6-1.3.9-1.9.9z" fill="#E6162D"/>
      <path d="M19.5 7.5c-.5 0-1-.2-1.4-.5-.3-.2-.4-.6-.2-.9.2-.3.6-.4.9-.2.5.3 1.1.2 1.5-.2.4-.4.5-1 .2-1.5-.2-.3-.1-.7.2-.9.3-.2.7-.1.9.2.5.9.3 2-.5 2.7-.4.4-1 .6-1.6.6v.7z" fill="#E6162D"/>
    </svg>
  );
}
function DouyinIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M16 8.5V5h-2.5v10.5c0 1.7-1.3 3-3 3s-3-1.3-3-3 1.3-3 3-3c.4 0 .7.1 1 .2V10c-.3-.1-.7-.1-1-.1-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5V8.5c1 .6 2.2 1 3.5 1V7c-1.2 0-2.3-.5-3-1.3-.7-.8-1-1.7-1-2.7h2.5c0 1.3.5 2.5 1.3 3.3.8.8 1.9 1.2 3.2 1.2V8.5h-2.5z" fill="#1C1C1C"/>
    </svg>
  );
}

// 头像压缩兜底（与 MobileWorkbench 一致）
function compressImageToBase64(file, maxWidth = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function MobileProfileEdit() {
  const nav = useNavigate();
  const { user, updateUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [studio, setStudio] = useState(null);
  const [members, setMembers] = useState([]);
  const logoRef = useRef(null);
  const memberRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      http.get('/api/settings/studio').then((r) => r.data),
      http.get('/api/admin/personnel').then((r) => r.data || []).catch(() => [])
    ])
      .then(([s, personnel]) => {
        setStudio(s);
        setMembers(safeArray(s.members).length ? safeArray(s.members) : personnel.filter((p) => p.avatar).slice(0, 4));
      })
      .catch(() => setStudio({}))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!studio) return;
    try {
      setSaving(true);
      const payload = {
        ...studio,
        members
      };
      await http.put('/api/settings/studio', payload);
      await updateUser({ name: studio.name });
      nav('/');
    } catch (e) {
      console.warn('保存失败', e);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !studio) return;
    try {
      let url;
      try {
        const r = await uploadImage(file, { category: 'logo', isPublic: true });
        url = r.url;
      } catch (cloudErr) {
        console.warn('云端上传不可用，降级为 base64 logo', cloudErr);
        url = await compressImageToBase64(file);
      }
      setStudio((prev) => ({ ...prev, logo: url }));
    } catch (err) {
      alert('Logo 上传失败');
    }
  };

  const handleMemberUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      let url;
      try {
        const r = await uploadImage(file, { category: 'avatar', isPublic: true });
        url = r.url;
      } catch (cloudErr) {
        url = await compressImageToBase64(file);
      }
      setMembers((prev) => [...prev, { id: Date.now(), name: '', avatar: url, sort: prev.length }]);
    } catch (err) {
      alert('成员头像上传失败');
    }
  };

  if (loading || !studio) {
    return (
      <div style={{ minHeight: '100%', background: '#F8F8F8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED }}>
        加载中…
      </div>
    );
  }

  const name = studio.name || user?.name || '岛像微电影';
  const subTitle = studio.subTitle || '';
  const tags = safeArray(studio.tags);
  const address = studio.address || '';
  const socials = { wechat: '', weibo: '', phone: '', douyin: '', ...safeObj(studio.socials) };

  const contactCards = [
    { key: 'wechat', label: '微信', icon: <WechatIcon />, value: socials.wechat, placeholder: '去绑定', color: '#07C160' },
    { key: 'weibo', label: '微博', icon: <WeiboIcon />, value: socials.weibo, placeholder: '去绑定', color: '#E6162D' },
    { key: 'phone', label: '手机', icon: <Smartphone size={18} style={{ color: TEXT }} />, value: socials.phone, placeholder: '去绑定', color: TEXT },
    { key: 'douyin', label: '抖音', icon: <DouyinIcon />, value: socials.douyin, placeholder: '去绑定', color: '#1C1C1C' }
  ];

  return (
    <div style={{ minHeight: '100%', background: '#F8F8F8', paddingBottom: 84 }}>
      {/* 顶部导航 */}
      <div className="flex items-center" style={{ background: '#fff', borderBottom: '1px solid ' + LINE, padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <button type="button" onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', color: TEXT }}>
          <ChevronLeft size={22} />
          <span style={{ fontSize: 14, marginLeft: -2 }}>返回</span>
        </button>
        <div className="flex-1 text-center" style={{ fontSize: 16, color: TEXT }}>编辑资料</div>
        <button type="button" onClick={handleSave} disabled={saving} style={{ background: 'none', border: 'none', padding: 0, fontSize: 14, color: MINT_DARK }}>
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      {/* 工作室信息卡 */}
      <div style={{ background: '#fff', padding: '24px 16px', textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => logoRef.current && logoRef.current.click()}
          style={{ width: 86, height: 86, borderRadius: '50%', overflow: 'hidden', background: '#111', border: 'none', padding: 0, margin: '0 auto', display: 'block', position: 'relative' }}
        >
          {studio.logo ? (
            <img src={img(studio.logo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: 28, fontWeight: 500 }}>岛像</span>
          )}
        </button>
        <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setStudio((prev) => ({ ...prev, name: e.target.value }))}
            style={{ fontSize: 18, color: TEXT, fontWeight: 500, textAlign: 'center', border: 'none', background: 'transparent', width: 160 }}
          />
          <Pencil size={14} style={{ color: MUTED }} />
        </div>

        <input
          type="text"
          value={subTitle}
          placeholder="添加副标题，如：婚纱照 | 婚礼跟拍 | 人物肖像"
          onChange={(e) => setStudio((prev) => ({ ...prev, subTitle: e.target.value }))}
          style={{ marginTop: 6, fontSize: 13, color: MUTED, textAlign: 'center', border: 'none', background: 'transparent', width: '100%' }}
        />

        <button
          type="button"
          style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4, background: MINT, color: '#fff', border: 'none', borderRadius: 14, padding: '6px 14px', fontSize: 13 }}
        >
          <MapPin size={14} />
          {address || '编辑地址及定位'}
        </button>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {tags.length ? tags.map((t, i) => (
            <span key={i} style={{ fontSize: 13, color: MUTED }}>{t}{i < tags.length - 1 ? ' |' : ''}</span>
          )) : (
            <span style={{ fontSize: 13, color: MUTED }}>添加标签，如：婚纱电影 | 婚前影像 | 婚礼拍摄</span>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: '#bbb' }}>岛像微电影</div>
      </div>

      {/* 团队成员 */}
      <div style={{ background: '#fff', marginTop: 10, padding: '16px' }}>
        <div style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>
          团队成员介绍 <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>(点击“+”添加成员，长按排序)</span>
        </div>
        <div className="flex items-center" style={{ marginTop: 14, gap: 12 }}>
          <button
            type="button"
            onClick={() => memberRef.current && memberRef.current.click()}
            style={{ width: 52, height: 52, borderRadius: '50%', border: '1px dashed #D0D0D0', background: '#FAFAFA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={22} style={{ color: MUTED }} />
          </button>
          <input ref={memberRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleMemberUpload} />
          {members.map((m, idx) => (
            <div key={m.id || idx} style={{ width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', background: '#eee' }}>
              {m.avatar ? <img src={img(m.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 12 }}>{m.name?.[0] || '?'}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 联系方式 */}
      <div style={{ background: '#fff', marginTop: 10, padding: '16px' }}>
        <div style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>联系方式 <span style={{ color: RED }}>*</span></div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {contactCards.map((c) => (
            <div key={c.key} style={{ flex: '0 0 auto', width: 110, border: '1px dashed ' + LINE, borderRadius: 10, padding: '14px 10px', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>{c.icon}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>{c.label}</div>
              <div style={{ fontSize: 13, color: c.value ? TEXT : MUTED, marginTop: 4 }}>{c.value || c.placeholder}</div>
              <ChevronRight size={14} style={{ color: '#ccc', margin: '4px auto 0' }} />
            </div>
          ))}
        </div>
      </div>

      {/* 功能列表 */}
      <div style={{ background: '#fff', marginTop: 10 }}>
        <ListRow label="小程序" value={studio.miniProgram?.enabled ? '已开通' : '未开通'} />
        <ListRow label="我的网站" value={studio.website?.enabled ? (studio.website.domain || '已开通') : '开通域名'} valueColor={studio.website?.enabled ? TEXT : RED} />
        <ListRow label="发布动态" />
        <ListRow label="顾客协议" value={studio.agreement?.enabled ? '已启用' : '未启用'} last />
      </div>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#ddd' }}>ID: {user?.id || '285098'}</div>
    </div>
  );
}

function ListRow({ label, value, valueColor = RED, last = false }) {
  return (
    <div className="flex items-center" style={{ padding: '16px', borderBottom: last ? 'none' : '1px solid ' + LINE }}>
      <div style={{ flex: 1, fontSize: 14, color: TEXT }}>{label}</div>
      <div className="flex items-center" style={{ color: valueColor, fontSize: 13 }}>
        {value && <span>{value}</span>}
        <ChevronRight size={16} style={{ color: '#ccc', marginLeft: 2 }} />
      </div>
    </div>
  );
}
