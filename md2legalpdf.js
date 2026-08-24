const { chromium } = require('playwright');
const fs = require('fs');

const MD = process.argv[2];
const OUT = process.argv[3];
const src = fs.readFileSync(MD, 'utf8').replace(/\r/g,'');
const lines = src.split('\n');

const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');

let html = '', para = [];
const flush = () => { if(para.length){ html += `<p>${para.join(' ')}</p>\n`; para=[]; } };

for (let raw of lines) {
  const line = raw.replace(/\s+$/,'');
  const t = line.trim();
  if (t === '') { flush(); continue; }
  if (t === '---') { flush(); continue; }
  if (t.startsWith('# ')) { flush(); html += `<h1>${inline(t.slice(2)).replace(/<\/?strong>/g,'')}</h1>\n`; continue; }
  if (t.startsWith('## ')) { flush(); html += `<h2>${inline(t.slice(3))}</h2>\n`; continue; }
  if (t.startsWith('### ')) { flush(); html += `<h3>${inline(t.slice(4))}</h3>\n`; continue; }
  if (/^\*\*(사 건|원 고|피 고)\*\*/.test(t)) { flush(); html += `<div class="party">${inline(t)}</div>\n`; continue; }
  if (/^\*\*첨부서류\*\*/.test(t)) { flush(); html += `<h3 class="atch">${inline(t)}</h3>\n`; continue; }
  if (/^[　\s]*\d+\.\s*납부확인서/.test(line)) { flush(); html += `<div class="atchitem">${inline(t)}</div>\n`; continue; }
  if (/^\d{4}\.\s*\d{1,2}\.\s*\d{0,2}\.?$/.test(t)) { flush(); html += `<div class="date">${inline(t)}</div>\n`; continue; }
  if (/^원고 소송대리인$/.test(t)) { flush(); html += `<div class="sig">${inline(t)}</div>\n`; continue; }
  if (/^변호사/.test(t)) { flush(); html += `<div class="sig sig-name">${inline(t)}</div>\n`; continue; }
  if (/귀중\*\*$/.test(t) || /귀중$/.test(t)) { flush(); html += `<div class="court">${inline(t)}</div>\n`; continue; }
  para.push(inline(t));
}
flush();

const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 25mm 22mm; }
* { box-sizing: border-box; }
body { font-family: 'Apple SD Gothic Neo','AppleGothic',sans-serif; font-size: 12pt; line-height: 1.9; color:#000; }
h1 { text-align:center; font-size: 20pt; letter-spacing: 12px; margin: 0 0 26px; font-weight:700; }
.party { font-size: 12pt; margin: 2px 0; }
.party strong { display:inline-block; min-width: 4.5em; font-weight:700; }
h2 { font-size: 13pt; font-weight:700; margin: 22px 0 8px; }
h3 { font-size: 12pt; font-weight:700; margin: 14px 0 6px; }
p { margin: 8px 0; text-align: justify; }
.intro { margin-top: 14px; }
.atch { margin-top: 26px; }
.atchitem { margin: 2px 0 2px 1em; }
.date { text-align:center; margin: 34px 0 18px; }
.sig { text-align:center; margin: 4px 0; }
.sig-name { margin-bottom: 26px; letter-spacing:1px; }
.court { text-align:center; font-weight:700; font-size: 13pt; margin-top: 24px; }
strong { font-weight:700; }
</style></head><body>${html}</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent(doc, { waitUntil: 'networkidle' });
  await page.pdf({ path: OUT, format: 'A4', printBackground: true,
    margin: { top:'25mm', bottom:'25mm', left:'22mm', right:'22mm' } });
  await browser.close();
  console.log('PDF 생성:', OUT, Math.round(fs.statSync(OUT).size/1024)+'KB');
})();
