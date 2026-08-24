const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const fs = require('fs');

const OUT = process.argv[2] || '/tmp/ecfs-cost/납부확인서.pdf';
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

    // 대상 사건 행의 '납부' 링크 클릭 → 납부확인서 모달
    const clicked = await page.evaluate((CASE) => {
      for (const tr of document.querySelectorAll('table tbody tr')) {
        if (tr.innerText.includes(CASE)) {
          const a = [...tr.querySelectorAll('a')].find(x => (x.textContent||'').trim() === '납부');
          if (a) { a.click(); return true; }
        }
      }
      return false;
    }, CASE);
    console.log('납부 링크 클릭:', clicked);
    if (!clicked) throw new Error('납부 링크(상태) 못 찾음 - 미납 상태일 수 있음');
    await page.waitForTimeout(4000);

    // 납부확인서 모달 확인
    const hasModal = await page.evaluate(() => /납부확인서/.test(document.body.innerText) && /소송등인지 납부정보/.test(document.body.innerText));
    console.log('납부확인서 모달 표시:', hasModal);

    const client = await page.context().newCDPSession(page);
    const { data } = await client.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 8.27, paperHeight: 11.69,
      marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
      preferCSSPageSize: false,
    });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    console.log('PDF 저장:', OUT, '(', Math.round(fs.statSync(OUT).size/1024), 'KB )');
  } catch (err) { console.error('ERROR:', err.message); }
  finally { await browser.close(); }
})();
