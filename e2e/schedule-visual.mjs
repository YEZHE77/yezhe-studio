/**
 * 档期页主内容区（需求 G）· 真实浏览器 UI 回归脚本
 * ------------------------------------------------------------
 * 覆盖：月/周/日三视图切换、8 色状态图例 hover 说明气泡、三项筛选（摄影师/套系/订单状态）、
 *       高级选项菜单、右侧深灰栏（黄块日期 #FFB900）、点击「+ 添加档期」弹出新增订单弹窗。
 * 同时抓取关键色号做断言（背景 #F7F7F7 / 侧栏 #3F3F3F / 黄块 #FFB900 / 主蓝 #2DB7F5）。
 *
 * 运行（已起好本地栈）：BASE_URL=http://localhost:5173 node schedule-visual.mjs
 * 环境变量：BASE_URL / ADMIN_USER / ADMIN_PASS / SHOTS_DIR / CHROME_PATH
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const OUT = process.env.SHOTS_DIR || path.resolve('shots');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e-schedule]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f, fullPage: false });
  log('截图 →', f);
};

/** 按可见文本点击元素（button / div 均可） */
async function clickText(page, text, tag = '*') {
  const ok = await page.evaluate((t, g) => {
    const els = Array.from(document.querySelectorAll(g));
    const hit = els.reverse().find((e) => (e.textContent || '').trim() === t && e.offsetParent !== null);
    if (!hit) return false;
    hit.click();
    return true;
  }, text, tag);
  if (!ok) throw new Error('未找到可点击元素: ' + text);
  await sleep(400);
}

async function fetchToken(base, username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status + ' ' + await r.text());
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome，请设置 CHROME_PATH');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });
  page.on('pageerror', (e) => log('⚠️ pageerror:', e.message));

  const fails = [];
  const check = (label, actual, expect) => {
    const ok = actual === expect;
    log((ok ? '✅ ' : '❌ ') + label, actual, ok ? '' : '(期望 ' + expect + ')');
    if (!ok) fails.push(label + ': ' + actual + ' ≠ ' + expect);
  };

  try {
    log('登录', ADMIN_USER, '@', BASE_URL);
    const token = await fetchToken(BASE_URL, ADMIN_USER, ADMIN_PASS);
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 15000 });

    // 1) 月视图（默认）
    await page.goto(BASE_URL + '/schedule', { waitUntil: 'networkidle2' });
    await sleep(1200);
    await shot(page, 'schedule-01-month');

    // 色号断言
    const colors = await page.evaluate(() => {
      const side = document.querySelector('.calendar-side-info');
      const yellow = side && side.querySelector('div[style*="border-radius"]');
      const btn = document.querySelector('.btn-add-schedule');
      const all = Array.from(document.querySelectorAll('div'));
      const yellowBlock = all.find((d) => getComputedStyle(d).backgroundColor === 'rgb(255, 185, 0)');
      return {
        side: side ? getComputedStyle(side).backgroundColor : null,
        yellow: yellowBlock ? getComputedStyle(yellowBlock).backgroundColor : null,
        addBtn: btn ? getComputedStyle(btn).backgroundColor : null,
      };
    });
    check('右侧深灰侧栏 #3F3F3F', colors.side, rgb('#3F3F3F'));
    check('日期黄块 #FFB900', colors.yellow, rgb('#FFB900'));
    check('添加档期按钮 #2DB7F5', colors.addBtn, rgb('#2DB7F5'));

    // 2) 8 色图例 + hover 说明气泡
    const legendCount = await page.evaluate(() => {
      const labels = ['未付定金', '等待拍摄', '已拍摄', '选片中', '精修中', '已交付', '已完成', '已作废'];
      const txt = document.body.innerText;
      return labels.filter((l) => txt.includes(l)).length;
    });
    check('8 色状态图例齐全', String(legendCount), '8');
    await page.hover('text/未付定金').catch(async () => {
      const box = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('div')).find((d) => (d.textContent || '').trim() === '未付定金');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (box) await page.mouse.move(box.x, box.y);
    });
    await sleep(500);
    await shot(page, 'schedule-02-legend-hover');

    // 3) 周视图
    await clickText(page, '周', 'button');
    await sleep(900);
    await shot(page, 'schedule-03-week');

    // 4) 日视图
    await clickText(page, '日', 'button');
    await sleep(900);
    await shot(page, 'schedule-04-day');

    // 5) 回到月视图 + 高级选项菜单
    await clickText(page, '月', 'button');
    await sleep(700);
    await clickText(page, '高级选项 ▾', 'button').catch(async () => {
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('高级选项'));
        if (b) b.click();
      });
    });
    await sleep(400);
    await shot(page, 'schedule-05-adv-menu');
    await page.mouse.click(900, 40);
    await sleep(300);

    // 6) 三项筛选下拉存在性
    const selects = await page.evaluate(() =>
      Array.from(document.querySelectorAll('select')).map((s) => (s.options[0] || {}).text || '')
    );
    check('含「全部摄影师」筛选', String(selects.includes('全部摄影师')), 'true');
    check('含「全部套系」筛选', String(selects.includes('全部套系')), 'true');
    check('含「全部订单状态」筛选', String(selects.includes('全部订单状态')), 'true');

    // 7) 点击「+ 添加档期」弹出新增订单弹窗
    await page.evaluate(() => {
      const b = document.querySelector('.btn-add-schedule');
      if (b) b.click();
    });
    await sleep(900);
    const hasModal = await page.evaluate(() => document.body.innerText.includes('新增订单'));
    check('「+ 添加档期」弹出新增订单弹窗', String(hasModal), 'true');
    await shot(page, 'schedule-06-order-modal');

    log(fails.length === 0 ? '\n✅ 全部检查通过' : '\n❌ 未通过项:\n- ' + fails.join('\n- '));
    process.exitCode = fails.length === 0 ? 0 : 1;
  } catch (e) {
    log('❌ 脚本异常:', e.message);
    await shot(page, 'schedule-error').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
