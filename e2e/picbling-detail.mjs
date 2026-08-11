// 拾光盒子入口页深度抓取：账户卡/待处理块/品牌卡的全部元素（含 svg/空 div）+ 悬停待处理块弹窗
// 用法: env PICBLING_PWD=xxx node picbling-detail.mjs
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
  await sleep(9000);

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
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      out.push({
        tag: el.tagName.toLowerCase(),
        text,
        cls: (el.className || '').toString().slice(0, 100),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: cs.backgroundColor,
        border: cs.borderLeftWidth + ' ' + cs.borderLeftStyle + ' ' + cs.borderLeftColor + ' | ' + cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor,
        color: cs.color,
        radius: cs.borderRadius,
      });
    }
    return out;
  });

  const before = await grab();
  fs.writeFileSync('/tmp/picbling-detail-before.json', JSON.stringify(before, null, 1));

  // 悬停第一个待处理块（未支付定金）：块 = 宽150-250、高90-140 且含该文字的最近 div
  const hovered = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div')].filter((d) => /未支付定金/.test(d.innerText || ''));
    const el = els.find((d) => {
      const r = d.getBoundingClientRect();
      return r.width >= 150 && r.width <= 250 && r.height >= 90 && r.height <= 140;
    }) || els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  console.log('HOVER TARGET:', JSON.stringify(hovered));
  if (hovered) {
    await page.mouse.move(hovered.x, hovered.y);
    await sleep(1200);
    await page.screenshot({ path: '/tmp/picbling-pending-hover.png' });
    const after = await grab();
    fs.writeFileSync('/tmp/picbling-detail-hover.json', JSON.stringify(after, null, 1));
  }
  await page.screenshot({ path: '/tmp/picbling-entry-full.png', fullPage: true });
  console.log('DONE');
} finally {
  await browser.close();
}
