import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';
import { getServiceAgreement } from '../utils/customerAgreement.js';

/* ============================================================
   顾客协议（独立页面）
   —— 从套系预览弹窗内的「行内展开」改造为跳转独立页面
   —— 路由 /packages/:id/agreement；拉取同一接口 /api/packages/:id
   —— 内容保留换行（whiteSpace: pre-wrap），空时显示「未设置」
   ============================================================ */

const MGREEN = '#07C160';
const MGRAY = '#999999';
const MTEXT = '#1f2329';
const MBG = '#FAFAFA';
const MBORDER = '#F0F0F0';

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export default function CustomerAgreement() {
  const { id } = useParams();
  const nav = useNavigate();
  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/packages/' + id)
      .then((r) => setPkg(r.data || null))
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
  }, [id]);

  const agreementText = getServiceAgreement(pkg?.details);
  const packageName = pkg?.name || pkg?.title || '';

  return (
    <div style={{ minHeight: '100vh', background: MBG, paddingBottom: 24 }}>
      {/* 顶部导航：返回 + 标题 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: '#fff',
          height: 48,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid ' + MBORDER
        }}
      >
        <button
          type="button"
          onClick={() => nav(-1)}
          aria-label="返回"
          style={{ width: 36, height: 36, background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
        >
          <IconBack />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600, color: MTEXT, marginRight: 36 }}>
          顾客协议
        </div>
      </div>

      {/* 加载态 */}
      {loading && (
        <div style={{ paddingTop: 80, textAlign: 'center' }}>
          <div
            style={{
              width: 28,
              height: 28,
              border: '3px solid #eee',
              borderTopColor: MGREEN,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto'
            }}
          />
          <div style={{ fontSize: 13, color: MGRAY, marginTop: 12 }}>加载中…</div>
        </div>
      )}

      {/* 套系不存在 */}
      {!loading && !pkg && (
        <div style={{ paddingTop: 80, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: MGRAY }}>套系不存在或已删除</div>
          <button
            type="button"
            onClick={() => nav('/packages')}
            style={{
              marginTop: 16,
              fontSize: 14,
              color: MGREEN,
              background: 'none',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            返回套系列表
          </button>
        </div>
      )}

      {/* 正常渲染 */}
      {!loading && pkg && (
        <>
          {/* 套系名（让用户知道是哪个套系的协议） */}
          {packageName ? (
            <div
              style={{
                margin: '12px 16px 0',
                padding: '12px 14px',
                background: '#fff',
                borderRadius: 10,
                fontSize: 13,
                color: MGRAY,
                lineHeight: 1.6
              }}
            >
              <span style={{ color: MTEXT }}>{packageName}</span>
            </div>
          ) : null}

          {/* 协议正文卡片 */}
          <div
            style={{
              margin: '12px 16px 0',
              padding: '16px 14px',
              background: '#fff',
              borderRadius: 12,
              minHeight: 120
            }}
          >
            {agreementText ? (
              <div
                style={{
                  fontSize: 14,
                  color: MTEXT,
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {agreementText}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: MGRAY, fontSize: 13, padding: '32px 0' }}>
                尚未设置顾客协议
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div
            style={{
              margin: '16px',
              padding: '10px 14px',
              background: '#F5F9FA',
              borderRadius: 6,
              fontSize: 12,
              color: MGRAY,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>💡</span>
            <span>本协议仅作为套系的补充说明，最终以双方签订合同为准</span>
          </div>
        </>
      )}
    </div>
  );
}
