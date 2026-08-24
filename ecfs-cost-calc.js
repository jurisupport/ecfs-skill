#!/usr/bin/env node
// 인지액·송달료 계산기 (브라우저 불필요)
// 사용: node ecfs-cost-calc.js --sua 200000000 --defendants 2 [--level 단독] [--paper] [--parties 3]
//
// ⚠️ 이 계산은 '참고값'이다. 전자소송 시스템이 산정한 금액이 있으면 그쪽이 항상 우선.
//    (2026-07 실사건: 시스템 169,200 vs 자체계산 247,500 → 시스템이 맞았음)

const RATES = {
  // 송달료 회차 (송달료규칙 별표1)
  회차: { 소액: 10, 단독: 15, 합의: 15, 항소: 12, 상고: 8 },
  단가: 5640,   // 송달료 1회분. 규칙 개정으로 변동 가능 → 시스템 산정값과 어긋나면 여기부터 의심
};

// 인지액 (민사소송등인지법 §2): 구간식 → 100원 미만 버림(최저 1,000원)
function stampFee(sua, electronic = true) {
  let base;
  if (sua < 10_000_000)       base = sua * 50 / 10000;
  else if (sua < 100_000_000) base = sua * 45 / 10000 + 5000;
  else if (sua < 1_000_000_000) base = sua * 40 / 10000 + 55000;
  else                        base = sua * 35 / 10000 + 555000;
  base = Math.floor(base / 100) * 100;
  if (base < 1000) base = 1000;
  const final = electronic ? Math.floor(base * 0.9 / 100) * 100 : base;  // 전자소송 9/10 (전자문서법 §8)
  return { base, final };
}

// 송달료: ⚠️ 전자소송은 '피고 수'에만 곱한다 (원고는 전자송달이라 우편송달료 미계상)
function deliveryFee({ defendants, parties, level = '단독', electronic = true }) {
  const n = electronic ? defendants : parties;
  const cnt = RATES.회차[level];
  if (!cnt) throw new Error('level은 ' + Object.keys(RATES.회차).join('/') + ' 중 하나');
  return { count: n, rounds: cnt, unit: RATES.단가, total: n * cnt * RATES.단가 };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const name = k.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) a[name] = true;
      else { a[name] = next; i++; }
    }
  }
  return a;
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  if (!a.sua) {
    console.log('사용: node ecfs-cost-calc.js --sua <소가> --defendants <피고수> [--level 소액|단독|합의|항소|상고] [--parties <당사자수>] [--paper]');
    process.exit(1);
  }
  const sua = Number(String(a.sua).replace(/[^0-9]/g, ''));
  const electronic = !a.paper;
  const defendants = Number(a.defendants || 1);
  const parties = Number(a.parties || defendants + 1);
  const level = a.level || '단독';

  const s = stampFee(sua, electronic);
  const d = deliveryFee({ defendants, parties, level, electronic });
  const total = s.final + d.total;
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  console.log(`\n[소송비용 산정]  소가 ${won(sua)} / ${level} / ${electronic ? '전자소송' : '종이소송'} / 피고 ${defendants}명`);
  console.log(`  인지액 : ${won(s.final)}` + (electronic ? `   (기본 ${won(s.base)} × 9/10 전자감액)` : ''));
  console.log(`  송달료 : ${won(d.total)}   (${electronic ? '피고' : '당사자'} ${d.count}명 × ${d.rounds}회 × ${won(d.unit)})`);
  console.log(`  ─────────────────────`);
  console.log(`  합계   : ${won(total)}\n`);
  console.log('  ※ 전자소송 시스템 산정값이 있으면 그 값을 우선하고, 다르면 이 계산을 의심할 것.\n');
}

module.exports = { stampFee, deliveryFee, RATES };
