/**
 * 订单详情页 · 真实浏览器 UI 回归脚本
 * ------------------------------------------------------------
 * 价值：本质仍是调已验证的后端接口，但补齐「视觉 + 弹窗交互」的回归。
 * 流程：登录 admin → 进入订单详情 → 截图全页
 *      → 套系服务详情弹窗（服务详情 / 退订政策 / 选片提示 三个 Tab）
 *      → 编辑订单弹窗 → 加片设置弹窗 → 调查问卷（切底部 Tab）→ 更多设置下拉
 *
 * 运行（本地一键）：  ./run-local.sh
 * 运行（已起好栈）：  BASE_URL=http://localhost:5173 node order-detail-visual.mjs
 * 运行（线上）：      BASE_URL=https://yezhe-studio.pages.dev ADMIN_USER=admin ADMIN_PASS=*** node order-detail-visual.mjs
 *
 * 环境变量：
 *   BASE_URL    前端地址（默认 http://localhost:5173）
 *   ADMIN_USER  管理员账号（默认 admin）
 *   ADMIN_PASS  管理员密码（默认 admin123）
 *   ORDER_ID    指定订单 id（缺省则取列表第一条；本地无订单时自动建演示单）
 *   SHOTS_DIR   截图输出目录（默认 ./shots）
 *   CHROME_PATH 系统 Chrome 路径（默认 macOS 常见路径）
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const ORDER_ID = process.env.ORDER_ID || '';
const OUT = process.env.SHOTS_DIR || path.resolve('shots');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

/** 全页截图 */
async function shot(page, name) {
  const f = path.join(OUT, name);
  await page.screenshot({ path: f, fullPage: true });
  log('📸 截图:', name);
  return f;
}

/** 点击文字匹配的 button / a（精确优先；若多个则点最后一个，用于命中顶部「更多设置」等右侧重复按钮） */
async function clickText(page, text, wait = 700) {
  const h = await page.evaluateHandle((t) => {
    const norm = (s) => (s || '').replace(/\s+/g, '');
    const els = Array.from(document.querySelectorAll('button, a'));
    const exact = els.filter((e) => norm(e.textContent) === norm(t));
    const contains = els.filter((e) => norm(e.textContent).includes(norm(t)));
    const matched = exact.length ? exact : contains;
    return matched[matched.length - 1] || null;
  }, text);
  const el = h.asElement();
  if (!el) throw new Error('未找到可点击元素: ' + text);
  await el.click();
  if (wait) await sleep(wait);
}

/** 等待页面出现包含指定文字的节点 */
async function waitText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('*')).some((e) => (e.textContent || '').includes(t)),
    { timeout },
    text
  );
}

/** 通过后端 API 获取管理员 token */
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

/** 关闭任意背景点击关闭的模态框：点左上角(3,3)命中 fixed 蒙层 */
async function closeModal(page) {
  await page.mouse.click(3, 3);
  await sleep(500);
}

(async () => {
  log('启动 Chrome:', CHROME);
  if (!fs.existsSync(CHROME)) {
    throw new Error('未找到 Chrome，请设置 CHROME_PATH。可装：npx @puppeteer/browsers install chrome@stable');
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => {
    try { await d.dismiss(); } catch {}
  });
  page.on('pageerror', (e) => log('⚠️ pageerror:', e.message));

  try {
    // 1) 登录：Node 取 token → 注入 localStorage → reload 后 AuthProvider 自动 /api/auth/me
    log('登录', ADMIN_USER, '@', BASE_URL);
    const token = await fetchToken(BASE_URL, ADMIN_USER, ADMIN_PASS);
    log('已获取 token');
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 15000 });
    log('登录成功，当前路径:', await page.evaluate(() => location.pathname));

    // 2) 定位订单（优先 ORDER_ID，否则取列表首条，本地无单则建演示单）
    let id = ORDER_ID;
    if (!id) {
      id = await page.evaluate(async (t) => {
        const r = await fetch('/api/orders?limit=1', { headers: { Authorization: 'Bearer ' + t } });
        const d = await r.json();
        const list = d.list || d.data || d || [];
        return (list[0] && list[0].id) || null;
      }, token);
    }
    if (!id) {
      log('本地无订单，自动创建演示订单（date_tbd 避免占档期）...');
      id = await page.evaluate(async (t) => {
        const pd = await (await fetch('/api/packages?limit=1', { headers: { Authorization: 'Bearer ' + t } })).json();
        const pkg = (pd.data && pd.data[0]) || pd[0];
        if (!pkg) return null;
        const cd = await (
          await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
            body: JSON.stringify({
              order_name: 'UI回归演示单',
              customer_name: '回归测试',
              phones: ['13800000000'],
              package_id: pkg.id,
              date_tbd: 1,
              price: pkg.price || 0,
              deposit: 0,
              pay_status: 'unpaid',
            }),
          })
        ).json();
        return cd.id || (cd.data && cd.data.id) || null;
      }, token);
    }
    if (!id) throw new Error('无法获取订单（列表为空且无可用套系）');
    log('目标订单 id =', id);

    // 3) 进入详情页
    await page.goto(BASE_URL + '/orders/' + id, { waitUntil: 'networkidle2' });
    await waitText(page, '更多内容', 20000);
    await sleep(600);
    await shot(page, '01-detail-full.png');

    // 4) 套系服务详情弹窗 + 三个 Tab
    await clickText(page, '更多内容');
    await waitText(page, '套系服务详情');
    await sleep(400);
    await shot(page, '02-pkg-detail-service.png');
    await clickText(page, '退订政策', 500);
    await shot(page, '03-pkg-detail-refund.png');
    await clickText(page, '选片提示', 500);
    await shot(page, '04-pkg-detail-selection.png');
    await closeModal(page);
    await sleep(400);

    // 5) 编辑订单弹窗
    await clickText(page, '编辑订单');
    await waitText(page, '编辑订单 ·');
    await sleep(400);
    await shot(page, '05-edit-modal.png');
    await closeModal(page);
    await sleep(400);

    // 6) 加片设置弹窗
    await clickText(page, '加片设置');
    await waitText(page, '加片设置');
    await sleep(400);
    await shot(page, '06-addon-modal.png');
    await closeModal(page);
    await sleep(400);

    // 7) 调查问卷（切换底部 Tab，不开弹窗）
    await clickText(page, '调查问卷');
    await sleep(600);
    await shot(page, '07-questionnaire-tab.png');

    // 8) 更多设置下拉（放最后，无需处理收起，避免状态干扰）
    await clickText(page, '更多设置');
    await waitText(page, '更换套系');
    await sleep(300);
    await shot(page, '08-more-menu.png');

    log('✅ 完成。截图目录:', OUT);
  } catch (e) {
    log('❌ 失败:', e.message);
    try { await shot(page, 'zz-error.png'); } catch {}
    process.exitCode = 1;
  } finally {
    // browser.close() 在异常页面上偶发卡死，加超时兜底 kill
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => {
          try { browser.process()?.kill('SIGKILL'); } catch {}
          reject(new Error('browser.close timeout, killed'));
        }, 15000)),
      ]);
    } catch (e) {
      log('browser.close 兜底:', e.message);
    }
  }
})();
