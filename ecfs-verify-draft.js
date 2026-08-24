// 작성중서류: 임시저장목록 조회 + 제출대기목록 점검
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');

const CASE_NUM = process.argv[2] || '10737';

async function dumpRows(page, label) {
  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('table tbody tr').forEach(r => {
      const t = r.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t.slice(0, 160));
    });
    return out;
  });
  console.log(`--- ${label} (${rows.length}행) ---`);
  rows.forEach((t, i) => console.log(`  ${i}: ${t}`));
  return rows;
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  let page = null;
  try {
    page = await login(browser);
    console.log('로그인 완료');
    await page.hover('text=나의전자소송');
    await page.waitForTimeout(1200);
    await page.click('text=작성중서류');
    await page.waitForTimeout(5000);

    // 페이지 크기 최대화 시도 (select)
    await page.evaluate(() => {
      const sels = document.querySelectorAll('select');
      for (const s of sels) {
        for (const o of s.options) { if (/50|100/.test(o.text)) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return; } }
      }
    });
    await page.waitForTimeout(500);

    // 조회 버튼 클릭 (임시저장목록)
    await page.evaluate(() => {
      const els = document.querySelectorAll('button, input[type="button"], a');
      for (const e of els) { if ((e.textContent || e.value || '').trim() === '조회' && e.getBoundingClientRect().width > 0) { e.click(); return; } }
    });
    await page.waitForTimeout(4000);

    const tmpRows = await dumpRows(page, '임시저장목록');
    const hit = tmpRows.filter(t => t.includes(CASE_NUM));
    console.log(`>>> 임시저장목록 중 ${CASE_NUM} 포함 행: ${hit.length}`);
    hit.forEach(h => console.log('    ★', h));
    await page.screenshot({ path: '/tmp/ecfs_verify_tmp.png', fullPage: true });

    // 제출대기목록 탭 점검
    await page.evaluate(() => {
      const els = document.querySelectorAll('a, button, li, span, div');
      for (const e of els) { if (/제출대기목록/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0) { e.click(); return; } }
    });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const els = document.querySelectorAll('button, input[type="button"], a');
      for (const e of els) { if ((e.textContent || e.value || '').trim() === '조회' && e.getBoundingClientRect().width > 0) { e.click(); return; } }
    });
    await page.waitForTimeout(3000);
    const waitRows = await dumpRows(page, '제출대기목록');
    console.log(`>>> 제출대기목록 중 ${CASE_NUM} 포함 행: ${waitRows.filter(t => t.includes(CASE_NUM)).length}`);
    await page.screenshot({ path: '/tmp/ecfs_verify_wait.png', fullPage: true });

    console.log('DONE');
    await page.waitForTimeout(3000);
    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
    if (page) await page.screenshot({ path: '/tmp/ecfs_verify_err.png' }).catch(() => {});
    await browser.close().catch(() => {});
  }
})();
