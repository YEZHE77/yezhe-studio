// 档期页验证：登录本地 → /schedule → 输出面包屑数量 + 日历卡右缘与右侧面板左缘的间隙
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

  const info = await page.evaluate(() => {
    // 面包屑：统计包含「工作台」且含「档期」的可见元素（取叶子文本）
    // 精确匹配：仅叶子级「工作台 > 档期」短文本
    const texts = [...document.querySelectorAll('div, span, a')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /^工作台\s*[>＞]\s*档期$/.test(t));
    const unique = [...new Set(texts)];
    // 日历卡（白色大卡）与右侧深色面板
    const card = [...document.querySelectorAll('div')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 900 && r.height > 500 && getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)';
    });
    const panel = [...document.querySelectorAll('div')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width === 140 && r.right > 1600 && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
    });
    const cardRect = card ? card.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    return {
      breadcrumbTexts: unique.slice(0, 5),
      cardRight: cardRect ? Math.round(cardRect.right) : null,
      cardLeft: cardRect ? Math.round(cardRect.left) : null,
      panelLeft: panelRect ? Math.round(panelRect.left) : null,
      gap: (cardRect && panelRect) ? Math.round(panelRect.left - cardRect.right) : null
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: '/tmp/local_schedule_verify.png', fullPage: true });
} finally {
  await browser.close();
}
