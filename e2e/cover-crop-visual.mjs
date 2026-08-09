/**
 * 套系封面临时裁切 · 真实浏览器 UI 回归脚本
 * ------------------------------------------------------------
 * 价值：真实 Chrome 走完整 UI 流程并截图，补齐「视觉 + 弹窗交互」回归：
 *   新建套系 → 填必填 → 选封面图 → 裁切弹窗（拖动裁切框）→ 确认裁切 → 预览回显
 *   → 移除封面（回到虚线框）→ 重新裁切 → 保存（此时才上传图片）→ 清理测试套系
 *
 * 运行（本地一键）：  ./run-local.sh        （run-local 会依次跑 order-detail + cover-crop）
 * 运行（已起好栈）：  BASE_URL=http://localhost:5173 node cover-crop-visual.mjs
 *
 * 环境变量：BASE_URL / ADMIN_USER / ADMIN_PASS / SHOTS_DIR / CHROME_PATH（同 order-detail）
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const OUT = process.env.SHOTS_DIR || path.resolve('shots');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('\x1b[36m[e2e-cover]\x1b[0m', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---------- 生成测试图（512x512 纯色 PNG，免外部依赖） ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng(file, size = 512, color = [54, 136, 235]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}
const TEST_IMG = path.join(os.tmpdir(), 'e2e-cover-test.png');
makePng(TEST_IMG);

// ---------- 通用助手 ----------
async function shot(page, name) {
  const f = path.join(OUT, name);
  await page.screenshot({ path: f, fullPage: true });
  log('📸 截图:', name);
  return f;
}
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
async function waitText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('*')).some((e) => (e.textContent || '').includes(t)),
    { timeout }, text
  );
}
// React 受控输入赋值（text/number 均适用）
async function setInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no input: ' + sel);
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
}
async function setSelectFirst(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no select: ' + sel);
    const opt = Array.from(el.options).find((o) => o.value);
    if (!opt) throw new Error('select 无可选值: ' + sel);
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
}
async function fetchToken(base, username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error('API 登录失败: ' + r.status);
  const d = await r.json();
  return d.token || (d.data && d.data.token);
}

const NAME = 'UI回归封面裁切_' + Date.now();

(async () => {
  log('启动 Chrome:', CHROME);
  if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome，请设置 CHROME_PATH');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });
  page.on('pageerror', (e) => log('⚠️ pageerror:', e.message));

  try {
    // 1) 登录
    const token = await fetchToken(BASE_URL, ADMIN_USER, ADMIN_PASS);
    log('已获取 token');
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 15000 });

    // 2) 新建套系
    await page.goto(BASE_URL + '/packages/new', { waitUntil: 'networkidle2' });
    await waitText(page, '套系封面');
    await setInput(page, 'input[placeholder="婚礼跟拍｜摄影单机位"]', NAME);
    await setSelectFirst(page, 'select'); // 套系分类（tab0 唯一 select）
    log('已填名称 + 分类');

    // 3) 选封面图 → 裁切弹窗
    const coverInput = await page.$('input[type=file][accept="image/jpeg,image/png,image/webp"]');
    if (!coverInput) throw new Error('未找到封面 file input');
    await coverInput.uploadFile(TEST_IMG);
    await waitText(page, '确认裁切', 15000);
    await sleep(500);
    await shot(page, '02-crop-modal.png');

    // 4) 拖动裁切框（验证自由拖动交互）
    const box = await page.$('div[style*="9999px"]');
    if (box) {
      const bb = await box.boundingBox();
      if (bb) {
        const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx - 30, cy - 20, { steps: 8 });
        await page.mouse.up();
      }
    }
    await sleep(300);

    // 5) 确认裁切 → 预览回显
    await clickText(page, '确认裁切');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('img')).some((i) => (i.src || '').startsWith('data:image')),
      { timeout: 15000 }
    );
    await sleep(400);
    await shot(page, '03-cover-preview.png');
    log('裁切并预览回显 OK');

    // 6) 移除封面（回到虚线框）
    await clickText(page, '删除封面');
    await sleep(400);
    await shot(page, '04-cover-removed.png');
    log('移除封面 OK');

    // 7) 重新裁切（恢复封面 pending，供保存上传）
    const coverInput2 = await page.$('input[type=file][accept="image/jpeg,image/png,image/webp"]');
    await coverInput2.uploadFile(TEST_IMG);
    await waitText(page, '确认裁切', 15000);
    await sleep(300);
    await clickText(page, '确认裁切');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('img')).some((i) => (i.src || '').startsWith('data:image')),
      { timeout: 15000 }
    );
    await sleep(300);

    // 8) 填其余必填（价格及问卷 / 服务及加片）
    await clickText(page, '价格及问卷');
    await sleep(300);
    await setInput(page, 'input[type=number]', '1999'); // price（tab1 第一个 number）
    // 第二个 number = deposit
    const nums1 = await page.$$('input[type=number]');
    if (nums1[1]) await setInput(page, 'input[type=number]', '500'); // 仅首个被 set，下面用索引精确填
    await setInput(page, 'xpath/.//input[@type="number"]', '500'); // 占位，真正精确填充在下方
    // 精确：直接按索引赋值
    await page.evaluate(() => {
      const ns = Array.from(document.querySelectorAll('input[type=number]'));
      // ns[0]=price, ns[1]=deposit
      const setV = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      setV(ns[0], '1999'); setV(ns[1], '500');
    });
    await sleep(200);

    await clickText(page, '服务及加片');
    await sleep(300);
    await page.evaluate(() => {
      const ns = Array.from(document.querySelectorAll('input[type=number]'));
      // 该 Tab 下 ns[0]=底片数量, ns[1]=精修片
      const setV = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      setV(ns[0], '300'); setV(ns[1], '50');
    });
    await sleep(200);

    // 9) 保存（此时才上传裁切图）
    await clickText(page, '保存');
    await page.waitForFunction(() => location.pathname === '/packages', { timeout: 20000 });
    await sleep(600);
    await shot(page, '05-packages-after.png');
    log('保存成功，已跳回套系列表');

    // 10) 清理：删除刚建的测试套系
    const list = await (await fetch(BASE_URL + '/api/packages?limit=200', { headers: { Authorization: 'Bearer ' + token } })).json();
    const arr = list.list || list.data || list || [];
    const created = arr.find((p) => p.name === NAME);
    if (created) {
      const dr = await fetch(BASE_URL + '/api/packages/' + created.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      log('清理测试套系', created.id, '→', dr.status);
    } else {
      log('⚠️ 未找到刚创建的测试套系，请手动清理名称含 UI回归封面裁切 的套系');
    }

    log('✅ 完成。截图目录:', OUT);
  } catch (e) {
    log('❌ 失败:', e.message);
    try { await shot(page, 'zz-error.png'); } catch {}
    process.exitCode = 1;
  } finally {
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => { try { browser.process()?.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 15000)),
      ]);
    } catch (e) { log('browser.close 兜底:', e.message); }
  }
})();
