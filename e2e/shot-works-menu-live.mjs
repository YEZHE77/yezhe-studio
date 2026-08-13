import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-live';
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

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  const allConsole = [];
  const allRequests = [];
  let dialogCount = 0;
  page.on('dialog', async (d) => { dialogCount++; console.log('DIALOG:', d.message().slice(0, 200)); await d.accept(); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const txt = m.text().slice(0, 250);
    allConsole.push(m.type() + ': ' + txt);
    if (m.type() === 'error') errs.push('console: ' + txt);
  });
  page.on('request', (r) => allRequests.push({ type: 'req', url: r.url().slice(0, 200), method: r.method() }));
  page.on('response', (r) => allRequests.push({ type: 'res', url: r.url().slice(0, 200), status: r.status() }));

  const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  // 测试直接访问 /works/new，等待足够久
  console.log('Step 1: direct /works/new, wait 12s');
  await page.goto(BASE_URL + '/works/new', { waitUntil: 'networkidle2' });
  for (let i = 1; i <= 12; i++) {
    await delay(1000);
    const info = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 200) }));
    console.log(`t=${i}s`, info);
  }
  await page.screenshot({ path: OUT + '/works-new-direct-12s.png' });

  fs.writeFileSync(OUT + '/console.json', JSON.stringify(allConsole, null, 2));
  fs.writeFileSync(OUT + '/requests.json', JSON.stringify(allRequests, null, 2));
  console.log('\n--- errors ---');
  console.log(errs.length ? errs.join('\n') : '无异常');
  console.log('dialog count:', dialogCount);

  await browser.close();
})();
