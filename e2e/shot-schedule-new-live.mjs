/**
 * 线上档期页 ·「添加档期」移动端跳转独立页 + 桌面弹窗回归验证
 * ------------------------------------------------------------
 * 流程：
 *   1) 线上登录 admin → 注入 token
 *   2) 移动端 390×844 进 /schedule → 点顶栏三点菜单 → 点「添加档期」
 *      → 断言 URL 变为 /schedule/new、出现自绘顶栏「新增订单」、无深色遮罩
 *      → 截图页顶 + 滚动到底截图页底
 *   3) 点顶栏返回箭头 → 断言回到 /schedule
 *   4) 桌面 1440×900 进 /schedule → 点「+ 添加档期」→ 断言弹窗仍正常出现
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = (process.env.BASE_URL || 'https://yezhe-studio.pages.dev').replace(/\/$/, '');
const API_BASE = (process.env.API_BASE || 'https://yezhe-studio-server.onrender.com').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const OUT = process.env.SHOTS_DIR || '/tmp/schedule-new-live';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e-sched-new]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function fetchToken(base, username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

(async () => {
  log('BASE_URL =', BASE_URL, '| API_BASE =', API_BASE);
  if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome: ' + CHROME);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  // 表单 dirty 关闭时有 confirm 二次确认，headless 需自动接受
  page.on('dialog', async (d) => { log('dialog:', d.message().slice(0, 60)); await d.accept(); });

  try {
    // 1) 登录
    log('登录', ADMIN_USER, '@', API_BASE);
    const token = await fetchToken(API_BASE, ADMIN_USER, ADMIN_PASS);
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 });
    log('登录成功，路径:', await page.evaluate(() => location.pathname));

    // 2) 移动端：/schedule → 三点菜单 → 添加档期
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(BASE_URL + '/schedule', { waitUntil: 'networkidle2' });
    await page.waitForSelector('text/档期管理', { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    log('移动端 /schedule 已加载');

    // 点击顶栏三点菜单（含三个圆点的 SVG 按钮）
    const kebabClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => el.querySelector('svg circle') && el.querySelectorAll('svg circle').length === 3);
      if (b) { b.click(); return true; }
      return false;
    });
    if (!kebabClicked) throw new Error('未找到移动端三点菜单按钮');
    await sleep(300);

    // 点击「添加档期」
    const addClicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('添加档期'));
      if (el) { el.click(); return true; }
      return false;
    });
    if (!addClicked) throw new Error('未找到「添加档期」菜单项');
    log('已点击「添加档期」，等待跳转 /schedule/new...');

    await page.waitForFunction(() => location.pathname === '/schedule/new', { timeout: 10000 });
    await sleep(1500);
    const urlNow = await page.evaluate(() => location.pathname);
    log('✅ URL =', urlNow);

    // 断言：自绘顶栏「新增订单」+ 表单出现 + 无深色遮罩
    const pageState = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasTitle = text.includes('新增订单');
      const hasCustomer = text.includes('顾客姓名') || text.includes('顾客') || text.includes('联系电话');
      const hasSave = text.includes('保存');
      // 深色遮罩：查找 fixed inset-0 半透明黑背景元素
      const overlay = Array.from(document.querySelectorAll('div')).some((d) => {
        const st = getComputedStyle(d);
        return st.position === 'fixed' && (st.inset === '0px' || (st.top === '0px' && st.left === '0px')) &&
          st.backgroundColor && /rgba\(0,\s*0,\s*0,\s*(0\.[1-9]|[1-9])/.test(st.backgroundColor);
      });
      return { hasTitle, hasCustomer, hasSave, overlay };
    });
    log('页面断言:', JSON.stringify(pageState));
    if (!pageState.hasTitle) throw new Error('未找到自绘顶栏标题「新增订单」');
    if (!pageState.hasSave) throw new Error('未找到保存按钮');
    if (pageState.overlay) throw new Error('⚠️ 页面仍渲染了深色遮罩（弹窗模式未切换为页面模式）');

    await page.screenshot({ path: OUT + '/mobile-schedule-new-top.png', fullPage: false });

    // 滚动到底截图
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) { window.scrollBy(0, 600); await new Promise((r) => setTimeout(r, 80)); }
    });
    await sleep(500);
    await page.screenshot({ path: OUT + '/mobile-schedule-new-bottom.png', fullPage: false });
    log('移动端截图完成');

    // 3) 点顶栏返回箭头 → 回到 /schedule
    const backClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.querySelector('path[d*="15 18"]'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!backClicked) throw new Error('未找到返回箭头');
    await page.waitForFunction(() => location.pathname === '/schedule', { timeout: 10000 });
    log('✅ 返回箭头回到 /schedule');

    // 4) 桌面端回归：+ 添加档期 → 弹窗
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    const deskAdd = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('添加档期'));
      if (el) { el.click(); return true; }
      return false;
    });
    if (!deskAdd) throw new Error('桌面端未找到「+ 添加档期」按钮');
    await sleep(800);
    const deskState = await page.evaluate(() => {
      const text = document.body.innerText;
      const overlay = Array.from(document.querySelectorAll('div')).some((d) => {
        const st = getComputedStyle(d);
        return st.position === 'fixed' && (st.inset === '0px' || (st.top === '0px' && st.left === '0px')) &&
          st.backgroundColor && /rgba\(0,\s*0,\s*0,\s*(0\.[1-9]|[1-9])/.test(st.backgroundColor);
      });
      return { hasDialog: text.includes('新增订单'), overlay };
    });
    log('桌面端弹窗断言:', JSON.stringify(deskState));
    if (!deskState.hasDialog) throw new Error('桌面端弹窗未出现');
    if (!deskState.overlay) throw new Error('桌面端弹窗缺少深色遮罩（弹窗模式异常）');
    await page.screenshot({ path: OUT + '/desktop-modal-ok.png', fullPage: false });
    log('✅ 桌面端弹窗正常');

    log('JS 错误:', errs.length ? errs : '无');
    log('🎉 全部通过。截图目录:', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
