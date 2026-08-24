// 금융거래정보 제출명령 초안 정리 (기본 dry-run, --commit 시 삭제)
const { chromium } = require('playwright');

const CASE_NUM = '20XX느합XXXX';   // ← 사건번호 수정
const { login } = require('./ecfs-login');
const { openDraftList, dismissModal } = require('./ecfs-utils');
const COMMIT = process.argv.includes('--commit');
const KEEP = (process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep')+1] : '').split(',').filter(Boolean);
(async()=>{
  const browser=await chromium.launch({headless:false,channel:'chrome'});
  try{
    const page=await login(browser);
    page.on('dialog',d=>d.accept().catch(()=>{}));
    await openDraftList(page);
    await page.waitForTimeout(3000);
    // 한 페이지에 최대한 많이 보이게
    await page.evaluate(() => {
      for (const sel of document.querySelectorAll('select')) {
        const o = [...sel.options].find(o => /100개씩|50개씩/.test(o.text));
        if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', {bubbles:true})); return; }
      }
    });
    await page.waitForTimeout(3000);
    // 그리드 전체 덤프 (WebSquare grid cell id 패턴 탐색)
    const dump=await page.evaluate(()=>{
      const gid=[...document.querySelectorAll('[id*="grd_"]')].map(e=>e.id)
        .filter(i=>/_main_div$|^mf_pfwork.*grd_[A-Za-z]+$/.test(i));
      const rows=[];
      for (const tr of document.querySelectorAll('tr')) {
        const t=(tr.innerText||'').replace(/\s+/g,' ').trim();
        if (t.length>10 && /\d{4}[가-힣]/.test(t)) rows.push(t.slice(0,140));
      }
      const pager=[...document.querySelectorAll('a,button')]
        .filter(e=>/^\d+$|다음|끝/.test((e.innerText||'').trim()) && e.getBoundingClientRect().width>0)
        .map(e=>(e.innerText||'').trim()).slice(0,15);
      return {gids:gid.slice(0,8), rows, pager, tabs:[...document.querySelectorAll('[id*="tab_tmpr"],[id*="tab_sbmsn"]')].map(e=>e.innerText.trim()).slice(0,4)};
    });
    console.log('탭:',JSON.stringify(dump.tabs));
    console.log('grid ids:',JSON.stringify(dump.gids));
    console.log('페이저:',JSON.stringify(dump.pager));
    console.log('=== 행 ('+dump.rows.length+') ===');
    dump.rows.forEach(r=>console.log('  '+r));
    await page.screenshot({path:'/tmp/ecfs-fin/drafts.png',fullPage:true});

    for (let round = 0; COMMIT && round < 6; round++) {
      const info=await page.evaluate((KEEP)=>{
        let n=0; const hit=[];
        for(const tr of document.querySelectorAll('tr')){
          const t=tr.innerText||'';
          if(t.includes(CASE_NUM)&&t.includes('금융거래정보')&&!KEEP.some(k=>t.includes(k))){
            const cb=tr.querySelector('input[type=checkbox]');
            if(cb&&!cb.checked){cb.click();n++;}
            hit.push(t.replace(/\s+/g,' ').trim().slice(0,100));
          }
        }
        return {n,hit};
      }, KEEP);
      console.log('체크됨:',info.n,JSON.stringify(info.hit));
      if(info.n){
        await page.evaluate(()=>{for(const b of document.querySelectorAll('button,input[type=button],a')){
          const x=(b.textContent||b.value||'').trim();
          if(x==='선택항목삭제'&&b.getBoundingClientRect().width>0){b.click();return;}}});
        await page.waitForTimeout(2000);
        await page.evaluate(()=>{for(const b of document.querySelectorAll('button,input[type=button],a')){
          const x=(b.textContent||b.value||'').trim();
          if(/^(예|확인)$/.test(x)&&b.getBoundingClientRect().width>0){b.click();return;}}});
        await page.waitForTimeout(3500); await dismissModal(page);
        console.log(`  round ${round+1}: ${info.n}건 삭제`);
        await page.waitForTimeout(2000);
      } else { console.log(`  round ${round+1}: 남은 대상 없음`); break; }
    }
    console.log('CLEANUP_DONE');
  }catch(e){console.error('ERROR:',e.message);}
  finally{await browser.close();}
})();
