// 通用网页抓取：node capture-url.mjs <url> [输出png路径]
// 打开目标页面 → 全页截图 + 打印标题/当前URL/可见文本（前 12000 字）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const outPng = process.argv[3] || '/tmp/capture.png';
if (!url) {
  console.error('用法: node capture-url.mjs <url> [输出png路径]');
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  throw new Error('未找到 Chrome，请设置 CHROME_PATH');
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1680,1050'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  // 额外等待 SPA 渲染
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('TITLE:', await page.title());
  console.log('FINAL_URL:', page.url());
  console.log('--- VISIBLE TEXT ---');
  const text = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log(text.slice(0, 12000));
} finally {
  await browser.close();
}
