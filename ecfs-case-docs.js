// 특정 사건의 송달문서를 월별 구간(31일 제한)으로 반복 조회 → 목록/저장
// 사용: node ecfs-case-docs.js <사건번호키워드> --months 2026.03,2026.04,... [--court 서울가정법원] [--save DIR]
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');const {login}=require('./ecfs-login');
const argv=process.argv.slice(2);
const opt=(k,d)=>{const i=argv.indexOf(k);return i>=0&&argv[i+1]&&!argv[i+1].startsWith('--')?argv[i+1]:d;};
const CASE=argv[0];
const MONTHS=opt('--months','2026.03,2026.04,2026.05,2026.06,2026.07,2026.08').split(',');
const COURT=opt('--court','');
const SAVE=opt('--save','');
if(SAVE)fs.mkdirSync(SAVE,{recursive:true});
const lastDay=(y,m)=>new Date(y,m,0).getDate();

async function gotoMenu(page,label){
  await page.hover('text=나의전자소송').catch(()=>{});await page.waitForTimeout(1500);
  await page.evaluate(l=>{for(const a of document.querySelectorAll('a'))if(a.textContent.trim()===l&&a.getBoundingClientRect().width>0){a.click();return;}},label);
  await page.waitForTimeout(6000);
}
async function dismiss(page){
  await page.evaluate(()=>{
    const btns=[...document.querySelectorAll('button,input[type=button],a')].filter(b=>b.getBoundingClientRect().width>0&&/^(확인|닫기|예)$/.test((b.textContent||b.value||'').trim()));
    if(btns.length)btns[btns.length-1].click();});
  await page.waitForTimeout(1200);
}
async function setDate(page,id,val){
  await page.evaluate(({i,v})=>{const el=document.getElementById(i);if(!el)return;
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(el,v);
    ['input','change','keyup','blur'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));},{i:id,v:val});
  await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(400);
}
async function setCourt(page,name){
  if(!name)return;
  await page.evaluate(n=>{const s=document.getElementById('mf_pfwork_sbx_cortList');if(!s)return;
    const o=[...s.options].find(x=>x.text.trim()===n);if(o){s.value=o.value;['change','input'].forEach(t=>s.dispatchEvent(new Event(t,{bubbles:true})));}},name);
  await page.waitForTimeout(800);
}
async function search(page){
  await page.evaluate(()=>{for(const b of document.querySelectorAll('input[type=button],button,a')){const t=(b.textContent||b.value||'').trim();if(t==='조회'&&b.getBoundingClientRect().width>0){b.click();return;}}});
  await page.waitForTimeout(4500);
  const alert=await page.evaluate(()=>{const e=[...document.querySelectorAll('[class*=modal],[class*=popup],[id*=alert]')].filter(x=>x.getBoundingClientRect().width>0).map(x=>x.innerText).join(' ');
    const m=e.match(/조회 기간이[^"]{0,60}/);return m?m[0]:'';});
  if(alert){console.log('  [알림]',alert.trim());await dismiss(page);return false;}
  return true;
}
function rows(page){return page.evaluate(()=>{const out=[];
  [...document.querySelectorAll('table tr')].forEach(tr=>{
    const c=[...tr.querySelectorAll('td')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
    if(c.length<6||!c.some(x=>/\d{4}[가-힣]/.test(x)))return;
    const caseNo=(tr.textContent.match(/\d{4}[가-힣]+\d+/)||[])[0]||'';
    const tds=[...tr.querySelectorAll('td')];const a=tds[5]&&tds[5].querySelector('a');
    out.push({caseNo,docName:a?a.textContent.trim():(c[5]||''),isUnconfirmed:c.some(x=>x==='미확인'),cols:c.filter(Boolean).slice(0,8)});});
  return out;});}
async function nextPage(page,n){
  return page.evaluate(num=>{const els=[...document.querySelectorAll('a,button,input[type=button]')].filter(e=>e.getBoundingClientRect().width>0);
    let el=els.find(a=>a.textContent.trim()===String(num)&&a.closest('[class*=page],[class*=paging],[id*=page]'));
    if(!el)el=els.find(a=>a.textContent.trim()===String(num));
    if(el){el.click();return true;}return false;},n);
}
async function saveViewer(ctx,listPage,outdir){
  let v=ctx.pages().find(p=>p!==listPage&&!p.isClosed());
  if(!v)v=await ctx.waitForEvent('page',{timeout:15000}).catch(()=>null);
  if(!v)return{ok:false,reason:'뷰어 안뜸'};
  await v.waitForLoadState('domcontentloaded').catch(()=>{});
  for(let w=0;w<12;w++){const r=await v.evaluate(()=>!!(document.getElementById('mf_btn_save')||[...document.querySelectorAll('button,input[type=button],a')].find(x=>(x.textContent||x.value||'').trim()==='파일저장'))).catch(()=>false);if(r)break;await v.waitForTimeout(2000);}
  await v.waitForTimeout(1500);
  let saved=null;
  const done=new Promise(res=>{v.on('download',async d=>{const fn=path.join(outdir,d.suggestedFilename()||'doc.pdf');await d.saveAs(fn).catch(()=>{});saved=fn;res();});setTimeout(res,25000);});
  let f=false;for(let a=0;a<3&&!f;a++){f=await v.evaluate(()=>{const b=document.getElementById('mf_btn_save')||[...document.querySelectorAll('button,input[type=button],a')].find(x=>(x.textContent||x.value||'').trim()==='파일저장');if(b){b.click();return true;}return false;}).catch(()=>false);if(!f)await v.waitForTimeout(2000);}
  if(!f){await v.close().catch(()=>{});return{ok:false,reason:'저장버튼 없음'};}
  await done;await v.close().catch(()=>{});await listPage.waitForTimeout(1500);
  return{ok:!!saved,file:saved,reason:saved?undefined:'다운로드 미발생'};
}
async function clickByIndex(page,ei){
  return page.evaluate(idx=>{const trs=[...document.querySelectorAll('table tr')].filter(tr=>{const c=[...tr.querySelectorAll('td')].map(x=>x.textContent.replace(/\s+/g,' ').trim());return c.length>=6&&c.some(x=>/\d{4}[가-힣]/.test(x));});
    const tr=trs[idx];if(!tr)return false;const tds=[...tr.querySelectorAll('td')];
    const link=(tds[5]&&tds[5].querySelector('a'))||(tds[3]&&tds[3].querySelector('a'));
    if(link){link.click();return true;}return false;},ei);
}
async function runWindow(page,from,to){
  await gotoMenu(page,'전체송달문서');
  await setCourt(page,COURT);
  await setDate(page,'mf_pfwork_cal_from_input',from);
  await setDate(page,'mf_pfwork_cal_to_input',to);
  const ok=await search(page);
  if(!ok)return[];
  const got=[],seen=new Set();
  for(let pg=1;pg<=10;pg++){
    const rs=await rows(page);let neu=0;
    rs.forEach((r,i)=>{const k=r.caseNo+'|'+r.docName+'|'+r.cols.join('|');if(!seen.has(k)){seen.add(k);got.push({...r,pg,ei:i,from,to});neu++;}});
    if(neu===0&&pg>1)break;
    if(!(await nextPage(page,pg+1)))break;await page.waitForTimeout(3000);
  }
  return got;
}
(async()=>{const b=await chromium.launch({headless:false,channel:'chrome'});
try{const page=await login(b);const ctx=b.contexts()[0];console.log('[✓] 로그인');
const all=[];
for(const ym of MONTHS){
  const [y,m]=ym.split('.').map(Number);
  const from=`${y}.${String(m).padStart(2,'0')}.01`;
  const to=`${y}.${String(m).padStart(2,'0')}.${lastDay(y,m)}`;
  const got=await runWindow(page,from,to);
  const hit=got.filter(r=>r.caseNo.includes(CASE));
  console.log(`[${from}~${to}] ${got.length}건 중 ${CASE} ${hit.length}건`);
  all.push(...got);
}
const hits=all.filter(r=>r.caseNo.includes(CASE));
console.log(`\n===== ${CASE} 총 ${hits.length}건 =====`);
hits.forEach(r=>console.log(`  ${r.isUnconfirmed?'🔴미확인':'✓'} | ${r.cols.join(' | ')}`));
fs.writeFileSync('/tmp/ecfs-case-docs.json',JSON.stringify({case:CASE,hits,totalScanned:all.length},null,2));
if(SAVE&&hits.length){
  console.log('\n[저장 시작]');
  const byWin={};hits.forEach(h=>{(byWin[h.from+'|'+h.to]=byWin[h.from+'|'+h.to]||[]).push(h);});
  for(const key of Object.keys(byWin)){
    const [from,to]=key.split('|');
    for(const h of byWin[key]){
      if(h.isUnconfirmed){console.log('  ⏭ 미확인 건너뜀:',h.docName);continue;}
      await gotoMenu(page,'전체송달문서');await setCourt(page,COURT);
      await setDate(page,'mf_pfwork_cal_from_input',from);await setDate(page,'mf_pfwork_cal_to_input',to);
      if(!(await search(page)))continue;
      for(let p=1;p<h.pg;p++){await nextPage(page,p+1);await page.waitForTimeout(2500);}
      if(!(await clickByIndex(page,h.ei))){console.log('  링크 못찾음:',h.docName);continue;}
      const r=await saveViewer(ctx,page,SAVE);
      console.log(`  ${r.ok?'💾':'⚠'} ${h.docName} → ${r.ok?path.basename(r.file):r.reason}`);
    }
  }
}
}catch(e){console.error('[오류]',e.message,e.stack);}finally{await b.close();}})();
