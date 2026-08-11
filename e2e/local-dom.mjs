// 本地项目页面 DOM+样式提取：登录本地后台 → 打开 /orders/:id → 输出 /tmp/local-dom.json + /tmp/local_order.png
// 用法: node local-dom.mjs <路径如 /orders/1>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5173';
const path = process.argv[2] || '/orders/1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1680,1050'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  const loginInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map((i) => ({ type: i.type, placeholder: i.placeholder, name: i.name || '' }));
    const btn = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 6);
    return { inputs, btn };
  });
  console.log('LOCAL LOGIN FORM:', JSON.stringify(loginInfo));
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const setVal = (el, v) => {
      el.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (inputs[0]) setVal(inputs[0], 'admin');
    const pwd = inputs.find((i) => i.type === 'password') || inputs[1];
    if (pwd) setVal(pwd, 'admin123');
  });
  await sleep(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /登\s*录/.test(b.innerText || ''));
    if (btn) btn.click();
  });
  await sleep(4000);
  console.log('AFTER LOGIN URL:', page.url());

  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(5000);
  await page.screenshot({ path: '/tmp/local_order.png', fullPage: true });

  const data = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const el of nodes) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 60) continue;
      const key = text + '|' + Math.round(r.x) + '|' + Math.round(r.y) + '|' + Math.round(r.width);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 80),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        font: { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily.split(',')[0] },
        color: cs.color,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        radius: cs.borderRadius,
        pad: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
        align: cs.textAlign,
      });
    }
    return out;
  });
  fs.writeFileSync('/tmp/local-dom.json', JSON.stringify(data, null, 1));
  console.log('LOCAL DOM ITEMS:', data.length);
} finally {
  await browser.close();
}
