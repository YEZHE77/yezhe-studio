/**
 * 线上订单详情页 · 移动端渲染验证（部署回归）
 * ------------------------------------------------------------
 * 流程：线上登录 admin → 取第一笔订单 → 390×844 视口进入 /orders/:id
 *      → 截图顶部（自绘顶栏 + 状态卡 + 操作按钮）
 *      → 滚动到底 → 截图底部（记录卡 + 下载区）
 *      → 切桌面视口 → 截图桌面端确认无回归
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.BASE_URL || 'https://yezhe-studio.pages.dev').replace(/\/$/, '');
// 线上前端直连 Render 后端（CORS 放行 pages.dev），pages.dev 的 /api 走静态资源会 405
const API_BASE = (process.env.API_BASE || 'https://yezhe-studio-server.onrender.com').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const OUT = process.env.SHOTS_DIR || '/tmp/order-detail-live';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e-live]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function fetchToken(base, username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

(async () => {
  log('BASE_URL =', BASE_URL, '| API_BASE =', API_BASE);
  if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome: ' + CHROME);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('⚠️ pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('console.error:', m.text().slice(0, 160)); });

  try {
    // 1) 登录（线上：API 直连 Render，页面静态托管在 pages.dev）
    log('登录', ADMIN_USER, '@', API_BASE);
    const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 });
    log('登录成功，路径:', await page.evaluate(() => location.pathname));

    // 2) 取第一笔订单（页面内 fetch 相对路径 /api 会被 axios 指向 Render）
    const id = await page.evaluate(async (t) => {
      const r = await fetch('https://yezhe-studio-server.onrender.com/api/orders?limit=1', { headers: { Authorization: 'Bearer ' + t } });
      const d = await r.json();
      const list = d.list || d.data || d || [];
      return (list[0] && list[0].id) || null;
    }, token);
    if (!id) throw new Error('线上无订单');
    log('目标订单 id =', id);

    // 3) 移动端视口
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE_URL + '/orders/' + id, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => (document.body.innerText || '').includes('订单详情'), { timeout: 25000 });
    await sleep(800);

    // 顶栏 + 状态卡 + 操作按钮
    await page.screenshot({ path: path.join(OUT, 'mobile-top.png') });
    log('📸 mobile-top.png');

    // 滚动到底 → 记录卡 + 下载区
    await page.evaluate(async () => {
      let last = 0, stable = 0;
      while (stable < 10) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 80));
        const h = document.body.scrollHeight;
        if (h === last) { stable++; } else { stable = 0; last = h; }
      }
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'mobile-bottom.png') });
    log('📸 mobile-bottom.png');
    const bottomText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
    log('滚动后页面总文本长度:', bottomText.length);
    if (bottomText.includes('下载记录')) log('✓ 包含「下载记录」');
    if (bottomText.includes('交易记录')) log('✓ 包含「交易记录」');

    // 4) 桌面视口无回归
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE_URL + '/orders/' + id, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => (document.body.innerText || '').includes('更多内容'), { timeout: 25000 });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'desktop.png') });
    log('📸 desktop.png');

    log('✅ 完成。截图目录:', OUT);
  } catch (e) {
    log('❌ 失败:', e.message);
    try { await page.screenshot({ path: path.join(OUT, 'zz-error.png') }); } catch {}
    process.exitCode = 1;
  } finally {
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => {
          try { browser.process()?.kill('SIGKILL'); } catch {}
          reject(new Error('browser.close timeout, killed'));
        }, 15000)),
      ]);
    } catch (e) { log('browser.close 兜底:', e.message); }
  }
})();
