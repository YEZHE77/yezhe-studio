// routes/uploadFile.js —— 通用文件上传（BGM 音频等非图片资源），管理员权限
// POST /api/files/upload —— 接收单个文件（multipart 字段名 file），直传云端存储，返回 CDN URL
// 与 /api/upload（图片，3MB 上限 + image/jpeg）区分：本端点面向音频等二进制，
// 仅做 30MB 硬上限保护，content-type 按扩展名/上传 mime 透传，不限制为图片。
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { authRequired } from '../auth.js';
import { saveBuffer } from '../storage.js';

const router = express.Router();

// 中转临时目录（multer 收完即被 readFileSync + unlink，瞬态，绝不持久化业务二进制）
const tmpDir = path.join(os.tmpdir(), 'yezhe-files');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 30 * 1024 * 1024 } });

const EXT_CONTENT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime'
};

router.post('/upload', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const buf = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path); // 收完即转存云端，不落本地磁盘
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.mp3';
    // 优先按扩展名映射（curl 等客户端常把 mp3 标成 octet-stream，会导致音频 MIME 错误），
    // 仅在扩展名未知时才回退到客户端上报的 mimetype。
    const contentType = EXT_CONTENT[ext] || req.file.mimetype || 'application/octet-stream';
    const result = await saveBuffer(buf, ext, 'bgm', {
      category: 'bgm',
      isPublic: true,
      contentType
    });
    res.json({ url: result.url });
  } catch (e) {
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    res.status(500).json({ error: e.message });
  }
});

export default router;
