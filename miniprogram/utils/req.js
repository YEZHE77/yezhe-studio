// req.js —— 带鉴权、超时、可取消、自动重试的请求封装
const { CONFIG } = require('./config.js');

const TIMEOUT = 15000;  // 15 秒超时（Render 冷启动通常 3-10s）
const RETRY_DELAY = 2000;

// 真机/体验版强制校验合法域名，未配置时 wx.request 会被拒。
// 这里做一次明确提示（5s 内去重），避免用户只看到白屏不知所措。
let _domainWarned = 0;
function warnDomain() {
  const now = Date.now();
  if (now - _domainWarned < 5000) return;
  _domainWarned = now;
  try { wx.showToast({ title: '服务器域名未配置', icon: 'none' }); } catch (e) {}
  console.error(
    '[req] 微信校验合法域名失败。请在小程序后台「开发管理 → 开发设置 → 服务器域名」中添加：\n' +
    '  request 合法域名: ' + CONFIG.API_BASE + '\n' +
    '  downloadFile 合法域名: ' + CONFIG.API_BASE + '\n' +
    (CONFIG.IMG_CDN ? '  downloadFile 合法域名: ' + CONFIG.IMG_CDN + '\n' : '') +
    '  downloadFile 合法域名: https://yezhe-img-proxy.yezhe128627.workers.dev （R2 兜底，未启用 COS 时）'
  );
}

function getToken() {
  try { return wx.getStorageSync('token') || ''; } catch (e) { return ''; }
}

/**
 * 核心请求方法：{ promise, abort }
 * 页面 onUnload 时调用 abort() 取消请求，避免卸载后 setData
 */
function requestTask(path, method = 'GET', data = {}) {
  let task = null;
  let aborted = false;

  const doReq = (token) => {
    return new Promise((resolve, reject) => {
      if (aborted) return;
      task = wx.request({
        url: CONFIG.API_BASE + path,
        method,
        data,
        timeout: TIMEOUT,
        header: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        success: (res) => {
          if (aborted) return;
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
          if (res.statusCode === 401) {
            try { wx.removeStorageSync('token'); } catch (e) {}
            return reject({ type: 'auth', code: 401, message: (res.data && res.data.error) || '请重新登录' });
          }
          if (res.statusCode === 403) return reject({ type: 'denied', code: 403, message: (res.data && res.data.error) || '无权访问' });
          return reject({ type: 'server', code: res.statusCode, message: (res.data && res.data.error) || ('请求失败(' + res.statusCode + ')'), status: res.statusCode });
        },
        fail: (err) => {
          if (aborted) return;
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('timeout') !== -1) {
            return reject({ type: 'timeout', message: '请求超时，请检查网络' });
          }
          // 真机未配置合法域名时，errMsg 含 "domain" / "合法域名"
          if (msg.indexOf('domain') !== -1 || msg.indexOf('合法域名') !== -1) {
            warnDomain();
            return reject({ type: 'domain', message: '服务器域名未配置：' + CONFIG.API_BASE });
          }
          return reject({ type: 'network', message: '网络连接失败，请检查后端服务' });
        }
      });
    });
  };

  const abort = () => {
    aborted = true;
    if (task) { try { task.abort(); } catch (e) {} }
  };

  const run = () => {
    if (path.indexOf('/api/customer/') === 0) {
      const app = getApp();
      if (app && app.ensureLogin) {
        return app.ensureLogin().then((t) => doReq(t));
      }
      return doReq(getToken());
    }
    return doReq(getToken());
  };

  // 自动重试 1 次（仅网络 / 超时，处理 Render 冷启动）
  const promise = run().catch((err) => {
    if ((err.type === 'network' || err.type === 'timeout') && !aborted) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (aborted) return;
          run().then(resolve).catch(reject);
        }, RETRY_DELAY);
      });
    }
    throw err;
  });

  return { promise, abort };
}

/**
 * 向后兼容的简单请求（无取消能力）
 * 新页面建议用 requestTask 以便 onUnload 清理
 */
function request(path, method = 'GET', data = {}) {
  return requestTask(path, method, data).promise;
}

module.exports = { request, requestTask, getToken, TIMEOUT };
