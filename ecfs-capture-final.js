// 최종문서확인 화면의 좌측 서류목록을 순회하며 문서별 미리보기(인라인 뷰어)를 캡처하는 범용 스크립트
// 변경·제출 없음. 초안이 최종문서확인(작성완료) 단계에 있어야 한다.
//
// 사용:
//   node ecfs-capture-final.js <사건번호일부> <문서명> <출력폴더>
// 예:
//   node ecfs-capture-final.js 55734 준비서면 "/path/제출캡처"
//
// 동작: 작성중서류 → 문서명 링크로 초안 진입(최종문서확인 화면) → 전체 캡처(00_전체.png)
//       → 좌측 서류목록 앵커([을마N]..., 대법원..., 준비서면 등)를 하나씩 클릭 → 뷰어 로딩 대기 → viewport 캡처
const { chromium } = require('playwright');
const fs = require('fs');
const { login } = require('./ecfs-login');
const { dismissModal, openDraftList, resumeDraft } = require('./ecfs-utils');

const [caseKey, docKey, outDir] = [process.argv[2], process.argv[3], process.argv[4]];
if (!caseKey || !docKey || !outDir) {
  console.error('Usage: node ecfs-capture-final.js <사건번호일부> <문서명> <출력폴더>');
  process.exit(1);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const done = async (c) => { try { await browser.close(); } catch (e) {} process.exit(c); };
  try {
    const page = await login(browser);
    console.log('[1] 로그인');
    await openDraftList(page);
    await resumeDraft(page, caseKey, docKey);
    console.log('[2] 초안 진입');
    await page.waitForTimeout(8000);
    await dismissModal(page);
    await page.screenshot({ path: outDir + '/00_전체.png', fullPage: true });
    console.log('[3] 전체 캡처: 00_전체.png');

    // 좌측 서류목록 앵커 수집 (뷰어 목록 항목: 짧은 텍스트의 a)
    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a').forEach(el => {
        const t = (el.textContent || '').trim();
        const r = el.getBoundingClientRect();
        if (!t || r.width === 0 || t.length > 60) return;
        // 서류목록 패턴: [을가1]..., 준비서면, 대법원..., ○○지법... / 메뉴·버튼류 제외
        if (/^\[?[을병갑]?[가-하]?\d*\]?.*|^준비서면$|^답변서$|^대법원|지법|지원/.test(t) &&
            /^준비서면$|^답변서$|^\[.+\]|^대법원 |지법 |지원 /.test(t)) {
          out.push(t);
        }
      });
      return [...new Set(out)];
    });
    console.log('[4] 서류목록 ' + items.length + '건: ' + JSON.stringify(items));
    if (!items.length) { console.log('서류목록을 찾지 못함 — 초안이 최종문서확인 단계인지 확인'); await done(2); }

    let n = 1;
    for (const it of items) {
      try {
        const loc = page.locator(`a:has-text("${it}")`).first();
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 8000, force: true });
        await page.waitForTimeout(8000); // 뷰어 변환·로딩 대기
        const safe = it.replace(/[\/\\:*?"<>| \[\]]/g, '_').slice(0, 40);
        await page.screenshot({ path: `${outDir}/${String(n).padStart(2, '0')}_${safe}.png` });
        console.log(`[5] 캡처 ${String(n).padStart(2, '0')}: ${it}`);
        n++;
      } catch (e) { console.log('[5] 실패: ' + it + ' — ' + e.message.split('\n')[0]); }
    }
    console.log('[끝] 총 ' + (n - 1) + '건 캡처. 변경/제출 없음.');
    await done(0);
  } catch (e) { console.error('Error: ' + e.message); await done(1); }
})();
