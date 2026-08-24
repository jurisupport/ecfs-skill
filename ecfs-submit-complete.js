// 전자소송 준비서면 "작성완료"까지 (전자서명/제출은 안 함)
// 사용: node ecfs-submit-complete.js <법원명> <사건번호끝자리> <본문파일> [서증1] [서증2] ...
// findCase를 페이지네이션 대응으로 개선(진행중사건 목록 여러 페이지 순회).
// ⚠️ 작성완료(wrtCmptn)까지만. 전자서명·전자제출은 절대 클릭하지 않는다.

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const {
  openSubmission, selectDocType, switchToFileMode,
  uploadMainDoc, uploadEvidence, clickComplete, dismissModal, screenshot
} = require('./ecfs-utils');

const COURT = process.argv[2];
const CASE_NUM = process.argv[3];
const MAIN_DOC = process.argv[4];
const EVIDENCE_FILES = process.argv.slice(5);

if (!COURT || !CASE_NUM || !MAIN_DOC) {
  console.error('Usage: node ecfs-submit-complete.js <법원명> <사건번호끝자리> <본문파일> [서증1] ...');
  process.exit(1);
}

// 페이지네이션 대응 사건 찾기
async function findCasePaged(page, court, caseNum) {
  await page.hover('text=나의전자소송');
  await page.waitForTimeout(1000);
  await page.click('text=진행중사건');
  await page.waitForTimeout(3000);
  await page.selectOption('#mf_pfwork_sbx_cortList', { label: court });
  await page.waitForTimeout(500);
  await page.click('#mf_pfwork_btn_search');
  await page.waitForTimeout(5000);

  const findOnCurrentPage = async () => page.evaluate((cn) => {
    const rows = document.querySelectorAll('table tbody tr');
    for (const row of rows) {
      if (row.textContent.includes(cn)) {
        const btn = row.querySelector('button');
        return btn ? btn.id : null;
      }
    }
    return null;
  }, caseNum);

  // 현재 페이지 확인
  let btnId = await findOnCurrentPage();
  if (btnId) return btnId;

  // 페이지 번호 버튼 순회 (최대 20페이지)
  for (let p = 1; p <= 20; p++) {
    const pagerId = `#mf_pfwork_pgl_inProgCs_page_${p}`;
    const exists = await page.$(pagerId);
    if (!exists) break;
    await page.click(pagerId);
    await page.waitForTimeout(3500);
    console.log(`  ...${p}페이지 검색`);
    btnId = await findOnCurrentPage();
    if (btnId) return btnId;
  }
  throw new Error('사건을 찾을 수 없습니다(전 페이지 순회): ' + caseNum);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  let page;
  try {
    page = await login(browser);
    console.log('[1/7] 로그인 완료');

    const menuBtnId = await findCasePaged(page, COURT, CASE_NUM);
    console.log('[2/7] 사건 찾기 완료:', CASE_NUM);

    await openSubmission(page, menuBtnId);
    console.log('[3/7] 소송서류제출 진입');

    await selectDocType(page, '준비서면');
    await switchToFileMode(page);
    console.log('[4/7] 준비서면 → 파일첨부방식');

    await uploadMainDoc(page, MAIN_DOC);
    console.log('[5/7] 본문 업로드:', MAIN_DOC);

    for (let i = 0; i < EVIDENCE_FILES.length; i++) {
      await uploadEvidence(page, EVIDENCE_FILES[i]);
      console.log(`[6/7] 서증 ${i + 1}/${EVIDENCE_FILES.length} 등록:`, EVIDENCE_FILES[i]);
    }

    await screenshot(page, '/tmp/ecfs_before_complete.png');

    await clickComplete(page);
    await page.waitForTimeout(2000);
    await dismissModal(page);
    await screenshot(page, '/tmp/ecfs_completed.png');
    console.log('[7/7] 작성완료 → 최종문서확인 페이지');
    console.log('스크린샷: /tmp/ecfs_completed.png');
    console.log('--- 전자서명/제출은 하지 않았습니다. 브라우저를 열어둡니다. ---');
    await page.waitForTimeout(900000);
  } catch (e) {
    console.error('Error:', e.message);
    if (page) { await screenshot(page, '/tmp/ecfs_complete_error.png').catch(() => {}); await page.waitForTimeout(600000).catch(() => {}); }
  }
})();
