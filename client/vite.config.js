import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// 构建 ID：用当前 commit 短 hash 作为所有产物文件名后缀。
// Cloudflare Pages 对 /assets/* 走强缓存，若仅靠内容 hash，
// 极端情况下浏览器仍可能命中旧 chunk（旧页面逻辑残留）。
// 加上构建 ID 后每次部署文件名必变，彻底规避「代码已更新但页面仍是旧逻辑」。
function getBuildId() {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return Date.now().toString(36); }
}
const BUILD_ID = getBuildId();

// 开发期前端代理 /api 到本地后端，避免跨域；生产由 Netlify 静态托管 + 后端走 Render 公网
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}.[ext]`,
        // 路由级懒加载（配合 React.lazy）自动代码分割
        // manualChunks 把 react/axios 等稳定依赖单独打包，充分利用浏览器缓存
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          axios: ['axios']
        }
      }
    }
  }
});
