#!/usr/bin/env node
// 전자소송 소송비용납부(가상계좌 발급): 폼작성 → 엄격검증 → (--confirm 시에만) 발급
//
// 사용:
//   node ecfs-cost-pay.js <법원명> <사건번호> --stamp 769500 --delivery 169200 --phone 010-0000-0000 [--bank 신한은행] [--out DIR] [--confirm]
//
// 기본은 미제출(dry): 폼만 채우고 검증 결과 + 캡처만 남긴다. 금액 확인 후 --confirm 으로 재실행해 발급.
// ⚠️ 납부버튼 = '가상계좌 발급'(실제 송금 아님). 금액이 틀리면 미납 방치 후 재발급하면 된다.

const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const { findCase, dismissModal } = require('./ecfs-utils');
const fs = require('fs');

const ID = {
  가상계좌라디오: 'mf_pfwork_rad_vtAcnt_input_0',
  인지체크: 'mf_pfwork_cbx_stmpAmt_input_0',
  인지금액: 'mf_pfwork_ibx_stmpAmt',
  인지계좌확인: 'mf_pfwork_btn_stmpAmtAcntIdnty',
  인지환급은행: 'mf_pfwork_sbx_stmpRfdactBankCd',
  송달체크: 'mf_pfwork_cbx_dlvrf_input_0',
  인지환급계좌동일: 'mf_pfwork_cbx_dlvrf_input_1',
  송달금액: 'mf_pfwork_ibx_dlvrf',
  송달계좌확인: 'mf_pfwork_btn_dlvrfAcntIdnty',
  휴대폰1: 'mf_pfwork_sbx_mblTelno1',
  휴대폰2: 'mf_pfwork_ibx_mblTelno2',
  휴대폰3: 'mf_pfwork_ibx_mblTelno3',
  환급통지_문자: 'mf_pfwork_rad_rfndAvtsmtMeansCd_input_0',
  환급통지_카톡: 'mf_pfwork_rad_rfndAvtsmtMeansCd_input_1',
  환급통지_우편: 'mf_pfwork_rad_rfndAvtsmtMeansCd_input_2',
  가상계좌은행: 'mf_pfwork_sbx_vtulAcntIssuBankCd',
  납부버튼: 'mf_pfwork_btn_lwstCstPay',
  메뉴_소송비용납부: 'mf_pfwork_PSP221P02_wframe_btn_lwstCstPay',
  납부인선택: 'mf_pfwork_btn_payrNm',
  납부인팝업: 'mf_pfwork_PSP513P02',
  납부인확인: 'mf_pfwork_PSP513P02_wframe_btn_ok',
};

const dg = (s) => String(s ?? '').replace(/[^0-9]/g, '');
const clickId = (p, id) => p.evaluate((id) => { const e = document.getElementById(id); if (e) { e.click(); return 'ok'; } return 'no-el'; }, id);
const readVal = (p, id) => p.evaluate((id) => { const e = document.getElementById(id); return e ? (e.value ?? e.checked) : null; }, id);
const readSel = (p, id) => p.evaluate((id) => { const e = document.getElementById(id); return e ? e.options[e.selectedIndex]?.textContent.trim() : null; }, id);
const readTotal = (p) => p.evaluate(() => {
  const bt = document.body.innerText.replace(/\s+/g, ' ');
  return (bt.match(/인지액[0-9,]+원송달료[0-9,]+원법원보관금[0-9,]+원 총 납부금액 :[0-9,]+원/) || [])[0] || '';
});
const selectByText = (p, id, text) => p.evaluate(({ id, text }) => {
  const s = document.getElementById(id); if (!s) return 'no-el';
  const o = [...s.options].find(x => x.textContent.trim() === text);
  if (!o) return 'no-opt';
  s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok';
}, { id, text });

// ⚠️ 금액칸 입력의 유일한 안전 경로.
//  - Backspace로 비우면 WebSquare가 '0'을 자동삽입하고 커서가 그 '앞'에 놓여 뒤에 0이 남는다 → 10배 사고
//  - macOS 전체선택은 Control+A가 아니라 Meta+A(Cmd+A)
//  - el.value= 로는 합계(총 납부금액) 재계산이 안 걸린다 → 실제 키보드 타이핑 필수
async function amtSet(page, id, val) {
  const el = await page.$('#' + id);
  if (!el) return 'no-el';
  for (let i = 0; i < 3; i++) {
    await el.click();
    await page.keyboard.press('Meta+A');
    await page.waitForTimeout(150);
    await page.keyboard.type(val, { delay: 70 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(900);
    await dismissModal(page);
    const cur = await readVal(page, id);
    if (dg(cur) === val) return cur;
    console.log(`   재시도(${i + 1}) ${id}: ${cur}`);
  }
  return readVal(page, id);
}

// 화면에 떠 있는 모달/팝업의 텍스트를 읽는다.
// ⚠️ dismissModal은 경고문("납부인을 선택해 주십시오" 등)을 조용히 닫아버리므로,
//    납부 클릭 직후에는 반드시 이걸로 문구를 먼저 읽고 나서 닫을 것.
async function readModals(page) {
  return page.evaluate(() => {
    const out = [];
    for (const w of document.querySelectorAll('.w2window, .w2modal, [class*="popup"]')) {
      const r = w.getBoundingClientRect();
      if (r.width < 150 || r.height < 40) continue;
      const t = (w.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t.slice(0, 300));
    }
    return out;
  });
}

// 납부인선택 팝업: 라디오로 납부인 지정 → 확인 → (등록하시겠습니까?) 예
// 팝업은 열자마자 목록이 채워져 있어 조회 버튼이 필요 없다(2026-07-16 확인).
async function selectPayer(page, payerName) {
  await clickId(page, ID.납부인선택);
  await page.waitForTimeout(4000);

  const picked = await page.evaluate((name) => {
    const w = document.getElementById('mf_pfwork_PSP513P02');
    if (!w) return 'no-popup';
    const rows = [...w.querySelectorAll('tr')];
    const tr = rows.find(r => r.textContent.includes(name) && r.querySelector('input[type="radio"]'));
    if (!tr) return 'no-row:' + rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6).join(' | ');
    tr.querySelector('input[type="radio"]').click();
    return 'picked';
  }, payerName);
  console.log('납부인 선택:', payerName, '→', picked);
  if (picked !== 'picked') return picked;

  await page.waitForTimeout(1200);
  await clickId(page, ID.납부인확인);
  await page.waitForTimeout(2500);

  // "등록하시겠습니까?" → 예
  const yes = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button, input[type="button"]')) {
      const t = (b.textContent || b.value || '').trim();
      if (t === '예' && b.getBoundingClientRect().width > 0) { b.click(); return true; }
    }
    return false;
  });
  console.log('납부인 등록 예:', yes);
  await page.waitForTimeout(2500);
  await dismissModal(page);
  return 'ok';
}

function parseArgs(argv) {
  const pos = [], a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const n = k.slice(2), nx = argv[i + 1];
      if (!nx || nx.startsWith('--')) a[n] = true; else { a[n] = nx; i++; }
    } else pos.push(k);
  }
  return { pos, a };
}

(async () => {
  const { pos, a } = parseArgs(process.argv);
  const [court, caseNo] = pos;
  if (!court || !caseNo || !a.stamp || !a.delivery || !a.phone) {
    console.log('사용: node ecfs-cost-pay.js <법원명> <사건번호> --stamp <인지액> --delivery <송달료> --phone 010-0000-0000 [--bank 신한은행] [--out DIR] [--confirm]');
    process.exit(1);
  }
  const STAMP = dg(a.stamp), DELIVERY = dg(a.delivery);
  const TOTAL = String(Number(STAMP) + Number(DELIVERY));
  const BANK = a.bank || '신한은행';
  const [p1, p2, p3] = String(a.phone).split('-');
  const OUT = a.out || '/tmp/ecfs-cost';
  const CONFIRM = !!a.confirm;
  const PAYER = a.payer || '원고대리인';

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('로그인 완료');
    const mb = await findCase(page, court, caseNo);
    await page.click('#' + mb); await page.waitForTimeout(3000);
    await clickId(page, ID.메뉴_소송비용납부);
    await page.waitForTimeout(7000); await dismissModal(page);
    console.log('납부화면 진입 / 가상계좌 선택:', await readVal(page, ID.가상계좌라디오));

    // 인지
    await clickId(page, ID.인지체크); await page.waitForTimeout(2000); await dismissModal(page);
    console.log('인지 환급계좌(프로필 자동):', await readSel(page, ID.인지환급은행));
    console.log('인지 금액:', await amtSet(page, ID.인지금액, STAMP));
    await clickId(page, ID.인지계좌확인); await page.waitForTimeout(3000); await dismissModal(page); await page.waitForTimeout(700);

    // 납부인(대리인이 납부하는 경우 필수 — 미입력 시 납부버튼이 조용히 무시된다)
    await selectPayer(page, PAYER);

    // 송달료
    await clickId(page, ID.송달체크); await page.waitForTimeout(1500); await dismissModal(page);
    await clickId(page, ID.인지환급계좌동일); await page.waitForTimeout(1500); await dismissModal(page);
    console.log('송달 금액:', await amtSet(page, ID.송달금액, DELIVERY));
    await selectByText(page, ID.휴대폰1, p1);
    await amtSet(page, ID.휴대폰2, p2);
    await amtSet(page, ID.휴대폰3, p3);
    await clickId(page, ID.송달계좌확인); await page.waitForTimeout(3000); await dismissModal(page); await page.waitForTimeout(700);

    // 환급통지 카카오톡 + 가상계좌 은행
    await clickId(page, ID.환급통지_카톡); await page.waitForTimeout(600);
    console.log('가상계좌 은행:', await selectByText(page, ID.가상계좌은행, BANK), BANK);
    await page.waitForTimeout(1200); await dismissModal(page);

    // ── 엄격 검증 (하나라도 어긋나면 발급 금지) ──
    const st = await readVal(page, ID.인지금액);
    const dl = await readVal(page, ID.송달금액);
    const tot = await readTotal(page);
    const totNum = (tot.match(/총 납부금액 :([0-9,]+)원/) || [])[1];
    const checks = [
      ['인지액', dg(st) === STAMP, st],
      ['송달료', dg(dl) === DELIVERY, dl],
      ['총액', dg(totNum) === TOTAL, totNum],
      ['가상계좌은행', (await readSel(page, ID.가상계좌은행)) === BANK, BANK],
      ['환급통지 카카오톡', ['on', true].includes(await readVal(page, ID.환급통지_카톡)), 'on'],
    ];
    console.log('\n===== 검증 =====');
    let pass = true;
    for (const [k, ok, v] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${k}: ${v}`); if (!ok) pass = false; }
    console.log('합계표시:', tot);

    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/pay_1.png' });
    for (let i = 2; i <= 5; i++) { await page.evaluate(() => window.scrollBy(0, 620)); await page.waitForTimeout(500); await page.screenshot({ path: OUT + `/pay_${i}.png` }); }

    if (!pass) { console.log('\n!!! 검증 실패 → 발급하지 않고 중단. 캡처:', OUT); return; }
    if (!CONFIRM) {
      console.log(`\n✅ 검증 통과 (총 ${Number(TOTAL).toLocaleString('ko-KR')}원). 미제출(dry) 모드 — 발급 안 함.`);
      console.log('   금액 확인 후 발급하려면 같은 명령에 --confirm 을 붙여 재실행.');
      console.log('   캡처:', OUT);
      return;
    }

    console.log('\n검증 통과 + --confirm → 소송비용납부(가상계좌 발급) 클릭');
    await clickId(page, ID.납부버튼);
    await page.waitForTimeout(3000);

    // ⚠️ 클릭 직후 뜬 모달 문구를 '먼저 읽는다'. 그냥 dismissModal로 닫으면
    //    "납부인을 선택해 주십시오" 같은 거절 사유가 사라져 실패를 성공으로 오인한다.
    const modals = await readModals(page);
    if (modals.length) console.log('클릭 후 모달:', JSON.stringify(modals, null, 1));
    for (let i = 0; i < 3; i++) { await dismissModal(page); await page.waitForTimeout(1500); }
    await page.waitForTimeout(6000);

    await page.screenshot({ path: OUT + '/issued.png', fullPage: true });
    const bodyText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(OUT + '/issued.txt', bodyText);

    // 발급 성공이면 폼을 벗어나 가상계좌번호가 찍힌다. 폼 안내문이 그대로면 거절된 것.
    const stillForm = bodyText.includes('납부버튼을 누르면 다음 화면에서 가상계좌 번호를 확인할 수 있습니다');
    const acct = (bodyText.match(/가상계좌\s*번호\s*([0-9-]{8,})/) || [])[1];
    if (acct) console.log('\n✅ 가상계좌 발급됨:', acct);
    else if (stillForm) console.log('\n❌ 화면이 납부폼에 그대로 = 발급 거절된 것으로 보임(위 모달 문구 확인).');
    else console.log('\n⚠️ 발급 여부 불명 — 화면이 폼도 결과도 아님.');
    console.log('반드시 실제 발급을 조회로 확인할 것:');
    console.log(`   node ecfs-cost-verify.js ${caseNo}`);
  } catch (e) { console.error('ERROR:', e.message, e.stack); }
  finally { await browser.close(); }
})();
