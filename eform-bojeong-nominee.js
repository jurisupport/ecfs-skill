// 보정서(서류명의인 등록형) 템플릿 — 이폼(전자문서작성) 항목별 입력 후 작성완료(최종문서확인)까지
// 파일첨부방식 아님. 전자서명/제출 안 함. 원고/피고는 이폼이 사건에서 자동 기입.
const { chromium } = require('playwright');
const fs = require('fs');
const { login } = require('./ecfs-login');
const { findCase, openSubmission, selectDocType, dismissModal, completeAndVerify, selectNominee } = require('./ecfs-utils');

const COURT = '○○지방법원';           // ← 사건에 맞게 수정
const CASE_NUM = '20XX가단XXXXXX';    // ← 사건에 맞게 수정
const BODY = fs.readFileSync('/tmp/bojeong_body.txt', 'utf8').replace(/\s+$/, '');
const ATTACH = '/path/to/납부확인서.pdf';   // ← 첨부 경로
const ATTACH_NAME = '납부확인서';
const NOMINEE = '○○○';                // ← 서류명의인(당사자명)
const SHOT = '/tmp/ecfs-eform-nominee';

const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  fs.mkdirSync(SHOT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[1] 로그인');
    const menuBtnId = await findCase(page, COURT, CASE_NUM);
    console.log('[2] 사건 찾기');
    await openSubmission(page, menuBtnId);
    console.log('[3] 소송서류제출 진입');
    await selectDocType(page, '보정서');
    await wait(page, 3000); await dismissModal(page);
    console.log('[4] 서류유형: 보정서 (이폼)');

    // 4-1. 보정명령 목록: 첫 번째(인지대·송달료) 선택 → 등록
    await page.evaluate(() => {
      const rs = [...document.querySelectorAll('input[type=radio]')].filter(r => /amndm_grd_stmpAmndm/.test(r.name || ''));
      if (rs[0]) rs[0].click();
    });
    await wait(page, 800);
    await page.evaluate(() => document.getElementById('mf_pfwork_wfm_amndm_btn_save')?.click());
    await wait(page, 2500); await dismissModal(page); await wait(page, 1500);
    console.log('[5] 보정명령 선택·등록');

    // 4-2. 보정 사유 입력 → 등록
    await page.evaluate(() => { const t = document.getElementById('mf_pfwork_wfm_file_txa_hangsoInfo'); if (t) { t.focus(); t.value = ''; } });
    await page.fill('#mf_pfwork_wfm_file_txa_hangsoInfo', BODY);
    await page.evaluate(() => { const t = document.getElementById('mf_pfwork_wfm_file_txa_hangsoInfo'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); t.dispatchEvent(new Event('keyup', { bubbles: true })); });
    await wait(page, 800);
    const len = await page.evaluate(() => document.getElementById('mf_pfwork_wfm_file_txa_hangsoInfo').value.length);
    console.log('  보정사유 입력 길이:', len);
    await page.evaluate(() => document.getElementById('mf_pfwork_wfm_file_btn_hangso_save')?.click());
    await wait(page, 2500); await dismissModal(page); await wait(page, 1500);
    console.log('[6] 보정 사유 등록');

    // 4-3. 서류명의인: 원고 소송대리인 존재 → 등록
    await page.evaluate(() => document.getElementById('mf_pfwork_wfm_docmntNmnr_btn_save')?.click());
    await wait(page, 2500); await dismissModal(page); await wait(page, 1500);
    console.log('[7] 서류명의인 등록');

    // 4-4. 첨부서류: 직접입력 + 서류명 '납부확인서' + 파일 → 목록에 추가 → 등록
    await page.evaluate(() => {
      const s = document.getElementById('mf_pfwork_wfm_atch_sbx_docKind');
      if (s) { for (const o of s.options) { if ((o.textContent || '').trim() === '직접입력') { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); break; } } }
      const c = document.getElementById('mf_pfwork_wfm_atch_chkFileNmSameYn_input_0'); if (c && c.checked) c.click();
    });
    await wait(page, 600);
    await page.fill('#mf_pfwork_wfm_atch_ibxDocNm', ATTACH_NAME);
    await page.evaluate(() => { const t = document.getElementById('mf_pfwork_wfm_atch_ibxDocNm'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(page, 500);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.evaluate(() => document.getElementById('mf_pfwork_wfm_atch_btn_searchFile')?.click())
    ]);
    await fc.setFiles(ATTACH);
    await wait(page, 3000); await dismissModal(page);
    await page.evaluate(() => document.getElementById('mf_pfwork_wfm_atch_btn_addedList')?.click());
    await wait(page, 3000); await dismissModal(page);
    await page.evaluate(() => document.getElementById('mf_pfwork_wfm_atch_btn_save')?.click());
    await wait(page, 2500); await dismissModal(page); await wait(page, 1500);
    console.log('[8] 첨부서류(납부확인서) 등록');
    await page.screenshot({ path: SHOT + '/eform-filled.png', fullPage: true });

    // 작성완료 → 최종문서확인
    let ok = await completeAndVerify(page);
    if (!ok) { await selectNominee(page, NOMINEE); ok = await completeAndVerify(page); }
    console.log('[9] 작성완료(최종문서확인):', ok);
    await wait(page, 2000);
    await page.screenshot({ path: SHOT + '/eform-final.png', fullPage: true });
    console.log('스크린샷:', SHOT + '/eform-final.png');
    console.log('--- 사용자 확인 후 전자서명/제출 진행 ---');
    await browser.close();
  } catch (e) {
    console.error('ERROR:', e.message);
    try { const pgs = browser.contexts().flatMap(c => c.pages()); if (pgs.length) await pgs[pgs.length-1].screenshot({ path: SHOT + '/eform-err.png', fullPage: true }); console.error('에러샷:', SHOT + '/eform-err.png'); } catch (_) {}
    await browser.close(); process.exit(1);
  }
})();
