// uploadChunk.js —— 需求 D：分片上传接口（压缩小样 >2MB 启用）
// 三端点：
//   POST /api/upload/chunk           上传单个分片（multer 收 512KB 分片，后端缓冲到 R2/本地）
//   GET  /api/upload/chunk/status    查询某 uploadId 已存在的分片（断点续传）
//   POST /api/upload/complete        校验分片齐全 → 顺序合并落库 → 返回 CDN URL
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db.js';
import { authRequired } from '../auth.js';
import { putChunk, listChunks, mergeChunks } from '../storage.js';

const router = express.Router();

// 分片中转临时目录（multer 收完即被 putChunk 读走并删除，瞬态）
const chunkTmpDir = path.join(dataDir, 'tmp', 'upload-multer');
fs.mkdirSync(chunkTmpDir, { recursive: true });
const upload = multer({ dest: chunkTmpDir, limits: { fileSize: 15 * 1024 * 1024 } });

// 业务分类 → Worker type 枚举（与 api.js CATEGORY_TO_TYPE 对齐）
const CATEGORY_TO_TYPE = {
  raw: 'negative', retouched: 'retouched', client: 'client',
  cover: 'cover', set: 'set', backup: 'backup', uncategorized: 'uncategorized',
  negative: 'negative', 'raw-negative': 'negative'
};
function toType(cat) { return CATEGORY_TO_TYPE[cat] || 'uncategorized'; }

// ① 上传单个分片
router.post('/chunk', authRequired, upload.single('file'), async (req, res) => {
  try {
    const uploadId = req.body.uploadId;
    const partNo = parseInt(req.body.partNo, 10);
    if (!uploadId || !req.file) return res.status(400).json({ error: '缺少 uploadId 或分片文件' });
    if (!Number.isInteger(partNo) || partNo < 1) return res.status(400).json({ error: 'partNo 非法' });
    const buf = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path); // 收完即转存，不持久留本地
    await putChunk(uploadId, partNo, buf);
    res.json({ ok: true, partNo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ② 查询已上传分片（断点续传用）
router.get('/chunk/status', authRequired, async (req, res) => {
  try {
    const uploadId = req.query.uploadId;
    if (!uploadId) return res.status(400).json({ error: '缺少 uploadId' });
    const parts = await listChunks(uploadId);
    res.json({ parts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ③ 合并完成：校验齐全 → 合并落库 → 返回 URL
router.post('/complete', authRequired, async (req, res) => {
  try {
    const { uploadId, ext, category, isPublic, totalParts } = req.body;
    if (!uploadId || !ext) return res.status(400).json({ error: '缺少 uploadId 或 ext' });
    const parts = await listChunks(uploadId);
    const total = parseInt(totalParts, 10);
    // 校验分片齐全（1..total 连续）
    const set = new Set(parts);
    const missing = [];
    if (Number.isInteger(total)) {
      for (let i = 1; i <= total; i++) if (!set.has(i)) missing.push(i);
    }
    if (missing.length) {
      return res.status(409).json({ error: '分片不完整，无法合并', missing });
    }
    const type = toType(category);
    const result = await mergeChunks(uploadId, ext, 'biz-works', {
      category: type,
      isPublic: isPublic === true || isPublic === '1' || isPublic === 'true',
      contentType: 'image/jpeg'
    });
    res.json({ url: result.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
