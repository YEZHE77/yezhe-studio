// 本地验证：登录 → 订单详情 → 点击「编辑订单」→ 截图抽屉 + 打印可见文本
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
  await page.goto('http://localhost:5173/orders/1', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  // 点击「编辑订单」按钮（客户卡片右侧按钮组）
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '编辑订单');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await sleep(1500);
  await page.screenshot({ path: '/tmp/local_edit_drawer.png', fullPage: false });
  console.log('EDIT CLICKED:', clicked);
  console.log('--- DRAWER TEXT ---');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 2500));
} finally {
  await browser.close();
}
