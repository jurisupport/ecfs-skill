// 전자소송 준비서면 제출 (완결 스크립트)
// 사용: node ecfs-submit-brief.js <법원명> <사건번호끝자리> <준비서면PDF> [서증1] [서증2] ...
// 예: node ecfs-submit-brief.js "서울북부지방법원" "20936" "/tmp/준비서면.pdf" "/tmp/갑35.pdf" "/tmp/갑36.pdf" "/tmp/갑37.pdf"

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const {
  findCase, openSubmission, selectDocType, switchToFileMode,
  uploadMainDoc, uploadEvidence, clickComplete, screenshot
} = require('./ecfs-utils');

const COURT = process.argv[2];
const CASE_NUM = process.argv[3];
const BRIEF_PDF = process.argv[4];
const EVIDENCE_FILES = process.argv.slice(5);

if (!COURT || !CASE_NUM || !BRIEF_PDF) {
  console.error('Usage: node ecfs-submit-brief.js <법원명> <사건번호끝자리> <준비서면PDF> [서증1] [서증2] ...');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  try {
    // 1. 로그인
    const page = await login(browser);
    console.log('[1/7] 로그인 완료');

    // 2. 사건 찾기
    const menuBtnId = await findCase(page, COURT, CASE_NUM);
    console.log('[2/7] 사건 찾기 완료');

    // 3. 소송서류제출 진입
    await openSubmission(page, menuBtnId);
    console.log('[3/7] 소송서류제출 진입');

    // 4. 준비서면 → 파일첨부방식
    await selectDocType(page, '준비서면');
    await switchToFileMode(page);
    console.log('[4/7] 파일첨부방식 전환');

    // 5. 준비서면 PDF 업로드
    await uploadMainDoc(page, BRIEF_PDF);
    console.log('[5/7] 준비서면 PDF 등록');

    // 6. 서증 업로드 (순서대로)
    for (let i = 0; i < EVIDENCE_FILES.length; i++) {
      await uploadEvidence(page, EVIDENCE_FILES[i]);
      console.log(`[6/7] 서증 ${i+1}/${EVIDENCE_FILES.length} 등록: ${EVIDENCE_FILES[i]}`);
    }

    // 7. 작성완료
    await clickComplete(page);
    await screenshot(page, '/tmp/ecfs_result.png');
    console.log('[7/7] 작성완료 → 최종문서확인');
    console.log('스크린샷: /tmp/ecfs_result.png');
    console.log('--- 사용자 확인 후 전자서명/제출 진행 ---');

    await page.waitForTimeout(300000);
  } catch(e) {
    console.error('Error: ' + e.message);
    await browser.close();
    process.exit(1);
  }
})();
