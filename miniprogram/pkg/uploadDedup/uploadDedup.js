// 照片上传重复检测工具（微信小程序端，对应需求 C：小程序+H5双端去重）
//
// 真机流程（严格按开发规范）：
//  1. 选图后第一时间请求本相册 existSignList
//  2. wx.chooseImage 拿 tempFilePath（禁止拿临时路径名做判断）
//  3. 循环 wx.getFileInfo 获取每张真实文件 digest(内容md5) + size
//  4. 生成 currentSign = `${digest}_${size}`，与 existSignList 比对
//
// 说明：小程序无法取得原始文件名，wx.getFileInfo 仅返回 digest + size，
//       故以 digest 作为 originalName 存入后端（后端签名 key = originalName_size 仍可匹配同端重复上传）。
//       读取失败（getFileInfo 异常）的图片不拦截，允许上传，防止误伤。

const { CONFIG } = require('../../config.js');

function getApiBase() {
  return CONFIG.API_BASE;
}

// 拉取某相册已存在签名集合（originalName_size 数组）
function getExistSigns(workId, token) {
  return new Promise((resolve) => {
    wx.request({
      url: `${getApiBase()}/api/works/${workId}/albums/exist-signs`,
      method: 'GET',
      header: token ? { Authorization: 'Bearer ' + token } : {},
      success: (res) => {
        const list = (res.data && res.data.existSignList) || [];
        resolve(new Set(list));
      },
      fail: () => resolve(new Set()), // 失败降级：不拦截，避免误伤正常上传
    });
  });
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

// 选图 + 去重检测。
// 返回 { previews, toUpload, dupCount, total }
//   previews: [{ tempFilePath, digest, size, sign, dup, error }]
//   toUpload: 非重复项（待上传）
//   dupCount: 重复项数量（已存在）
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
          const existSet = await getExistSigns(workId, token);
          const MAX = 3 * 1024 * 1024; // 单张硬性限制 3M
          const previews = [];
          const overNames = [];
          for (const tp of tempFilePaths) {
            try {
              const info = await getFileInfo(tp);
              const digest = info.digest;
              const size = info.size;
              const oversize = size > MAX; // 单张 >3M → 标记超限，不加入上传队列
              const sign = `${digest}_${size}`;
              previews.push({ tempFilePath: tp, digest, size, sign, dup: !oversize && existSet.has(sign), oversize, error: false });
              if (oversize) overNames.push(tp);
            } catch (e) {
              // 读取失败 → 放行（防误拦）
              previews.push({ tempFilePath: tp, digest: '', size: 0, sign: '', dup: false, oversize: false, error: true });
            }
          }
          const toUpload = previews.filter((p) => !p.dup && !p.oversize && !p.error);
          // 需求：选中大于3M 的图片直接提示，不发起上传
          if (overNames.length) {
            wx.showModal({ title: '图片过大', content: `有 ${overNames.length} 张图片大于 3M，已自动过滤（标红「超过3M限制」），请压缩后再上传`, showCancel: false });
          }
          resolve({ previews, toUpload, dupCount: previews.filter((p) => p.dup).length, overCount: overNames.length, total: previews.length });
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = { getExistSigns, getFileInfo, chooseAndDedup };
