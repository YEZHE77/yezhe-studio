// pages/media/MediaOverviewContent.jsx —— 自媒体工作台「主页」内容块
// 可复用：MediaOverview 页面 + Dashboard 顶部（自媒体 · 待处理选题概览位置）共用同一份内容
// 包含：标题头 + 4 统计卡 + 6 快捷入口 + 最近选题 + AI 配置提示
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDate, priorityOf, toast } from './common.js';

export default function MediaOverviewContent() {
  const nav = useNavigate();
  const [stats, setStats] = useState({ inspirations: 0, topics: 0, published: 0, reviews: 0 });
  const [recentTopics, setRecentTopics] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // 每个 .then 都确保返回数组/数字/对象，Promise.all 解构出任何 undefined 都会让 setRecentTopics
    // 等位置 .slice / .length 报错。加 Array.isArray 兜底防止后端返回非标响应时整页崩溃。
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const safeNum = (v) => (typeof v === 'number' ? v : 0);
    Promise.all([
      http.get('/api/media/inspirations', { params: { page: 1, pageSize: 1 } }).then((r) => safeNum(r.data && r.data.total)).catch(() => 0),
      http.get('/api/media/topics', { params: { includeArchived: 1 } }).then((r) => safeArr(r.data).length).catch(() => 0),
      http.get('/api/media/publish-records').then((r) => safeArr(r.data).length).catch(() => 0),
      http.get('/api/media/reviews').then((r) => safeArr(r.data).length).catch(() => 0),
      http.get('/api/media/topics', { params: { includeArchived: 1 } }).then((r) => safeArr(r.data)).catch(() => []),
      http.get('/api/media/status-columns').then((r) => safeArr(r.data)).catch(() => [])
    ]).then(([insp, top, pub, rev, topics, cols]) => {
      if (!alive) return;
      const sm = {};
      safeArr(cols).forEach((c) => { if (c && c.id != null) sm[String(c.id)] = c.name; });
      setStats({ inspirations: insp || 0, topics: top || 0, published: pub || 0, reviews: rev || 0 });
      setRecentTopics(safeArr(topics).slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 6));
      setStatusMap(sm);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const cards = [
    { label: '灵感总数', value: stats.inspirations, to: '/media/inspirations', icon: 'message', color: '#2DB7F5' },
    { label: '选题总数', value: stats.topics, to: '/media/board', icon: 'select', color: '#9B7ED8' },
    { label: '已发布记录', value: stats.published, to: '/media/publish', icon: 'marketing', color: '#49C5AE' },
    { label: '复盘报告', value: stats.reviews, to: '/media/review', icon: 'review', color: '#FAC054' }
  ];

  const entries = [
    { label: '灵感库', desc: '粘贴链接解析、记录痛点', to: '/media/inspirations', icon: 'message' },
    { label: '选题看板', desc: '拖拽排期、自定义状态列', to: '/media/board', icon: 'select' },
    { label: '内容生产', desc: 'AI 初稿、编辑、5 版草稿', to: '/media/production', icon: 'appointment' },
    { label: '分发记录', desc: '手动录入发布数据', to: '/media/publish', icon: 'marketing' },
    { label: '复盘报告', desc: '真实数据复盘与回流', to: '/media/review', icon: 'review' },
    { label: '标签管理', desc: '重命名、合并、治理标签', to: '/media/tags', icon: 'tag' }
  ];

  return (
    <div>
      {/* 标题 */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>自媒体工作台</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>灵感采集 → 选题策划 → 内容生产 → 分发 → 回填复盘 → 回流迭代</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => nav('/media/inspirations')} className="text-xs" style={{ color: '#2DB7F6', background: '#fff', border: '1px solid #ABE2FB', padding: '0 14px', height: 30, borderRadius: 100, cursor: 'pointer' }}>录入灵感</button>
          <button type="button" onClick={() => nav('/media/board?new=1')} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 14px', height: 30, borderRadius: 100, cursor: 'pointer' }}>新建选题</button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={() => nav(c.to)} className="bg-white border text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(31,35,41,0.10)]" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: '18px 16px', cursor: 'pointer' }}>
            <div className="flex items-center gap-2" style={{ color: c.color }}>
              <Icon name={c.icon} className="w-5 h-5" />
              <span className="text-xs" style={{ color: '#888888' }}>{c.label}</span>
            </div>
            <div className="mt-2 text-[28px]" style={{ color: '#333333' }}>{loading ? '—' : c.value}</div>
          </button>
        ))}
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {entries.map((e) => (
          <button key={e.label} type="button" onClick={() => nav(e.to)} className="bg-white border transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(31,35,41,0.10)]" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: '16px 12px', textAlign: 'center', cursor: 'pointer' }}>
            <div className="flex items-center justify-center" style={{ color: '#2DB7F5' }}><Icon name={e.icon} className="w-6 h-6" /></div>
            <div className="text-[13px] mt-2" style={{ color: '#333333' }}>{e.label}</div>
            <div className="text-[11px] mt-1 leading-[16px]" style={{ color: '#AAAAAA' }}>{e.desc}</div>
          </button>
        ))}
      </div>

      {/* 最近选题 */}
      <div className="bg-white border mt-4" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: '18px 16px' }}>
        <div className="flex items-center justify-between">
          <span className="text-[15px]" style={{ color: '#333333' }}>最近选题</span>
          <button type="button" className="text-xs" style={{ color: '#2DB7F6', cursor: 'pointer', background: 'none', border: 'none' }} onClick={() => nav('/media/board')}>全部 &gt;</button>
        </div>
        {recentTopics.length ? (
          <div className="mt-3 divide-y" style={{ borderColor: '#F5F5F5' }}>
            {recentTopics.map((t) => {
              const p = priorityOf(t.priority);
              return (
                <div key={t.id} onClick={() => nav('/media/production/' + t.id)} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-[#FAFAFA]" style={{ paddingLeft: 8, paddingRight: 8, borderRadius: 4 }}>
                  <span className="shrink-0 w-1 h-6 rounded" style={{ background: t.card_color || '#2DB7F5' }} />
                  <span className="flex-1 min-w-0 truncate text-[13px]" style={{ color: '#333333' }}>{t.title || '未命名选题'}</span>
                  <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded" style={{ background: p.bg, color: p.color }}>{p.label}</span>
                  <span className="shrink-0 text-xs" style={{ color: '#999999' }}>{statusMap[String(t.status_id)] || '未设置'}</span>
                  <span className="shrink-0 text-xs hidden sm:inline" style={{ color: '#BBBBBB' }}>{t.expect_publish_time ? fmtDate(t.expect_publish_time) : ''}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 py-8 text-center text-sm" style={{ color: '#999999' }}>暂无选题，去灵感库把灵感变成选题吧</div>
        )}
      </div>

      {/* AI 配置提示 */}
      <div className="mt-4 text-xs" style={{ color: '#AAAAAA' }}>
        提示：内容生产 / 复盘报告可接入 OpenAI 兼容接口生成初稿（设置存本机，未配置时用本地模板）。禁止自动发布、禁止爬取平台数据，流量与咨询数据请人工回填。
      </div>
      <button
        type="button"
        className="mt-2 text-xs"
        style={{ color: '#2DB7F6', background: 'none', border: '1px solid #ABE2FB', padding: '4px 12px', borderRadius: 100, cursor: 'pointer' }}
        onClick={() => { const cfg = window.prompt('AI 接口配置（JSON）：{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-...","model":"gpt-4o-mini"}', JSON.stringify(JSON.parse(localStorage.getItem('media.aiConfig') || '{}'))); if (cfg) { try { const o = JSON.parse(cfg); if (o.baseUrl && o.apiKey) { localStorage.setItem('media.aiConfig', JSON.stringify(o)); toast('AI 配置已保存'); } else { toast('配置缺少 baseUrl 或 apiKey', 'warn'); } } catch { toast('JSON 格式无效', 'err'); } } }}
      >配置 AI 接口</button>
    </div>
  );
}
