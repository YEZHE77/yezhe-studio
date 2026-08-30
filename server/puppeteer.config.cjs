// server/puppeteer.config.cjs
// 关键：Render 生产环境不会保留 $HOME/.cache，puppeteer 默认的 Chromium 缓存目录
// 在构建环境之外，部署后运行时就找不到 Chromium（报 "Could not find Chromium"）。
// 这里把缓存目录改到项目目录内（随代码一起打进部署 slug），构建时 npm install
// 会自动把 Chromium 下载到这里，运行时即可正常启动。
const { join } = require('path');

/** @type {import('puppeteer').Configuration} */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
