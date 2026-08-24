// 전자소송 준비서면 "임시저장" 전용 스크립트 (작성완료/제출 안 함)
// 사용: node ecfs-submit-draft.js <법원명> <사건번호끝자리> <본문파일> [서증1] [서증2] ...
// 예: node ecfs-submit-draft.js "서울중앙지방법원" "10737" "/경로/준비서면.hwpx" "/경로/갑14.pdf"
//
// ⚠️ 이 스크립트는 임시저장까지만 수행한다. 작성완료(wrtCmptn)·전자서명·전자제출은
//    절대 클릭하지 않는다. 임시저장은 되돌릴 수 있는 초안 저장이다.

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const {
  openSubmission, selectDocType, switchToFileMode,
  uploadMainDoc, dismissModal, screenshot
} = require('./ecfs-utils');

// 입증서류(서증) 첨부 — 준비서면 화면 구조(파일찾기 → 목록에 추가) 대응
async function uploadEvidenceLocal(page, filePath) {
  // 본문 등록 완료 모달 등 정리
  await dismissModal(page);
  await page.waitForTimeout(1000);

  // 진단: 입증서류 영역 버튼 확인
  const btns = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, input[type="button"], a').forEach(el => {
      const t = (el.textContent || el.value || '').trim();
      if (/파일찾기|목록에 추가|추가/.test(t) && el.getBoundingClientRect().width > 0) {
        out.push({ id: el.id, text: t });
      }
    });
    return out;
  });
  console.log('  [입증서류 버튼]', btns.map(b => `"${b.text}"#${b.id}`).join(' '));

  // 파일찾기 클릭 → filechooser
  const clickFileSearch = () => page.evaluate(() => {
    const ids = ['mf_pfwork_wfm_prvDocmt_btn_fileSearch', 'mf_pfwork_wfm_prvDocmt_btn_searchFile'];
    for (const id of ids) { const el = document.getElementById(id); if (el) { el.click(); return id; } }
    // 텍스트 폴백: '파일찾기' 중 입증서류 영역(화면 하단부)
    const els = [...document.querySelectorAll('button, input[type="button"], a')]
      .filter(e => (e.textContent || e.value || '').trim() === '파일찾기' && e.getBoundingClientRect().width > 0);
    if (els.length) { els[els.length - 1].click(); return 'text:파일찾기'; }
    return null;
  });

  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    clickFileSearch(),
  ]);
  await fc.setFiles(filePath);
  await page.waitForTimeout(3000);
  await dismissModal(page);

  // 목록에 추가
  const added = await page.evaluate(() => {
    const el = document.getElementById('mf_pfwork_wfm_prvDocmt_btn_added_files');
    if (el) { el.click(); return 'id'; }
    const els = [...document.querySelectorAll('button, input[type="button"], a')]
      .filter(e => (e.textContent || e.value || '').trim() === '목록에 추가' && e.getBoundingClientRect().width > 0);
    if (els.length) { els[0].click(); return 'text'; }
    return null;
  });
  console.log('  목록에 추가:', added);
  await page.waitForTimeout(3000);
  await dismissModal(page);
}

// 진행중사건 목록을 페이지 순회하며 사건 찾기 (날짜 내림차순 페이지네이션 대응)
async function findCasePaged(page, court, caseNum, maxPage = 60) {
  await page.hover('text=나의전자소송');
  await page.waitForTimeout(1000);
  await page.click('text=진행중사건');
  await page.waitForTimeout(3000);
  await page.selectOption('#mf_pfwork_sbx_cortList', { label: court });
  await page.waitForTimeout(500);
  await page.click('#mf_pfwork_btn_search');
  await page.waitForTimeout(5000);

  const scan = () => page.evaluate((cn) => {
    const rows = document.querySelectorAll('table tbody tr');
    for (const row of rows) {
      if (row.textContent.includes(cn)) {
        const b = row.querySelector('button');
        return b ? b.id : null;
      }
    }
    return null;
  }, caseNum);

  // 특정 페이지 번호(화면 텍스트)를 클릭. 성공하면 true.
  const clickPageNum = (n) => page.evaluate((num) => {
    const els = document.querySelectorAll('a[id*="pgl_inProgCs"], button[id*="pgl_inProgCs"]');
    for (const a of els) {
      if ((a.textContent || '').trim() === String(num) && a.getBoundingClientRect().width > 0) {
        a.click(); return true;
      }
    }
    return false;
  }, n);

  // 다음 그룹 화살표 클릭 시도
  const clickNextGroup = () => page.evaluate(() => {
    const els = document.querySelectorAll('a[id*="pgl_inProgCs"], button[id*="pgl_inProgCs"], [id*="pgl_inProgCs"] a, [id*="pgl_inProgCs"] button');
    for (const a of els) {
      const t = (a.textContent || '').trim();
      const title = (a.getAttribute('title') || '') + ' ' + (a.getAttribute('alt') || '');
      if ((/next|다음/i.test(a.id) || /다음|next/i.test(title) || t === '다음' || t === '>' || t === '»') && a.getBoundingClientRect().width > 0) {
        a.click(); return true;
      }
    }
    return false;
  });

  // page 1 부터 순차 방문
  let btnId = await scan();
  if (btnId) return btnId;
  for (let n = 2; n <= maxPage; n++) {
    let ok = await clickPageNum(n);
    if (!ok) {
      // 현재 그룹 소진 → 다음 그룹으로
      const jumped = await clickNextGroup();
      if (jumped) { await page.waitForTimeout(3500); ok = await clickPageNum(n); }
    }
    if (!ok) { console.log(`  페이지 ${n} 없음 → 순회 종료`); break; }
    await page.waitForTimeout(3500);
    console.log(`  페이지 ${n} 스캔`);
    btnId = await scan();
    if (btnId) { console.log(`  사건 발견: 페이지 ${n}`); return btnId; }
  }
  throw new Error('사건을 찾을 수 없습니다(페이지 순회 후): ' + caseNum);
}

const COURT = process.argv[2];
const CASE_NUM = process.argv[3];
const MAIN_DOC = process.argv[4];
const EVIDENCE_FILES = process.argv.slice(5);

if (!COURT || !CASE_NUM || !MAIN_DOC) {
  console.error('Usage: node ecfs-submit-draft.js <법원명> <사건번호끝자리> <본문파일> [서증1] ...');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  let page = null;
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
      await uploadEvidenceLocal(page, EVIDENCE_FILES[i]);
      console.log(`[6/7] 서증 ${i + 1}/${EVIDENCE_FILES.length} 등록:`, EVIDENCE_FILES[i]);
    }

    await screenshot(page, '/tmp/ecfs_draft_before_save.png');

    // --- 임시저장 버튼 탐색 (하드코딩 금지, 텍스트로 식별) ---
    const candidates = await page.evaluate(() => {
      const els = document.querySelectorAll('button, input[type="button"], a');
      const out = [];
      for (const el of els) {
        const t = (el.textContent || el.value || '').trim();
        if (/임시|저장|완료|제출|서명/.test(t)) {
          const r = el.getBoundingClientRect();
          out.push({ id: el.id, tag: el.tagName, text: t, visible: r.width > 0 && r.height > 0 });
        }
      }
      return out;
    });
    console.log('--- 화면 내 관련 버튼 목록 ---');
    candidates.forEach(c => console.log(`  [${c.tag}#${c.id}] "${c.text}" visible=${c.visible}`));

    // 정확히 "임시저장" 텍스트인 요소만 클릭
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('button, input[type="button"], a');
      for (const el of els) {
        const t = (el.textContent || el.value || '').trim();
        const r = el.getBoundingClientRect();
        if (t === '임시저장' && r.width > 0 && r.height > 0) {
          el.click();
          return el.id || '(no-id)';
        }
      }
      return null;
    });

    if (!clicked) {
      console.log('[!] "임시저장" 버튼을 자동으로 찾지 못했습니다. 화면에서 직접 눌러주세요.');
      console.log('    (작성완료/제출은 누르지 마세요.) 브라우저를 열어둡니다.');
      await screenshot(page, '/tmp/ecfs_draft_no_button.png');
      await page.waitForTimeout(600000);
      return;
    }
    console.log('[7/7] 임시저장 클릭:', clicked);

    // 확인 모달 → 확인, 성공 알림 → 확인
    await page.waitForTimeout(2000);
    await dismissModal(page);
    await page.waitForTimeout(2000);
    await dismissModal(page);

    await screenshot(page, '/tmp/ecfs_draft_saved.png');
    console.log('임시저장 완료(추정). 스크린샷: /tmp/ecfs_draft_saved.png');
    console.log('--- 최종 제출은 하지 않았습니다. 브라우저를 열어둡니다. ---');
    await page.waitForTimeout(600000);
  } catch (e) {
    console.error('Error:', e.message);
    if (page) {
      await screenshot(page, '/tmp/ecfs_draft_error.png').catch(() => {});
      await page.waitForTimeout(300000).catch(() => {});
    }
  }
})();
