import { useState, useEffect } from 'react';
import { checkVisitorAccess, trackVisit, verifyVisitorPassword, hasPasswordGrant, setPasswordGrant } from '../utils/visitor.js';

// C 端访客守卫：黑名单拦截 + 访客密码校验 + 埋点上报
// status: checking(校验中) | blocked(黑名单拦截) | needPwd(需输入访客密码) | ok(放行)
export function useVisitorGate({ needPassword = false, page, source = 'h5' }) {
  const [status, setStatus] = useState('checking');
  const [pwd, setPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    checkVisitorAccess()
      .then((r) => {
        if (!mounted) return;
        if (r.blocked) { setStatus('blocked'); return; }
        if (needPassword && r.need_password && !hasPasswordGrant()) { setStatus('needPwd'); return; }
        setStatus('ok');
        trackVisit(page, source);
      })
      .catch(() => { if (mounted) { setStatus('ok'); trackVisit(page, source); } });
    return () => { mounted = false; };
  }, [needPassword, page, source]);

  const submitPassword = async () => {
    if (pwdBusy) return;
    setPwdBusy(true);
    setPwdError('');
    const ok = await verifyVisitorPassword(pwd);
    if (ok) {
      setPasswordGrant(true);
      setStatus('ok');
      trackVisit(page, source);
    } else {
      setPwdError('密码错误，请重试');
    }
    setPwdBusy(false);
  };

  return { status, pwd, setPwd, pwdError, pwdBusy, submitPassword };
}
