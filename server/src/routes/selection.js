// routes/selection.js —— 在线选片（梯度加片计费）
import { Router } from 'express';
import { get, insert, run } from '../db.js';
import { parseRow } from '../schema.js';
import { authRequired } from '../auth.js';

const router = Router();

// 梯度优惠：>=20 张 9 折，>=10 张 95 折，否则无优惠
function selectionFee(extraCount, unitPrice = 80) {
  let discount = 1;
  if (extraCount >= 20) discount = 0.9;
  else if (extraCount >= 10) discount = 0.95;
  const fee = Math.round(extraCount * unitPrice * discount);
  return { fee, discount };
}

// 取最新选片（客户端按 openid）
router.get('/work/:workId', async (req, res) => {
  try {
    const row = await get('SELECT * FROM selections WHERE work_id = ? ORDER BY id DESC LIMIT 1', [req.params.workId]);
    res.json(row ? parseRow(row, ['selected']) : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 保存选片 + 自动核算加片费
router.post('/work/:workId', authRequired, async (req, res) => {
  try {
    const b = req.body;
    const selected = Array.isArray(b.selected) ? b.selected : [];
    const extra = parseInt(b.extra_count) || 0;
    const unit = parseFloat(b.unit_price) || 80;
    const { fee, discount } = selectionFee(extra, unit);
    const id = await insert(
      'INSERT INTO selections (work_id, client_openid, selected, extra_count, status) VALUES (?,?,?,?,?)',
      [req.params.workId, b.client_openid || '', JSON.stringify(selected), extra, 'pending']
    );
    res.json({ id, selectedCount: selected.length, extraCount: extra, unitPrice: unit, discount, fee });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export { selectionFee };
export default router;
