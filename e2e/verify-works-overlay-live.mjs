import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-overlay';
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
  page.on('dialog', async (d) => { console.log('DIALOG:', d.message().slice(0, 150)); await d.accept(); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

  const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(3000);

  // 打开菜单
  const dotsPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!dotsPos) { console.log('FAIL: 未找到 ⋯ 按钮（页面可能还在加载）'); await page.screenshot({ path: OUT + '/fail.png' }); await browser.close(); return; }
  await page.mouse.click(dotsPos.x, dotsPos.y);
  await delay(400);

  // 点击「添加新客片」，立即检测遮罩
  const addPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!addPos) { console.log('FAIL: 菜单里没有添加新客片'); await browser.close(); return; }

  await page.mouse.click(addPos.x, addPos.y);
  // 100ms 后检查是否出现遮罩
  await delay(150);
  const overlayAt150ms = await page.evaluate(() => document.body.innerText.includes('正在创建作品'));
  await delay(150);
  const overlayAt300ms = await page.evaluate(() => document.body.innerText.includes('正在创建作品'));
  await page.screenshot({ path: OUT + '/overlay-check.png' });
  console.log('overlay 150ms:', overlayAt150ms, '| overlay 300ms:', overlayAt300ms);

  // 等待跳转
  const start = Date.now();
  let url = await page.evaluate(() => location.href);
  for (let i = 0; i < 30 && !/\/works\/\d+\/edit$/.test(url); i++) {
    await delay(500);
    url = await page.evaluate(() => location.href);
  }
  console.log(`navigate to ${url} after ${Date.now() - start}ms`);
  await delay(1500);
  await page.screenshot({ path: OUT + '/add-done.png' });
  const finalBody = await page.evaluate(() => document.body.innerText.slice(0, 150));
  console.log('final:', finalBody.replace(/\n/g, ' | '));

  // 自定义排序
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(3000);
  const dots2 = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(dots2.x, dots2.y);
  await delay(400);
  const sortPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('自定义排序'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(sortPos.x, sortPos.y);
  await delay(150);
  const sortOverlay = await page.evaluate(() => document.body.innerText.includes('正在加载全部作品'));
  await delay(2000);
  await page.screenshot({ path: OUT + '/sort-mode.png' });
  const sortInfo = await page.evaluate(() => ({
    overlay150: sortOverlay,
    hasSaveSort: document.body.innerText.includes('保存排序'),
    hasTip: document.body.innerText.includes('排序模式')
  }));
  console.log('sortInfo:', sortInfo);

  console.log('\n--- errors ---');
  console.log(errs.length ? errs.join('\n') : '无异常');
  await browser.close();
})();
