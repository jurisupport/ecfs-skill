const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const fs = require('fs');

const OUT = process.argv[2] || '/tmp/ecfs-cost/가상계좌납부내역.pdf';
const CASE = process.argv[3] || '12017';

async function inquiry(page) {
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('input[type=button],button,a')]
      .filter(b => (b.value || b.textContent || '').trim() === '조회' && b.getBoundingClientRect().width > 0);
    c.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (c[0]) c[0].click();
  });
  await page.waitForTimeout(5000);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('로그인 완료');
    await page.evaluate(() => document.getElementById('mf_pfheader_anc_menuid_150803')?.click());
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = [...document.querySelectorAll('input[type=button],button')].find(x => (x.value || x.textContent || '').trim() === '1개월'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await inquiry(page);

    // 이 사건(CASE) 외의 데이터 행 제거 (가단/가합/가소 등 다른 사건번호 행)
    const removed = await page.evaluate((CASE) => {
      let cnt = 0;
      for (const tr of document.querySelectorAll('table tbody tr')) {
        const t = tr.innerText || '';
        if (/20\d{2}(가|나|다|머|차)/.test(t) && !t.includes(CASE)) { tr.remove(); cnt++; }
      }
      return cnt;
    }, CASE);
    console.log('다른 사건 행 제거:', removed, '건');

    const rowsLeft = await page.evaluate((CASE) => [...document.querySelectorAll('table tbody tr')].map(tr=>tr.innerText.replace(/\s+/g,' ').trim()).filter(t=>t.includes(CASE)), CASE);
    console.log('남은 대상 행:', rowsLeft);

    // CDP로 인쇄뷰(@media print) PDF 저장
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 8.27, paperHeight: 11.69, // A4
      marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
      preferCSSPageSize: false,
    });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    console.log('PDF 저장:', OUT, '(', Math.round(fs.statSync(OUT).size/1024), 'KB )');
  } catch (err) { console.error('ERROR:', err.message); }
  finally { await browser.close(); }
})();
