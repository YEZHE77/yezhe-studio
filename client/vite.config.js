import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
