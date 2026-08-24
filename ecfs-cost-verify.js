#!/usr/bin/env node
// 가상계좌 발급·납부 상태 확인 (읽기 전용)
// 사용: node ecfs-cost-verify.js [사건번호일부]
//
// ⚠️ 납부 스크립트의 결과화면은 빈 페이지로 캡처될 수 있다. 발급 여부는 반드시 이걸로 확인할 것.
// 상태: '발급' = 가상계좌 나왔으나 미납 / '납부' = 입금완료

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const fs = require('fs');
const OUT = '/tmp/ecfs-cost';

// 큰 파란 '조회' 버튼(가장 넓은 것). 작은 돋보기 조회를 누르면 목록이 안 뜬다.
async function inquiry(page) {
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('input[type=button],button,a')]
      .filter(b => (b.value || b.textContent || '').trim() === '조회' && b.getBoundingClientRect().width > 0);
    c.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (c[0]) c[0].click();
  });
  await page.waitForTimeout(5000);
}

async function rows(page) {
  return page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('table tbody tr')) {
      const t = tr.innerText.replace(/\s+/g, ' ').trim();
      if (t && /\d/.test(t) && !/^전체|^법원/.test(t)) out.push(t);
    }
    return out.slice(0, 30);
  });
}

(async () => {
  const filter = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('로그인 완료');

    // 가상계좌내역 (납부/환급관리)
    await page.evaluate(() => document.getElementById('mf_pfheader_anc_menuid_150803')?.click());
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = [...document.querySelectorAll('input[type=button],button')].find(x => (x.value || x.textContent || '').trim() === '1개월'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await inquiry(page);
    await page.screenshot({ path: OUT + '/vaccount.png', fullPage: true });
    let r = await rows(page);
    if (filter) r = r.filter(x => x.includes(filter));
    console.log('\n===== 가상계좌내역 =====');
    console.log('  순번 법원 사건번호 납부은행 가상계좌번호 납부금액 발급일 납부일 상태');
    r.forEach(x => console.log('  |', x));
    if (!r.length) console.log('  (해당 없음)');

    // 전자납부내역
    await page.evaluate(() => document.getElementById('mf_pfheader_anc_menuid_150802')?.click());
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = [...document.querySelectorAll('input[type=button],button')].find(x => (x.value || x.textContent || '').trim() === '1개월'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await inquiry(page);
    await page.screenshot({ path: OUT + '/epay.png', fullPage: true });
    let e = await rows(page);
    if (filter) e = e.filter(x => x.includes(filter));
    console.log('\n===== 전자납부내역 =====');
    e.forEach(x => console.log('  |', x));
    if (!e.length) console.log('  (해당 없음 = 아직 납부 안 됨)');
    console.log('\n캡처:', OUT);
  } catch (err) { console.error('ERROR:', err.message); }
  finally { await browser.close(); }
})();
