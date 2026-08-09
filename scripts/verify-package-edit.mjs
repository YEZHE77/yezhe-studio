import puppeteer from 'puppeteer-core';
import { appendFileSync } from 'fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://localhost:5173';
const API = 'http://localhost:4000';
const LOG = '/tmp/ppcore/_slim.log';
const log = (m) => { try { appendFileSync(LOG, m + '\n'); } catch {} };

const facts = {};
log('start ' + new Date().toISOString());
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
});
log('launched');
const page = await browser.newPage();
log('newPage');

try {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const lj = await login.json();
  const token = lj.token || (lj.data && lj.data.token);
  if (!token) throw new Error('login failed');
  facts.hasToken = true;
  const auth = { Authorization: 'Bearer ' + token };
  log('login');

  const cats = await fetch(`${API}/api/categories`).then((r) => r.json());
  const catId = (cats[0] && cats[0].id) || 1;
  log('cat ' + catId);

  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(`${ORIGIN}/packages/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('套系编辑'), { timeout: 20000 });
  await sleep(600);
  log('loaded new');

  facts.breadcrumb = await page.evaluate(() => document.body.innerText.includes('工作台') && document.body.innerText.includes('套系编辑'));
  facts.tabLabels = await page.evaluate(() => ['套系名称','价格及问卷','服务及加片','其他详情'].every((t) => document.body.innerText.includes(t)));

  // 必填校验（空表单点保存）
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '保存'); if (b) b.click(); });
  await sleep(400);
  facts.validationError = await page.evaluate(() => document.body.innerText.includes('请完善必填项'));

  // 下一步切 Tab
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('下一步')); if (b) b.click(); });
  await sleep(400);
  facts.nextTabWorks = await page.evaluate(() => document.body.innerText.includes('服务参数'));

  // 回到 Tab1 填 名称 + 分类
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '套系名称'); if (b) b.click(); });
  await sleep(300);
  const name = '验证套系_' + Date.now();
  const set1 = await page.evaluate((nm, cid) => {
    const setter = (el, v, evt) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event(evt || 'input', { bubbles: true })); };
    const out = {};
    const nameI = document.querySelector('input[placeholder*="海岛婚礼"]'); if (nameI) { setter(nameI, nm); out.name = true; }
    const sel = document.querySelector('select'); if (sel) { sel.value = String(cid); sel.dispatchEvent(new Event('change', { bubbles: true })); out.cat = sel.value; }
    return out;
  }, name, catId);
  facts.set1 = set1;
  log('set1 ' + JSON.stringify(set1));

  // Tab2 价格/定金/服务参数/退订政策
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('下一步')); if (b) b.click(); });
  await sleep(300);
  const set2 = await page.evaluate(() => {
    const setter = (el, v, evt) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event(evt || 'input', { bubbles: true })); };
    const out = {};
    const sp = document.querySelector('input[placeholder="服务参数模板名称"]'); if (sp) { setter(sp, '标准服务'); out.sp = true; }
    const nums = Array.from(document.querySelectorAll('input[type=number]'));
    if (nums[0]) { setter(nums[0], '699'); out.price = true; }
    if (nums[1]) { setter(nums[1], '200'); out.deposit = true; }
    const ta = document.querySelector('textarea[placeholder*="退订规则"]'); if (ta) { setter(ta, '定金支付后不予退还', 'input'); out.refund = true; }
    return out;
  });
  facts.set2 = set2;
  log('set2 ' + JSON.stringify(set2));

  // Tab3 拍摄时长/底片数量/精修片
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('下一步')); if (b) b.click(); });
  await sleep(300);
  const set3 = await page.evaluate(() => {
    const setter = (el, v, evt) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event(evt || 'input', { bubbles: true })); };
    const out = {};
    const dur = document.querySelector('input[placeholder*="全天"]'); if (dur) { setter(dur, '全天'); out.dur = true; }
    const nums = Array.from(document.querySelectorAll('input[type=number]'));
    if (nums[0]) { setter(nums[0], '300'); out.raw = true; }
    if (nums[1]) { setter(nums[1], '50'); out.retouch = true; }
    return out;
  });
  facts.set3 = set3;
  log('set3 ' + JSON.stringify(set3));

  // ===== 后端直连：保存落库 + details 持久化（绕过浏览器上传 OOM，复用已验证的 uploadImage）=====
  const payload = {
    name, price: 699, deposit: 200, category_id: catId, cover_url: 'https://example.com/cover.png',
    description: 'UI 验证套系', status: 'on', addons: [], marketing: {}, specs: [],
    questionnaire: '',
    details: { service_params: '标准服务', refund_policy: '定金支付后不予退还', duration: '全天', raw_count: '300', retouch_count: '50', show_currency: true, tags: ['热销'] }
  };
  const postRes = await fetch(`${API}/api/packages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
  const postJson = await postRes.json();
  facts.apiCreate = postJson;
  const newId = postJson.id;
  log('apiCreate ' + newId);

  if (newId) {
    const got = await fetch(`${API}/api/packages/${newId}`, { headers: auth }).then((r) => r.json());
    facts.dbRoundTrip = {
      name: got.name, price: got.price, deposit: got.deposit, category_id: got.category_id,
      hasDetails: !!got.details,
      serviceParams: got.details && got.details.service_params,
      refund: got.details && got.details.refund_policy,
      duration: got.details && got.details.duration,
      rawCount: got.details && got.details.raw_count,
      retouch: got.details && got.details.retouch_count,
      tags: got.details && got.details.tags,
      // 旧列兼容：questionnaire 文本列
      questionnaireCol: got.questionnaire
    };
    log('dbRoundTrip ' + JSON.stringify(facts.dbRoundTrip));

    // PUT 更新（编辑保存路径）
    const putRes = await fetch(`${API}/api/packages/${newId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ ...payload, name: name + '_改', details: { ...payload.details, service_params: '高端定制' } }) });
    facts.apiUpdate = (await putRes.json());
    const got2 = await fetch(`${API}/api/packages/${newId}`, { headers: auth }).then((r) => r.json());
    facts.dbAfterUpdate = { name: got2.name, serviceParams: got2.details && got2.details.service_params };
    log('dbAfterUpdate ' + JSON.stringify(facts.dbAfterUpdate));

    // ===== 浏览器：编辑回显 =====
    await page.goto(`${ORIGIN}/packages/${newId}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('套系编辑'), { timeout: 20000 });
    await sleep(700);
    facts.editEcho = await page.evaluate((nm) => {
      const nameI = document.querySelector('input[placeholder*="海岛婚礼"]');
      const spI = document.querySelector('input[placeholder="服务参数模板名称"]');
      const sel = document.querySelector('select');
      return { nameMatch: nameI && nameI.value === nm, spMatch: spI && spI.value === '高端定制', catSet: sel && sel.value !== '' };
    }, name + '_改');
    log('editEcho ' + JSON.stringify(facts.editEcho));
  }
} catch (e) {
  facts.error = String((e && e.message) || e);
  log('error: ' + facts.error);
} finally {
  try { await browser.close(); } catch {}
}
log('done ' + JSON.stringify(facts));
console.log(JSON.stringify(facts, null, 2));
