// 拾光盒子档期页深度抓取：登录 → 进档期页 → 抓日历 DOM → 点「添加档期」抓弹窗
// 用法: env PICBLING_PWD=xxx node picbling-schedule-capture.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '18976896425';
const PASSWORD = process.env.PICBLING_PWD || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!PASSWORD) { console.error('缺少 PICBLING_PWD'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1680,1050'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });

  await page.goto('https://www.picbling.com/auth/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  await page.evaluate((ph) => {
    const el = [...document.querySelectorAll('input')].find((i) => /手机|phone|tel/i.test((i.placeholder || '') + (i.name || ''))) || [...document.querySelectorAll('input')][0];
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ph);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, PHONE);
  await page.evaluate((pw) => {
    const el = [...document.querySelectorAll('input')].find((i) => i.type === 'password');
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, pw);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, PASSWORD);
  await sleep(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /立即登录/.test(b.innerText || ''));
    if (btn) btn.click();
  });
  await sleep(6000);
  await page.goto('https://www.picbling.com/pCenter/entry?login_success=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(8000);

  // 点击侧边栏「档期」
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('li, a, div, span')].find((d) => (d.innerText || '').trim() === '档期' && d.getBoundingClientRect().width > 40 && d.getBoundingClientRect().height > 20);
    if (el) el.click();
  });
  await sleep(8000);
  console.log('URL:', page.url());

  const grab = () => page.evaluate(() => {
    const out = [];
    const nodes = [];
    let n;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while ((n = walker.nextNode())) nodes.push(n);
    for (const el of nodes) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      out.push({
        tag: el.tagName.toLowerCase(),
        text,
        cls: (el.className || '').toString().slice(0, 90),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: cs.backgroundColor,
        color: cs.color,
        border: cs.borderLeftWidth + ' ' + cs.borderLeftColor + ' | ' + cs.borderTopWidth + ' ' + cs.borderTopColor,
        font: cs.fontSize + '/' + cs.fontWeight,
      });
    }
    return out;
  });

  await page.screenshot({ path: '/tmp/picbling-schedule.png' });
  const dom = await grab();
  fs.writeFileSync('/tmp/picbling-schedule-dom.json', JSON.stringify(dom, null, 1));
  console.log('SCHEDULE DOM ITEMS:', dom.length);

  // 点「添加档期」按钮
  const added = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, div, span')].find((d) => /添加档期/.test(d.innerText || '') && d.getBoundingClientRect().width >= 50 && d.getBoundingClientRect().width <= 160 && d.getBoundingClientRect().height >= 20 && d.getBoundingClientRect().height <= 45 && (d.tagName === 'BUTTON' || d.innerText.trim() === '+ 添加档期' || d.innerText.trim() === '＋添加档期'));
    if (!el) return null;
    el.click();
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('ADD BTN:', JSON.stringify(added));
  await sleep(3000);
  await page.screenshot({ path: '/tmp/picbling-addschedule-modal.png' });
  const modalDom = await grab();
  fs.writeFileSync('/tmp/picbling-addschedule-modal-dom.json', JSON.stringify(modalDom, null, 1));
  console.log('MODAL DOM ITEMS:', modalDom.length);
} finally {
  await browser.close();
}
