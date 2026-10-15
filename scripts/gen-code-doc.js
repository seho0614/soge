#!/usr/bin/env node
/**
 * 코드 정의서 생성.
 *
 * code_labels 가 정본입니다 — 화면·API·문서가 모두 여기서 라벨을 받습니다.
 * 손으로 쓰면 코드 하나 추가할 때마다 문서가 뒤처지고, 그러면
 * "REJECTED 가 반려인가 기각인가" 같은 질문에 답할 근거가 사라집니다.
 */
const { Client } = require('pg');
require('./load-env');
const fs = require('fs');

// 도메인 묶음. 코드가 어디에 쓰이는지 알아야 의미가 잡힙니다
const GROUPS = [
  ['계정 · 사업자', ['account.type', 'business.status']],
  ['콘텐츠',        ['listing.status', 'request.status', 'proposal.status',
                     'badge.type', 'badge.status', 'fee.bearer']],
  ['검수',          ['review.status', 'review.target_type', 'review.decision_mode',
                     'review.manual_reason']],
  ['거래 · 정산',   ['deal.status', 'payment.method', 'settlement.status', 'dispute.status']],
  ['구독 · 원장',   ['subscription.status', 'ledger.entry_type']],
  ['정책 · 카탈로그',['category.status', 'category.labor_law', 'restriction.mode']],
  ['귀속 · 광고',   ['attribution.channel', 'ad.status']],
  ['운영',          ['integration.status', 'alert.severity', 'inquiry.status']],
];

// 같은 코드가 도메인마다 뜻이 다른 것들. 이게 domain 을 PK 에 넣은 이유입니다
const AMBIGUOUS = ['REJECTED', 'APPROVED', 'PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED', 'SUSPENDED'];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const codes = (await c.query(
    `SELECT domain, code, label, short_label, description, ui_tone,
            sort_order, is_active, audience
       FROM code_labels ORDER BY domain, sort_order, code`)).rows;
  const reasons = (await c.query(
    `SELECT code, label, category, is_active FROM review_reason_codes
      ORDER BY category, sort_order`)).rows;
  const words = (await c.query(
    `SELECT severity, count(*)::int n, string_agg(word, ', ' ORDER BY word) sample
       FROM banned_words WHERE is_active GROUP BY severity`)).rows;
  const enums = (await c.query(
    `SELECT c.relname tbl, con.conname, pg_get_constraintdef(con.oid) def
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype='c' AND n.nspname='public'
        AND pg_get_constraintdef(con.oid) LIKE '%= ANY (ARRAY%'
      ORDER BY c.relname, con.conname`)).rows;
  await c.end();

  const byDomain = {};
  for (const r of codes) (byDomain[r.domain] ??= []).push(r);
  const placed = new Set(GROUPS.flatMap(g => g[1]));
  const rest = Object.keys(byDomain).filter(d => !placed.has(d));

  const L = [];
  L.push('# 소개뱅크 — 코드 정의서', '');
  L.push('**자동 생성** `node scripts/gen-code-doc.js` · 정본은 `code_labels` 테이블');
  L.push(`**도메인 ${Object.keys(byDomain).length} · 코드 ${codes.length} · 반려 사유 ${reasons.length}**`, '');
  L.push('---', '');

  L.push('## 이 문서를 쓰는 법', '');
  L.push('코드 라벨은 **화면에 하드코딩하지 않습니다.** 부팅 시 `GET /codes` 로 한 번 받고');
  L.push('로컬에서 씁니다. `"노출 중"`을 `"게시 중"`으로 바꾸는 데 배포가 필요 없습니다.', '');
  L.push('```tsx');
  L.push('// ✗ 하드코딩');
  L.push("{status === 'PUBLISHED' ? '노출 중' : ...}");
  L.push('');
  L.push('// ✓ 서버가 내려준 것');
  L.push('<Badge tone={codes[domain][status].tone}>{item.statusLabel}</Badge>');
  L.push('```', '');

  // 중복 코드 — 이게 이 문서의 핵심입니다
  const dup = {};
  for (const r of codes) (dup[r.code] ??= []).push(r);
  const conflicts = Object.entries(dup)
    .filter(([code, rows]) => rows.length > 1 && AMBIGUOUS.includes(code));

  L.push('## ★ 같은 코드, 다른 뜻', '');
  L.push('`domain` 이 PK 에 들어간 이유입니다. **코드만 보고 판단하면 틀립니다.**', '');
  L.push('| 코드 | 도메인 | 뜻 |');
  L.push('|---|---|---|');
  for (const [code, rows] of conflicts) {
    for (const r of rows) L.push(`| \`${code}\` | ${r.domain} | ${r.label} |`);
  }
  L.push('');

  const tone = t => t ? `\`${t}\`` : '—';
  const emit = (domain) => {
    const rows = byDomain[domain] ?? [];
    if (!rows.length) return;
    const aud = [...new Set(rows.map(r => r.audience))].join('/');
    L.push(`### \`${domain}\`  ·  ${rows.length}종  ·  노출 ${aud === 'ALL' ? '전체' : '관리자'}`);
    L.push('');
    L.push('| 코드 | 라벨 | 짧은 라벨 | 톤 | 설명 |');
    L.push('|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| \`${r.code}\`${r.is_active ? '' : ' ⚠️'} | ${r.label} | ${r.short_label ?? '—'} | ${tone(r.ui_tone)} | ${r.description ?? ''} |`);
    }
    L.push('');
  };

  for (const [title, domains] of GROUPS) {
    L.push(`## ${title}`, '');
    for (const d of domains) emit(d);
  }
  if (rest.length) {
    L.push('## 기타', '');
    for (const d of rest) emit(d);
  }

  L.push('## 반려 사유 코드', '');
  L.push('검수 반려 시 필수입니다. **사유 없이 반려하면 등록자가 무엇을 고쳐야 할지 모릅니다.**', '');
  const byCat = {};
  for (const r of reasons) (byCat[r.category] ??= []).push(r);
  for (const [cat, rows] of Object.entries(byCat)) {
    L.push(`### ${cat}`, '');
    L.push('| 코드 | 등록자에게 보이는 문구 |');
    L.push('|---|---|');
    for (const r of rows) L.push(`| \`${r.code}\`${r.is_active ? '' : ' ⚠️'} | ${r.label} |`);
    L.push('');
  }

  L.push('## 금칙어', '');
  L.push('| 등급 | 수 | 처리 |');
  L.push('|---|---:|---|');
  for (const w of words) {
    L.push(`| **${w.severity}** | ${w.n} | ${w.severity === 'BLOCK' ? '등록 거부' : '통과 + 자동검수 제외 (사람이 봄)'} |`);
  }
  L.push('');
  L.push('**WARN 을 차단하지 않는 이유** — "최고 사양 설비"는 정상 표현이고,');
  L.push('"카톡으로 문의"도 맥락에 따라 다릅니다. 막는 대신 사람에게 보냅니다.', '');

  L.push('## DB CHECK 제약 — 코드의 최종 방어선', '');
  L.push('라벨이 없어도 DB 는 값을 강제합니다. **라벨과 CHECK 가 어긋나면**');
  L.push('`v_code_missing_labels` 가 잡습니다 (CI 게이트).', '');
  L.push('| 테이블 | 허용 값 |');
  L.push('|---|---|');
  for (const e of enums) {
    const vals = (e.def.match(/ARRAY\[(.*?)\]/s)?.[1] ?? '')
      .replace(/::text/g, '').replace(/'/g, '').split(',').map(s => s.trim()).join(' · ');
    if (vals) L.push(`| ${e.tbl} | ${vals.slice(0, 110)} |`);
  }
  L.push('');

  L.push('## 코드를 추가할 때', '');
  L.push('```sql');
  L.push('-- 1. CHECK 제약에 값 추가 (마이그레이션)');
  L.push('-- 2. code_labels 에 라벨 추가');
  L.push("INSERT INTO code_labels(domain, code, label, ui_tone, sort_order, audience)");
  L.push("VALUES ('listing.status', 'ARCHIVED', '보관됨', 'muted', 7, 'ALL');");
  L.push('```', '');
  L.push('```bash');
  L.push('node scripts/gen-codes.js > src/generated/codes.ts   # 타입 재생성');
  L.push('npm run verify                                        # 라벨 누락 검사');
  L.push('```', '');
  L.push('**라벨 없이 CHECK 만 추가하면** 화면에 영문이 그대로 나갑니다.');
  L.push('`v_code_missing_labels` 가 CI 에서 막습니다.');

  fs.writeFileSync('docs/20_코드정의서.md', L.join('\n') + '\n');
  console.log(`코드 정의서: 도메인 ${Object.keys(byDomain).length} · 코드 ${codes.length} · 중복 ${conflicts.length}`);
})().catch(e => { console.error(e.message); process.exit(1); });
