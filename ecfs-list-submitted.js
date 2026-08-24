// 전자소송 제출내역 확인 (읽기 전용)
// 사용: node ecfs-list-submitted.js [페이지수(기본2)]
// 나의전자소송 → 제출 관련 메뉴를 찾아 최근 제출서류 목록을 덤프한다.

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');

const PAGES = parseInt(process.argv[2] || '2', 10);

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[✓] 로그인');

    await page.hover('text=나의전자소송').catch(() => {});
    await page.waitForTimeout(1500);
    const menuLinks = await page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .filter((a) => a.getBoundingClientRect().width > 0)
        .map((a) => a.textContent.trim())
        .filter((t) => t && t.length < 20)
    );
    const candidates = menuLinks.filter((t) => t.includes('제출'));
    console.log('[제출 관련 메뉴]', [...new Set(candidates)].join(' | ') || '(없음)');
    const target = candidates.find((t) => /제출문서|제출내역|제출서류/.test(t)) || candidates[0];
    if (!target) { console.error('[실패] 제출 메뉴 못 찾음. 전체 메뉴:', [...new Set(menuLinks)].join(' | ')); return; }
    console.log('[이동]', target);

    await page.evaluate((l) => { for (const a of document.querySelectorAll('a')) if (a.textContent.trim() === l && a.getBoundingClientRect().width > 0) { a.click(); return; } }, target);
    await page.waitForTimeout(5000);
    await page.evaluate(() => { for (const b of document.querySelectorAll('input[type=button],button,a')) { const t = (b.textContent || b.value || '').trim(); if (t === '조회' && b.getBoundingClientRect().width > 0) { b.click(); return; } } });
    await page.waitForTimeout(4000);

    for (let pg = 1; pg <= PAGES; pg++) {
      if (pg > 1) {
        const moved = await page.evaluate((n) => { const el = [...document.querySelectorAll('a,button')].find((a) => a.textContent.trim() === String(n) && a.getBoundingClientRect().width > 0); if (el) { el.click(); return true; } return false; }, pg);
        if (!moved) break;
        await page.waitForTimeout(3500);
      }
      const rows = await page.evaluate(() => {
        const out = [];
        for (const tr of document.querySelectorAll('table tr')) {
          const c = [...tr.querySelectorAll('td')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (c.length >= 4 && c.some((x) => /\d{4}[가-힣]+\d+/.test(x))) out.push(c.slice(0, 8).join(' | '));
        }
        return out;
      });
      console.log(`\n[제출내역 p${pg}] ${rows.length}건`);
      rows.forEach((r) => console.log('  •', r));
    }
  } catch (e) {
    console.error('[오류]', e.message);
  } finally {
    await browser.close();
  }
})();
