/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 浅色 SaaS 主题（1:1 复刻拾光盒子工作台观感）
        ink: '#f4f6f9',       // 页面浅灰底
        panel: '#ffffff',     // 卡片纯白
        panel2: '#f5f7fa',    // 次级灰（hover / 输入框 / 数据子块）
        line: '#e8eaed',      // 极细边框/分割线
        fg: '#1f2329',        // 主正文（近黑不刺眼）
        muted: '#6b7280',     // 次要说明
        faint: '#9ca3af',     // 辅助备注
        brand: '#2f7cf6',     // 天蓝主色（选中/按钮）
        brand2: '#1d6fe0',    // 主色 hover
        danger: '#e53e3e'     // 警示红
      },
      borderRadius: { xl2: '10px' }
    }
  },
  plugins: []
};
