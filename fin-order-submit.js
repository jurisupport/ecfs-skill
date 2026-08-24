// 금융거래정보 제출명령 신청서(서술형) 이폼 자동작성
//   1.문서작성 → 작성완료 → 2.최종문서확인 [→ --confirm 시 확인완료 → 3.전자서명 대기]
//   전자서명·전자제출은 하지 않는다.
// usage: node fin-order-submit.js <payloads.json> <no1,no2,..> [--confirm]
//
// ⚠️ 핵심: 이 이폼의 입력은 el.value= 로는 WebSquare 데이터모델에 반영되지 않아
//    작성완료 시 "필수 입력입니다" 검증에 막힌다. 반드시 $w.getComponentById(id).setValue() 사용.
//    대상기관 명칭/우편번호/기본주소는 DOM상 disabled(조회 전용)이지만 setValue는 정상 반영된다.
//    (조회 팝업의 기관 DB에는 시중은행 본점이 없어 조회 경로로는 작성 불가)
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const { findCase, openSubmission, selectDocType, dismissModal } = require('./ecfs-utils');
const fs = require('fs');

const COURT = '○○가정법원', CASE = '20XX느합XXXX';   // ← 사건에 맞게 수정
const P = 'mf_pfwork_wfm_finDlngInfSbmsnOrdAplfrm_';
const SHOT = '/tmp/ecfs-fin';
const APPLY_INTNT = '위 사건에 관하여 청구인은 주장사실을 증명하기 위하여 다음과 같이 금융거래정보제출명령을 신청합니다.';

const payloads = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = (process.argv[3] || '').split(',').filter(Boolean);
const CONFIRM = process.argv.includes('--confirm');
const targets = only.length ? payloads.filter(p => only.includes(p.no)) : payloads;

const wsSet = (page, key, val) => page.evaluate(({ id, val }) => {
  const c = $w.getComponentById(id);
  if (!c) return 'NOCOMP';
  c.setValue(val);
  return String(c.getValue() ?? '');
}, { id: P + key, val });

// 작성완료 화면에서 같은 탭을 재사용하면 이후 조작이 전부 막힌다(hover 타임아웃).
// 세션(컨텍스트)은 유지한 채 탭만 새로 열어 홈에서 다시 시작한다.
async function freshTab(context, oldPage) {
  const page = await context.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  try { await oldPage.close({ runBeforeUnload: false }); } catch (e) {}
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto('https://ecfs.scourt.go.kr/psp/index.on', { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) { console.log('  goto 실패:', e.message.split('\n')[0]); }
    await page.waitForTimeout(6000);
    const n = await page.locator('text=나의전자소송').count().catch(() => 0);
    if (n) return page;
    const st = await page.evaluate(() => ({ url: location.href, t: document.body.innerText.replace(/\s+/g,' ').slice(0, 200) })).catch(() => ({url:'?',t:'?'}));
    console.log(`  탭 준비 재시도 ${i+1} — url=${st.url} body="${st.t}"`);
    await page.screenshot({ path: SHOT + '/tab-retry.png', fullPage: false }).catch(()=>{});
  }
  return page;
}

async function fillOne(page, p) {
  const log = (...a) => console.log(`  [${p.no}]`, ...a);
  const zip = (p.addr.match(/\((\d{5})\)/) || [])[1] || '';
  const bas = p.addr.replace(/\(\d{5}\)\s*/, '').trim();
  const set = async (k, v) => {
    const got = await wsSet(page, k, v);
    if (got === 'NOCOMP') throw new Error('컴포넌트 없음: ' + k);
    if (got !== String(v)) log(`  ⚠️ ${k} 값 불일치 (기대 ${String(v).length}자 / 실제 ${got.length}자)`);
    return got;
  };

  await set('txt_aplyIntnt', APPLY_INTNT);
  await set('txt_trgtInstnNm', p.inst);
  await set('txt_trgtInstnZpcd', zip);
  await set('txt_trgtInstnBasAddr', bas);
  log('대상기관:', p.inst, '/', zip, bas);

  await page.evaluate(p => document.getElementById(p + 'rad_inptMeansCd_input_1').click(), P);
  await page.waitForTimeout(2200);

  await set('txt_nmnrHmnMtr', p.nmnr);
  await set('cal_demnTrgtPerdBgng', p.beg.replace(/\./g, ''));
  await set('cal_demnTrgtPerdEnd', p.end.replace(/\./g, ''));
  await set('txt_usePurp', p.purp);
  await set('txt_demnInfCtt', p.req);
  log(`거래기간 ${p.beg}~${p.end} / 사용목적 ${p.purpB}B / 요구내용 ${p.reqB}B`);

  await dismissModal(page);
  await page.screenshot({ path: `${SHOT}/${p.no}-1-form.png`, fullPage: true });

  // 작성완료
  await page.evaluate(() => document.getElementById('mf_pfwork_btn_wrtCmptn').click());
  await page.waitForTimeout(8000);
  const alerts = await page.evaluate(() => [...document.querySelectorAll('[class*="w2modal"],[id*="alert"]')]
    .filter(e => e.getBoundingClientRect().height > 0)
    .map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(t => t && t.length < 120));
  if (alerts.length) log('⚠️ 작성완료 알림:', JSON.stringify(alerts));
  await dismissModal(page);
  await page.waitForTimeout(3000);

  const onFinal = await page.evaluate(() => !document.getElementById('mf_pfwork_btnTmpSave')
    && (document.getElementById('mf_pfwork')?.innerText || '').includes('모든 문서의 내용에 이상이 없음'));
  await page.screenshot({ path: `${SHOT}/${p.no}-2-final.png`, fullPage: true });
  if (!onFinal) { log('❌ 최종문서확인 진입 실패'); return 'complete-fail'; }
  log('✅ 2.최종문서확인 도달');
  if (!CONFIRM) return 'final-review';

  // 확인완료 → 3.전자서명 (제출대기목록으로 이동)
  await page.evaluate(() => {
    const cb = document.getElementById('mf_pfwork_cbx_confirm_input_0');
    if (cb && !cb.checked) cb.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button,input[type=button],a'))
      if ((b.textContent || b.value || '').trim() === '확인완료' && b.getBoundingClientRect().width > 0) { b.click(); return; }
  });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {   // [인증서] 설치 모달은 '아니요'
    for (const b of document.querySelectorAll('button,input[type=button],a'))
      if (/^아니(요|오)$/.test((b.textContent || b.value || '').trim()) && b.getBoundingClientRect().width > 0) { b.click(); return; }
  });
  await page.waitForTimeout(3000);
  const step = await page.evaluate(() => (document.getElementById('mf_pfwork')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: `${SHOT}/${p.no}-3-sign.png`, fullPage: true });
  log('확인완료 후 화면:', step.slice(0, 120));
  return 'ready-to-sign';
}

(async () => {
  fs.mkdirSync(SHOT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const results = [];
  try {
    let page = await login(browser);
    const context = page.context();
    page.on('dialog', d => d.accept().catch(() => {}));
    console.log('[로그인 완료]');
    for (const p of targets) {
      console.log(`\n=== ${p.no} ${p.inst} ===`);
      try {
        const btn = await findCase(page, COURT, CASE);
        await openSubmission(page, btn, CASE);
        await selectDocType(page, '금융거래정보 제출명령 신청서');
        await page.waitForTimeout(3500);
        await dismissModal(page);
        if (!(await page.evaluate(p => !!document.getElementById(p + 'txt_aplyIntnt'), P)))
          throw new Error('이폼 진입 실패');
        results.push([p.no, p.inst, await fillOne(page, p)]);
      } catch (e) {
        console.log('  ❌ 오류:', e.message.split('\n')[0]);
        results.push([p.no, p.inst, 'ERR:' + e.message.split('\n')[0]]);
      }
      try { page = await freshTab(context, page); }
      catch (e) { console.log('  ⚠️ 새 탭 준비 실패:', e.message.split('\n')[0]); }
    }
    console.log('\n=== 결과 ===');
    results.forEach(r => console.log(`  ${r[0]} ${r[1]} → ${r[2]}`));
    console.log('ALL_DONE');
  } catch (e) { console.error('FATAL:', e.message); }
  if (process.argv.includes('--close')) { try { await browser.close(); } catch (e) {} }
})();
