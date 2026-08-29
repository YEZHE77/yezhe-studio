// pages/media/MediaProduction.jsx —— 内容生产
// 传入 topic_id 加载对应选题；AI Skill 调用生成初稿（OpenAI 兼容接口，未配置回退模板）
// 内置编辑器二次编辑；保存触发广告违禁词检测（仅弹窗提示命中词，不拦截保存）
// 草稿规则：单条选题最多 5 版，超出自动删除最旧；支持版本切换、回退旧草稿
// 附带输出：备选标题数组、话题标签、配图思路；可绑定素材
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import http, { img } from '../../api.js';
import { toast, fmtDateTime, runSkill, checkBanned, PRIORITY_OPTS } from './common.js';

export default function MediaProduction() {
  const nav = useNavigate();
  const { topicId } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';

  // 选题
  const [topic, setTopic] = useState(null);
  const [notFound, setNotFound] = useState(false);
  // 新建表单
  const [newForm, setNewForm] = useState({ title: '', core_pain: '', target_platform: '', content_form: '图文', priority: 'medium', expect_publish_time: '', card_color: '#2DB7F5' });
  // 草稿
  const [drafts, setDrafts] = useState([]);
  const [curVersion, setCurVersion] = useState(null);
  const [content, setContent] = useState('');
  const [altTitles, setAltTitles] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [imageIdeas, setImageIdeas] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const loadTopic = useCallback(() => {
    if (!topicId) return;
    http.get('/api/media/topics/' + topicId).then((r) => setTopic(r.data || null)).catch(() => setNotFound(true));
  }, [topicId]);

  const loadDrafts = useCallback(() => {
    if (!topicId) return;
    http.get('/api/media/drafts', { params: { topic_id: topicId } }).then((r) => {
      const list = r.data || [];
      setDrafts(list);
      if (list.length) {
        const last = list[list.length - 1];
        setCurVersion(last.version);
        setContent(last.content || '');
        setAltTitles((last.alt_titles || []).join('\n'));
        setHashtags((last.hashtags || []).join(' '));
        setImageIdeas((last.image_ideas || []).join('\n'));
      }
    }).catch(() => {});
  }, [topicId]);

  useEffect(() => { loadTopic(); }, [loadTopic]);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  // 新建选题
  const createTopic = async () => {
    if (!String(newForm.title || '').trim()) { toast('选题标题不能为空', 'warn'); return; }
    setBusy(true);
    try {
      const r = await http.post('/api/media/topics', newForm);
      toast('选题已创建，进入内容生产');
      nav('/media/production/' + r.data.id, { replace: true });
    } catch (e) { toast('创建失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  // 保存草稿（含违禁词检测：仅提示不拦截）
  const saveDraft = async () => {
    if (!topicId) return;
    if (!String(content || '').trim()) { toast('正文不能为空', 'warn'); return; }
    const hits = checkBanned(content + '\n' + altTitles);
    if (hits.length) window.alert('广告违禁词提示（不会阻止保存）：命中 ' + hits.join('、') + '。请自行斟酌是否修改。');
    setBusy(true);
    try {
      const r = await http.post('/api/media/drafts', {
        topic_id: Number(topicId),
        content,
        alt_titles: altTitles.split('\n').map((s) => s.trim()).filter(Boolean),
        hashtags: hashtags.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean),
        image_ideas: imageIdeas.split('\n').map((s) => s.trim()).filter(Boolean)
      });
      toast('草稿 v' + r.data.version + ' 已保存（最多保留 5 版）');
      loadDrafts();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  // 回退旧草稿：切换到指定版本
  const switchVersion = (d) => {
    setCurVersion(d.version);
    setContent(d.content || '');
    setAltTitles((d.alt_titles || []).join('\n'));
    setHashtags((d.hashtags || []).join(' '));
    setImageIdeas((d.image_ideas || []).join('\n'));
    toast('已切换到 v' + d.version);
  };

  // AI 生成初稿（基于选题字段；只允许 AI 写文案，数据字段人工填写）
  // 走后端 Skill 模板：runSkill('draft_generate') → /api/ai/render 用选题业务数据填占位符 → 前端直连大模型
  const aiGenerate = async () => {
    if (!topic) return;
    setAiBusy(true);
    const fallback = `【AI 初稿 · 本地模板 · 未配置 AI 接口，以下为示例】\n\n围绕「${topic.title || '本选题'}」的核心痛点「${topic.core_pain || '待补充'}」，这篇内容将面向${topic.target_platform || '目标平台'}的${topic.content_form || '图文'}用户展开：\n\n1. 开头抛出痛点：你是否也在备婚/拍摄中遇到同样的问题？\n2. 展开解决方案与实操建议。\n3. 结尾引导互动：评论区聊聊你的经历。\n\n（提示：在「主页概览」配置 AI 接口后，此处将调用真实模型生成初稿）`;
    try {
      const r = await runSkill('draft_generate', { topicId: Number(topic.id) }, { fallback, temperature: 0.7 });
      setContent(r.text);
      toast(r.source === 'ai' ? 'AI 初稿已生成' : '已生成模板初稿（未配置 AI 接口）', r.source === 'ai' ? 'ok' : 'warn');
    } finally { setAiBusy(false); }
  };

  // AI 深度违禁词检测（skill: banned_check）。仅标记文本中实际存在的命中词，不自动改写。
  const [bannedAi, setBannedAi] = useState(null);
  const [bannedAiBusy, setBannedAiBusy] = useState(false);
  const aiCheckBanned = async () => {
    const text = (content || '') + '\n' + (altTitles || '');
    if (!String(text).trim()) { toast('正文与备选标题均为空', 'warn'); return; }
    setBannedAiBusy(true);
    const fallback = '未发现明显违禁词（未配置 AI 接口，已用本地关键词列表做基础检测）。';
    try {
      const r = await runSkill('banned_check', { text }, { fallback, temperature: 0.2 });
      setBannedAi({ text: r.text, source: r.source });
    } finally { setBannedAiBusy(false); }
  };

  // 去分发记录（带 topic 预选）
  const goPublish = () => nav('/media/publish?topic_id=' + topic.id);

  // ---------- 新建视图 ----------
  if (isNew || !topicId) {
    return (
      <div style={{ maxWidth: 640 }}>
        <div className="text-[20px] mb-1" style={{ color: '#222222' }}>新建选题</div>
        <div className="text-xs mb-4" style={{ color: '#999999' }}>创建后直接进入内容生产</div>
        <div className="bg-white border" style={{ borderRadius: 8, borderColor: '#EEEEEE', padding: 20 }}>
          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1" style={{ color: '#666666' }}>标题 *</div>
              <input value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} placeholder="选题标题" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: '#666666' }}>核心痛点</div>
              <textarea value={newForm.core_pain} onChange={(e) => setNewForm((f) => ({ ...f, core_pain: e.target.value }))} rows={2} placeholder="用户痛点…" style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>目标平台</div>
                <input value={newForm.target_platform} onChange={(e) => setNewForm((f) => ({ ...f, target_platform: e.target.value }))} placeholder="小红书 / 抖音" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>内容形式</div>
                <select value={newForm.content_form} onChange={(e) => setNewForm((f) => ({ ...f, content_form: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                  <option value="图文">图文</option>
                  <option value="短视频">短视频</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>优先级</div>
                <select value={newForm.priority} onChange={(e) => setNewForm((f) => ({ ...f, priority: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                  {PRIORITY_OPTS.map((p) => <option key={p.value} value={p.value}>{p.label}优先级</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>预计发布时间</div>
                <input type="date" value={newForm.expect_publish_time} onChange={(e) => setNewForm((f) => ({ ...f, expect_publish_time: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => nav('/media/board')} className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>返回看板</button>
            <button type="button" onClick={createTopic} disabled={busy} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>{busy ? '创建中…' : '创建并进入生产'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 404 ----------
  if (notFound) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: '#999999' }}>
        选题不存在或已删除
        <div className="mt-3"><button type="button" className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ABE2FB', background: '#F0F7FF', color: '#2DB7F6', cursor: 'pointer' }} onClick={() => nav('/media/board')}>返回选题看板</button></div>
      </div>
    );
  }

  if (!topic) {
    return <div className="py-16 text-center text-sm" style={{ color: '#999999' }}>加载中…</div>;
  }

  const curDraft = drafts.find((d) => d.version === curVersion);

  return (
    <div style={{ maxWidth: 960 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[20px] truncate" style={{ color: '#222222' }} title={topic.title}>{topic.title || '未命名选题'}</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>选题 #{topic.id} · 核心痛点：{topic.core_pain || '（未填）'}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => nav('/media/board')} className="text-xs" style={{ color: '#666666', background: '#fff', border: '1px solid #E0E0E0', padding: '0 14px', height: 30, borderRadius: 100, cursor: 'pointer' }}>看板</button>
          <button type="button" onClick={goPublish} className="text-xs" style={{ color: '#2DB7F6', background: '#F0F7FF', border: '1px solid #ABE2FB', padding: '0 14px', height: 30, borderRadius: 100, cursor: 'pointer' }}>记录发布</button>
        </div>
      </div>

      {/* 草稿版本栏 */}
      <div className="bg-white border mb-4" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="text-xs" style={{ color: '#888888' }}>草稿版本：</span>
        (drafts || []).length ? (drafts || []).map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => switchVersion(d)}
            className="text-xs"
            style={d.version === curVersion ? { background: '#2DB7F5', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 100, cursor: 'pointer' } : { background: '#F5F5F5', color: '#666666', border: 'none', padding: '4px 10px', borderRadius: 100, cursor: 'pointer' }}
          >v{d.version}</button>
        )) : <span className="text-xs" style={{ color: '#BBBBBB' }}>暂无草稿</span>}
        <span className="text-xs ml-auto" style={{ color: '#BBBBBB' }}>最多保留 5 版，超出自动删除最旧</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 编辑器主区 */}
        <div className="lg:col-span-2">
          <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[14px]" style={{ color: '#333333' }}>正文编辑器</span>
              <div className="flex gap-2">
                <button type="button" onClick={aiGenerate} disabled={aiBusy} className="text-xs" style={{ padding: '6px 14px', borderRadius: 100, border: '1px solid #ABE2FB', background: '#F0F7FF', color: '#2DB7F6', cursor: aiBusy ? 'default' : 'pointer' }}>{aiBusy ? '生成中…' : '✨ AI 生成初稿'}</button>
                <button type="button" onClick={aiCheckBanned} disabled={bannedAiBusy} className="text-xs" style={{ padding: '6px 14px', borderRadius: 100, border: '1px solid #F3D6A8', background: '#FFF7EC', color: '#E6A23C', cursor: bannedAiBusy ? 'default' : 'pointer' }}>{bannedAiBusy ? '检测中…' : '🛡 AI 违禁词检测'}</button>
              </div>
              {bannedAi && (
                <div className="mt-2 text-[12px]" style={{ color: '#666666', background: '#FAFAFA', border: '1px solid #F0F0F0', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ color: '#E6A23C' }}>AI 违禁词检测{bannedAi.source === 'ai' ? '' : '（本地模板）'}：</span>
                  <div className="whitespace-pre-wrap mt-1" style={{ color: '#444444' }}>{bannedAi.text}</div>
                </div>
              )}
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              placeholder="在此编写 / 编辑文案正文…"
              style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 10, fontSize: 13.5, lineHeight: 1.7, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
            />
            <div className="text-[11px] mt-1" style={{ color: '#BBBBBB' }}>{content.length} 字 · 保存时自动检测广告违禁词（仅提示，不拦截）</div>
            <div className="flex justify-end mt-3">
              <button type="button" onClick={saveDraft} disabled={busy} className="text-xs" style={{ padding: '8px 24px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>{busy ? '保存中…' : '保存草稿' + (curVersion ? '（新版本）' : '')}</button>
            </div>
          </div>

          {/* 素材预览 */}
          {topic.materialRef && (topic.materialRef.urls || []).length > 0 && (
            <div className="bg-white border mt-4" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 12 }}>
              <div className="text-xs mb-2" style={{ color: '#666666' }}>已绑定素材（{topic.materialRef.urls.length} 张）</div>
              <div className="flex flex-wrap gap-2">
                {(topic.materialRef.urls || []).map((u, i) => (
                  <img key={i} src={img(u)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid #EEE' }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 附带输出区 */}
        <div className="space-y-4">
          <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
            <div className="text-[13px] mb-2" style={{ color: '#333333' }}>备选标题（每行一个）</div>
            <textarea value={altTitles} onChange={(e) => setAltTitles(e.target.value)} rows={4} placeholder={'标题A\n标题B'} style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
            <div className="text-[13px] mb-2" style={{ color: '#333333' }}>话题标签（空格/逗号分隔）</div>
            <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#海口婚礼 #备婚日记" style={{ width: '100%', height: 34, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
            <div className="text-[13px] mb-2" style={{ color: '#333333' }}>配图思路（每行一条）</div>
            <textarea value={imageIdeas} onChange={(e) => setImageIdeas(e.target.value)} rows={4} placeholder={'封面：…\n配图：…'} style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div className="bg-white border" style={{ borderRadius: 6, borderColor: '#EEEEEE', padding: 14 }}>
            <div className="text-[13px] mb-2" style={{ color: '#333333' }}>选题信息</div>
            <div className="text-xs space-y-1" style={{ color: '#666666' }}>
              <div>平台：{topic.target_platform || '—'} · 形式：{topic.content_form || '—'}</div>
              <div>优先级：{(PRIORITY_OPTS.find((p) => p.value === topic.priority) || {}).label || '—'} · 预计发布：{topic.expect_publish_time ? String(topic.expect_publish_time).slice(0, 10) : '—'}</div>
              {topic.reference_url ? <div className="truncate">参考：<a href={topic.reference_url} target="_blank" rel="noreferrer" style={{ color: '#2DB7F6', textDecoration: 'none' }}>{topic.reference_url}</a></div> : null}
            </div>
            <div className="flex gap-2 mt-3">
              <button type="button" className="text-xs flex-1" style={{ padding: '6px 0', borderRadius: 4, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }} onClick={() => nav('/media/board')}>回看板</button>
              <button type="button" className="text-xs flex-1" style={{ padding: '6px 0', borderRadius: 4, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }} onClick={() => nav('/media/board')}>编辑选题</button>
            </div>
          </div>
          {curDraft && (
            <div className="text-[11px]" style={{ color: '#BBBBBB' }}>当前草稿 v{curDraft.version} 保存于 {fmtDateTime(curDraft.created_at)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
