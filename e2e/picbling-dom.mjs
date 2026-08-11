// 拾光盒子后台 DOM+样式提取：登录 → 打开 URL → 输出结构化布局 JSON 到 /tmp/picbling-dom.json
// 用法: node picbling-dom.mjs <url> [输出json路径]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '18976896425';
const PASSWORD = process.env.PICBLING_PWD || '';
const url = process.argv[2];
const outJson = process.argv[3] || '/tmp/picbling-dom.json';
if (!url) { console.error('用法: node picbling-dom.mjs <url>'); process.exit(1); }
if (!PASSWORD) { console.error('缺少密码：请设置环境变量 PICBLING_PWD'); process.exit(1); }

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

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(10000);

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
      // 跳过父级已覆盖的文本（只取叶子级可读元素）
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
  fs.writeFileSync(outJson, JSON.stringify(data, null, 1));
  console.log('DOM ITEMS:', data.length);
  console.log('--- 顶部区域 ---');
  for (const it of data.filter((x) => x.rect.y < 420)) {
    console.log(`[y=${it.rect.y} x=${it.rect.x} w=${it.rect.w}] ${it.tag} "${it.text}" font=${it.font.size}/${it.font.weight} color=${it.color} bg=${it.bg} border=${it.border} radius=${it.radius} pad=${it.pad}`);
  }
} finally {
  await browser.close();
}
