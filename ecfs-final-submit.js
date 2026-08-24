// 준비서면 최종 제출(전자서명+전자제출) 검증된 레퍼런스 — 새 제출은 이 파일을 복사해 사건정보를 수정
// 확인완료된 초안은 작성중서류 > "제출대기목록" 탭에 있음. 거기서 진입 →
// 설치 모달 '아니요' → 문서제출 클릭 → (설치 모달 '아니요') → 웹 인증서창(xwup) 서명 → 결과 확인.
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const { dismissModal, screenshot } = require('./ecfs-utils');

const CASE = 'XXXXXX';   // ← 사건번호 뒷자리
const DOC = '준비서면';   // ← 서류명

const { secret } = require('./k-secrets');

const CERT_DIR = secret('ECFS_CERT_DIR');
const CERT_FILES = [CERT_DIR + '/signCert.der', CERT_DIR + '/signPri.key'];
const CERT_PW = secret('ECFS_CERT_PW');

async function declineInstall(page) {
  const clicked = await page.evaluate(() => {
    const body = document.body.innerText;
    if (!body.includes('설치하시겠습니까')) return false;
    const btns = [...document.querySelectorAll('button, input[type=button]')]
      .filter((b) => { const t = (b.textContent || b.value || '').trim(); const r = b.getBoundingClientRect(); return t === '아니요' && r.width > 0 && r.height > 0; });
    if (btns[0]) { btns[0].click(); return true; }
    return false;
  });
  if (clicked) { console.log('  (설치 모달 → 아니요)'); await page.waitForTimeout(1500); }
  return clicked;
}

async function clickByText(page, texts) {
  return page.evaluate((texts) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const t of texts) {
      const el = [...document.querySelectorAll('button, input[type=button], a')]
        .filter(vis).find((b) => (b.textContent || b.value || '').trim() === t);
      if (el) { el.click(); return t; }
    }
    return null;
  }, texts);
}

async function handleAnySign(page) {
  const appeared = await page.waitForSelector('#xwup_media_memorystorage', { state: 'attached', timeout: 15000 }).catch(() => null);
  if (!appeared) return false;
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const b = document.getElementById('xwup_media_memorystorage');
    if (b) { b.classList.remove('xwup-rbg-disabled'); b.disabled = false; b.click(); }
  });
  await page.waitForSelector('#xwup_openFile', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#xwup_openFile', CERT_FILES);
  await page.waitForSelector('#xwup_inputpasswd_tek_input1', { state: 'visible', timeout: 15000 });
  await page.click('#xwup_inputpasswd_tek_input1');
  await page.keyboard.type(CERT_PW, { delay: 50 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, input[type=button]')]
      .filter((b) => { const t = (b.textContent || b.value || '').trim(); const r = b.getBoundingClientRect(); return t === '확인' && r.width > 0 && r.height > 0; })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (btns[0]) btns[0].click();
  });
  await page.waitForTimeout(8000);
  return true;
}

async function dumpResult(page, tag) {
  const hits = await page.evaluate(() => {
    const lines = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
    return lines.filter((l) => /접수|제출.?(완료|되었습니다)|전자서명/.test(l)).slice(0, 15);
  });
  console.log(`[${tag}]`);
  hits.forEach((l) => console.log('  · ' + l));
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[1] 로그인');

    await page.hover('text=나의전자소송');
    await page.waitForTimeout(1200);
    await page.click('text=작성중서류');
    await page.waitForTimeout(5000);

    // 제출대기목록 탭 클릭
    const tab = await page.evaluate(() => {
      const el = [...document.querySelectorAll('a, button, li, span, div')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .find((e) => /^제출대기목록/.test(e.textContent.trim()) && e.textContent.trim().length < 15);
      if (el) { el.click(); return el.textContent.trim(); }
      return null;
    });
    if (!tab) throw new Error('제출대기목록 탭 못 찾음');
    console.log('[2] 탭 진입: ' + tab);
    await page.waitForTimeout(4000);
    await screenshot(page, '/tmp/ecfs-final-list.png');

    // 해당 사건 행의 문서명 링크 클릭
    const row = page.locator('table tbody tr', { hasText: CASE }).filter({ hasText: DOC }).first();
    if (await row.count() === 0) throw new Error('제출대기목록에 해당 초안 없음 — /tmp/ecfs-final-list.png 확인');
    await row.locator('a', { hasText: DOC }).first().click();
    console.log('[3] 초안 진입 클릭');
    await page.waitForTimeout(8000);

    await declineInstall(page);
    await screenshot(page, '/tmp/ecfs-final-step1.png');

    const hasSubmit = await page.evaluate(() => document.body.innerText.includes('문서제출'));
    console.log('[4] 문서제출 화면 도달: ' + hasSubmit);
    if (!hasSubmit) throw new Error('문서제출 화면이 아님 — v3-step1.png 확인');

    const c = await clickByText(page, ['문서제출']);
    if (!c) throw new Error('문서제출 버튼 못 찾음');
    console.log('[5] 문서제출 클릭');
    await page.waitForTimeout(3000);
    await declineInstall(page);

    const signed = await handleAnySign(page);
    console.log('[6] 인증서 서명: ' + (signed ? 'OK' : '인증서창 안 뜸'));
    await page.waitForTimeout(5000);
    await screenshot(page, '/tmp/ecfs-final-step2.png');

    await dismissModal(page);
    await page.waitForTimeout(5000);
    await screenshot(page, '/tmp/ecfs-final-final.png');
    await dumpResult(page, '결과');
    console.log('[7] 종료 — /tmp/ecfs-final-final.png 확인');

    await page.waitForTimeout(15 * 60 * 1000);
  } catch (e) {
    console.error('Error: ' + e.message);
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages.length) await screenshot(pages[pages.length - 1], '/tmp/ecfs-final-error.png');
    } catch (e2) {}
    console.error('브라우저 유지 중 — 화면에서 수동 마무리 가능');
    await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
  }
})();
