const { chromium } = require('playwright');
const fs = require('fs');
const MD = process.argv[2], OUT = process.argv[3];
const src = fs.readFileSync(MD,'utf8').replace(/\r/g,'');
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
let html='', inFence=false, fence=[];
for (const raw of src.split('\n')){
  const line = raw.replace(/\s+$/,''); const t = line.trim();
  if (t.startsWith('```')) { inFence=!inFence;
    if(!inFence){ for(const f of fence){ const ft=f.trim(); if(!ft) continue;
        if(/귀중$/.test(ft)) html+=`<div class="court">${inline(ft)}</div>\n`;
        else if(/^\d{4}\./.test(ft)) html+=`<div class="date">${inline(ft)}</div>\n`;
        else html+=`<div class="sig">${inline(ft)}</div>\n`; } fence=[]; }
    continue; }
  if (inFence) { fence.push(line); continue; }
  if (t==='' || t==='---') continue;
  if (t.startsWith('# ')) { html+=`<h1>${esc(t.slice(2))}</h1>\n`; continue; }
  if (t.startsWith('## ')) { html+=`<h2>${inline(t.slice(3))}</h2>\n`; continue; }
  if (t.startsWith('### ')) { html+=`<h3>${inline(t.slice(4))}</h3>\n`; continue; }
  if (/^(사 {2,}건|청 {2,}구 {2,}인|상 {2,}대 {2,}방)/.test(line)) { html+=`<div class="party">${inline(line)}</div>\n`; continue; }
  if (/^\*\*[가-하]\.\s/.test(t)) { html+=`<h4>${inline(t)}</h4>\n`; continue; }
  if (/^(명칭|주소|성명|주민등록번호|계좌번호)/.test(t)) { html+=`<div class="fld">${inline(t)}</div>\n`; continue; }
  if (/^※/.test(t)) { html+=`<div class="note">${inline(t)}</div>\n`; continue; }
  if (/^\d\)\s/.test(t)) { html+=`<div class="lv2">${inline(t)}</div>\n`; continue; }
  if (/^-\s/.test(t)) { html+=`<div class="lv3">${inline(t)}</div>\n`; continue; }
  if (/^[①②③④⑤]/.test(t)) { html+=`<div class="lv3">${inline(t)}</div>\n`; continue; }
  if (/^\(/.test(t)) { html+=`<div class="lv3">${inline(t)}</div>\n`; continue; }
  if (/^[가-하]\.\s/.test(t)) { html+=`<p class="item">${inline(t)}</p>\n`; continue; }
  if (/^\s{1,}[0-9]\)/.test(line)) { html+=`<div class="lv2">${inline(t)}</div>\n`; continue; }
  html+=`<p>${inline(t)}</p>\n`;
}
const doc=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page{size:A4;margin:20mm 20mm;}
body{font-family:'Apple SD Gothic Neo','AppleGothic',sans-serif;font-size:11.5pt;line-height:1.75;color:#000;}
h1{text-align:center;font-size:19pt;letter-spacing:6px;margin:0 0 26px;font-weight:700;}
.party{white-space:pre;font-size:11.5pt;margin:1px 0;}
h2{font-size:12.5pt;font-weight:700;margin:20px 0 6px;border-bottom:1px solid #000;padding-bottom:2px;}
h3{font-size:11.5pt;font-weight:700;margin:14px 0 5px;}
h4{font-size:11.5pt;font-weight:700;margin:11px 0 4px;padding-left:0.5em;}
p{margin:6px 0;text-align:justify;}
p.item{padding-left:1em;text-indent:-1em;}
.fld{margin:2px 0;padding-left:1em;text-indent:-1em;}
.lv2{margin:3px 0 3px 1.6em;text-indent:-1.2em;padding-left:1.2em;}
.lv3{margin:2px 0 2px 2.6em;text-indent:-1em;padding-left:1em;font-size:11pt;}
.note{margin:10px 0 4px 0.5em;font-size:10.5pt;padding-left:1.2em;text-indent:-1.2em;}
.date{text-align:center;margin:36px 0 16px;}
.sig{text-align:center;margin:4px 0;letter-spacing:1px;}
.court{text-align:left;font-weight:700;font-size:13pt;margin-top:28px;}
strong{font-weight:700;}
</style></head><body>${html}</body></html>`;
(async()=>{ const b=await chromium.launch({headless:true,channel:'chrome'});
  const p=await b.newPage(); await p.setContent(doc,{waitUntil:'networkidle'});
  await p.pdf({path:OUT,format:'A4',printBackground:true,margin:{top:'20mm',bottom:'20mm',left:'20mm',right:'20mm'}});
  await b.close(); console.log('OK', OUT, Math.round(fs.statSync(OUT).size/1024)+'KB'); })();
