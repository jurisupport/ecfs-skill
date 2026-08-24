// 전자소송 로그인 모듈
// 사용: const { login } = require('./ecfs-login'); const page = await login(browser);

const { secret } = require('./k-secrets');

const ID = secret('ECFS_ID');
const PW = secret('ECFS_CERT_PW');
const CERT_DIR = secret('ECFS_CERT_DIR');
const CERT_FILES = [CERT_DIR + '/signCert.der', CERT_DIR + '/signPri.key'];

async function login(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://ecfs.scourt.go.kr/psp/index.on');
  await page.waitForTimeout(2000);
  await page.click('a:has-text("로그인")');
  await page.waitForTimeout(3000);
  // WebSquare는 실제 키 입력이 있어야 로그인 버튼이 활성화되는데,
  // keyboard.type만으로는 활성화되지 않는 경우가 있어 강제 해제 후 클릭
  await page.click('#mf_pfwork_ibx_elpUserIdForCert');
  await page.keyboard.type(ID, { delay: 50 });
  await page.evaluate(() => {
    const btn = document.getElementById('mf_pfwork_btn_certlogin');
    if (btn) { btn.disabled = false; btn.classList.remove('w2trigger_disabled'); }
  });
  await page.click('#mf_pfwork_btn_certlogin');
  await page.waitForTimeout(5000);

  // ── 검증된 로그인 경로 (macOS + AnySign 로컬 데몬이 포트를 못 여는 환경에서도 동작) ──
  // AnySign 대화상자: '인증서찾기'(xwup_media_memorystorage) 클릭 → 숨은 file input(#xwup_openFile)이 생성됨.
  // 이 input에 NPKI 묶음(signCert.der + signPri.key)을 setInputFiles로 주입하면
  //   → "읽어올 인증서의 암호" 모달(#xwup_inputpasswd_tek_input1)이 뜸
  //   → 암호 입력 후 최상단 '확인' 클릭하면 로그인 완료.
  // ⚠️ '하드디스크'/'브라우저' 저장소나 '인증서찾기' 후 목록 선택 경로는 데몬(wss 14440~14449)이 필요해
  //    이 환경에서는 목록이 비어 실패함. 반드시 file input 직접 주입 경로를 사용할 것.
  await page.evaluate(() => {
    const b = document.getElementById('xwup_media_memorystorage');
    if (b) { b.classList.remove('xwup-rbg-disabled'); b.disabled = false; b.click(); }
  });
  await page.waitForSelector('#xwup_openFile', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#xwup_openFile', CERT_FILES);

  // "읽어올 인증서의 암호" 모달 대기 → 암호 입력
  await page.waitForSelector('#xwup_inputpasswd_tek_input1', { state: 'visible', timeout: 15000 });
  await page.click('#xwup_inputpasswd_tek_input1');
  await page.keyboard.type(PW, { delay: 50 });
  await page.waitForTimeout(500);

  // 화면에 보이는 '확인' 버튼 중 최상단(모달 내부) 클릭
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, input[type=button]')]
      .filter(b => { const t = (b.textContent || b.value || '').trim(); const r = b.getBoundingClientRect(); return t === '확인' && r.width > 0 && r.height > 0; })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (btns[0]) btns[0].click();
  });
  await page.waitForTimeout(8000);

  return page;
}

module.exports = { login };
