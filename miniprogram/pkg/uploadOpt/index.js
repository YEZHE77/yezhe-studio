// uploadOpt —— 小程序端图片上传优化（需求 D）
// 核心：选图后本地压缩（wx.compressImage，长边≤1920、质量 75）→ 压缩小样直传/分片上传。
// 压缩小样单张 >2MB 启用分片（512KB/片，后端临时缓冲+合并），支持断点续传 + 单分片失败自动重试 2 次。
// 原图（本地原文件）绝不上传，仅传压缩小样（贴合既有 R2 存储方案）。
//
// 依赖：相册上传接口需管理员会话（admin token），由调用方（albumUpload 页）从
// getApp().globalData.adminToken 取并传入。本模块只负责「压缩 + 上传」，不关心登录态。
//
// 用法：
//   const opt = require('../uploadOpt/index.js');
//   opt.uploadImage(tempFilePath, { token, apiBase, category, isPublic, onProgress, ctrl, getPaused })
//     .then((url) => ...)
//   ctrl.aborted = true        // 取消全部（对应 H5 的 AbortController.abort）
//   getPaused() => bool        // 返回 true 时挂起后续分片/图片（暂停/继续）

const CHUNK_SIZE = 512 * 1024; // 512KB/片
const CHUNK_RETRY = 2;         // 单分片失败自动重试次数
const COMPRESS_QUALITY = 75;   // wx.compressImage 质量（0~100）
const COMPRESS_MAX_WIDTH = 1920;

function genUploadId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 本地压缩：压缩失败则回退原图直传（不阻断主流程）
function compress(tempFilePath) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: tempFilePath,
      quality: COMPRESS_QUALITY,
      compressedWidth: COMPRESS_MAX_WIDTH,
      success: (res) => {
        const cp = res.tempFilePath;
        wx.getFileInfo({
          filePath: cp,
          success: (i) => resolve({ tempFilePath: cp, size: i.size }),
          fail: () => resolve({ tempFilePath: cp, size: 0 })
        });
      },
      fail: () => resolve({ tempFilePath, size: 0 })
    });
  });
}

// 直传（压缩小样 ≤2MB）：wx.uploadFile → /api/upload
function uploadDirect(cp, opts) {
  const { token, apiBase, category, isPublic, onProgress, ctrl } = opts;
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${apiBase}/api/upload`,
      filePath: cp,
      name: 'file',
      formData: { category, isPublic },
      header: { Authorization: 'Bearer ' + token },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(res.data).url); } catch (e) { reject(new Error('上传返回解析失败')); }
        } else {
          let msg = '上传失败';
          try { msg = (JSON.parse(res.data) || {}).error || msg; } catch {}
          reject(new Error(msg));
        }
      },
      fail: reject
    });
    if (task && task.onProgressUpdate && onProgress) task.onProgressUpdate((e) => onProgress(e.progress));
    if (ctrl) ctrl._abort = () => { try { task.abort(); } catch {} };
  });
}

// 上传单个分片（含 per-part 进度 + 自动重试）
function uploadChunk(apiBase, uploadId, partNo, partPath, token, onPart) {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${apiBase}/api/upload/chunk`,
      filePath: partPath,
      name: 'file',
      formData: { uploadId: String(uploadId), partNo: String(partNo) },
      header: { Authorization: 'Bearer ' + token },
      success: (res) => (res.statusCode >= 200 && res.statusCode < 300) ? resolve(res) : reject(new Error((res.data && JSON.parse(res.data).error) || '分片上传失败')),
      fail: reject
    });
    if (task && task.onProgressUpdate && onPart) task.onProgressUpdate((e) => onPart(e.progress));
  });
}

// 查询已上传分片（断点续传）
function getStatus(apiBase, uploadId, token) {
  return new Promise((resolve) => {
    wx.request({
      url: `${apiBase}/api/upload/chunk/status?uploadId=${encodeURIComponent(uploadId)}`,
      method: 'GET',
      header: { Authorization: 'Bearer ' + token },
      success: (res) => {
        const parts = (res.data && res.data.parts) || [];
        resolve(new Set(parts.map((p) => Number(p))));
      },
      fail: () => resolve(new Set())
    });
  });
}

// 合并完成
function completeUpload(apiBase, body, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/upload/complete`,
      method: 'POST',
      header: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: body,
      success: (res) => (res.statusCode >= 200 && res.statusCode < 300) ? resolve(JSON.parse(res.data)) : reject(new Error((res.data && res.data.error) || '合并失败')),
      fail: reject
    });
  });
}

// 分片上传主流程
async function uploadChunked(cp, size, opts) {
  const { token, apiBase, category, isPublic, onProgress, ctrl, getPaused } = opts;
  const uploadId = genUploadId();
  const ext = '.jpg';
  const fs = wx.getFileSystemManager();
  const buf = fs.readFileSync(cp);
  const total = buf.byteLength;
  const totalParts = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  const uploaded = await getStatus(apiBase, uploadId, token);
  let uploadedBytes = 0;
  for (let partNo = 1; partNo <= totalParts; partNo++) {
    if (ctrl && ctrl.aborted) throw { type: 'cancel' };
    while (getPaused && getPaused() && !(ctrl && ctrl.aborted)) { await sleep(150); }
    const start = (partNo - 1) * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, total);
    const partSize = end - start;
    if (uploaded.has(partNo)) {
      uploadedBytes = end;
      if (onProgress) onProgress(Math.min(99, Math.round((uploadedBytes / size) * 100)));
      continue;
    }
    const partPath = `${wx.env.USER_DATA_PATH}/up_${uploadId}_${partNo}.tmp`;
    fs.writeFileSync(partPath, buf.slice(start, end));
    let attempt = 0;
    while (true) {
      try {
        await uploadChunk(apiBase, uploadId, partNo, partPath, token, (pct) => {
          if (onProgress) {
            const cur = uploadedBytes + Math.round((pct / 100) * partSize);
            onProgress(Math.min(99, Math.round((cur / size) * 100)));
          }
        });
        try { fs.unlinkSync(partPath); } catch {}
        break;
      } catch (e) {
        if (ctrl && ctrl.aborted) throw e;
        attempt++;
        if (attempt > CHUNK_RETRY) throw e;
        await sleep(800);
      }
    }
    uploadedBytes = end;
  }
  const data = await completeUpload(apiBase, { uploadId, ext, category, isPublic, totalParts }, token);
  return data.url;
}

// 统一入口：压缩 → 路由（直传 / 分片）
async function uploadImage(tempFilePath, opts = {}) {
  const { token, apiBase, category = 'client', isPublic = '1', onProgress, ctrl, getPaused } = opts;
  const { tempFilePath: cp, size } = await compress(tempFilePath);
  if (size > 2 * 1024 * 1024) {
    return uploadChunked(cp, size, { token, apiBase, category, isPublic, onProgress, ctrl, getPaused });
  }
  return uploadDirect(cp, { token, apiBase, category, isPublic, onProgress, ctrl });
}

module.exports = { uploadImage, compress, CHUNK_SIZE };
