// 本地验证：登录 → /schedule → 点击日历格「+ 添加」→ 截图新增订单弹窗 + 打印顾客区文本
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1680,1050'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);
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
  await sleep(400);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /登\s*录/.test(b.innerText || ''));
    if (btn) btn.click();
  });
  await sleep(3500);
  await page.goto('http://localhost:5173/schedule', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /\+ 添加/.test(b.innerText || '') && b.offsetParent !== null);
    if (btns[0]) { btns[0].click(); return true; }
    return false;
  });
  await sleep(1500);
  await page.screenshot({ path: '/tmp/local_schedule_modal.png', fullPage: false });
  console.log('ADD CLICKED:', clicked);
  const text = await page.evaluate(() => document.body.innerText);
  const idx = text.indexOf('新增订单');
  console.log('--- MODAL TEXT ---');
  console.log(idx >= 0 ? text.slice(idx, idx + 600) : text.slice(0, 600));
} finally {
  await browser.close();
}
