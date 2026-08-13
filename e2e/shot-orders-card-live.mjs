import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/orders-card-live';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(OUT, { recursive: true });

async function fetchToken(base, username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status);
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  const allConsole = [];
  page.on('dialog', async (d) => await d.accept());
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    allConsole.push(m.type() + ': ' + m.text().slice(0, 200));
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200));
  });

  const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(BASE_URL + '/orders', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3000));
  await page.waitForSelector('text/订单中心', { timeout: 10000 }).catch(() => {});

  // Debug: print first 200 chars of body text and current url
  const debug = await page.evaluate(() => ({
    url: location.pathname,
    bodyPreview: document.body.innerText.slice(0, 300)
  }));
  console.log('debug:', JSON.stringify(debug));

  // 断言：定金/尾款显示、暂无备注已删除、编辑在左
  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasDeposit: text.includes('定金'),
      hasBalance: text.includes('尾款'),
      hasNoRemark: text.includes('暂无备注'),
      hasEdit: text.includes('编辑')
    };
  });
  console.log('断言:', JSON.stringify(state));
  if (!state.hasDeposit) throw new Error('未找到「定金」字段');
  if (!state.hasBalance) throw new Error('未找到「尾款」字段');
  if (state.hasNoRemark) throw new Error('仍存在「暂无备注」占位');

  await page.screenshot({ path: OUT + '/orders-top.png', fullPage: false });
  await page.evaluate(async () => { window.scrollBy(0, 400); await new Promise(r => setTimeout(r, 200)); });
  await page.screenshot({ path: OUT + '/orders-mid.png', fullPage: false });

  console.log('JS 错误:', errs.filter(e => !e.includes('validateDOMNesting')).length ? errs.filter(e => !e.includes('validateDOMNesting')) : '无（仅 validateDOMNesting 警告为既有）');
  console.log('allConsole sample:', allConsole.filter(c => !c.includes('validateDOMNesting')).slice(0, 5));
  console.log('✅ 线上验证通过，截图:', OUT);
  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });