// 작성중서류(임시저장) 이어쓰기·서류 교체 범용 스크립트
// 최종 제출/전자서명은 하지 않는다 — 작성완료(최종문서확인)까지만.
//
// 사용:
//   node ecfs-resume-edit.js <사건번호일부> <문서명> [옵션...]
//
// 옵션:
//   --inspect                     변경 없이 상태 덤프(본문/서증/첨부)만
//   --replace-main <PDF>          본문 교체 (기존 전부 삭제 후 업로드)
//   --add-evidence <PDF[,PDF..]>  서증 추가 ("목록에 추가" 방식)
//   --add-attach <PDF[,PDF..]>    첨부서류 추가 ('파일명과 동일' 자동 체크)
//   --fix-evidence <가지부호:시작번호[:이름1|이름2|..]>
//                                 서증 그리드 정정. 예: 마:1  또는  마:1:대화내역|의견서
//   --nominee <이름>              서류명의인 선택 (작성완료 전 필수)
//   --complete                    작성완료(최종문서확인 전환)까지 진행
//   --shot <경로.png>             마지막에 전체 캡처
//
// 예: 청주 55734 준비서면의 본문을 교체하고 작성완료까지
//   node ecfs-resume-edit.js 55734 준비서면 --replace-main "/path/새본문.pdf" --complete --shot /tmp/done.png
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const {
  dismissModal, openDraftList, resumeDraft, isOnForm, goBackToForm,
  mainFileCount, deleteAllMainFiles, uploadMainWithRetry,
  uploadEvidence, uploadAttachment, fixEvidenceGrid, selectNominee, completeAndVerify
} = require('./ecfs-utils');

const [caseKey, docKey] = [process.argv[2], process.argv[3]];
const args = process.argv.slice(4);
if (!caseKey || !docKey) {
  console.error('Usage: node ecfs-resume-edit.js <사건번호일부> <문서명> [옵션...] (헤더 주석 참조)');
  process.exit(1);
}
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
function has(name) { return args.includes(name); }

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const done = async (c) => { try { await browser.close(); } catch (e) {} process.exit(c); };
  try {
    const page = await login(browser);
    console.log('[1] 로그인');
    await openDraftList(page);
    await resumeDraft(page, caseKey, docKey);
    console.log('[2] 초안 진입: ' + caseKey + ' ' + docKey);
    await page.waitForTimeout(5000);

    // 편집 작업이 있으면 문서작성 화면으로
    const needForm = has('--inspect') || opt('--replace-main') || opt('--add-evidence') ||
      opt('--add-attach') || opt('--fix-evidence') || opt('--nominee') || has('--complete');
    if (needForm && !(await goBackToForm(page))) {
      console.log('문서작성 화면 진입 실패'); await done(2);
    }

    if (has('--inspect')) {
      const st = await page.evaluate(() => {
        let main = 0;
        while (document.getElementById(`mf_pfwork_wfm_file_gen_atflLst_${main}_spn_atflNm`)) main++;
        const ev = [];
        for (let r = 0; r < 30; r++) {
          const b = document.getElementById(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${r}_2_select_input_0`);
          const n = document.getElementById(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${r}_3_text`);
          const d = document.getElementById(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${r}_5_text`);
          if (!n) break;
          ev.push(`${b ? b.value : '?'}/${n.value}/${d ? d.value : '?'}`);
        }
        return { main, ev };
      });
      console.log('[상태] 본문 ' + st.main + '개 / 서증: ' + JSON.stringify(st.ev));
    }

    const mainPdf = opt('--replace-main');
    if (mainPdf) {
      console.log('[3] 본문 삭제 전: ' + (await mainFileCount(page)) + '개');
      await deleteAllMainFiles(page);
      await uploadMainWithRetry(page, mainPdf);
      const cnt = await mainFileCount(page);
      console.log('[3] 본문 교체 완료: ' + cnt + '개');
      if (cnt !== 1) { console.log('본문 개수 비정상 — 중단'); await done(3); }
    }

    const evFiles = opt('--add-evidence');
    if (evFiles) {
      for (const f of evFiles.split(',')) {
        await uploadEvidence(page, f.trim());
        console.log('[4] 서증 추가: ' + f.trim().split('/').pop());
      }
    }

    const atFiles = opt('--add-attach');
    if (atFiles) {
      for (const f of atFiles.split(',')) {
        await uploadAttachment(page, f.trim());
        console.log('[5] 첨부서류 추가: ' + f.trim().split('/').pop());
      }
    }

    const fix = opt('--fix-evidence');
    if (fix) {
      const [branch, startStr, namesStr] = fix.split(':');
      const start = parseInt(startStr, 10);
      const names = namesStr ? namesStr.split('|') : [];
      const rows = [];
      const rowCnt = await page.evaluate(() => {
        let n = 0;
        while (document.getElementById(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${n}_3_text`)) n++;
        return n;
      });
      for (let r = 0; r < rowCnt; r++) {
        rows.push({ row: r, branch, number: start + r, name: names[r] != null ? names[r] : null });
      }
      await fixEvidenceGrid(page, rows);
      console.log('[6] 서증 정정: ' + rowCnt + '행 → ' + branch + ' ' + start + '~' + (start + rowCnt - 1));
    }

    const nominee = opt('--nominee');
    if (nominee) {
      const ok = await selectNominee(page, nominee);
      console.log('[7] 서류명의인 선택(' + nominee + '): ' + ok);
    }

    if (has('--complete')) {
      const moved = await completeAndVerify(page);
      console.log('[8] 작성완료 → 최종문서확인 전환: ' + moved);
      if (!moved) {
        console.log('    전환 실패 — 서류명의인 미선택 여부 확인 필요 (--nominee 옵션)');
      }
    }

    const shotPath = opt('--shot');
    if (shotPath) {
      await page.waitForTimeout(6000);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log('[9] 캡처: ' + shotPath);
    }

    console.log('[끝] 전자서명/제출은 진행하지 않음 — 사용자 확인 후 직접 진행');
    await done(0);
  } catch (e) { console.error('Error: ' + e.message); await done(1); }
})();
