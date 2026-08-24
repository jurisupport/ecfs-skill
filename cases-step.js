// CDP 9444 세션에 붙어 한 단계 실행: node cases-step.js <js파일> [인자...]
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9444');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages[pages.length - 1];
  const fn = require(process.argv[2]);
  await fn(page, ctx, process.argv.slice(3));
  await browser.close();  // CDP 연결만 끊음 (브라우저는 유지)
})().catch(e => { console.error('STEP-ERROR', e.message); process.exit(1); });
