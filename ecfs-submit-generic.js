// 전자소송 범용 서류제출 (완결 스크립트)
// 준비서면 외 다른 서류(답변서, 소장, 서증 등)에도 사용 가능
// 사용: node ecfs-submit-generic.js <법원명> <사건번호끝자리> <서류유형> <본문PDF> [서증1] [서증2] ...
// 서류유형 예: "준비서면", "답변서(청구취지/원인)", "서증", "소장" 등
// 예: node ecfs-submit-generic.js "서울북부지방법원" "20936" "서증" "" "/tmp/갑38.pdf"

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const {
  findCase, openSubmission, selectDocType, switchToFileMode,
  uploadMainDoc, uploadEvidence, clickComplete, screenshot
} = require('./ecfs-utils');

const COURT = process.argv[2];
const CASE_NUM = process.argv[3];
const DOC_TYPE = process.argv[4];
const MAIN_PDF = process.argv[5]; // 빈 문자열이면 스킵
const EVIDENCE_FILES = process.argv.slice(6);

if (!COURT || !CASE_NUM || !DOC_TYPE) {
  console.error('Usage: node ecfs-submit-generic.js <법원명> <사건번호끝자리> <서류유형> <본문PDF|""> [서증1] ...');
  console.error('서류유형: "준비서면", "답변서(청구취지/원인)", "서증", "소장" 등');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  try {
    const page = await login(browser);
    console.log('[1] 로그인 완료');

    const menuBtnId = await findCase(page, COURT, CASE_NUM);
    console.log('[2] 사건 찾기 완료');

    await openSubmission(page, menuBtnId, CASE_NUM);
    console.log('[3] 소송서류제출 진입');

    await selectDocType(page, DOC_TYPE);
    console.log('[4] 서류유형 선택: ' + DOC_TYPE);

    // 파일첨부방식으로 전환 (전환 버튼이 있는 경우만)
    try {
      await switchToFileMode(page);
      console.log('[5] 파일첨부방식 전환');
    } catch(e) {
      console.log('[5] 파일첨부방식 전환 불필요 (이미 파일모드이거나 해당 없음)');
    }

    // 본문 PDF 업로드 (경로가 있는 경우만)
    if (MAIN_PDF && MAIN_PDF !== '""' && MAIN_PDF !== "''") {
      await uploadMainDoc(page, MAIN_PDF);
      console.log('[6] 본문 PDF 등록: ' + MAIN_PDF);
    } else {
      console.log('[6] 본문 PDF 없음 (스킵)');
    }

    // 서증 업로드
    for (let i = 0; i < EVIDENCE_FILES.length; i++) {
      await uploadEvidence(page, EVIDENCE_FILES[i]);
      console.log(`[7] 서증 ${i+1}/${EVIDENCE_FILES.length}: ${EVIDENCE_FILES[i]}`);
    }

    // 작성완료
    await clickComplete(page);
    await screenshot(page, '/tmp/ecfs_result.png');
    console.log('[8] 작성완료 → 최종문서확인');
    console.log('스크린샷: /tmp/ecfs_result.png');
    console.log('--- 사용자 확인 후 전자서명/제출 진행 ---');

    await page.waitForTimeout(300000);
  } catch(e) {
    console.error('Error: ' + e.message);
    await browser.close();
    process.exit(1);
  }
})();
