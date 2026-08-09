import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://localhost:5173';
const API = 'http://localhost:4000';

const facts = {};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

try {
  // 1) 登录拿 token
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const lj = await login.json();
  const token = lj.token || (lj.data && lj.data.token);
  if (!token) throw new Error('login failed: ' + JSON.stringify(lj));
  facts.hasToken = true;

  // 2) 注入 token 后进入套系列表
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(`${ORIGIN}/packages`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.innerText.includes('套系'), { timeout: 15000 });
  await sleep(700);

  // 3) 面包屑 + 黑色栏 promo + 筛选图标 + 新建按钮
  facts.breadcrumb = await page.evaluate(() => {
    const t = document.body.innerText;
    return t.includes('工作台') && t.includes('套系');
  });
  facts.blackBarPromo = await page.evaluate(() =>
    document.body.innerText.includes('您目前没有上线的促销/拼团活动'));
  facts.hasFilterIcon = await page.evaluate(() =>
    !!document.querySelector('[title="更多筛选"], [title="筛选"]'));
  facts.hasNewBtn = await page.evaluate(() =>
    !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('新建套系')));

  // 4) 列表条目数（带封面 + 含 ¥ 的卡片）
  facts.rowCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll('div')).filter((d) => {
      const img = d.querySelector('img');
      return img && /¥/.test(d.innerText) && d.innerText.length < 400;
    }).length);

  // 5) 价格红色 #e4393c = rgb(228,57,60)
  facts.redPrice = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const priceSpan = spans.find((s) => /^¥[\d,]/.test(s.textContent.trim()));
    if (!priceSpan) return false;
    return getComputedStyle(priceSpan).color.replace(/\s/g, '') === 'rgb(228,57,60)';
  });

  // 6) 右侧图标按钮组顺序：分享｜编辑｜下架｜删除
  facts.iconBtns = await page.evaluate(() => {
    const want = ['分享', '编辑', '下架', '删除'];
    const idx = want.map((w) => {
      const els = Array.from(document.querySelectorAll('[title]'));
      return els.findIndex((e) => e.getAttribute('title') === w);
    });
    return { ordered: JSON.stringify(idx) === JSON.stringify([0, 1, 2, 3]) };
  });

  // 7) 点击【分享】 → 唤起弹窗，校验 H5/小程序 Tab + 二维码 + 复制链接
  const opened = await page.evaluate(() => {
    const b = document.querySelector('[title="分享"]');
    if (!b) return false;
    b.click();
    return true;
  });
  facts.shareBtnFound = opened;
  await sleep(600);
  facts.modal = await page.evaluate(() => {
    const t = document.body.innerText;
    const qrImg = Array.from(document.querySelectorAll('img')).find((i) =>
      (i.src || '').startsWith('data:image'));
    return {
      hasTabs: t.includes('H5') && t.includes('小程序'),
      hasCopy: t.includes('复制链接'),
      hasScan: t.includes('使用微信扫描'),
      qrImg: !!qrImg,
    };
  });

  // 8) 切到小程序 Tab
  if (facts.modal && facts.modal.hasTabs) {
    await page.evaluate(() => {
      const mini = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '小程序');
      if (mini) mini.click();
    });
    await sleep(500);
    facts.miniTab = await page.evaluate(() => {
      const qrImg = Array.from(document.querySelectorAll('img')).find((i) =>
        (i.src || '').startsWith('data:image'));
      return { qrImg: !!qrImg };
    });
  }
} catch (e) {
  facts.error = String((e && e.message) || e);
} finally {
  await browser.close();
}

console.log(JSON.stringify(facts, null, 2));
