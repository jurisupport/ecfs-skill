// 사건기록 전체 다운로드: 로그인 → 나의사건열람(사건번호 검색) → 열람 → 문건별 PDF 저장
// 사용: node ecfs-record-download.js <사건번호끝자리> <출력폴더> [사건부호(기본 가단)] [연도(기본 2026)]
// ⚠️ connectOverCDP가 아니라 자체 브라우저를 launch 해야 Playwright download가 정상 동작한다.
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const fs = require('fs');
const path = require('path');

const CASE_NO = process.argv[2];
const OUT = process.argv[3] || '/tmp/ecfs-record';
const CS_CD = process.argv[4] || '가단';
const CS_YR = process.argv[5] || '2026';

if (!CASE_NO) { console.error('Usage: node ecfs-record-download.js <사건번호끝자리> <출력폴더> [사건부호] [연도]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  try {
    const page = await login(browser);
    console.log('[✓] 로그인');
    const ctx = page.context();
    page.on('dialog', d => { console.log('DIALOG:', d.message().slice(0, 60)); d.accept().catch(() => {}); });

    // 나의사건열람
    await page.hover('text=나의전자소송').catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('a')) if (a.textContent.trim() === '나의사건열람' && a.getBoundingClientRect().width > 0) { a.click(); return; }
    });
    await page.waitForTimeout(6000);

    // 사건번호 검색 모드
    await page.evaluate(() => { const r = document.getElementById('mf_pfwork_rad_choice_input_1'); if (r && !r.checked) r.click(); });
    await page.waitForTimeout(2000);
    await page.evaluate(({ yr, cd, no }) => {
      const setV = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; el.focus(); s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const y = document.getElementById('mf_pfwork_sbx_csYear'); if (y) { y.value = yr; y.dispatchEvent(new Event('change', { bubbles: true })); }
      const c = document.getElementById('mf_pfwork_acp_csDvs_input'); if (c) setV(c, cd);
      const n = document.getElementById('mf_pfwork_ibx_csNo'); if (n) setV(n, no);
    }, { yr: CS_YR, cd: CS_CD, no: CASE_NO });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('mf_pfwork_btn_search').click());
    await page.waitForTimeout(6000);

    // 열람 클릭 → 새 탭(sgvo)
    const before = ctx.pages().length;
    await page.evaluate((no) => {
      for (const tr of document.querySelectorAll('table tr')) {
        if (!tr.textContent.includes(no)) continue;
        const b = [...tr.querySelectorAll('button,a,input[type=button]')].find(x => /열람/.test((x.value || x.textContent || '')) && x.getBoundingClientRect().width > 0);
        if (b) { b.click(); return; }
      }
    }, CASE_NO);
    let rec = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(700);
      const ps = ctx.pages();
      if (ps.length > before) { rec = ps[ps.length - 1]; break; }
    }
    if (!rec) throw new Error('기록열람 탭이 열리지 않음');
    await rec.waitForLoadState('domcontentloaded').catch(() => {});
    await rec.waitForTimeout(6000);
    rec.on('dialog', d => { console.log('DIALOG:', d.message().slice(0, 60)); d.accept().catch(() => {}); });

    let saved = 0;
    rec.on('download', async d => {
      const fn = path.join(OUT, d.suggestedFilename() || `doc_${Date.now()}.pdf`);
      await d.saveAs(fn).then(() => { saved++; console.log('  💾', path.basename(fn)); })
        .catch(e => console.log('  ⚠ 저장실패', e.message.slice(0, 50)));
    });

    // 문건 목록
    const items = await rec.evaluate(() => {
      const out = [];
      document.querySelectorAll('tr').forEach(tr => {
        const tds = [...tr.querySelectorAll('td')];
        if (tds.length < 2) return;
        const date = tds[0].textContent.trim(), name = tds[1].textContent.trim();
        if (/^\d{4}\.\d{2}\.\d{2}$/.test(date) && name.length > 1) out.push({ date, name });
      });
      return out;
    });
    const uniq = []; const seen = new Set();
    for (const it of items) { const k = it.date + '|' + it.name; if (!seen.has(k)) { seen.add(k); uniq.push(it); } }
    console.log(`\n대상 ${uniq.length}건 → ${OUT}\n`);

    for (let i = 0; i < uniq.length; i++) {
      const { date, name } = uniq[i];
      console.log(`[${i + 1}/${uniq.length}] ${date} ${name}`);
      try {
        await rec.keyboard.press('Escape');
        await rec.waitForTimeout(300);
        const row = rec.locator('tr').filter({ hasText: date }).filter({ hasText: name }).first();
        await row.locator('text=선택').first().click({ timeout: 8000 });
        await rec.waitForTimeout(1400);
        await rec.locator('text=PDF 보기').first().click({ timeout: 6000 });
        await rec.waitForTimeout(6500);
        await rec.evaluate(() => {
          const b = [...document.querySelectorAll('[id$="_btn_save"]')].filter(x => x.getBoundingClientRect().width > 0);
          if (b.length) b[b.length - 1].click();
        });
        await rec.waitForTimeout(4500);
        await rec.evaluate(() => {
          const c = [...document.querySelectorAll('[id*="tab_"][id$="_close"]')].filter(x => x.getBoundingClientRect().width > 0);
          if (c.length > 2) c.slice(0, c.length - 1).forEach(x => x.click());
        });
        await rec.waitForTimeout(600);
      } catch (e) { console.log('  ⚠', e.message.slice(0, 50)); }
    }
    console.log(`\n[완료] ${saved}건 저장 → ${OUT}`);
  } catch (e) {
    console.error('FATAL', e.message);
  } finally {
    await browser.close();
  }
})();
