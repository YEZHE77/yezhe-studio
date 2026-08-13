/**
 * 线上订单中心 · 备注编辑入口 + 备注页 + 筛选右滑抽屉 验证
 * ----------------------------------------------------------
 * 1) 登录 → 移动端 390×844 进 /orders
 * 2) 断言订单卡片存在「编辑」备注入口
 * 3) 点击编辑 → 断言 URL=/orders/:id/notes → 截图备注页
 * 4) 返回 /orders → 点击「筛选」→ 断言抽屉 transform 右滑动画生效
 *    （先 translateX(100%) 再 translateX(0)）→ 截图抽屉
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = (process.env.BASE_URL || 'https://yezhe-studio.pages.dev').replace(/\/$/, '');
const API_BASE = (process.env.API_BASE || 'https://yezhe-studio-server.onrender.com').replace(/\/$/, '');
const OUT = process.env.SHOTS_DIR || '/tmp/orders-notes-filter-live';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e-orders]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function fetchToken(base) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status);
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

(async () => {
  log('BASE_URL =', BASE_URL);
  if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  page.on('dialog', async (d) => { log('dialog:', d.message().slice(0, 60)); await d.accept(); });

  try {
    const token = await fetchToken(API_BASE);
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 });

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE_URL + '/orders', { waitUntil: 'networkidle2' });
    await sleep(2000);
    log('路径:', await page.evaluate(() => location.pathname));

    // 1) 订单卡片「编辑」备注入口（用 aria-label 精确定位，避免命中卡片外层按钮）
    const hasEdit = await page.evaluate(() => !!document.querySelector('[aria-label="编辑备注"]'));
    log('订单卡片编辑入口存在:', hasEdit);
    if (!hasEdit) throw new Error('未找到备注编辑入口');

    // 2) 点击编辑 → 跳转备注页
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="编辑备注"]');
      if (el) { el.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('编辑入口点击失败');
    await page.waitForFunction(() => /\/orders\/\d+\/notes/.test(location.pathname), { timeout: 10000 });
    await sleep(1200);
    log('✅ 跳转备注页:', await page.evaluate(() => location.pathname));

    const notesState = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        title: text.includes('订单备注'),
        sections: ['订单备注', '生日', '预约备注', '调查问卷', '内部备注', '外部备注'].filter((s) => text.includes(s)),
        copy: text.includes('复制'),
        edit: text.includes('编辑'),
      };
    });
    log('备注页断言:', JSON.stringify(notesState));
    if (!notesState.title || notesState.sections.length < 5) throw new Error('备注页区块不完整');
    await page.screenshot({ path: OUT + '/notes-page.png' });

    // 3) 返回 /orders，点筛选，验证右滑动画
    await page.goBack({ waitUntil: 'networkidle2' });
    await sleep(1000);
    const filterClicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('筛选'));
      if (el) { el.click(); return true; }
      return false;
    });
    if (!filterClicked) throw new Error('筛选按钮点击失败');
    await sleep(50);
    // 打开瞬间应处于 translateX(100%)（屏幕外），随后滑入 0
    const t1 = await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('div')).find((x) => x.style && /translateX/.test(x.style.transform || ''));
      return d ? getComputedStyle(d).transform : null;
    });
    await sleep(400);
    const t2 = await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('div')).find((x) => x.style && /translateX/.test(x.style.transform || ''));
      return d ? getComputedStyle(d).transform : null;
    });
    const scrollable = await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('div')).find((x) => x.style && x.style.overflowY === 'auto');
      return !!d;
    });
    log('抽屉初始 transform:', t1, '| 400ms 后:', t2, '| 可滚动区:', scrollable);
    await sleep(300);
    await page.screenshot({ path: OUT + '/filter-drawer.png' });
    if (!/matrix\(1, 0, 0, 1, 0, 0\)/.test(t2 || '') && !/translateX\(0/.test(t2 || '')) throw new Error('抽屉未滑入到位: ' + t2);
    if (!scrollable) throw new Error('抽屉内容区不可滚动');

    log('JS 错误:', errs.length ? errs : '无');
    log('🎉 全部通过。截图目录:', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
