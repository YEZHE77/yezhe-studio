// 登录后打印左侧菜单所有链接 href（供定位页面 URL）
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '18976896425';
const PASSWORD = process.env.PICBLING_PWD || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!PASSWORD) { console.error('缺少 PICBLING_PWD'); process.exit(1); }
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
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
  await sleep(7000);
  // 依次点击左侧菜单项，记录点击后的 URL（点击每个菜单前先回到入口页）
  const targets = ['档期', '订单中心', '套系'];
  for (const name of targets) {
    const clicked = await page.evaluate((n) => {
      const el = [...document.querySelectorAll('li, div, span, a')].find((e) => (e.innerText || '').trim() === n && e.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    }, name);
    await sleep(4000);
    console.log(`${name}: clicked=${clicked} url=${page.url()}`);
    // 回到入口页
    await page.goto('https://www.picbling.com/pCenter/entry', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);
  }
} finally {
  await browser.close();
}
