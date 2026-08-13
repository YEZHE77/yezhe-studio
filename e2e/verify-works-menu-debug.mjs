import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-debug';
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
  const apiCalls = [];
  let dialogMsg = null;
  page.on('dialog', async (d) => { dialogMsg = d.message().slice(0, 200); console.log('DIALOG:', dialogMsg); await d.accept(); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('request', (r) => {
    if (r.url().includes('/api/works')) apiCalls.push({ t: Date.now(), method: r.method(), url: r.url().slice(0, 120) });
  });

  const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(3000);

  // 打开菜单
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (btn) btn.click();
  });
  await delay(400);
  await page.screenshot({ path: OUT + '/menu.png' });

  // 方法1：el.click() 点击添加新客片
  console.log('--- 方法1: el.click() ---');
  const t0 = Date.now();
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    if (btn) btn.click();
  });
  await delay(300);
  const state300 = await page.evaluate(() => ({ url: location.href, hasCreatingText: document.body.innerText.includes('创建作品') }));
  console.log('300ms:', state300, '| apiCalls:', JSON.stringify(apiCalls.map((c) => c.method + ' ' + c.url)));

  let url = await page.evaluate(() => location.href);
  for (let i = 0; i < 20 && !/\/works\/\d+\/edit$/.test(url); i++) {
    await delay(400);
    url = await page.evaluate(() => location.href);
  }
  console.log(`el.click() 结果: ${url} 耗时 ${Date.now() - t0}ms`);

  // 方法2：真实 mouse 点击
  console.log('--- 方法2: mouse.click ---');
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(3000);
  const dotsPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(dotsPos.x, dotsPos.y);
  await delay(400);

  const addPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.textContent.trim() };
  });
  console.log('addPos:', addPos);
  const t1 = Date.now();
  await page.mouse.click(addPos.x, addPos.y);
  await delay(300);
  const state300b = await page.evaluate(() => ({ url: location.href, hasCreatingText: document.body.innerText.includes('创建作品'), body: document.body.innerText.slice(0, 80) }));
  console.log('300ms:', state300b, '| dialogMsg:', dialogMsg, '| apiCalls:', JSON.stringify(apiCalls.map((c) => c.method + ' ' + c.url)));

  url = await page.evaluate(() => location.href);
  for (let i = 0; i < 20 && !/\/works\/\d+\/edit$/.test(url); i++) {
    await delay(400);
    url = await page.evaluate(() => location.href);
  }
  console.log(`mouse.click() 结果: ${url} 耗时 ${Date.now() - t1}ms`);
  console.log('最终 apiCalls:', JSON.stringify(apiCalls, null, 2));
  console.log('\n--- errors ---');
  console.log(errs.length ? errs.join('\n') : '无异常');

  await browser.close();
})();
