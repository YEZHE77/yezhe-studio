// utils/contract.js —— 合同渲染工具（占位符替换 + {{#if}} 条件 + 人民币大写）
// PDF 前端本地生成，模板 template_content 为唯一数据源

// 人民币金额 → 大写（如 2580 → 贰仟伍佰捌拾元整）
export function rmbUpper(n) {
  if (n == null || n === '') return '';
  const num = Math.round(Number(n) * 100) / 100;
  if (isNaN(num) || num < 0) return '';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const smallUnits = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '兆'];

  const integer = Math.floor(num);
  const decimal = Math.round((num - integer) * 100);

  function segUpper(seg) {
    let s = '';
    let zero = false;
    for (let i = 0; i < 4; i++) {
      const d = Math.floor(seg / Math.pow(10, 3 - i)) % 10;
      if (d === 0) {
        if (s && !zero) { s += '零'; zero = true; }
      } else {
        s += digits[d] + smallUnits[3 - i];
        zero = false;
      }
    }
    return s;
  }

  let intStr = '';
  let x = integer;
  let unitIdx = 0;
  if (integer === 0) intStr = '零';
  while (x > 0) {
    const seg = x % 10000;
    x = Math.floor(x / 10000);
    if (seg > 0) {
      intStr = segUpper(seg) + bigUnits[unitIdx] + intStr;
    } else if (intStr && intStr[0] !== '零') {
      intStr = '零' + intStr;
    }
    unitIdx++;
  }

  let result = intStr + '元';
  if (decimal === 0) {
    result += '整';
  } else {
    const jiao = Math.floor(decimal / 10);
    const fen = decimal % 10;
    if (jiao > 0) result += digits[jiao] + '角';
    if (fen > 0) result += digits[fen] + '分';
  }
  return result;
}

// 条件求值：支持 `shoot_position == "单机位"` 或布尔变量 `pay_cash`
function evalCond(cond, vars) {
  const eq = cond.match(/^\s*(\w+)\s*==\s*["']([^"']*)["']\s*$/);
  if (eq) return String(vars[eq[1]] || '') === eq[2];
  return !!vars[cond.trim()];
}

// 渲染合同模板：先处理 {{#if}} 条件块，再替换 {{xxx}} 占位符
export function renderContract(template, vars) {
  if (!template) return '';
  let html = String(template);
  // 条件块（带 else）
  html = html.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g, (m, cond, yes, no) => {
    return evalCond(cond, vars) ? yes : no;
  });
  // 条件块（无 else）
  html = html.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (m, cond, yes) => {
    return evalCond(cond, vars) ? yes : '';
  });
  // 简单占位符
  html = html.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    return vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : '';
  });
  return html;
}

// 从订单数据 + 套系快照构造合同变量（机位/底片/价格等读订单自身字段，缺省从套系快照回退）
export function buildContractVars(order) {
  const snap = (order && order.package_snapshot) || {};
  const snapObj = typeof snap === 'string' ? (() => { try { return JSON.parse(snap); } catch { return {}; } })() : snap;
  const pkgName = snapObj.name || '';
  // 机位：从套系名提取（含「单机位」→单机位；含「双机位」/「多机位」→多机位）
  const shootPosition = /多机位|双机位/.test(pkgName) ? '多机位' : (/单机位/.test(pkgName) ? '单机位' : '');

  // 底片数量：从 raw_policy / description 提取数字
  const rawText = (snapObj.raw_policy || '') + ' ' + (snapObj.description || '');
  const negMatch = rawText.match(/底片\s*(?:大约|约)?\s*(\d+)/);
  const totalNegatives = negMatch ? parseInt(negMatch[1], 10) : 0;

  // 电话：phones 数组 [新郎, 新娘]
  let phones = [];
  try { phones = Array.isArray(order.phones) ? order.phones : (typeof order.phones === 'string' ? JSON.parse(order.phones || '[]') : []); } catch { phones = []; }
  const groomPhone = phones[0] || order.customer_phone || '';
  const bridePhone = phones[1] || order.customer_phone || '';

  // 日期拆分
  const shootDate = order.shoot_date || '';
  const dParts = shootDate ? shootDate.split('-') : [];
  const weddingYear = dParts[0] || '';
  const weddingMonth = dParts[1] || '';
  const weddingDay = dParts[2] || '';

  const totalMoney = Math.round((parseFloat(order.total_amount) || 0) * 100) / 100;
  const shootCost = parseFloat(snapObj.price) || 0;
  const depositMoney = parseFloat(order.deposit) || 0;
  const balanceMoney = parseFloat(order.balance) || 0;

  // 快修费：从 extra_items 提取（label 含「加片」「快修」的金额）
  let quickRepairCost = 0;
  try {
    const extras = Array.isArray(order.extra_items) ? order.extra_items : (typeof order.extra_items === 'string' ? JSON.parse(order.extra_items || '[]') : []);
    for (const x of extras) {
      if ((x.label || x.name || '').includes('加片') || (x.label || x.name || '').includes('快修')) {
        quickRepairCost += Math.abs(parseFloat(x.amount) || 0);
      }
    }
  } catch {}

  // 支付方式
  const method = order.deposit_method || '';
  const channel = order.deposit_channel || '';
  const payCash = method === 'offline' && (channel === 'cash' || !channel);
  const payWechat = channel === 'wechat' || method === 'online';
  const payAlipay = channel === 'alipay';

  return {
    groom_name: order.groom_name || '',
    groom_phone: groomPhone,
    bride_name: order.bride_name || '',
    bride_phone: bridePhone,
    wedding_full_date: shootDate,
    wedding_year: weddingYear,
    wedding_month: weddingMonth,
    wedding_day: weddingDay,
    wedding_address: order.address || '',
    shoot_position: shootPosition,
    total_negatives: totalNegatives,
    retouch_count: snapObj.retouch_count || 0,
    album_electronic_num: 1,
    album_price: '',
    total_money: totalMoney,
    total_money_upper: rmbUpper(totalMoney),
    shoot_cost: shootCost,
    quick_repair_cost: quickRepairCost || '',
    deposit_money: depositMoney,
    balance_money: balanceMoney,
    pay_cash: payCash,
    pay_wechat: payWechat,
    pay_alipay: payAlipay,
    pay_account_info: '',
    contract_extra_text: order.contract_extra_text || '',
    sign_date: new Date().toISOString().slice(0, 10)
  };
}
