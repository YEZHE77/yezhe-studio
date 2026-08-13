import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'http://localhost:4173';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-local';
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
  page.on('dialog', async (d) => { console.log('DIALOG:', d.message().slice(0, 200)); await d.accept(); });
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

  // 1. 点击添加新客片
  console.log('Step 1: /works');
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(1500);
  await page.screenshot({ path: OUT + '/works-list.png' });

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (btn) btn.click();
  });
  await delay(300);
  await page.screenshot({ path: OUT + '/works-menu.png' });

  console.log('Step 2: click 添加新客片');
  const start = Date.now();
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    if (btn) btn.click();
  });
  // 等待 URL 变成 /works/*/edit 或超时 8s
  let url = await page.evaluate(() => location.href);
  for (let i = 0; i < 20 && !/\/works\/\d+\/edit$/.test(url); i++) {
    await delay(400);
    url = await page.evaluate(() => location.href);
  }
  console.log(`navigated to ${url} after ${Date.now() - start}ms`);
  await delay(1000);
  await page.screenshot({ path: OUT + '/works-new-result.png' });

  const newInfo = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 300) }));
  console.log('newInfo:', newInfo);

  // 3. 自定义排序
  console.log('Step 3: /works sort mode');
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(1500);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (btn) btn.click();
  });
  await delay(300);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('自定义排序'));
    if (btn) btn.click();
  });
  await delay(800);
  await page.screenshot({ path: OUT + '/works-sort-mode.png' });
  const sortInfo = await page.evaluate(() => ({
    url: location.href,
    hasSaveSort: document.body.innerText.includes('保存排序'),
    hasCancelSort: document.body.innerText.includes('取消排序'),
    hasTip: document.body.innerText.includes('排序模式')
  }));
  console.log('sortInfo:', sortInfo);

  fs.writeFileSync(OUT + '/console.json', JSON.stringify(allConsole, null, 2));
  fs.writeFileSync(OUT + '/requests.json', JSON.stringify(allRequests, null, 2));
  console.log('\n--- errors ---');
  console.log(errs.length ? errs.join('\n') : '无异常');

  await browser.close();
})();
