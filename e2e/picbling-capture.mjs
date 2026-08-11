// 拾光盒子后台抓取：登录 + 打开目标 URL → 全页截图 + 可见文本
// 用法: node picbling-capture.mjs <url> [输出png路径]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '18976896425';
const PASSWORD = process.env.PICBLING_PWD || '';
const url = process.argv[2];
const outPng = process.argv[3] || '/tmp/picbling.png';
if (!url) {
  console.error('用法: node picbling-capture.mjs <url> [输出png路径]');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('缺少密码：请设置环境变量 PICBLING_PWD');
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  throw new Error('未找到 Chrome，请设置 CHROME_PATH');
}

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

  // 1) 登录
  console.log('STEP 1: 打开登录页');
  await page.goto('https://www.picbling.com/auth/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);

  const formInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map((i) => ({
      type: i.type, placeholder: i.placeholder, name: i.name || '', id: i.id || '',
      cls: (i.className || '').toString().slice(0, 60),
    }));
    const btns = [...document.querySelectorAll('button, [role=button], a')]
      .filter((b) => /登录|注册|微信/.test(b.innerText || ''))
      .map((b) => ({ tag: b.tagName, text: (b.innerText || '').trim().slice(0, 20), cls: (b.className || '').toString().slice(0, 60) }))
      .slice(0, 8);
    return { inputs, btns };
  });
  console.log('FORM INPUTS:', JSON.stringify(formInfo.inputs));
  console.log('FORM BUTTONS:', JSON.stringify(formInfo.btns));

  // 2) 填写手机号 + 密码
  const phoneSel = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(
      (i) => /手机|phone|tel|account/i.test((i.placeholder || '') + (i.name || '') + (i.type || ''))
    ) || [...document.querySelectorAll('input')][0];
    return el ? { tag: el.tagName, ph: el.placeholder } : null;
  });
  console.log('PHONE INPUT:', JSON.stringify(phoneSel));
  const typed = await page.evaluate((ph) => {
    const el = [...document.querySelectorAll('input')].find(
      (i) => /手机|phone|tel|account/i.test((i.placeholder || '') + (i.name || '') + (i.type || ''))
    ) || [...document.querySelectorAll('input')][0];
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ph);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, PHONE);
  console.log('TYPED PHONE:', typed);

  const pwdTyped = await page.evaluate((pw) => {
    const el = [...document.querySelectorAll('input')].find((i) => i.type === 'password');
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, pw);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, PASSWORD);
  console.log('TYPED PWD:', pwdTyped);
  await sleep(800);

  // 3) 点击「立即登录」
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [role=button]')].find((b) => /立即登录/.test(b.innerText || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('CLICK LOGIN:', clicked);
  await sleep(6000);
  console.log('AFTER LOGIN URL:', page.url());
  console.log('AFTER LOGIN TEXT:', (await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 600));

  // 4) 打开目标页面
  console.log('STEP 2: 打开目标页面');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(5000);
  await page.screenshot({ path: outPng, fullPage: true });
  console.log('TITLE:', await page.title());
  console.log('FINAL_URL:', page.url());
  console.log('--- VISIBLE TEXT ---');
  console.log((await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 12000));
} finally {
  await browser.close();
}
