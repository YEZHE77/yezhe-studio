import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-realclick';
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
  page.on('dialog', async (d) => { console.log('DIALOG:', d.message().slice(0, 200)); await d.accept(); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const txt = m.text().slice(0, 250);
    allConsole.push(m.type() + ': ' + txt);
    if (m.type() === 'error') errs.push('console: ' + txt);
  });

  const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  console.log('Step 1: /works');
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(2500);

  const pageState = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 200), hasBtn: Array.from(document.querySelectorAll('button')).length }));
  console.log('pageState:', pageState);

  // 用真实 mouse 坐标点击 ⋯ 按钮
  const dotsPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('dotsPos:', dotsPos);
  if (!dotsPos) { console.log('未找到 ⋯ 按钮'); await browser.close(); return; }

  await page.mouse.click(dotsPos.x, dotsPos.y);
  await delay(500);
  await page.screenshot({ path: OUT + '/menu-open.png' });

  // 用真实 mouse 点击「添加新客片」
  const addPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.textContent.trim() };
  });
  console.log('addPos:', addPos);
  if (addPos) {
    await page.mouse.click(addPos.x, addPos.y);
    const start = Date.now();
    let url = await page.evaluate(() => location.href);
    for (let i = 0; i < 25 && !/\/works\/\d+\/edit$/.test(url); i++) {
      await delay(400);
      url = await page.evaluate(() => location.href);
    }
    console.log(`真实点击后 navigate 到 ${url}，耗时 ${Date.now() - start}ms`);
    await delay(1500);
    await page.screenshot({ path: OUT + '/add-result.png' });
  } else {
    console.log('真实点击：菜单里没有「添加新客片」');
  }

  // 返回测试自定义排序
  await page.goto(BASE_URL + '/works', { waitUntil: 'networkidle2' });
  await delay(2500);
  const dotsPos2 = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '⋯');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(dotsPos2.x, dotsPos2.y);
  await delay(500);

  const sortPos = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('自定义排序'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('sortPos:', sortPos);
  if (sortPos) {
    await page.mouse.click(sortPos.x, sortPos.y);
    await delay(3000);
    await page.screenshot({ path: OUT + '/sort-mode.png' });
  } else {
    console.log('真实点击：菜单里没有「自定义排序」');
  }

  const sortInfo = await page.evaluate(() => ({
    url: location.href,
    hasSaveSort: document.body.innerText.includes('保存排序'),
    hasCancelSort: document.body.innerText.includes('取消排序'),
    hasTip: document.body.innerText.includes('排序模式')
  }));
  console.log('sortInfo:', sortInfo);

  fs.writeFileSync(OUT + '/console.json', JSON.stringify(allConsole, null, 2));
  console.log('\n--- errors ---');
  console.log(errs.length ? errs.join('\n') : '无异常');

  await browser.close();
})();
