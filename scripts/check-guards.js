#!/usr/bin/env node
/* =====================================================================
 * 재발 방지 검사
 *
 * 이번 작업에서 같은 유형의 실수를 일곱 번 겪었습니다.
 * 사람이 기억해야 하는 규칙은 언젠가 빠집니다 — 검사로 고정합니다.
 *
 *   npm run guards
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

let ok = 0, ng = 0;
const pass = (m) => { console.log(`  안전  ${m}`); ok++; };
const fail = (m, d) => { console.log(`  ▲위험 ${m}${d ? ' — ' + d : ''}`); ng++; };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

console.log('\n=== ① 시험이 실제 데이터를 지움 ===');
/* UPDATE·DELETE 에 WHERE 가 없으면 전체 행이 바뀝니다.
 * 실제로 10월 1일 약관 발행이 검정 한 번에 사라졌습니다. */
{
  const files = ['scripts/verify-invariants.sh', 'scripts/attack-check.sh'];
  const bad = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      const m = line.match(/\b(UPDATE\s+\w+\s+SET|DELETE\s+FROM\s+\w+)\b/i);
      if (!m) return;

      /* ★ 줄 전체가 아니라 **그 구문부터** 봐야 합니다(2026-09-23).
         앞쪽 INSERT 의 세미콜론에 잘려 뒤의 WHERE 를 못 보고
         40건이 잘못 떴습니다 — 실제로는 4건이 오탐, 1건이 의도한
         시험이었습니다. 검사가 헛짚으면 진짜 문제가 묻힙니다. */
      /* ★ 여러 줄에 걸친 UPDATE 는 SET 절이 길어 WHERE 가
         6줄 뒤에 오기도 합니다. 3줄만 보면 잘못 뜹니다. */
      const from = line.toUpperCase().indexOf(m[0].toUpperCase());
      const chunk = [line.slice(from), ...read(f).split('\n').slice(i + 1, i + 8)]
        .join(' ');
      if (/\bWHERE\b/i.test(chunk.split(';')[0])) return;

      /* ★ WHERE 없는 구문이 **차단되는지 보는 시험**은 정상입니다.
         `run ... FAIL` 과 `blocked ...` 가 그런 시험입니다 —
         "이게 막혀야 한다" 를 확인하는 것이라 WHERE 가 없어야
         시험이 성립합니다. */
      if (/\bFAIL\b/.test(line)) return;
      /* ★ 여러 줄로 이어진 blocked 도 봅니다 — 줄바꿈(\)으로
         이어지면 SQL 이 다음 줄에 옵니다. 앞 2줄까지 거슬러
         올라가 확인합니다. */
      const back = read(f).split('\n').slice(Math.max(0, i - 2), i + 1).join(' ');
      if (/(^|\s)blocked\s/.test(back)) return;

      bad.push(`${f}:${i + 1}`);
    });
  }
  if (bad.length === 0) pass('검정에 WHERE 없는 UPDATE·DELETE 없음');
  else fail(`WHERE 없는 구문 ${bad.length}건`, bad.slice(0, 5).join(' '));
}

console.log('\n=== ② 기준선이 생성물을 덮음 ===');
/* REF 목록은 "없으면 서비스가 안 도는 것"만 담아야 합니다.
 * 생성기가 다시 만드는 것을 담으면 옛 값이 새 값을 덮습니다. */
{
  const bl = read('scripts/build-baseline.js');
  const generated = ['terms'];   // 생성기가 본문을 만드는 표
  const inRef = generated.filter((t) => new RegExp(`'${t}'`).test(bl));
  if (inRef.length === 0) pass('생성물 표가 REF 에 없음 (terms)');
  else fail('생성기가 만드는 표가 REF 에 있음', inRef.join(','));

  /* 반대 방향 — 서비스가 못 도는데 빠진 것 */
  const critical = ['job_schedules', 'classify_vocab', 'banned_words',
                    'subscription_plans', 'lead_grade_rates', 'report_reasons',
                    'trust_weights', 'listing_checklist', 'categories'];
  const missing = critical.filter((t) => !new RegExp(`'${t}'`).test(bl));
  if (missing.length === 0) pass(`필수 기준표 ${critical.length}종 REF 포함`);
  else fail('REF 에 빠진 필수 표', missing.join(','));
}

console.log('\n=== ③ 중복 실행이 안전장치를 무력화 ===');
{
  const pkg = JSON.parse(read('package.json') || '{}');
  const chain = pkg.scripts?.docs || '';
  const n = (chain.match(/merge-openapi/g) || []).length;
  if (n <= 1) pass('docs 체인에 merge 중복 없음');
  else fail(`merge 가 ${n}번 — 두 번째 성공이 첫 실패를 덮습니다`);

  const seq = chain.split('&&').map((s) => s.trim());
  const dup = seq.filter((s, i) => s && seq.indexOf(s) !== i);
  if (dup.length === 0) pass('체인에 중복 단계 없음');
  else fail('중복 단계', dup.join(' / '));
}

console.log('\n=== ④ "차단됨"을 성공으로 읽음 ===');
{
  const atk = read('scripts/attack-check.sh');
  /* blocked() 가 "왜 막혔는지"를 구분하는가.
     없는 함수·표 때문에 실패해도 "차단"으로 보이면 안 됩니다. */
  const hasReason = /does not exist|undefined_function|undefined_table|42883|42P01/.test(atk);
  if (hasReason) pass('blocked 가 실패 원인을 구분함');
  else fail('blocked 가 원인을 구분하지 않음', '없는 함수도 "차단"으로 보입니다');
}

console.log('\n=== ⑤ 0행 대상은 트리거가 돌지 않음 ===');
{
  const atk = read('scripts/attack-check.sh');
  const hasSkip = /건너뜀/.test(atk) && /대상 행 없음|시험 성립/.test(atk);
  if (hasSkip) pass('대상 없으면 건너뜀으로 표시');
  else fail('0행 대상이 "안전"으로 보고됨');

  const countsSkip = /건너뜀 \$\{?skip|skip=\$\(\(skip/.test(atk);
  if (countsSkip) pass('건너뜀을 따로 셈 (통과가 아님)');
  else fail('건너뜀이 통과에 섞임');
}

console.log('\n=== ⑥ 없는 CSS 클래스는 조용히 깨짐 ===');
{
  const targets = [
    { css: ['web/src/styles/app.css', 'web/src/styles/tokens.css'],
      src: 'web/src/app/admin', name: '관리자' },
    /* v10.29 — 사용자 웹은 layout.tsx 가 styles/ 의 CSS 를 모두 불러옵니다(시안 반영 proto-*.css 포함). 두 파일만 보면 정의된 클래스도 「없음」으로 잡힙니다 */
    /* v10.31 — 화면 옆에 둔 CSS(components/refcode/refcode.css 처럼 그 컴포넌트가 import 하는 것)도 정의로 봅니다.
       styles/ 만 보면 refcode.css 의 rc-list · rc-tag 가 늘 「없음」으로 잡혀 이 검사가 판마다 실패로 남았습니다. */
    { css: (function cssUnder(d) {
        return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? cssUnder(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.relative(path.join(__dirname, '..'), path.join(d, e.name))] : []);
      })(path.join(__dirname, '..', 'site/src')),
      src: 'site/src/app', name: '사용자' },
  ];
  for (const t of targets) {
    const css = t.css.map(read).join('\n');
    /* ★ 하이픈이 든 이름을 통째로 잡아야 합니다.
       .badge-verified 를 badge 와 verified 로 쪼개면
       "정의 안 됨"이 잘못 뜹니다 — 검사가 헛짚으면 진짜 문제가 묻힙니다. */
    const defined = new Set([...css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
    const used = new Set();
    const walk = (d) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx|jsx)$/.test(e.name)) {
          for (const m of read(p).matchAll(/className="([^"{]*)"/g))
            for (const c of m[1].split(/\s+/))
              if (/^[a-z][a-zA-Z0-9_-]*$/.test(c)) used.add(c);
        }
      }
    };
    walk(t.src);
    const missing = [...used].filter((c) => !defined.has(c));
    if (missing.length === 0) pass(`${t.name} CSS 클래스 전부 정의됨`);
    else fail(`${t.name} 미정의 클래스 ${missing.length}건`, (process.env.GUARD_ALL ? missing : missing.slice(0, 6)).join(' '));
  }
}

console.log('\n=== ⑦ 한글 SMS 는 28자가 상한 ===');
{
  /* 바이트로 세야 합니다. 한글은 EUC-KR 기준 2바이트이고
     SMS 는 90바이트라 45자가 아니라 28자 근처에서 잘립니다. */
  const hasCheck = /byteLength|Buffer\.from|octet_length|length\(convert_to/.test(
    read('scripts/verify-invariants.sh') + read('scripts/attack-check.sh'));
  if (hasCheck) pass('SMS 길이를 바이트로 검사');
  else fail('SMS 길이를 글자 수로만 검사', '한글은 바이트로 세야 합니다');
}

console.log(`\n${'='.repeat(52)}`);
console.log(`안전 ${ok} · ▲위험 ${ng}`);
process.exit(ng > 0 ? 1 : 0);
