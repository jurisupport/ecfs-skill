// 전자소송 송달문서 점검: 로그인 → 미확인송달문서 + 전체송달문서(여러 페이지) 수집
// 사용: node ecfs-check-delivery.js [전체송달_페이지수(기본3)]
// 출력: /tmp/ecfs-check/ 에 스크린샷 + delivery.json (콘솔에 요약)

const fs = require('fs');
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');

const PAGES = parseInt(process.argv[2] || '3', 10);
const OUT = '/tmp/ecfs-check';
fs.mkdirSync(OUT, { recursive: true });
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }).then(() => {});

async function gotoMenu(page, exactText) {
  await page.hover('text=나의전자소송').catch(() => {});
  await page.waitForTimeout(1500);
  const ok = await page.evaluate((label) => {
    const c = [...document.querySelectorAll('a')].filter(a => a.textContent.trim() === label && a.getBoundingClientRect().width > 0);
    if (c[0]) { c[0].click(); return true; } return false;
  }, exactText);
  await page.waitForTimeout(5000);
  // 조회 버튼 있으면 클릭
  await page.evaluate(() => { for (const b of document.querySelectorAll('input[type=button],button,a')) { const t = (b.textContent || b.value || '').trim(); if (t === '조회' && b.getBoundingClientRect().width > 0) { b.click(); return; } } });
  await page.waitForTimeout(4000);
  return ok;
}

// 송달 목록 행 파싱 (사건번호 포함 행만)
function dumpRows(page) {
  return page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table').forEach(t => {
      if (t.getBoundingClientRect().height < 10) return;
      t.querySelectorAll('tr').forEach(tr => {
        const c = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        if (c.length >= 6 && c.some(x => /\d{4}[가-힣]/.test(x))) rows.push(c);
      });
    });
    return rows;
  });
}

async function clickPage(page, n) {
  return page.evaluate((num) => {
    const els = [...document.querySelectorAll('a,button,input[type=button]')];
    let el = els.find(a => a.textContent.trim() === String(num) && a.getBoundingClientRect().width > 0 && a.closest('[class*=page],[class*=paging],[id*=page]'));
    if (!el) el = els.find(a => a.textContent.trim() === String(num) && a.getBoundingClientRect().width > 0);
    if (el) { el.click(); return true; } return false;
  }, n);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    const li = await page.evaluate(() => { let lo = false, lg = false; document.querySelectorAll('a,button').forEach(e => { const t = e.textContent.trim(), r = e.getBoundingClientRect(); if (r.width > 0) { if (t === '로그아웃') lo = true; if (t === '로그인') lg = true; } }); return lo && !lg; });
    if (!li) { console.error('[실패] 로그인되지 않음'); await shot(page, 'login-fail'); return; }
    console.log('[✓] 로그인 완료');

    // 1) 미확인송달문서
    await gotoMenu(page, '미확인송달문서');
    await shot(page, 'unconfirmed');
    const unconfirmed = await dumpRows(page);
    console.log(`\n[미확인송달문서] ${unconfirmed.length}건 (아직 안 연 것)`);
    unconfirmed.forEach(r => console.log('  •', r.filter(Boolean).slice(0, 6).join(' | ')));

    // 2) 전체송달문서 (여러 페이지)
    await gotoMenu(page, '전체송달문서');
    const all = [], seen = new Set();
    for (let pg = 1; pg <= PAGES; pg++) {
      const rows = await dumpRows(page);
      for (const r of rows) { const k = r.join('|'); if (!seen.has(k)) { seen.add(k); all.push(r); } }
      await shot(page, `all-p${pg}`);
      if (pg < PAGES) { if (!(await clickPage(page, pg + 1))) break; await page.waitForTimeout(3500); }
    }
    console.log(`\n[전체송달문서] 최근 ${all.length}건 (최근 ${PAGES}페이지)`);
    all.slice(0, 30).forEach(r => console.log('  •', r.filter(Boolean).slice(0, 7).join(' | ')));

    fs.writeFileSync(`${OUT}/delivery.json`, JSON.stringify({ unconfirmed, all, capturedPages: PAGES }, null, 2));
    console.log(`\n[저장] ${OUT}/delivery.json  |  스크린샷: ${OUT}/unconfirmed.png, all-p*.png`);
  } catch (e) {
    console.error('[오류]', e.message);
  } finally {
    await browser.close();
  }
})();
