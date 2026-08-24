// 전자소송 미확인 송달문서 자동 취득 (유형 선별)
// 사용: node ecfs-auto-fetch.js [--dry]
//
// 안전원칙 (사용자 확정 정책, 2026-07-04):
//   - 미확인 문서를 여는 순간 '송달 확인' 처리되어 불복·이의·보정 기간이 기산된다.
//   - 따라서 기간 기산과 무관한 유형만 자동 열람하고, 나머지는 텔레그램 알림만 보낸다.
//   - SAFE 판정: ① '부본' 포함 && '소장' 미포함 (상대방 서면 부본)
//               ② 기일통지서·변경기일통지서·기일변경명령·증거설명서·사실조회회신/회보
//   - 그 외 전부 UNSAFE (판결·결정·명령·조서·지급명령·이행권고·소장부본 등) → 열지 않음.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');

const DRY = process.argv.includes('--dry');

const TELEGRAM_ENV = path.join(os.homedir(), '.claude/channels/telegram/.env');
const { secret } = require('./k-secrets');
// 송달문서 저장 폴더: 환경변수/금고 ECFS_DELIVERY_DIR → 기본 ~/ecfs-delivery
const OUTDIR = secret('ECFS_DELIVERY_DIR', path.join(os.homedir(), 'ecfs-delivery'));
const CHAT_ID = secret('TELEGRAM_CHAT_ID');

fs.mkdirSync(OUTDIR, { recursive: true });

const SAFE_RULES = [
  (n) => n.includes('부본') && !n.includes('소장'),
  (n) => /기일통지서|변경기일통지|기일변경명령|증거설명서|사실조회.*(회신|회보)/.test(n),
];
const isSafe = (docName) => SAFE_RULES.some((r) => r(docName));

function tgToken() {
  const env = fs.readFileSync(TELEGRAM_ENV, 'utf8');
  const m = env.match(/TELEGRAM_BOT_TOKEN=(\S+)/);
  if (!m) throw new Error('텔레그램 토큰 없음');
  return m[1];
}

function tgSend(text) {
  try {
    execFileSync('curl', ['-s', '-X', 'POST',
      `https://api.telegram.org/bot${tgToken()}/sendMessage`,
      '-d', `chat_id=${CHAT_ID}`, '--data-urlencode', `text=${text}`], { timeout: 30000 });
  } catch (e) { console.error('[텔레그램 실패]', e.message); }
}

function tgSendFile(filePath, caption) {
  try {
    execFileSync('curl', ['-s', '-X', 'POST',
      `https://api.telegram.org/bot${tgToken()}/sendDocument`,
      '-F', `chat_id=${CHAT_ID}`, '-F', `document=@${filePath}`,
      '-F', `caption=${(caption || '').slice(0, 1000)}`], { timeout: 120000 });
  } catch (e) { console.error('[텔레그램 파일 실패]', e.message); }
}

async function gotoUnconfirmed(page) {
  await page.hover('text=나의전자소송').catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { for (const a of document.querySelectorAll('a')) if (a.textContent.trim() === '미확인송달문서' && a.getBoundingClientRect().width > 0) { a.click(); return; } });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { for (const b of document.querySelectorAll('input[type=button],button,a')) { const t = (b.textContent || b.value || '').trim(); if (t === '조회' && b.getBoundingClientRect().width > 0) { b.click(); return; } } });
  await page.waitForTimeout(4000);
}

function collectRows(page) {
  return page.evaluate(() => {
    const out = [];
    const trs = [...document.querySelectorAll('table tr')];
    trs.forEach((tr) => {
      const c = [...tr.querySelectorAll('td')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      if (c.length < 6 || !c.some((x) => /\d{4}[가-힣]/.test(x))) return;
      const caseNo = (tr.textContent.match(/\d{4}[가-힣]+\d+/) || [])[0] || '';
      const tds = [...tr.querySelectorAll('td')];
      const a = tds[5] && tds[5].querySelector('a');
      const docName = a ? a.textContent.trim() : (c[5] || '');
      out.push({ caseNo, docName, cols: c.filter(Boolean).slice(0, 7) });
    });
    return out;
  });
}

// caseNo+docName의 occurrence번째 행 링크 클릭 (인덱스 밀림 방지)
function clickDoc(page, caseNo, docName, occurrence) {
  return page.evaluate(({ caseNo, docName, occurrence }) => {
    let seen = 0;
    const trs = [...document.querySelectorAll('table tr')];
    for (const tr of trs) {
      if (!tr.textContent.includes(caseNo)) continue;
      const tds = [...tr.querySelectorAll('td')];
      const a = tds[5] && tds[5].querySelector('a');
      if (!a || a.textContent.trim() !== docName) continue;
      if (seen++ === occurrence) { a.click(); return true; }
    }
    return false;
  }, { caseNo, docName, occurrence });
}

async function saveViewer(ctx, listPage) {
  // 뷰어 팝업이 클릭과 동시에(동기) 열리면 waitForEvent가 이벤트를 놓친다 (2026-08-14 확인)
  let viewer = ctx.pages().find(p => p !== listPage && !p.isClosed());
  if (!viewer) viewer = await ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  if (!viewer) return { ok: false, reason: '뷰어 안뜸' };
  await viewer.waitForLoadState('domcontentloaded').catch(() => {});
  // 파일저장 버튼이 뜰 때까지 최대 20초 대기
  for (let w = 0; w < 10; w++) {
    const ready = await viewer.evaluate(() => !!(document.getElementById('mf_btn_save') || [...document.querySelectorAll('button,input[type=button],a')].find((x) => (x.textContent || x.value || '').trim() === '파일저장'))).catch(() => false);
    if (ready) break;
    await viewer.waitForTimeout(2000);
  }
  await viewer.waitForTimeout(1500);
  let saved = null;
  const done = new Promise((res) => {
    viewer.on('download', async (d) => {
      const fn = path.join(OUTDIR, d.suggestedFilename() || 'doc.pdf');
      await d.saveAs(fn).catch(() => {});
      saved = fn; res();
    });
    setTimeout(res, 12000);
  });
  await viewer.evaluate(() => { const b = document.getElementById('mf_btn_save') || [...document.querySelectorAll('button,input[type=button],a')].find((x) => (x.textContent || x.value || '').trim() === '파일저장'); if (b) b.click(); });
  await done;
  await viewer.close().catch(() => {});
  await listPage.waitForTimeout(1500);
  return { ok: !!saved, file: saved };
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    const ctx = browser.contexts()[0];
    console.log('[✓] 로그인');

    await gotoUnconfirmed(page);
    const rows = await collectRows(page);
    console.log(`[미확인송달문서] ${rows.length}건`);

    if (rows.length === 0) {
      if (!DRY) tgSend('📭 전자소송 송달 알림을 받았지만 현재 미확인 송달문서가 없습니다. (이미 열람되었거나 등재 지연)');
      return;
    }

    const safe = rows.filter((r) => isSafe(r.docName));
    const unsafe = rows.filter((r) => !isSafe(r.docName));

    if (DRY) {
      console.log('--dry 모드:');
      safe.forEach((r) => console.log('  [자동열람 대상]', r.caseNo, r.docName));
      unsafe.forEach((r) => console.log('  [알림만]', r.caseNo, r.docName));
      return;
    }

    const saved = [], failed = [];
    const occCounter = {};
    for (const r of safe) {
      const key = r.caseNo + '|' + r.docName;
      const occ = occCounter[key] || 0;
      occCounter[key] = occ + 1;
      const clicked = await clickDoc(page, r.caseNo, r.docName, occ);
      if (!clicked) { failed.push({ ...r, reason: '링크 못찾음' }); continue; }
      const res = await saveViewer(ctx, page);
      if (res.ok) { saved.push({ ...r, file: res.file }); console.log('  💾', r.caseNo, r.docName, '→', path.basename(res.file)); }
      else { failed.push({ ...r, reason: res.reason || '저장 실패' }); console.log('  ⚠', r.caseNo, r.docName, res.reason); }
    }

    // 인덱스 누적
    const idxFile = path.join(OUTDIR, '_auto-index.json');
    const prev = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
    prev.push(...saved.map((s) => ({ ...s, at: new Date().toISOString() })));
    fs.writeFileSync(idxFile, JSON.stringify(prev, null, 2));

    // 텔레그램 요약
    const lines = ['📬 전자소송 송달문서 자동 점검 결과'];
    if (saved.length) {
      lines.push('', `✅ 자동 열람·저장 ${saved.length}건 → 작성서류/송달문서`);
      saved.forEach((s) => lines.push(`  • ${s.caseNo} ${s.docName}`));
    }
    if (failed.length) {
      lines.push('', `⚠ 저장 실패 ${failed.length}건 (수동 확인 필요)`);
      failed.forEach((f) => lines.push(`  • ${f.caseNo} ${f.docName} (${f.reason})`));
    }
    if (unsafe.length) {
      lines.push('', `🔒 미열람 유지 ${unsafe.length}건 — 열람 시 송달확인 처리되어 기간이 기산되므로 열지 않았습니다. 열람하려면 지시해 주세요.`);
      unsafe.forEach((u) => lines.push(`  • ${u.caseNo} ${u.docName}`));
    }
    tgSend(lines.join('\n'));
    for (const s of saved) tgSendFile(s.file, `${s.caseNo} ${s.docName}`);

    // 저장분을 _송달문서.db에 반영 (link-files → have-json). 실패해도 본 흐름은 유지.
    if (saved.length) {
      try {
        execFileSync('/usr/bin/python3', [path.join(__dirname, 'ecfs-delivery-db.py'), 'link-files'], { timeout: 30000 });
        execFileSync('/usr/bin/python3', [path.join(__dirname, 'ecfs-delivery-db.py'), 'have-json'], { timeout: 30000 });
      } catch (e) { console.error('[DB 동기화 실패]', e.message); }
    }

    console.log(`[완료] 저장 ${saved.length}, 실패 ${failed.length}, 미열람 유지 ${unsafe.length}`);
  } catch (e) {
    console.error('[오류]', e.message);
    tgSend(`❌ 전자소송 자동 점검 오류: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
