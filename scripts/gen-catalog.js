#!/usr/bin/env node
/* API · DB 목록을 뽑습니다.
 *
 * 추적 매트릭스가 "127개 API·76개 테이블을 개별 이름까지 나열한 원본
 * 목록이 없다" 고 적은 공백을 메웁니다.
 *
 * ★ 손으로 고치지 마십시오. 매번 다시 만들어집니다 —
 *   손으로 고치면 다음 실행에 날아가고, 그 사실을 아무도 모릅니다.
 */
const fs = require('fs');
const { Client } = require('pg');

async function main() {
  // ── API ────────────────────────────────────────────────────────────
  const d = JSON.parse(fs.readFileSync('docs/06_openapi.json', 'utf8'));
  const groups = {};
  for (const [path, ops] of Object.entries(d.paths).sort()) {
    const p = path.replace('/api/v1', '');
    const g = p.startsWith('/admin') ? '운영(ADM)'
            : p.startsWith('/me') ? '나의공간'
            : p.startsWith('/deals') ? '거래·계약'
            : /^\/(gwans|categories|listings|requests|search|terms|site|signup|auth)/.test(p) ? '공개'
            : '기타';
    for (const [m, o] of Object.entries(ops)) {
      if (!['get','post','patch','put','delete'].includes(m)) continue;
      (groups[g] = groups[g] || []).push(`| \`${m.toUpperCase()} ${p}\` | ${o.summary || ''} |`);
    }
  }
  const total = Object.values(groups).reduce((a, v) => a + v.length, 0);
  let api = ['# 소개뱅크 — API 전체 목록', '',
    '`npm run docs` 가 다시 만듭니다. **손으로 고치지 마십시오.**', '',
    `총 **${total} 오퍼레이션** · 경로 ${Object.keys(d.paths).length}개`, ''];
  for (const g of ['공개','나의공간','거래·계약','운영(ADM)','기타']) {
    if (!groups[g]) continue;
    api.push(`## ${g} (${groups[g].length})`, '', '| 엔드포인트 | 설명 |', '|---|---|', ...groups[g], '');
  }
  fs.writeFileSync('docs/07_api_list.md', api.join('\n'));

  // ── DB ─────────────────────────────────────────────────────────────
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const t = await c.query(`
    SELECT c.relname AS name, coalesce(obj_description(c.oid), '') AS memo,
           (SELECT count(*) FROM information_schema.columns
             WHERE table_name = c.relname AND table_schema = 'public') AS cols
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
  const v = await c.query(`
    SELECT table_name AS name FROM information_schema.views
     WHERE table_schema = 'public' ORDER BY table_name`);
  await c.end();

  const db = ['# 소개뱅크 — DB 목록', '',
    '`npm run docs` 가 다시 만듭니다. **손으로 고치지 마십시오.**', '',
    `테이블 **${t.rows.length}** · 뷰 **${v.rows.length}**`, '',
    '## 테이블', '', '| 테이블 | 컬럼 | 설명 |', '|---|---:|---|',
    ...t.rows.map(r => `| \`${r.name}\` | ${r.cols} | ${r.memo || '—'} |`), '',
    '## 뷰 (감시·집계)', '',
    '대부분 **0이어야 정상**인 감시 뷰입니다 — 값이 있으면 그 자체가 경보입니다.', '',
    ...v.rows.map(r => `- \`${r.name}\``), ''];
  fs.writeFileSync('docs/08_db_catalog.md', db.join('\n'));
  console.log(`  카탈로그  API ${total} · 테이블 ${t.rows.length} · 뷰 ${v.rows.length}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
