// 작성중서류(임시저장목록)에서 특정 사건 초안 삭제 - 이폼 재작성 전 중복 제거용
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const { openDraftList, dismissModal } = require('./ecfs-utils');

const CASE = 'XXXXXX', DOC = '보정서', SHOT = '/tmp/ecfs-deldraft';   // ← 사건번호 뒷자리·서류명 수정
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const fs = require('fs'); fs.mkdirSync(SHOT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[1] 로그인');
    await openDraftList(page);
    await wait(page, 2000);
    await page.screenshot({ path: SHOT + '/before.png', fullPage: true });

    const info = await page.evaluate(({ CASE, DOC }) => {
      const rows = []; let checked = 0;
      for (const tr of document.querySelectorAll('table tbody tr')) {
        const t = tr.textContent || '';
        if (t.includes(CASE) && t.includes(DOC)) {
          const cb = tr.querySelector('input[type=checkbox]');
          if (cb) { if (!cb.checked) cb.click(); checked++; }
          rows.push(t.replace(/\s+/g, ' ').trim().slice(0, 90));
        }
      }
      return { checked, rows };
    }, { CASE, DOC });
    console.log('[2] 매칭 초안 ' + info.checked + '건:', JSON.stringify(info.rows));
    if (info.checked === 0) { console.log('삭제할 보정서 초안 없음 — 종료'); await browser.close(); return; }

    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button,input[type=button],a')) {
        const x = (b.textContent || b.value || '').trim();
        if (x === '선택항목삭제' && b.getBoundingClientRect().width > 0) { b.click(); return; }
      }
    });
    await wait(page, 2000);
    // 확인 모달: 예/확인
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button,input[type=button],a')) {
        const x = (b.textContent || b.value || '').trim();
        if (/^(예|확인)$/.test(x) && b.getBoundingClientRect().width > 0) { b.click(); return; }
      }
    });
    await wait(page, 3000);
    await dismissModal(page);
    await wait(page, 2000);
    await page.screenshot({ path: SHOT + '/after.png', fullPage: true });

    const remain = await page.evaluate(({ CASE, DOC }) => {
      let n = 0;
      for (const tr of document.querySelectorAll('table tbody tr')) {
        const t = tr.textContent || '';
        if (t.includes(CASE) && t.includes(DOC)) n++;
      }
      return n;
    }, { CASE, DOC });
    console.log('[3] 삭제 후 잔여 초안:', remain);
    await browser.close();
  } catch (e) {
    console.error('ERROR:', e.message);
    try { const pg = browser.contexts().flatMap(c => c.pages()); if (pg.length) await pg[pg.length-1].screenshot({ path: SHOT + '/err.png', fullPage: true }); } catch (_) {}
    await browser.close(); process.exit(1);
  }
})();
