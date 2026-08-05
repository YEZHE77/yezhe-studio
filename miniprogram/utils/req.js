// req.js —— 带鉴权、超时、可取消、自动重试的请求封装
const { CONFIG } = require('./config.js');

const TIMEOUT = 15000;  // 15 秒超时（Render 冷启动通常 3-10s）
const RETRY_DELAY = 2000;

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
          if (err.errMsg && err.errMsg.indexOf('timeout') !== -1) {
            return reject({ type: 'timeout', message: '请求超时，请检查网络' });
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
