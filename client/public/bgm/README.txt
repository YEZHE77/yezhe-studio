把幻灯片背景音乐 MP3 命名为：

    bgm.mp3

放到本目录（client/public/bgm/bgm.mp3）即可生效（替换默认曲《The Way You Look Tonight - Tony Bennett》）。

说明：
- Vite 会把 public/ 下文件原样拷贝到构建产物根目录，线上访问路径为 /bgm/bgm.mp3。
- 后台「资料设置 → BGM」留空时，系统自动使用此本地音乐，彻底规避网易云/QQ 音乐
  等防盗链导致线上（Cloudflare Pages）与微信小程序播放失败。
- 若后台填了自有 CDN / R2 代理的 MP3 地址，则优先使用后台配置。
- 体积提示：H5（Cloudflare Pages）对单文件无 2MB 限制，当前默认曲约 7.7MB（320kbps 完整版），
  首播稍慢但循环播放无影响；如需更快首播可压到 128kbps（约 3~4MB）。
- 版权提示：请勿把受版权保护的录音提交进公开仓库；此处仅放置你已获授权使用的音乐文件。
