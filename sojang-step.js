// CDP로 기존 세션에 붙어 한 단계 실행: node sojang-step.js <js파일>
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages[pages.length - 1];
  const fn = require(process.argv[2]);
  await fn(page, ctx);
  await browser.close();  // CDP 연결만 끊음 (브라우저는 유지)
})().catch(e => { console.error('STEP-ERROR', e.message); process.exit(1); });
