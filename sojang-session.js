// 소장 작성용 상시 세션: CDP 포트 열고 로그인 후 대기
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
(async () => {
  const browser = await chromium.launch({
    headless: false, channel: 'chrome',
    args: ['--remote-debugging-port=9333']
  });
  const page = await login(browser);
  await page.screenshot({ path: '/tmp/ecfs-sojang/00-login.png' });
  console.log('READY url=' + page.url());
  await new Promise(() => {});
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
