// wx.js —— 微信小程序登录：code 换 openid
// 未配置 WX_APPID/WX_SECRET 时返回 DEBUG_<code> 兜底，不阻塞联调
export async function codeToOpenid(code) {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) return 'DEBUG_' + code;
  try {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session?appid=' + appid +
      '&secret=' + secret + '&js_code=' + code + '&grant_type=authorization_code';
    const r = await fetch(url);
    const j = await r.json();
    return j.openid || 'DEBUG_' + code;
  } catch {
    return 'DEBUG_' + code;
  }
}
