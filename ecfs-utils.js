// 전자소송 공통 유틸리티

// 모달(알림/확인) 팝업 닫기
async function dismissModal(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button, input[type="button"]');
    for (const btn of btns) {
      const text = (btn.textContent || btn.value || '').trim();
      const rect = btn.getBoundingClientRect();
      if ((text === '확인' || text === '예' || text === '닫기') && rect.top > 100 && rect.top < 700 && rect.left > 200) {
        btn.click(); return;
      }
    }
  });
  await page.waitForTimeout(1500);
}

// 사건 찾기: 법원 필터 → 조회 → 사건번호로 메뉴선택 클릭
// WebSquare 로딩 오버레이(___processbar2)가 사라질 때까지 대기.
// 이걸 안 기다리면 클릭이 오버레이에 가로채이고 그 사이 DOM이 교체된다.
async function waitBusy(page, maxMs = 30000) {
  const step = 500;
  for (let i = 0; i < maxMs / step; i++) {
    const busy = await page.evaluate(() => {
      const el = document.getElementById('___processbar2');
      return !!(el && el.offsetParent !== null);
    }).catch(() => false);
    if (!busy) return;
    await page.waitForTimeout(step);
  }
}

async function findCase(page, court, caseNum) {
  await page.hover('text=나의전자소송');
  await page.waitForTimeout(1000);
  await page.click('text=진행중사건');
  await page.waitForTimeout(3500);

  // (중요) 조회기간 '전체' — 기본값이면 최근 사건만 나와 과년도 사건을 못 찾음
  await page.click('#mf_pfwork_btn_all').catch(() => {});
  await page.waitForTimeout(500);
  // (중요) 30개씩 보기 — 기본 10개씩이면 1페이지에 최신건만 참
  await page.selectOption('#mf_pfwork_sbx_viewCnt', { label: '30개씩 보기' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.selectOption('#mf_pfwork_sbx_cortList', { label: court });
  await page.waitForTimeout(500);
  // 사건번호 오름차순 — 과년도 사건이 앞으로
  await page.selectOption('#mf_pfwork_sbx_sort1', { label: '사건번호↑' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.click('#mf_pfwork_btn_search');
  await page.waitForTimeout(6000);
  await waitBusy(page);

  // 페이지 순회하며 탐색
  for (let pageNo = 1; pageNo <= 15; pageNo++) {
    // (중요) 위치 기반 id(btn11/btn23/...)는 페이지마다 재사용되어 #id로 다시 찾으면
    // 엉뚱한 행이 잡힌다(다른 사건 팝업이 열림). 대상 버튼에 유일 id를 심어 반환한다.
    // 조회 직후 그리드가 채워지기 전에 훑으면 빈 결과가 나온다 → 재시도
    let btnId = null;
    for (let t = 0; t < 6 && !btnId; t++) {
      if (t) await page.waitForTimeout(2000);
      await waitBusy(page);
      btnId = await page.evaluate((cn) => {
        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
          if (row.textContent.includes(cn)) {
            const btn = [...row.querySelectorAll('button,input[type=button],a')]
              .find(b => (b.innerText || b.value || '').trim() === '메뉴선택')
              || row.querySelector('button');
            if (!btn) return null;
            btn.id = 'ECFS_TARGET_MENU_BTN';
            return 'ECFS_TARGET_MENU_BTN';
          }
        }
        return null;
      }, caseNum);
    }
    if (btnId) return btnId;
    // 진단용: 현재 페이지에 실제로 보이는 사건번호들
    const seen = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')]
      .map(r => (r.innerText.match(/\d{4}[가-힣]+\d+/) || [''])[0]).filter(Boolean));
    console.log('  [findCase] page ' + pageNo + ' 사건: ' + (seen.join(', ') || '(빈 목록)'));

    const moved = await page.evaluate((n) => {
      const els = Array.from(document.querySelectorAll('a,button'));
      const t = els.find(e => (e.innerText || '').trim() === String(n + 1) && e.offsetParent !== null);
      if (t) { t.click(); return true; }
      const nx = els.find(e => (e.innerText || '').trim() === '다음' && e.offsetParent !== null);
      if (nx) { nx.click(); return true; }
      return false;
    }, pageNo);
    if (!moved) break;
    await page.waitForTimeout(3500);
  }
  throw new Error('사건을 찾을 수 없습니다: ' + caseNum);
}

// 메뉴선택 팝업에서 소송서류제출 클릭
async function openSubmission(page, menuBtnId, expectCaseNum) {
  await waitBusy(page);
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.click();
  }, menuBtnId);
  await page.waitForTimeout(3500);
  // (안전장치) 메뉴선택 팝업 제목에 대상 사건번호가 있는지 확인 후에만 진행
  if (expectCaseNum) {
    const title = await page.evaluate(() => {
      const el = document.querySelector('[id*="PSP221P02"]');
      return el ? el.innerText.slice(0, 200) : '';
    });
    if (!title.includes(expectCaseNum)) {
      throw new Error('사건 불일치 — 팝업: ' + title.split('\n').slice(0, 3).join(' | '));
    }
  }
  await page.click('#mf_pfwork_PSP221P02_wframe_btn_submitLwstDocmt');
  await page.waitForTimeout(5000);
}

// 서류 유형 선택 (자주 찾는 민사전체서류 영역)
async function selectDocType(page, docName) {
  await page.evaluate((name) => {
    const anchors = document.querySelectorAll('a');
    for (const a of anchors) {
      if (a.textContent.trim() === name) {
        const rect = a.getBoundingClientRect();
        if (rect.top > 350) { a.click(); return; }
      }
    }
  }, docName);
  await page.waitForTimeout(5000);
}

// 파일첨부방식으로 전환
async function switchToFileMode(page) {
  await page.click('#mf_pfwork_btn_EfromToFile');
  await page.waitForTimeout(5000);
}

// 본문 서류(준비서면 등) PDF 업로드
async function uploadMainDoc(page, filePath) {
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.click('#mf_pfwork_wfm_file_btn_fileSearch')
  ]);
  await fc.setFiles(filePath);
  await page.waitForTimeout(3000);
  await dismissModal(page);
  await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_file_btn_save').click(); });
  await page.waitForTimeout(3000);
  await dismissModal(page);
}

// 입증서류(서증) 1건 업로드: 파일찾기 → 목록에 추가
async function uploadEvidence(page, filePath) {
  // 본문(hwpx 등) 변환 중에는 화면이 잠겨 파일찾기가 안 열린다 — 버튼이 준비될 때까지 대기
  for (let i = 0; i < 30; i++) {
    await dismissModal(page);
    const ready = await page.evaluate(() => {
      const b = document.getElementById('mf_pfwork_wfm_prvDocmt_btn_searchFile');
      if (!b || b.disabled) return false;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // 로딩 오버레이가 덮고 있으면 대기
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === b || b.contains(top);
    });
    if (ready) break;
    await page.waitForTimeout(2000);
  }
  let fc = null;
  for (let attempt = 0; attempt < 3 && !fc; attempt++) {
    try {
      [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        page.evaluate(() => { document.getElementById('mf_pfwork_wfm_prvDocmt_btn_searchFile').click(); })
      ]);
    } catch (e) {
      await dismissModal(page);
    }
  }
  if (!fc) throw new Error('서증 파일선택창이 열리지 않습니다: ' + filePath);
  await fc.setFiles(filePath);
  await page.waitForTimeout(3000);
  await dismissModal(page);
  // ⚠️ "목록에 추가" 클릭 (서증입력파일 등록 아님!)
  await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_prvDocmt_btn_added_files').click(); });
  await page.waitForTimeout(3000);
  await dismissModal(page);
}

// 작성완료 → 최종문서확인 페이지로 이동
async function clickComplete(page) {
  await page.evaluate(() => { document.getElementById('mf_pfwork_btn_wrtCmptn').click(); });
  await page.waitForTimeout(5000);
  await dismissModal(page);
}

// 스크린샷 촬영
async function screenshot(page, path) {
  await page.screenshot({ path, fullPage: false });
}

// ───────── 작성중서류(임시저장) 이어쓰기 공용 함수 ─────────

// 작성중서류 목록으로 이동 후 조회
async function openDraftList(page) {
  await page.hover('text=나의전자소송');
  await page.waitForTimeout(1200);
  await page.click('text=작성중서류');
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('button, input[type="button"], a'))
      if ((e.textContent || e.value || '').trim() === '조회' && e.getBoundingClientRect().width > 0) { e.click(); return; }
  });
  await page.waitForTimeout(4000);
}

// 초안 이어쓰기 진입.
// ⚠️ 반드시 "문서명" 링크를 클릭할 것 — 사건(문서)번호 링크는 사건정보 팝업만 연다.
// caseKey: 사건번호 일부(예: '55734'), docKey: 문서명(예: '준비서면')
async function resumeDraft(page, caseKey, docKey) {
  const isList = async () => await page.evaluate(() => document.body.textContent.includes('임시저장목록'));
  const row = page.locator('table tbody tr', { hasText: caseKey }).filter({ hasText: docKey }).first();
  if (await row.count() === 0) throw new Error(`초안 없음: ${caseKey} ${docKey}`);
  await row.locator('a', { hasText: docKey }).first().click();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    await dismissModal(page);
    if (!(await isList())) return true;
  }
  throw new Error('초안 화면 전환 실패');
}

// 현재 화면이 1.문서작성 화면인지 (작성완료 버튼 표시 여부)
async function isOnForm(page) {
  return page.evaluate(() => {
    const b = document.getElementById('mf_pfwork_btn_wrtCmptn');
    return !!b && b.getBoundingClientRect().width > 0;
  });
}

// 최종문서확인 단계에서 문서작성 화면으로 복귀
async function goBackToForm(page) {
  if (await isOnForm(page)) return true;
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('button, input[type="button"], a')) {
      const t = (e.textContent || e.value || '').trim();
      if (/^이전으로가기$|^이전$/.test(t) && e.getBoundingClientRect().width > 0) { e.click(); return; }
    }
  });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 8; i++) {
    await dismissModal(page);
    if (await isOnForm(page)) return true;
    await page.waitForTimeout(3000);
  }
  return false;
}

// 본문 첨부파일 개수
async function mainFileCount(page) {
  return page.evaluate(() => {
    let n = 0;
    while (document.getElementById(`mf_pfwork_wfm_file_gen_atflLst_${n}_spn_atflNm`)) n++;
    return n;
  });
}

// 본문 첨부파일 전부 삭제 (파일명 클릭=선택 → 파일삭제하기 → 확인)
async function deleteAllMainFiles(page) {
  const cnt = await mainFileCount(page);
  for (let i = cnt - 1; i >= 0; i--) {
    await page.evaluate((idx) => {
      const el = document.getElementById(`mf_pfwork_wfm_file_gen_atflLst_${idx}_spn_atflNm`);
      if (el) el.click();
    }, i);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_file_btn_fileDelete').click(); });
    await page.waitForTimeout(2000);
    await dismissModal(page);
    await page.waitForTimeout(1500);
  }
  return mainFileCount(page);
}

// 본문 업로드 (버튼 준비 대기 + 재시도판. uploadMainDoc보다 안정적)
async function uploadMainWithRetry(page, filePath) {
  let fc = null;
  for (let attempt = 0; attempt < 4 && !fc; attempt++) {
    await dismissModal(page);
    const ready = await page.evaluate(() => {
      const b = document.getElementById('mf_pfwork_wfm_file_btn_fileSearch');
      if (!b || b.disabled) return false;
      return b.getBoundingClientRect().width > 0;
    });
    if (!ready) { await page.waitForTimeout(3000); continue; }
    try {
      [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        page.evaluate(() => { document.getElementById('mf_pfwork_wfm_file_btn_fileSearch').click(); })
      ]);
    } catch (e) { await dismissModal(page); }
  }
  if (!fc) throw new Error('본문 파일선택창 실패: ' + filePath);
  await fc.setFiles(filePath);
  await page.waitForTimeout(4000);
  await dismissModal(page);
  await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_file_btn_save').click(); });
  await page.waitForTimeout(3000);
  await dismissModal(page);
}

// 첨부서류 1건 업로드.
// ⚠️ 서류명 미입력 상태로 "목록에 추가"를 누르면 조용히 무시됨 → '파일명과 동일' 체크 필수.
async function uploadAttachment(page, filePath) {
  await page.evaluate(() => {
    const c = document.getElementById('mf_pfwork_wfm_atch_chkFileNmSameYn_input_0');
    if (c && !c.checked) c.click();
  });
  await page.waitForTimeout(800);
  let fc = null;
  for (let attempt = 0; attempt < 4 && !fc; attempt++) {
    await dismissModal(page);
    const ready = await page.evaluate(() => {
      const b = document.getElementById('mf_pfwork_wfm_atch_btn_searchFile');
      if (!b || b.disabled) return false;
      return b.getBoundingClientRect().width > 0;
    });
    if (!ready) { await page.waitForTimeout(3000); continue; }
    try {
      [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        page.evaluate(() => { document.getElementById('mf_pfwork_wfm_atch_btn_searchFile').click(); })
      ]);
    } catch (e) { await dismissModal(page); }
  }
  if (!fc) throw new Error('첨부서류 파일선택창 실패: ' + filePath);
  await fc.setFiles(filePath);
  await page.waitForTimeout(3000);
  await dismissModal(page);
  await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_atch_btn_addedList').click(); });
  await page.waitForTimeout(3000);
  await dismissModal(page);
  await page.evaluate(() => { const b = document.getElementById('mf_pfwork_wfm_atch_btn_save'); if (b) b.click(); });
  await page.waitForTimeout(2500);
  await dismissModal(page);
}

// 서증 그리드 정정. rows: [{row, branch, number, name}]
// 셀 좌표: cell_{r}_1=서증부호(을/병), _2=가지부호(없음~하), _3=서증번호, _5=서증명
// ⚠️ 서증번호는 사건에 이미 제출된 을호증에 이어 자동 부여되므로(예: 13~17)
//    다수당사자(을가~을하) 사건은 가지부호와 번호를 반드시 정정해야 한다.
async function fixEvidenceGrid(page, rows) {
  for (const it of rows) {
    await page.evaluate(({ row, branch, number, name }) => {
      function setVal(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.focus(); el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
      if (branch != null) setVal(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${row}_2_select_input_0`, branch);
      if (number != null) setVal(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${row}_3_text`, String(number));
      if (name != null) setVal(`mf_pfwork_wfm_prvDocmt_grd_dcmevdLst_cell_${row}_5_text`, name);
    }, it);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => { document.getElementById('mf_pfwork_wfm_prvDocmt_btn_saveVndcDocmt').click(); });
  await page.waitForTimeout(2500);
  await dismissModal(page);
}

// 서류명의인 선택 (작성완료 필수요건 — 미선택 시 "서류명의인을(를) 선택해 주십시오" 모달)
// preferName: 우선 선택할 이름(예: '정진용'). 없으면 체크박스 있는 첫 행.
async function selectNominee(page, preferName) {
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, input[type="button"], a')) {
      const t = ((el.textContent || '') + (el.value || '')).trim();
      if (/^선택$/.test(t) && el.getBoundingClientRect().width > 0) { el.click(); return true; }
    }
    return false;
  });
  if (!clicked) return false;
  await page.waitForTimeout(3000);
  await page.evaluate((name) => {
    const wins = Array.from(document.querySelectorAll('div')).filter(dv => {
      const cls = dv.className || '';
      return typeof cls === 'string' && /w2window|w2popup/i.test(cls) && dv.getBoundingClientRect().width > 200;
    });
    for (const w of wins) {
      const trs = Array.from(w.querySelectorAll('tr'));
      const cand = (name && trs.find(tr => tr.textContent.includes(name))) ||
                   trs.find(tr => tr.querySelector('input[type="checkbox"], input[type="radio"]'));
      if (cand) {
        const inp = cand.querySelector('input[type="checkbox"], input[type="radio"]');
        if (inp) inp.click(); else cand.click();
        for (const b of w.querySelectorAll('button, input[type="button"], a')) {
          const t = (b.textContent || b.value || '').trim();
          if (['확인', '선택', '적용'].includes(t) && b.getBoundingClientRect().width > 0) { b.click(); return; }
        }
        return;
      }
    }
  }, preferName || null);
  await page.waitForTimeout(2500);
  await dismissModal(page);
  return true;
}

// 작성완료 → 최종문서확인 전환.
// 전환 판정: 입증서류 파일찾기 버튼(prvDocmt_btn_searchFile) 소멸 기준.
// (btn_wrtCmptn 존재 여부는 신뢰 불가 — 최종문서확인에서도 DOM에 남는다)
async function completeAndVerify(page) {
  await page.evaluate(() => { document.getElementById('mf_pfwork_btn_wrtCmptn').click(); });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 4; i++) { await dismissModal(page); await page.waitForTimeout(2500); }
  for (let i = 0; i < 10; i++) {
    const moved = await page.evaluate(() => {
      const b = document.getElementById('mf_pfwork_wfm_prvDocmt_btn_searchFile');
      return !b || b.getBoundingClientRect().width === 0;
    });
    if (moved) return true;
    await dismissModal(page);
    await page.waitForTimeout(3000);
  }
  return false;
}

module.exports = {
  waitBusy,
  dismissModal, findCase, openSubmission, selectDocType,
  switchToFileMode, uploadMainDoc, uploadEvidence, clickComplete, screenshot,
  openDraftList, resumeDraft, isOnForm, goBackToForm,
  mainFileCount, deleteAllMainFiles, uploadMainWithRetry,
  uploadAttachment, fixEvidenceGrid, selectNominee, completeAndVerify
};
