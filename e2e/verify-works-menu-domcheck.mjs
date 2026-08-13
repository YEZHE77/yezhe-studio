import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = 'https://yezhe-studio.pages.dev';
const API_BASE = 'https://yezhe-studio-server.onrender.com';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const OUT = '/tmp/works-menu-domcheck';
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
  page.on('dialog', async (d) => await d.accept());
  page.on('pageerror', (e) => console.log('pageerror:', e.message));

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

  // 检查菜单项 + 遮罩的 DOM 层级
  const info = await page.evaluate(() => {
    const addBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().includes('添加新客片'));
    const overlay = Array.from(document.querySelectorAll('div')).find((d) => d.className && d.className.includes('fixed inset-0 z-30'));
    const result = {};
    if (addBtn) {
      const r = addBtn.getBoundingClientRect();
      result.addBtn = {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        zIndex: getComputedStyle(addBtn).zIndex,
        parentClass: addBtn.parentElement?.className?.slice(0, 80),
        parentZ: addBtn.parentElement ? getComputedStyle(addBtn.parentElement).zIndex : null,
        parentPos: addBtn.parentElement ? getComputedStyle(addBtn.parentElement).position : null
      };
      // elementFromPoint 测试：点击坐标实际命中谁
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      result.hitTest = el ? { tag: el.tagName, cls: el.className?.slice(0, 100), text: el.textContent?.trim().slice(0, 30) } : null;
    }
    if (overlay) {
      const r = overlay.getBoundingClientRect();
      result.overlay = { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, zIndex: getComputedStyle(overlay).zIndex };
    }
    return result;
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: OUT + '/menu-open.png' });

  await browser.close();
})();
