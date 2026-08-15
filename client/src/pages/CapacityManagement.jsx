import React, { useState, useEffect, useCallback } from 'react';
import http, { formatBytes } from '../api.js';
import Icon from '../components/Icon.jsx';
import { safeNum } from '../utils/number.js';

// 三个 Tab（视频流量为预留占位，暂不启用）
const TABS = [
  { key: 'storage', label: '存储空间' },
  { key: 'traffic', label: '图片流量' },
  { key: 'video', label: '视频流量' }
];

const CATEGORY_ORDER = ['negative', 'retouch', 'client', 'cover', 'set', 'backup'];
const CATEGORY_LABEL = {
  'negative': '底片', 'retouch': '精修片', 'client': '客片',
  'cover': '封面套系样片', 'set': '套系样片', 'backup': '系统备份', 'uncategorized': '未分类'
};

function Spinner() {
  return <span className="inline-block w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin align-middle" />;
}

// 容量等级：<70% 正常 / 70-90% 警示 / ≥90% 严重
function levelOf(ratio) {
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.7) return 'warning';
  return 'normal';
}
const LEVEL_BAR = { normal: 'bg-emerald-500', warning: 'bg-amber-400', critical: 'bg-red-500' };
const LEVEL_TX = { normal: 'text-emerald-600', warning: 'text-amber-600', critical: 'text-red-600' };
const LEVEL_BG = { normal: 'bg-emerald-50 border-emerald-200', warning: 'bg-amber-50 border-amber-200', critical: 'bg-red-50 border-red-200' };

function UsageBar({ pct, level }) {
  return (
    <div className="h-3 rounded-full bg-ink overflow-hidden">
      <div className={'h-full ' + LEVEL_BAR[level] + ' transition-all'} style={{ width: Math.min(100, pct) + '%' }} />
    </div>
  );
}

// ===== 存储空间 Tab =====
function StorageTab({ reloadKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    http.get('/api/admin/storage/stats')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (loading) return <div className="text-muted text-sm py-8 flex items-center gap-2"><Spinner /> 加载容量统计…</div>;
  if (!data) return <div className="text-muted text-sm py-8">无法获取存储统计，请确认服务已启动。</div>;

  const ratio = data.limitBytes ? data.totalUsedBytes / data.limitBytes : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const level = levelOf(ratio);
  const remaining = data.limitBytes ? Math.max(0, data.limitBytes - data.totalUsedBytes) : null;

  const cats = [...(data.categories || [])].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a.category) + 99) - (CATEGORY_ORDER.indexOf(b.category) + 99)
  );
  const catSum = cats.reduce((s, c) => s + c.bytes, 0) || 1;

  return (
    <div className="space-y-5">
      {/* 概览进度条 */}
      <div className={'bg-panel border rounded-xl2 p-5 ' + (level === 'critical' ? 'border-red-300' : 'border-line')}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-[15px] text-fg">存储空间概览</div>
          <span className={'text-xs px-2 py-0.5 rounded-full ' + LEVEL_BG[level] + ' ' + LEVEL_TX[level]}>
            {level === 'critical' ? '严重' : level === 'warning' ? '警示' : '正常'}
          </span>
        </div>
        {data.cloudEnabled ? (
          <>
            <div className="flex items-end justify-between flex-wrap gap-2 mt-3 mb-2">
              <div className="text-3xl text-fg">{formatBytes(data.totalUsedBytes)}</div>
              <div className="text-xs text-muted">
                额度 {data.limitBytes ? formatBytes(data.limitBytes) : '不限'}{data.totalEstimated ? '（估算）' : ''} · 剩余 {remaining != null ? formatBytes(remaining) : '—'}
                {data.objectCount != null ? ` · ${data.objectCount} 个对象` : ''}
              </div>
            </div>
            <UsageBar pct={pct} level={level} />
            <div className={'flex items-center justify-between flex-wrap gap-2 mt-2 text-xs ' + LEVEL_TX[level]}>
              <span>{pct}% 已用</span>
              <span className="text-faint">{data.delayNote}</span>
            </div>
            {level === 'critical' && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                已接近免费额度上限，请尽快清理废弃图片或归档历史客片，避免超额产生费用。
              </div>
            )}
          </>
        ) : (
          <div className="mt-3 text-sm text-muted flex items-center gap-2">
            <Icon name="storage" className="w-5 h-5 text-amber-500" />
            当前为本地临时存储（未接入 Cloudflare R2），无配额限制，但服务重启可能导致图片丢失。配置 R2 后将显示真实额度使用情况。
          </div>
        )}
      </div>

      {/* 按业务分类统计 */}
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="text-[15px] text-fg mb-1">按业务分类统计</div>
        <div className="text-xs text-muted mb-4">分类基于上传时登记的业务类型（Worker / 后端强制前缀），无需遍历存储桶。</div>
        {cats.length === 0 ? (
          <div className="text-sm text-muted py-4">暂无已登记图片（新上传将自动归类）。</div>
        ) : (
          <div className="space-y-3">
            {cats.filter(Boolean).map((c) => {
              const cp = Math.round((safeNum(c.bytes) / Math.max(1, catSum)) * 100);
              return (
                <div key={c.category} className="flex items-center gap-3 flex-wrap">
                  <div className="w-28 shrink-0 text-sm text-fg flex items-center gap-1.5">
                    {c.label || '未分类'}
                    {c.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-600">公开</span>}
                  </div>
                  <div className="flex-1 min-w-[80px]">
                    <div className="h-2 rounded-full bg-ink overflow-hidden">
                      <div className="h-full bg-brand/70" style={{ width: cp + '%' }} />
                    </div>
                  </div>
                  <div className="w-full sm:w-40 shrink-0 text-right text-xs text-muted">
                    {formatBytes(c.bytes)} · {c.count} 张 · {cp}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 text-[11px] text-faint">注：带「公开」标记的分类含对外展示图片，清理时请谨慎。</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 快速清理空间 */}
        <CleanupCard onCleaned={load} />
        {/* 图片归档策略指引 */}
        <ArchiveGuideCard />
      </div>

      {/* 对象存储免费额度说明 */}
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="text-[15px] text-fg mb-3">对象存储免费额度说明</div>
        <ul className="space-y-2 text-sm text-muted list-disc pl-5">
          <li><span className="text-fg">主用存储：</span>腾讯云 COS（国内 CDN，访问无需代理）；Cloudflare R2 作为兜底后端仍可配置。</li>
          <li><span className="text-fg">额度：</span>COS 无固定免费额度（按量计费，单价极低）；R2 为永久免费 10GB 存储 + 每月 100GB 出流量。可在后端环境变量配置 COS_STORAGE_LIMIT 自定义告警阈值。</li>
          <li><span className="text-fg">入流量：</span>上传（入流量）在两家云厂商均免费，不产生流量费。</li>
          <li><span className="text-fg">数据时效：</span>存储空间按对象存储真实桶大小统计，每 5 分钟刷新一次（近实时）；出流量（图片流量 Tab）仅 R2 + 配置 CF 令牌时显示，存在 5-15 分钟延迟。</li>
          <li className="text-amber-700">超额风险：超出额度后按云厂商单价计费；本系统全程免费、不涉及任何付费 / VIP / 扩容购买逻辑，请勿轻信第三方扩容服务。</li>
        </ul>
      </div>
    </div>
  );
}

// 快速清理空间：列举未被引用的废弃图片，管理员勾选 → 导出清单 → 二次确认 → 显式删除（绝不自动后台删除）
function CleanupCard({ onCleaned }) {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const scan = () => {
    setLoading(true); setList(null); setSelected(new Set()); setResult(null);
    http.get('/api/admin/storage/orphans?limit=200')
      .then((r) => setList(r.data))
      .catch(() => setList({ list: [], totalBytes: 0, note: '扫描失败' }))
      .finally(() => setLoading(false));
  };

  const toggle = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const allSelected = list && list.list.length > 0 && selected.size === list.list.length;
  const someSelected = selected.size > 0 && !allSelected;

  const setSelectAll = (checked) => {
    if (checked) {
      setSelected(new Set(list.list.map((x) => x.id)));
    } else {
      setSelected(new Set());
    }
  };

  const exportList = () => {
    const rows = list.list.filter((x) => selected.has(x.id)).map((x) => ({
      url: x.url, category: x.category, label: x.label, bytes: x.bytes,
      isPublic: !!x.isPublic, createdAt: x.createdAt
    }));
    // 执行删除前导出待删除清单 JSON（便于本地留档核验）
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, items: rows }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'delete-list.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const doDelete = async () => {
    const urls = list.list.filter((x) => selected.has(x.id)).map((x) => x.url);
    setBusy(true);
    try {
      const r = await http.post('/api/admin/storage/delete', { urls });
      setResult(r.data);
      setShowConfirm(false); setSelected(new Set());
      setList(null);
      onCleaned && onCleaned();
    } finally { setBusy(false); }
  };

  const selItems = list ? list.list.filter((x) => selected.has(x.id)) : [];
  const hasPublic = selItems.some((x) => x.isPublic);

  return (
    <div className="bg-panel border border-line rounded-xl2 p-5 flex flex-col">
      <div className="text-[15px] text-fg mb-1">快速清理空间</div>
      <div className="text-xs text-muted mb-4">仅列举未被任何封面 / 相册引用的废弃图片，手动勾选删除；系统绝不自动后台删除原图。</div>

      {!list && !loading && (
        <button onClick={scan} className="self-start px-4 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90">扫描废弃图片</button>
      )}
      {loading && <div className="text-sm text-muted flex items-center gap-2 py-4"><Spinner /> 扫描中…</div>}

      {list && (
        <div className="flex-1 flex flex-col">
          <div className="text-xs text-muted mb-2">
            仅展示未被任何封面/相册引用的废弃图片 ·{' '}
            <button onClick={scan} className="text-brand hover:underline">重新扫描</button>
          </div>
          <div className="border border-line rounded-lg max-h-56 overflow-auto">
            {list.list.length === 0 ? (
              <div className="text-sm text-muted p-4 text-center">未发现废弃图片，存储空间已整洁。</div>
            ) : (
              <>
                <div className="sticky top-0 z-10 bg-panel2 border-b border-line px-3 py-2 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => setSelectAll(e.target.checked)}
                    className="accent-brand"
                  />
                  <span className="text-fg">
                    {allSelected ? '已全选' : someSelected ? `已选 ${selected.size} 张` : '全选'}
                  </span>
                  <span className="ml-auto">
                    共 {list.list.length} 张 · {formatBytes(list.totalBytes)}
                  </span>
                </div>
                {list.list.map((x) => (
                <label key={x.id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-0 hover:bg-panel2 cursor-pointer text-sm">
                  <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} className="accent-brand" />
                  <span className="w-20 shrink-0 text-xs text-muted">{x.label}</span>
                  {x.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 shrink-0">公开</span>}
                  <span className="flex-1 truncate text-faint" title={x.url}>{x.url}</span>
                  <span className="text-xs text-muted shrink-0">{formatBytes(x.bytes)}</span>
                </label>
              ))}
              </>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!selected.size}
              className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >删除选中（{selected.size}）</button>
            <button
              onClick={() => setSelectAll(!allSelected)}
              disabled={list.list.length === 0}
              className="px-4 py-2 rounded-lg border border-line text-sm text-muted hover:text-fg disabled:opacity-40"
            >{allSelected ? '取消全选' : '全选'}</button>
            <button onClick={exportList} disabled={!selected.size}
              className="px-4 py-2 rounded-lg border border-line text-sm text-muted hover:text-fg disabled:opacity-40">导出删除清单</button>
          </div>
          {hasPublic && (
            <div className="mt-2 text-[11px] text-amber-700">⚠ 选中项含「公开」图片，删除后将导致对外展示缺图，请务必确认。</div>
          )}
        </div>
      )}

      {/* 二次确认弹窗（双确认：勾选确认 + 点击确认删除） */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-panel rounded-xl2 border border-line max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-base text-fg mb-2 flex items-center gap-2">
              <Icon name="storage" className="w-5 h-5 text-red-500" /> 确认删除 {selected.size} 张图片？
            </div>
            <p className="text-sm text-muted mb-3">
              确认后将永久删除，建议先做好本地备份，确定继续？此操作将<span className="text-red-600">永久删除</span>选中的底层图片及其元数据，不可恢复。系统不会自动删除任何原图，本次仅删除你勾选的废弃图片。
              {hasPublic && <span className="block mt-2 text-amber-700">⚠ 含公开图片，删除后对外展示将缺失。</span>}
            </p>
            <DeleteConfirmBox onConfirm={doDelete} onCancel={() => setShowConfirm(false)} busy={busy} />
          </div>
        </div>
      )}

      {result && (
        <div className={'mt-3 text-sm rounded-lg px-3 py-2 ' + (result.failed ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200')}>
          已删除 {result.deleted} 张{result.failed ? `，失败 ${result.failed} 张` : ''}。
        </div>
      )}
    </div>
  );
}

// 二次确认：必须勾选确认框后才可点击「确认删除」
function DeleteConfirmBox({ onConfirm, onCancel, busy }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-muted mb-4 cursor-pointer">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 accent-brand" />
        我已确认这些图片可删除，且已知晓删除不可恢复。
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-line text-sm text-muted">取消</button>
        <button
          onClick={onConfirm}
          disabled={!ok || busy}
          className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm hover:opacity-90 disabled:opacity-40"
        >{busy ? '删除中…' : '确认删除'}</button>
      </div>
    </div>
  );
}

// 图片归档策略指引（静态知识卡片）
function ArchiveGuideCard() {
  const items = [
    { t: '底片（原片）', d: '拍摄完成后按存储时效保留，交付/归档后建议清理线上副本，仅留本地归档备份。' },
    { t: '精修片（成片）', d: '客户验收交付后保留至下载/打印完毕，可转本地长期归档后清理线上。' },
    { t: '客片（样片/选片）', d: '订单生命周期内保留；订单完成后如不再对外展示可清理。' },
    { t: '封面套系样片', d: '长期保留（对外展示门面），非必要不删。' },
    { t: '系统备份', d: '工作室 Logo、资料图等，定期校验完整性，勿随意清理。' }
  ];
  return (
    <div className="bg-panel border border-line rounded-xl2 p-5">
      <div className="text-[15px] text-fg mb-1">图片归档策略指引</div>
      <div className="text-xs text-muted mb-4">合理归档可长期维持免费额度内运行。</div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.t} className="flex gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 shrink-0" />
            <div>
              <div className="text-sm text-fg">{it.t}</div>
              <div className="text-xs text-muted">{it.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-[11px] text-faint">通用原则：删除前务必导出清单并二次确认；公开图片谨慎处理。</div>
    </div>
  );
}

// ===== 图片流量 Tab =====
function TrafficTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    http.get('/api/admin/storage/traffic')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm py-8 flex items-center gap-2"><Spinner /> 加载流量统计…</div>;
  if (!data) return <div className="text-muted text-sm py-8">无法获取流量统计。</div>;

  if (!data.cfConfigured) {
    return (
      <div className="bg-panel border border-line rounded-xl2 p-6 text-sm text-muted space-y-2">
        <div className="text-fg">图片流量（CDN 出流量）</div>
        <p>未配置 Cloudflare API 密钥（CF_API_TOKEN / CF_ACCOUNT_ID），无法读取真实出流量。配置后本页将自动显示当月累计用量与免费额度（100GB / 月）。</p>
        <p className="text-faint">提示：密钥仅存后端环境变量，前端绝不接触。</p>
      </div>
    );
  }

  const ratio = data.limitBytes && data.usedBytes != null ? data.usedBytes / data.limitBytes : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const level = levelOf(ratio);
  const remaining = data.limitBytes && data.usedBytes != null ? Math.max(0, data.limitBytes - data.usedBytes) : null;

  return (
    <div className="space-y-5">
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-[15px] text-fg">图片流量（CDN 出流量 · 本月累计）</div>
          <span className={'text-xs px-2 py-0.5 rounded-full ' + LEVEL_BG[level] + ' ' + LEVEL_TX[level]}>
            {level === 'critical' ? '严重' : level === 'warning' ? '警示' : '正常'}
          </span>
        </div>
        {data.usedBytes != null ? (
          <>
            <div className="flex items-end justify-between flex-wrap gap-2 mt-3 mb-2">
              <div className="text-3xl text-fg">{formatBytes(data.usedBytes)}</div>
              <div className="text-xs text-muted">额度 {formatBytes(data.limitBytes)} · 剩余 {formatBytes(remaining)}</div>
            </div>
            <UsageBar pct={pct} level={level} />
            <div className={'flex items-center justify-between flex-wrap gap-2 mt-2 text-xs ' + LEVEL_TX[level]}>
              <span>{pct}% 已用</span>
              <span className="text-faint">{data.delayNote}</span>
            </div>
          </>
        ) : (
          <div className="mt-3 text-sm text-muted">暂无本月流量数据（新账号或当月无访问）。</div>
        )}
      </div>
      <div className="bg-panel border border-line rounded-xl2 p-5 text-sm text-muted space-y-2">
        <div className="text-fg">Cloudflare R2 流量规则</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>每月 CDN 出流量免费 100GB；超出约 $0.01 / GB。</li>
          <li>上传入流量永久免费。</li>
          <li>图片经 Worker 只读代理分发，已开启 Referer 防盗链，避免被盗刷流量。</li>
        </ul>
      </div>
    </div>
  );
}

// ===== 视频流量 Tab（预留占位）=====
function VideoPlaceholder() {
  return (
    <div className="bg-panel border border-dashed border-line rounded-xl2 p-10 text-center">
      <div className="w-12 h-12 rounded-full bg-panel2 flex items-center justify-center mx-auto mb-3 text-muted">
        <Icon name="storage" className="w-6 h-6" />
      </div>
      <div className="text-[15px] text-fg mb-1">视频流量</div>
      <div className="text-sm text-muted max-w-sm mx-auto">
        本模块为预留占位，当前版本暂不启用。系统暂不托管视频文件，故无视频流量统计。后续若上线视频交付，将在此展示 CDN 出流量使用情况（同样基于 Cloudflare 免费额度，无任何付费 / VIP 逻辑）。
      </div>
      <div className="mt-3 inline-block text-[11px] px-2 py-1 rounded-full bg-panel2 text-faint">即将推出</div>
    </div>
  );
}

export default function CapacityManagement() {
  const [tab, setTab] = useState('storage');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="space-y-5" style={{ maxWidth: 1050 }}>
      <div>
        <h1 className="text-xl text-fg">容量管理</h1>
        <p className="text-muted text-xs mt-0.5">Cloudflare R2 免费额度下的存储与流量监控 · 无任何付费 / VIP / 扩容购买逻辑</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={'px-4 py-2.5 text-sm border-b-2 -mb-px transition ' +
              (tab === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'storage' && <StorageTab reloadKey={reloadKey} />}
      {tab === 'traffic' && <TrafficTab />}
      {tab === 'video' && <VideoPlaceholder />}
    </div>
  );
}
