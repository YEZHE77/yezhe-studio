// utils/contract.js —— 合同渲染工具（占位符替换 + {{#if}} 条件 + 人民币大写）
// PDF 前端本地生成，模板 template_content 为唯一数据源

// 人民币金额 → 大写（如 2580 → 贰仟伍佰捌拾元整）
// 规则：段内（每4位）末尾零不写「零」、中间连续零只写一个；跨段时低位段不足4位需补「零」
export function rmbUpper(n) {
  if (n == null || n === '') return '';
  const num = Math.round(Number(n) * 100) / 100;
  if (isNaN(num) || num < 0) return '';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const segUnit = ['', '拾', '佰', '仟'];
  const bigUnit = ['', '万', '亿', '兆'];

  const integer = Math.floor(num);
  const decimal = Math.round((num - integer) * 100);

  // 段内（0-9999）转大写：末尾零不加，中间连续零只加一个
  function segUpper(seg) {
    const ds = [
      Math.floor(seg / 1000) % 10,
      Math.floor(seg / 100) % 10,
      Math.floor(seg / 10) % 10,
      seg % 10
    ];
    let s = '';
    let zeroPending = false;
    let hasNonZero = false;
    for (let i = 0; i < 4; i++) {
      const d = ds[i];
      if (d === 0) {
        // 仅当前面已有数字、且后面仍存在非零位时，才需要补「零」
        if (hasNonZero && ds.slice(i + 1).some((x) => x > 0)) zeroPending = true;
      } else {
        if (zeroPending) { s += '零'; zeroPending = false; }
        s += digits[d] + segUnit[3 - i];
        hasNonZero = true;
      }
    }
    return s;
  }

  // 整数部分：按 4 位分段（低位→高位），跨段时补零
  let intStr = '';
  if (integer === 0) {
    intStr = '零';
  } else {
    const segs = [];
    let tmp = integer;
    while (tmp > 0) {
      segs.push(tmp % 10000);
      tmp = Math.floor(tmp / 10000);
    }
    let needZero = false;
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i];
      if (seg === 0) {
        if (intStr) needZero = true;
        continue;
      }
      if (needZero) { intStr += '零'; needZero = false; }
      // 非最高段且不足 4 位 → 说明该段高位有缺失，需补「零」（如 10001 → 壹万零壹）
      if (i < segs.length - 1 && seg < 1000 && intStr && !intStr.endsWith('零')) {
        intStr += '零';
      }
      intStr += segUpper(seg) + bigUnit[i];
    }
  }

  let result = intStr + '元';
  if (decimal === 0) {
    result += '整';
  } else {
    const jiao = Math.floor(decimal / 10);
    const fen = decimal % 10;
    if (jiao > 0) {
      result += digits[jiao] + '角';
      if (fen > 0) result += digits[fen] + '分';
    } else if (fen > 0) {
      // 无角有分且整数部分非零 → 需补「零」（如 10000.01 → 壹万元零壹分）
      if (integer > 0) result += '零';
      result += digits[fen] + '分';
    }
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

// 从订单自身字段构造合同变量（数据一致性强制规则）
// 每个 {{占位符}} 唯一绑定订单对应数据库字段；字段为空则留白，绝不读套系/phones 兜底。
// 机位/底片/精修/价格等业务字段在「新建订单时」已由套系初始化填充到订单字段，渲染只读订单字段。
export function buildContractVars(order) {
  if (!order) order = {};
  const shootDate = order.shoot_date || '';
  const dParts = shootDate ? shootDate.split('-') : [];
  const totalMoney = Math.round((parseFloat(order.total_amount) || 0) * 100) / 100;

  // 数值字段：>0 显示数字，否则留白（字段为空则 PDF 留白）
  const num = (v) => { const n = parseFloat(v); return n > 0 ? n : ''; };
  const intNum = (v) => { const n = parseInt(v, 10); return n > 0 ? n : ''; };

  return {
    groom_name: order.groom_name || '',
    groom_phone: order.groom_phone || '',
    bride_name: order.bride_name || '',
    bride_phone: order.bride_phone || '',
    wedding_full_date: shootDate,
    wedding_year: dParts[0] || '',
    wedding_month: dParts[1] || '',
    wedding_day: dParts[2] || '',
    wedding_address: order.address || '',
    shoot_position: order.shoot_position || '',
    total_negatives: intNum(order.total_negatives),
    retouch_count: intNum(order.retouch_count),
    album_electronic_num: intNum(order.album_electronic_num),
    album_price: num(order.album_price),
    total_money: totalMoney,
    total_money_upper: rmbUpper(totalMoney),
    shoot_cost: num(order.shoot_cost),
    quick_repair_cost: num(order.quick_repair_cost),
    deposit_money: num(order.deposit),
    balance_money: num(order.balance),
    pay_cash: !!order.pay_cash,
    pay_wechat: !!order.pay_wechat,
    pay_alipay: !!order.pay_alipay,
    pay_account_info: order.pay_account_info || '',
    contract_extra_text: order.contract_extra_text || '',
    sign_date: new Date().toISOString().slice(0, 10)
  };
}

// 规则4：比对当前订单与生成时快照（contract_order_snapshot），任一业务字段变化则返回 true
// 用于「订单已变更，旧 PDF 未同步」标红提示
const COMPARE_FIELDS = [
  'groom_name', 'bride_name', 'groom_phone', 'bride_phone', 'shoot_date', 'address',
  'shoot_position', 'total_negatives', 'retouch_count', 'album_electronic_num', 'album_price',
  'shoot_cost', 'quick_repair_cost', 'total_amount', 'deposit', 'balance',
  'pay_cash', 'pay_wechat', 'pay_alipay', 'pay_account_info', 'contract_extra_text'
];
export function contractChanged(order, snapshot) {
  if (!order || !snapshot) return false;
  let snap = snapshot;
  if (typeof snap === 'string') { try { snap = JSON.parse(snap); } catch { return false; } }
  return COMPARE_FIELDS.some((f) => {
    const a = order[f] == null ? '' : String(order[f]);
    const b = snap[f] == null ? '' : String(snap[f]);
    return a !== b;
  });
}
