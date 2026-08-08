// 相册选图工具（微信小程序端）
//
// 仅负责：选图 + 读取每张真实文件 digest/size 用于「单张 3M 超限」检测。
// 不再做重复检测（需求：去掉防止重复上传照片的限制，重复照片同样可上传）。
//
// 说明：小程序无法取得原始文件名，wx.getFileInfo 仅返回 digest + size，
//       此前以 digest 作为去重签名；现已移除去重逻辑，digest 仅作本地标识保留。

const { CONFIG } = require('../../config.js');

function getApiBase() {
  return CONFIG.API_BASE;
}

// 取单文件信息（digest + size）
function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: (res) => resolve({ digest: res.digest, size: res.size }),
      fail: (err) => reject(err)
    });
  });
}

// 选图（不做重复过滤，仅标记 3M 超限 / 读取失败）。
// 返回 { previews, toUpload, dupCount, overCount, total }
//   previews: [{ tempFilePath, digest, size, oversize, error }]
//   toUpload: 非超限且读取成功的项（待上传）
//   dupCount: 恒为 0（已去掉去重限制）
//   overCount: 超过 3M 的项数
//   total:    选中总数
function chooseAndDedup(workId, token, count = 9) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: async (chooseRes) => {
        try {
          const tempFilePaths = chooseRes.tempFilePaths || [];
          const MAX = 3 * 1024 * 1024; // 单张硬性限制 3M
          const previews = [];
          const overNames = [];
          for (const tp of tempFilePaths) {
            try {
              const info = await getFileInfo(tp);
              const size = info.size;
              const oversize = size > MAX; // 单张 >3M → 标记超限，不加入上传队列
              previews.push({ tempFilePath: tp, digest: info.digest, size, oversize, error: false });
              if (oversize) overNames.push(tp);
            } catch (e) {
              // 读取失败 → 放行，允许上传（防误拦）
              previews.push({ tempFilePath: tp, digest: '', size: 0, oversize: false, error: true });
            }
          }
          const toUpload = previews.filter((p) => !p.oversize && !p.error);
          // 选中大于3M 的图片直接提示，不发起上传
          if (overNames.length) {
            wx.showModal({ title: '图片过大', content: `有 ${overNames.length} 张图片大于 3M，已自动过滤（标红「超过3M限制」），请压缩后再上传`, showCancel: false });
          }
          resolve({ previews, toUpload, dupCount: 0, overCount: overNames.length, total: previews.length });
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = { getFileInfo, chooseAndDedup };
