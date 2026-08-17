import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { installGlobalHandlers } from './utils/errorReporter.js';
import './index.css';

// 安装三端统一异常捕获（window.onerror / unhandledrejection），幂等
installGlobalHandlers();

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);
