// pages/media/MediaCompetitors.jsx —— 对标账号库
// 列表卡片（账号名称/平台/主页链接/备注）+ 新增（粘贴主页链接 → AI 解析账号档案回填表单 → 手动保存）
// 生成深度分析：手动粘贴该账号 1-5 条爆款作品链接 → callAI 输出固定 6 段报告 → 存入 analyze_report（历史可查，不重复调用）
// 联动灵感库：报告【评论区客户痛点】→ 一键生成灵感（source_type=对标账号分析 + 「对标账号」标签）；生成后仍需手动复制生成选题
// 约束：严禁爬虫、不批量抓取；所有作品样本链接人工手动粘贴
import React, { useState, useEffect, useCallback } from 'react';
import http from '../../api.js';
import { toast, fmtDateTime, runSkill, readAiConfig } from './common.js';

const REPORT_SECTIONS = ['账号定位人设', '高频选题方向', '爆款共性拆解', '评论区客户痛点', '适合本摄影工作室借鉴点', '需要避开点'];

const EMPTY = { id: null, account_name: '', home_url: '', platform: '', brief: '', manual_note: '' };

export default function MediaCompetitors() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null); // 新增/编辑弹窗
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [anaForm, setAnaForm] = useState(null); // 深度分析弹窗 { id, links, report, saved }
  const [viewReport, setViewReport] = useState(null); // 展开查看的报告 id

  const load = useCallback(() => {
    http.get('/api/media/competitors').then((r) => setList(r.data || [])).catch(() => toast('对标账号加载失败', 'err'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const platformLabel = (p) => (p === 'douyin' ? '抖音' : p === 'xiaohongshu' ? '小红书' : (p || '—'));

  // ---------- 新增 / 编辑 ----------
  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (c) => setForm({ id: c.id, account_name: c.account_name || '', home_url: c.home_url || '', platform: c.platform || '', brief: c.brief || '', manual_note: c.manual_note || '' });
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // AI 解析账号档案（粘贴主页链接 → 读取公开昵称/简介回填表单，不自动保存）
  // 支持全面链接形式：完整 URL / 短链 / 裸域名 / 整段分享文案（自动提取 URL 并补协议）
  const parseAccount = async () => {
    let url = String(form.home_url || '').trim();
    if (!url) { toast('请先粘贴博主主页链接', 'warn'); return; }
    // 1) 从整段文本提取第一个 URL；2) 提取不到则按平台域名定位；3) 自动补协议
    let m = url.match(/https?:\/\/[^\s"'<>()]+/i);
    if (m) {
      url = m[0].replace(/[，。；、,.;:!！?？)）】\]>]+$/, '');
    } else {
      m = url.match(/(?:^|[^\w@/])((?:[a-z0-9-]+\.)*(?:douyin|iesdouyin|xiaohongshu|xhslink)\.(?:com|cn)(?::\d+)?(?:\/[^\s"'<>()]*)?)/i);
      if (m) url = 'https://' + m[1];
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    setParsing(true);
    setForm((f) => ({ ...f, home_url: url }));
    try {
      const r = await http.post('/api/media/competitors/fetch', { url }, { skipToast: true });
      const d = r.data || {};
      setForm((f) => ({ ...f, home_url: url, account_name: d.account_name || f.account_name, platform: d.platform || f.platform, brief: d.brief || f.brief }));
      toast('已解析账号档案，请核对后点「保存」');
    } catch (e) {
      const status = e.status || (e.response && e.response.status);
      if (status === 400) window.alert('链接格式无效，请粘贴小红书/抖音作品链接');
      else window.alert('账号主页解析失败，请手动填写账号基础信息');
    } finally { setParsing(false); }
  };

  const save = async () => {
    if (!String(form.account_name || '').trim() && !String(form.home_url || '').trim()) { toast('账号名称和主页链接不能同时为空', 'warn'); return; }
    setBusy(true);
    try {
      const payload = { account_name: String(form.account_name || '').trim(), home_url: String(form.home_url || '').trim(), platform: form.platform || '', brief: form.brief || '', manual_note: form.manual_note || '' };
      if (form.id) { await http.put('/api/media/competitors/' + form.id, payload); toast('对标账号已更新'); }
      else { await http.post('/api/media/competitors', payload); toast('对标账号已保存'); }
      setForm(null);
      load();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!window.confirm('确定删除对标账号「' + (c.account_name || c.home_url) + '」？其分析报告与关联灵感不受影响。')) return;
    try { await http.delete('/api/media/competitors/' + c.id); toast('已删除'); load(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  // ---------- 生成深度分析 ----------
  const openAnalyze = (c) => setAnaForm({ id: c.id, name: c.account_name || c.home_url, links: '', report: '', saved: false });
  const aiCfg = readAiConfig();
  const hasAi = !!(aiCfg && aiCfg.baseUrl && aiCfg.apiKey);

  const doAnalyze = async () => {
    if (!anaForm) return;
    const links = String(anaForm.links || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!links.length) { toast('请至少粘贴 1 条爆款作品链接', 'warn'); return; }
    if (links.length > 5) { toast('最多粘贴 5 条作品链接', 'warn'); return; }
    const acc = list.find((x) => x.id === anaForm.id);
    if (!acc) { toast('账号不存在，请刷新', 'err'); return; }
    setAnalyzing(true);
    const fallback = `【账号定位人设】\n${acc.account_name || '该账号'} 是${platformLabel(acc.platform)}上专注婚礼/摄影内容的账号，待结合主页信息完善。\n【高频选题方向】\n- 备婚攻略、婚礼当天记录、摄影幕后花絮（方向需结合粘贴的 ${links.length} 条爆款作品进一步确认）\n【爆款共性拆解】\n- 共性与标题钩子有关，建议逐个打开作品链接观察封面、标题与评论后补充\n【评论区客户痛点】\n预算不透明|新人普遍关心价格构成\n【适合本摄影工作室借鉴点】\n- 本地化内容（海口婚礼场景）可复用其选题框架\n【需要避开点】\n- 避免过度修图与夸大承诺的营销话术\n\n（本报告由本地模板生成：${hasAi ? 'AI 接口调用失败，已回退模板' : '未配置 AI 接口，可在主页概览配置'}）`;
    try {
      const r = await runSkill('competitor_analyze', { competitorId: anaForm.id, links: links.join('\n') }, { fallback, temperature: 0.6 });
      setAnaForm((f) => ({ ...f, report: r.text, saved: false }));
      toast(r.source === 'ai' ? 'AI 深度分析完成，请核对后保存' : '已生成模板报告（未配置/调用 AI 失败）', r.source === 'ai' ? 'ok' : 'warn');
    } finally { setAnalyzing(false); }
  };

  // 保存分析报告到库（历史可查，不重复调用 AI）
  const saveReport = async () => {
    if (!anaForm || !String(anaForm.report || '').trim()) { toast('请先生成分析报告', 'warn'); return; }
    try {
      await http.post('/api/media/competitors/' + anaForm.id + '/analyze', { report: anaForm.report });
      setAnaForm((f) => ({ ...f, saved: true }));
      toast('分析报告已保存');
      load();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  // 从报告中提取【评论区客户痛点】段落的痛点列表
  const painsOf = (report) => {
    const out = [];
    const text = String(report || '');
    const sec = text.match(/【评论区客户痛点】([\s\S]*?)(?=【|$)/);
    if (sec) {
      sec[1].split('\n').forEach((line) => {
        const l = line.trim();
        if (!l || /^【|^-+\s*$/.test(l)) return;
        const m = l.match(/^[•·\-]?\s*([^|｜]{2,60})[|｜](.+)$/);
        if (m) out.push({ title: m[1].trim(), content: m[2].trim() });
        else out.push({ title: l.slice(0, 30), content: l });
      });
    }
    return out;
  };

  // 提取痛点生成灵感（不自动创建选题）
  const painToInspirations = async (c) => {
    const pains = painsOf(c.analyze_report);
    if (!pains.length) { toast('报告中没有识别到客户痛点（请检查【评论区客户痛点】段落）', 'warn'); return; }
    if (!window.confirm('将报告中的 ' + pains.length + ' 条痛点生成灵感并存入灵感库？（自动打「对标账号」标签，仍需手动复制生成选题）')) return;
    try {
      const r = await http.post('/api/media/competitors/' + c.id + '/pain-to-inspirations', { pains });
      toast('已生成 ' + (r.data && r.data.created || 0) + ' 条灵感到灵感库（带「对标账号」标签）');
    } catch (e) { toast('生成失败：' + ((e.data && e.data.error) || e.message), 'err'); }
  };

  // 报告渲染：按【】小标题分段
  const renderReport = (report) => {
    if (!report) return <div className="text-sm py-6 text-center" style={{ color: '#999999' }}>暂无分析报告，点击「生成深度分析」</div>;
    const lines = String(report).split('\n');
    return (
      <div className="text-[13px] leading-[1.8]" style={{ color: '#444444' }}>
        {lines.map((line, i) => {
          const s = line.trim();
          if (REPORT_SECTIONS.some((sec) => s === '【' + sec + '】')) {
            return <div key={i} className="font-medium mt-2 mb-1" style={{ color: '#2DB7F5' }}>{s}</div>;
          }
          return <div key={i} className="whitespace-pre-wrap">{line || '\u00A0'}</div>;
        })}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>对标账号库</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>严禁爬虫、不批量抓取账号作品；作品样本链接请人工手动粘贴，规避平台风控</div>
        </div>
        <button type="button" onClick={openNew} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 16px', height: 32, borderRadius: 100, cursor: 'pointer' }}>+ 新增对标账号</button>
      </div>

      {/* 列表卡片 */}
      {(list || []).length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(list || []).map((c) => {
            const hasReport = !!String(c.analyze_report || '').trim();
            const expanded = viewReport === c.id;
            return (
              <div key={c.id} className="bg-white border flex flex-col" style={{ borderRadius: 6, borderColor: '#EEEEEE', overflow: 'hidden' }}>
                <div className="p-3 flex-1 flex flex-col gap-1.5" style={{ minWidth: 0 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[14px] font-medium truncate block" style={{ color: '#333333' }}>{c.account_name || '未命名账号'}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: '#F0F7FF', color: '#2DB7F6' }}>{platformLabel(c.platform)}</span>
                    </div>
                    {hasReport && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#EDF7EF', color: '#49C5AE' }}>已分析</span>}
                  </div>
                  {c.brief ? <div className="text-xs leading-[18px] line-clamp-2" style={{ color: '#888888' }}>{c.brief}</div> : null}
                  {c.home_url ? (
                    <a href={c.home_url} target="_blank" rel="noreferrer" className="text-[11px] truncate" style={{ color: '#2DB7F6', textDecoration: 'none' }} title={c.home_url}>{c.home_url}</a>
                  ) : <span className="text-[11px]" style={{ color: '#BBBBBB' }}>未填主页链接</span>}
                  {c.manual_note ? <div className="text-xs" style={{ color: '#666666' }}>备注：{c.manual_note}</div> : null}
                  <div className="text-[11px]" style={{ color: '#BBBBBB' }}>{fmtDateTime(c.create_time)}</div>
                  <div className="flex gap-2 pt-1 mt-auto">
                    <button type="button" className="text-[11px] flex-1" style={{ color: '#fff', background: '#2DB7F5', border: 'none', padding: '6px 0', borderRadius: 4, cursor: 'pointer' }} onClick={() => openAnalyze(c)}>{hasReport ? '重新深度分析' : '生成深度分析'}</button>
                    <button type="button" className="text-[11px]" style={{ color: '#666666', background: '#F5F5F5', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }} onClick={() => setViewReport(expanded ? null : c.id)}>{expanded ? '收起报告' : (hasReport ? '查看报告' : '报告')}</button>
                    <button type="button" className="text-[11px]" style={{ color: '#666666', background: '#F5F5F5', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }} onClick={() => openEdit(c)}>编辑</button>
                    <button type="button" className="text-[11px]" style={{ color: '#F47175', background: '#FDECEC', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }} onClick={() => remove(c)}>删除</button>
                  </div>
                </div>
                {expanded && (
                  <div style={{ borderTop: '1px solid #F0F0F0', padding: 14 }}>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <span className="text-xs" style={{ color: '#666666' }}>历史分析报告（{hasReport ? '已保存，可随时查看，不重复调用 AI' : '尚未生成'}）</span>
                      {hasReport && (
                        <button type="button" className="text-[11px]" style={{ padding: '4px 12px', borderRadius: 100, border: '1px solid #C9E4F7', background: '#F0F7FF', color: '#2DB7F6', cursor: 'pointer' }} onClick={() => painToInspirations(c)}>↺ 提取痛点生成灵感</button>
                      )}
                    </div>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>{renderReport(c.analyze_report)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border mt-2 py-12 text-center text-sm" style={{ borderRadius: 6, borderColor: '#EEEEEE', color: '#999999' }}>
          暂无对标账号，点击右上角「+ 新增对标账号」
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !busy && setForm(null)}>
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] overflow-auto" style={{ borderRadius: 10, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] mb-4" style={{ color: '#333333' }}>{form.id ? '编辑对标账号' : '新增对标账号'}</div>
            <div className="space-y-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>博主主页链接（抖音 / 小红书，支持各种形式）</div>
                <div className="flex gap-2">
                  <input value={form.home_url || ''} onChange={(e) => setF('home_url', e.target.value)} placeholder="粘贴主页链接或整段分享文案，如 xiaohongshu.com/user/profile/xxx、v.douyin.com/xxx…" style={{ flex: 1, height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={parseAccount} disabled={parsing} style={{ height: 36, padding: '0 12px', borderRadius: 6, border: '1px solid #ABE2FB', background: '#F0F7FF', color: '#2DB7F6', fontSize: 12.5, cursor: parsing ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>{parsing ? '解析中…' : 'AI 解析账号档案'}</button>
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#BBBBBB' }}>支持完整链接 / 短链 / 裸域名 / 整段分享文案；解析成功仅回填表单，点「保存」才入库</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>账号名称</div>
                  <input value={form.account_name || ''} onChange={(e) => setF('account_name', e.target.value)} placeholder="如：某某的婚礼日记" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>平台</div>
                  <select value={form.platform || ''} onChange={(e) => setF('platform', e.target.value)} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    <option value="">未设置</option>
                    <option value="xiaohongshu">小红书</option>
                    <option value="douyin">抖音</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>账号简介</div>
                <textarea value={form.brief || ''} onChange={(e) => setF('brief', e.target.value)} rows={2} placeholder="账号定位、简介（AI 解析可自动回填）" style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>手动备注</div>
                <textarea value={form.manual_note || ''} onChange={(e) => setF('manual_note', e.target.value)} rows={2} placeholder="运营观察、模仿建议等备注" style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setForm(null)} className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={save} disabled={busy} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 深度分析弹窗 */}
      {anaForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !analyzing && setAnaForm(null)}>
          <div className="bg-white w-full max-w-[640px] max-h-[92vh] overflow-auto" style={{ borderRadius: 10, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] mb-1" style={{ color: '#333333' }}>深度分析 · {anaForm.name || ''}</div>
            <div className="text-[11px] mb-3" style={{ color: '#BBBBBB' }}>将「账号主页信息 + 手动粘贴的作品链接」交给 AI 分析；严禁爬虫，作品链接必须人工粘贴</div>

            {!anaForm.report ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>手动粘贴该账号 1-5 条爆款作品链接（每行一条）</div>
                  <textarea value={anaForm.links || ''} onChange={(e) => setAnaForm((f) => ({ ...f, links: e.target.value }))} rows={5} placeholder={'https://www.xiaohongshu.com/explore/xxx\nhttps://v.douyin.com/xxx/'} style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
                </div>
                <div className="text-[11px]" style={{ color: '#999999' }}>
                  {hasAi ? '✅ 已配置 AI 接口，将调用真实模型' : '⚠️ 未配置 AI 接口（主页概览 → 配置 AI 接口），将生成本地模板报告'}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setAnaForm(null)} className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>取消</button>
                  <button type="button" onClick={doAnalyze} disabled={analyzing} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: analyzing ? 'default' : 'pointer' }}>{analyzing ? '分析中…' : '开始 AI 深度分析'}</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ maxHeight: 380, overflowY: 'auto', background: '#FAFAFA', borderRadius: 6, padding: 12 }}>{renderReport(anaForm.report)}</div>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setAnaForm((f) => ({ ...f, report: '', links: '' }))} className="text-xs" style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>重新生成</button>
                  {anaForm.saved
                    ? <span className="text-xs flex items-center" style={{ color: '#49C5AE' }}>✓ 已保存到历史报告</span>
                    : <button type="button" onClick={saveReport} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: 'pointer' }}>保存报告</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
