// 전자소송 송달문서 열기 + PDF 저장
// 사용: node ecfs-open-save.js [옵션]
//   --unconfirmed        미확인송달문서를 대상으로 (⚠️ 여는 순간 '송달 확인' 처리되어 송달효력 발생·기간 기산)
//   --all-menu           전체송달문서(기본). 미확인 상태 행은 자동 건너뜀(확인처리 방지)
//   --pages N            전체송달문서 페이지 수 (기본 2)
//   --out DIR            저장 폴더 (기본 작성서류/송달문서 — 2026-08-03 사용자 확정)
//   --limit N            최대 N건만 (기본 전체)
//   --skip FILE.json     이미 저장된 문서 목록(JSON: [{caseNo,docName},..]) — 해당 건 건너뜀
//   --dry                열지 않고 대상 목록만 출력
//
// 안전원칙: 기본(전체송달문서)에서는 '수신일자=미확인'인 행을 열지 않는다.
//   미확인 문서를 실제로 여는 것은 되돌릴 수 없는 법적 처분이므로 --unconfirmed 를 명시해야만 수행.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const UNCONFIRMED = argv.includes('--unconfirmed');
const PAGES = parseInt(opt('--pages', '2'), 10);
const { secret } = require('./k-secrets');
// 우선순위: --out 인자 → 환경변수/금고 ECFS_DELIVERY_DIR → ~/ecfs-delivery
const OUTDIR = opt('--out', secret('ECFS_DELIVERY_DIR', require('path').join(require('os').homedir(), 'ecfs-delivery')));
const LIMIT = parseInt(opt('--limit', '9999'), 10);
const CASE = opt('--case', '');   // 사건번호 부분일치 필터 (예: --case 60957)
const SKIPFILE = opt('--skip', '');
const HAVE = (() => { try { return SKIPFILE ? JSON.parse(fs.readFileSync(SKIPFILE, 'utf8')) : []; } catch { return []; } })();
const hasAlready = (caseNo, docName) => HAVE.some(h => h.caseNo === caseNo && h.docName === docName);
const DRY = argv.includes('--dry');
fs.mkdirSync(OUTDIR, { recursive: true });

const MENU = UNCONFIRMED ? '미확인송달문서' : '전체송달문서';

async function gotoMenu(page, label) {
  await page.hover('text=나의전자소송').catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate((l) => { for (const a of document.querySelectorAll('a')) if (a.textContent.trim() === l && a.getBoundingClientRect().width > 0) { a.click(); return; } }, label);
  await page.waitForTimeout(5000);
  await page.evaluate(() => { for (const b of document.querySelectorAll('input[type=button],button,a')) { const t = (b.textContent || b.value || '').trim(); if (t === '조회' && b.getBoundingClientRect().width > 0) { b.click(); return; } } });
  await page.waitForTimeout(4000);
}

// 현재 페이지의 대상 행 인덱스+메타 수집
function collectRows(page, unconfirmedMode) {
  return page.evaluate((uMode) => {
    const out = [];
    const trs = [...document.querySelectorAll('table tr')];
    trs.forEach((tr) => {
      const c = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      if (c.length < 6 || !c.some(x => /\d{4}[가-힣]/.test(x))) return;
      const caseNo = (tr.textContent.match(/\d{4}[가-힣]+\d+/) || [])[0] || '';
      const isUnconfirmed = c.some(x => x === '미확인');
      const docName = (() => { const tds = [...tr.querySelectorAll('td')]; const a = tds[5] && tds[5].querySelector('a'); return a ? a.textContent.trim() : (c[5] || ''); })();
      out.push({ caseNo, docName, isUnconfirmed, cols: c.filter(Boolean).slice(0, 7) });
    });
    return out;
  }, unconfirmedMode);
}

// n번째 대상 행의 문서링크 클릭 (미확인모드가 아니면 확인된 행만)
function clickDocLink(page, targetIdx, unconfirmedMode) {
  return page.evaluate(({ idx, uMode }) => {
    const trs = [...document.querySelectorAll('table tr')].filter(tr => {
      const c = [...tr.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      return c.length >= 6 && c.some(x => /\d{4}[가-힣]/.test(x));
    });
    const eligible = trs.filter(tr => {
      const isUnc = [...tr.querySelectorAll('td')].some(td => td.textContent.trim() === '미확인');
      return uMode ? true : !isUnc;   // 안전: 기본모드는 확인된 행만
    });
    const tr = eligible[idx];
    if (!tr) return false;
    const tds = [...tr.querySelectorAll('td')];
    const link = (tds[5] && tds[5].querySelector('a')) || (tds[3] && tds[3].querySelector('a'));
    if (link) { link.click(); return true; }
    return false;
  }, { idx: targetIdx, uMode: unconfirmedMode });
}

async function saveViewer(ctx, listPage, outdir) {
  // 뷰어 팝업이 클릭과 동시에(동기) 열리는 경우 waitForEvent가 이벤트를 놓친다 (2026-08-14 확인)
  // → 이미 열린 추가 페이지를 먼저 찾고, 없으면 새 페이지 이벤트 대기
  let viewer = ctx.pages().find(p => p !== listPage && !p.isClosed());
  if (!viewer) viewer = await ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  if (!viewer) return { ok: false, reason: '뷰어 안뜸' };
  await viewer.waitForLoadState('domcontentloaded').catch(() => {});
  // about:blank → 뷰어 로딩 완료까지: 파일저장 버튼이 뜰 때까지 최대 20초 대기
  for (let w = 0; w < 10; w++) {
    const ready = await viewer.evaluate(() => !!(document.getElementById('mf_btn_save') || [...document.querySelectorAll('button,input[type=button],a')].find(x => (x.textContent || x.value || '').trim() === '파일저장'))).catch(() => false);
    if (ready) break;
    await viewer.waitForTimeout(2000);
  }
  await viewer.waitForTimeout(1500);
  let saved = null;
  const done = new Promise(res => {
    viewer.on('download', async d => { const fn = path.join(outdir, (d.suggestedFilename() || 'doc.pdf')); await d.saveAs(fn).catch(() => {}); saved = fn; res(); });
    setTimeout(res, 120000);
  });
  // 파일저장 클릭 (미발견 시 2초 간격 3회 재시도)
  let btnFound = false;
  for (let a = 0; a < 3 && !btnFound; a++) {
    btnFound = await viewer.evaluate(() => { const b = document.getElementById('mf_btn_save') || [...document.querySelectorAll('button,input[type=button],a')].find(x => (x.textContent || x.value || '').trim() === '파일저장'); if (b) { b.click(); return true; } return false; }).catch(() => false);
    if (!btnFound) await viewer.waitForTimeout(2000);
  }
  if (!btnFound) { const u = viewer.url().slice(0, 100); await viewer.close().catch(() => {}); return { ok: false, reason: `저장버튼 없음 (${u})` }; }
  await done;
  // 뷰어 닫기
  const vurl = viewer.url().slice(0, 100);
  await viewer.close().catch(() => {});
  await listPage.waitForTimeout(1500);
  return { ok: !!saved, file: saved, reason: saved ? undefined : `다운로드 미발생 (${vurl})` };
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    const ctx = browser.contexts()[0];
    const li = await page.evaluate(() => { let lo = false, lg = false; document.querySelectorAll('a,button').forEach(e => { const t = e.textContent.trim(), r = e.getBoundingClientRect(); if (r.width > 0) { if (t === '로그아웃') lo = true; if (t === '로그인') lg = true; } }); return lo && !lg; });
    if (!li) { console.error('[실패] 로그인 안됨'); return; }
    console.log('[✓] 로그인');

    if (UNCONFIRMED) {
      console.log('\n⚠️  --unconfirmed: 미확인송달문서를 엽니다. 여는 즉시 "송달 확인"으로 처리되어');
      console.log('    송달 효력이 발생하고 불복/이의/보정 기간이 기산됩니다. (되돌릴 수 없음)\n');
    }

    const results = [];
    const pageCount = UNCONFIRMED ? 1 : PAGES;
    for (let pg = 1; pg <= pageCount; pg++) {
      await gotoMenu(page, MENU);
      if (pg > 1) { const moved = await page.evaluate((n) => { const el = [...document.querySelectorAll('a,button')].find(a => a.textContent.trim() === String(n) && a.getBoundingClientRect().width > 0); if (el) { el.click(); return true; } return false; }, pg); if (!moved) break; await page.waitForTimeout(3500); }

      const rows = await collectRows(page, UNCONFIRMED);
      // ei = 확인된(eligible) 행 기준 인덱스 — clickDocLink와 정렬 유지
      const eligibleRows = rows.filter(r => UNCONFIRMED ? true : !r.isUnconfirmed).map((r, ei) => ({ ...r, ei }));
      const preTargets = eligibleRows.filter(r => !CASE || r.caseNo.includes(CASE));
      const already = preTargets.filter(r => hasAlready(r.caseNo, r.docName));
      const targets = preTargets.filter(r => !hasAlready(r.caseNo, r.docName));
      const skipped = rows.filter(r => !UNCONFIRMED && r.isUnconfirmed);
      console.log(`\n[${MENU} p${pg}] 대상 ${targets.length}건` + (skipped.length ? `, 미확인 ${skipped.length}건 건너뜀(확인처리 방지)` : '') + (already.length ? `, 기저장 ${already.length}건 건너뜀` : ''));
      skipped.forEach(r => console.log('  ⏭ 미확인 건너뜀:', r.caseNo, r.docName));

      if (DRY) { targets.forEach(r => console.log('  •', r.cols.join(' | '))); continue; }

      for (let i = 0; i < targets.length && results.length < LIMIT; i++) {
        const meta = targets[i];
        const clicked = await clickDocLink(page, meta.ei, UNCONFIRMED);
        if (!clicked) { console.log('  링크 못찾음:', meta.caseNo, meta.docName); continue; }
        const res = await saveViewer(ctx, page, OUTDIR);
        console.log(`  ${res.ok ? '💾' : '⚠'} ${meta.caseNo} ${meta.docName} → ${res.ok ? path.basename(res.file) : res.reason}`);
        results.push({ ...meta, ...res });
      }
    }

    fs.writeFileSync(path.join(OUTDIR, '_saved-index.json'), JSON.stringify(results, null, 2));
    const okN = results.filter(r => r.ok).length;
    console.log(`\n[완료] ${okN}/${results.length}건 저장 → ${OUTDIR}`);
  } catch (e) {
    console.error('[오류]', e.message);
  } finally {
    await browser.close();
  }
})();
