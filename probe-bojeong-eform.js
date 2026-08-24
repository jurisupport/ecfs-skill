// 보정서 이폼(전자문서작성) 화면 구조 탐색 — 파일모드로 전환하지 않음
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const { findCase, openSubmission, selectDocType, screenshot, dismissModal } = require('./ecfs-utils');

const COURT = process.argv[2] || "의정부지법 남양주지원";
const CASE_NUM = process.argv[3] || "20XX가소XXXX";
const SHOT = "/tmp/ecfs-cwbc";

(async () => {
  const fs = require('fs'); fs.mkdirSync(SHOT, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[1] 로그인');
    const menuBtnId = await findCase(page, COURT, CASE_NUM);
    console.log('[2] 사건 찾기');
    await openSubmission(page, menuBtnId, CASE_NUM);
    console.log('[3] 소송서류제출 진입');
    // 서류유형 목록 덤프 — 정확한 명칭 확인용
    const types = await page.evaluate(() => [...document.querySelectorAll('a')]
      .filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.top > 300; })
      .map(a => a.textContent.trim()).filter(t => t && t.length < 40));
    console.log('=== 서류유형 후보 ===');
    console.log(JSON.stringify(types.filter(t => /청구|변경|취지|원인/.test(t))));
    console.log('ALL_TYPES:' + JSON.stringify(types));
    await selectDocType(page, process.argv[4] || '청구취지원인변경신청서');
    console.log('[4] 서류유형 선택 완료 (이폼 기본화면)');
    await page.waitForTimeout(3000);
    await dismissModal(page);
    await page.screenshot({ path: SHOT + '/eform-full.png', fullPage: true });

    // 입력 요소 덤프 (문서작성 영역)
    const fields = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('input, textarea, select, iframe, [contenteditable="true"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.top < 200) continue;
        const type = el.type || el.tagName.toLowerCase();
        if (['hidden'].includes(type)) continue;
        // 라벨 추정
        let label = '';
        if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.textContent.trim(); }
        if (!label) { const th = el.closest('td,div')?.previousElementSibling; if (th) label = (th.textContent||'').trim().slice(0,30); }
        out.push({ tag: el.tagName.toLowerCase(), type, id: el.id, name: el.name||'', label: label.slice(0,40), top: Math.round(r.top), w: Math.round(r.width) });
      }
      return out.sort((a,b)=>a.top-b.top);
    });
    console.log('=== 입력 요소 ('+fields.length+') ===');
    fields.forEach(f => console.log(`  [${f.type}] #${f.id} name=${f.name} "${f.label}" top=${f.top} w=${f.w}`));

    // 에디터(iframe) 존재?
    const editors = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f=>({id:f.id, src:(f.src||'').slice(0,60), w:Math.round(f.getBoundingClientRect().width)})).filter(f=>f.w>100));
    console.log('=== iframe 에디터 ===', JSON.stringify(editors));

    // 버튼들
    const btns = await page.evaluate(() => [...document.querySelectorAll('button,input[type=button]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.top>200;}).map(b=>({id:b.id,t:(b.textContent||b.value||'').trim().slice(0,20)})).filter(b=>b.t));
    console.log('=== 버튼 ===');
    btns.forEach(b=>console.log(`  "${b.t}" #${b.id}`));

    console.log('스크린샷:', SHOT + '/eform-full.png');
  } catch (e) { console.error('ERROR:', e.message); await browser.contexts().flatMap(c=>c.pages())[0]?.screenshot({path:SHOT+'/err.png',fullPage:true}).catch(()=>{}); }
  finally { await browser.close(); }
})();
