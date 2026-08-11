// 本地工作台整页截图 + DOM 提取：登录 → 打开 / → 输出 /tmp/local-dash.png + /tmp/local-dash-dom.json
// 用法: node dash-capture.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1680,1050'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
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
    const btn = [...document.querySelectorAll('button')].find((b) => /登/.test(b.innerText || ''));
    if (btn) btn.click();
  });
  await sleep(3000);

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(6000);

  await page.screenshot({ path: '/tmp/local-dash.png', fullPage: true });

  const data = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const nodes = [];
    let n;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
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
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        font: { size: cs.fontSize, weight: cs.fontWeight },
        color: cs.color,
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        pad: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
        align: cs.textAlign,
      });
    }
    return out;
  });
  fs.writeFileSync('/tmp/local-dash-dom.json', JSON.stringify(data, null, 1));
  console.log('SCREENSHOT SAVED /tmp/local-dash.png DOM ITEMS:', data.length);
} finally {
  await browser.close();
}
