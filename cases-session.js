// 진행중사건 점검용 상시 세션: CDP 9444 포트 열고 로그인 후 대기
// (9333은 소장 작성 세션이 쓰므로 충돌 방지를 위해 별도 포트 사용)
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
(async () => {
  const browser = await chromium.launch({
    headless: false, channel: 'chrome',
    args: ['--remote-debugging-port=9444']
  });
  const page = await login(browser);
  await page.screenshot({ path: '/tmp/ecfs-cases/00-login.png' });
  console.log('READY url=' + page.url());
  await new Promise(() => {});
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
