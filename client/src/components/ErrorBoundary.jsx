import React from 'react';
import { reportBoundary } from '../utils/errorReporter.js';

// 全局错误边界：防止单个页面/组件抛错导致整个 SPA 白屏
// 出错后显示友好提示 + 刷新/返回按钮，并自动上报到监控（含发生端 / 路由上下文）
// 支持 resetKeys：当 key 变化时自动重置错误状态（配合路由 location.pathname 使用）
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] 页面渲染错误:', error, errorInfo);
    // 自动上报到三端统一异常监控（含 end / 路由 / 组件栈）
    try { reportBoundary(error, errorInfo); } catch {}
    // 兼容调用方自定义上报
    if (this.props.onError) {
      try { this.props.onError(error, errorInfo); } catch {}
    }
  }

  componentDidUpdate(prevProps) {
    const { resetKeys = [] } = this.props;
    const prev = prevProps.resetKeys || [];
    if (this.state.hasError && resetKeys.length && resetKeys.some((k, i) => k !== prev[i])) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || '未知错误';
      return (
        <div className="min-h-screen bg-ink flex items-center justify-center p-6">
          <div className="bg-panel border border-line rounded-xl2 p-8 max-w-md w-full text-center shadow-sm">
            <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-2xl mx-auto mb-4">⚠</div>
            <h2 className="text-lg font-semibold text-fg mb-2">页面遇到一点问题</h2>
            <p className="text-sm text-muted mb-4">请尝试刷新页面，或返回上一页。如果问题持续，请截图控制台报错联系开发者。</p>
            <div className="bg-ink rounded p-3 text-left text-xs text-red-600 font-mono mb-5 break-all">{msg}</div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">刷新页面</button>
              <button onClick={() => { this.setState({ hasError: false, error: null }); if (window.history.length > 1) window.history.back(); else window.location.href = '/'; }} className="px-4 py-2 rounded border border-line text-fg text-sm hover:bg-panel2">返回</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
