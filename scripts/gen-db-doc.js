#!/usr/bin/env node
/**
 * DB 설계서 생성. 실제 스키마에서 뽑습니다 —
 * 손으로 쓰면 컬럼 하나 추가할 때마다 문서가 뒤처집니다.
 */
const { Client } = require('pg');
require('./load-env');
const fs = require('fs');

const DOMAINS = [
  ['identity', '계정 · 사업자 · 권한 · 약관', ['accounts','account_roles','businesses','business_members','identity_verifications','bank_accounts','terms','term_agreements']],
  ['catalog',  '관 · 업종 · 등급 · 지역',     ['gwans','categories','category_grades','category_matrix_axes','regions']],
  ['policy',   '금칙어 · 제한업종 · 설정',     ['banned_words','restricted_industries','fee_guidelines','site_settings','setting_placeholders','footer_links','auto_review_policies']],
  ['content_reg','콘텐츠 레지스트리',           ['faqs','ui_messages','gwan_form_copy']],
  ['billing',  '구독 · 소개코드 · 원장',       ['subscription_plans','subscriptions','referral_codes','ledger_entries','payment_transactions','subscription_invoices','request_views','idempotency_records']],
  ['content',  '리스팅 · 요청 · 배지',         ['listings','listing_versions','listing_media','listing_regions','listing_badges','requests','request_proposals','favorites']],
  ['review',   '검수',                         ['review_items','review_events','review_reason_codes']],
  ['attribution','귀속',                       ['attribution_events','visitor_identities','attribution_policies','safe_numbers','call_logs']],
  ['deal',     '문의 · 거래 · 성사',           ['conversations','messages','public_questions','deals','fee_agreements','deal_confirmations','deal_contracts','deal_payment_records','deal_reviews']],
  ['settlement','정산 · 분쟁',                 ['settlement_batches','settlements','tax_invoices','disputes','dispute_messages']],
  ['notify',   '알림 · 콘텐츠 · 광고',         ['notification_templates','notification_preferences','notification_event_policies','notifications','notification_deliveries','notices','ad_slots','ad_placements','inquiries']],
  ['ops',      '운영 · 코드 · 연동',            ['ops_alerts','code_labels','schema_migrations','integrations']],
  ['audit',    '감사 (append-only)',           ['audit_logs','pii_access_logs']],
  ['lead',     '리드관 (보류)',                ['lead_services','lead_grade_rules','leads','lead_purchases','lead_rejections','lead_performance_reports']],
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 뷰의 컬럼이 섞이지 않도록 BASE TABLE 로 한정합니다.
  const cols = (await c.query(`
    SELECT co.table_schema s, co.table_name t, co.column_name c, co.data_type d,
           co.is_nullable n, co.column_default df,
           co.character_maximum_length len, co.numeric_precision np, co.numeric_scale ns
      FROM information_schema.columns co
      JOIN information_schema.tables ta
        ON ta.table_schema = co.table_schema AND ta.table_name = co.table_name
       AND ta.table_type = 'BASE TABLE'
     WHERE co.table_schema IN ('public','pii','audit')
     ORDER BY co.table_schema, co.table_name, co.ordinal_position`)).rows;
  const pks = (await c.query(`
    SELECT tc.table_name t, kcu.column_name c
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
     WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'`)).rows;
  const fks = (await c.query(`
    SELECT c.relname t, a.attname col, cf.relname ref
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_class cf ON cf.oid=con.confrelid
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=con.conkey[1]
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE con.contype='f' AND n.nspname='public'`)).rows;
  const checks = (await c.query(`
    SELECT c.relname t, pg_get_constraintdef(con.oid) def
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE con.contype='c' AND n.nspname IN ('public','pii','audit')`)).rows;
  const trg = (await c.query(`
    SELECT event_object_table t, trigger_name n, action_timing tm,
           string_agg(DISTINCT event_manipulation,'/') ev
      FROM information_schema.triggers
     WHERE trigger_schema IN ('public','pii','audit')
     GROUP BY 1,2,3 ORDER BY 1,2`)).rows;
  const idx = (await c.query(`
    SELECT tablename t, indexname n, indexdef d FROM pg_indexes
     WHERE schemaname IN ('public','pii','audit') AND indexdef LIKE '%WHERE%' ORDER BY 1`)).rows;
  const views = (await c.query(`
    SELECT table_name n, obj_description(('public.'||quote_ident(table_name))::regclass) cm
      FROM information_schema.views WHERE table_schema='public' ORDER BY 1`)).rows;
  const fns = (await c.query(`
    SELECT routine_name n FROM information_schema.routines
     WHERE routine_schema='public' AND routine_name LIKE 'fn\\_%' ORDER BY 1`)).rows;
  const tblCom = (await c.query(`
    SELECT c.relname t, obj_description(c.oid) cm FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','pii','audit') AND obj_description(c.oid) IS NOT NULL`)).rows;
  await c.end();

  const pkOf = t => pks.filter(p=>p.t===t).map(p=>p.c);
  const fkOf = (t,col) => fks.find(f=>f.t===t&&f.col===col)?.ref;
  const comOf = t => tblCom.find(x=>x.t===t)?.cm;
  const typ = r => {
    if (r.d==='character varying'||r.d==='character') return `varchar(${r.len})`;
    if (r.d==='numeric') return `numeric(${r.np},${r.ns})`;
    return { 'timestamp with time zone':'timestamptz','character varying':'varchar',
             'double precision':'float8','USER-DEFINED':'enum' }[r.d] ?? r.d;
  };

  const allT = [...new Set(cols.map(x=>x.t))];
  const placed = new Set(DOMAINS.flatMap(d=>d[2]));
  const L = [];
  L.push('# 소개뱅크 — 데이터베이스 설계서 v2.0','');
  L.push('**자동 생성** `node scripts/gen-db-doc.js` · 실제 스키마에서 추출');
  L.push(`**테이블 ${allT.length} · 뷰 ${views.length} · 함수 ${fns.length} · 트리거 ${trg.length} · FK ${fks.length}**`);
  L.push('');
  L.push('## 도메인 구성','');
  L.push('| 도메인 | 내용 | 테이블 |');
  L.push('|---|---|---:|');
  for (const [k,desc,ts] of DOMAINS) {
    const n = ts.filter(t=>allT.includes(t)).length;
    if (n) L.push(`| ${k} | ${desc} | ${n} |`);
  }
  const rest = allT.filter(t=>!placed.has(t));
  if (rest.length) L.push(`| 기타 | ${rest.join(' · ')} | ${rest.length} |`);
  L.push('');

  for (const [k,desc,ts] of DOMAINS) {
    const present = ts.filter(t=>allT.includes(t));
    if (!present.length) continue;
    L.push(`## ${k} — ${desc}`,'');
    for (const t of present) {
      const rows = cols.filter(x=>x.t===t);
      const sch = rows[0].s;
      const APPEND_ONLY = new Set(['attribution_events','fee_agreements','ledger_entries',
        'term_agreements','review_events','call_logs','visitor_identities',
        'audit_logs','pii_access_logs']);
      L.push(`### \`${sch==='public'?'':sch+'.'}${t}\`` +
        (APPEND_ONLY.has(t) ? '  🔒 append-only' : ''));
      const cm = comOf(t); if (cm) L.push('',`> ${cm.replace(/\n\s*/g,' ')}`);
      L.push('');
      L.push('| 컬럼 | 타입 | NULL | 참조 · 비고 |');
      L.push('|---|---|:-:|---|');
      const pk = pkOf(t);
      for (const r of rows) {
        const ref = fkOf(t,r.c);
        const notes = [];
        if (pk.includes(r.c)) notes.push('**PK**');
        if (ref) notes.push(`→ \`${ref}\``);
        if (r.df && !/nextval|gen_random/.test(r.df)) notes.push(`기본 \`${String(r.df).slice(0,28)}\``);
        L.push(`| ${r.c} | ${typ(r)} | ${r.n==='YES'?'':'●'} | ${notes.join(' ')} |`);
      }
      const ck = checks.filter(x=>x.t===t).map(x=>x.def);
      if (ck.length) {
        L.push('');
        L.push('**CHECK**');
        L.push('');
        for (const d of ck) L.push(`- \`${d.replace(/\s+/g,' ').slice(0,150)}\``);
      }
      const tg = trg.filter(x=>x.t===t);
      if (tg.length) {
        L.push('');
        L.push('**트리거** ' + tg.map(x=>`\`${x.n}\`(${x.tm} ${x.ev})`).join(' · '));
      }
      L.push('');
    }
  }

  L.push('## 부분 인덱스','');
  L.push('전체 인덱스를 만들면 처리 완료 건이 쌓일수록 조회가 느려집니다. 조회 대상만 좁혀 둡니다.','');
  L.push('| 테이블 | 인덱스 | 조건 |');
  L.push('|---|---|---|');
  for (const i of idx) {
    const w = i.d.match(/WHERE (.+)$/)?.[1] ?? '';
    L.push(`| ${i.t} | \`${i.n}\` | \`${w.slice(0,80)}\` |`);
  }
  L.push('');
  L.push('## 뷰','');
  L.push('| 뷰 | 용도 |');
  L.push('|---|---|');
  for (const v of views) L.push(`| \`${v.n}\` | ${(v.cm ?? '').replace(/\n\s*/g,' ') || '—'} |`);
  L.push('');
  L.push('## 함수','');
  L.push(fns.map(f=>`\`${f.n}\``).join(' · '));
  fs.writeFileSync('docs/11_DB설계서.md', L.join('\n')+'\n');
  console.log(`DB 설계서: 테이블 ${allT.length} · 뷰 ${views.length} · 함수 ${fns.length}`);
})().catch(e=>{console.error(e.message);process.exit(1)});
