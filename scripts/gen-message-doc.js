#!/usr/bin/env node
/**
 * 알림 문구 정의서 · 메시지 정의서 생성.
 *
 * 사용자에게 나가는 모든 문구를 한곳에 모읍니다.
 * 문구가 코드·DB·마이그레이션에 흩어져 있으면 "이 말이 어디서 나왔지"를
 * 추적할 수 없고, 법무 검토도 불가능합니다.
 */
const { Client } = require('pg');
require('./load-env');
const fs = require('fs');
const path = require('path');

const CH = { INAPP: '인앱', EMAIL: '메일', SMS: '문자', PUSH: '푸시', ALIMTALK: '알림톡' };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const tpl = (await c.query(
    `SELECT code, channel, title, body, variables FROM notification_templates
      ORDER BY code`)).rows;
  const reasons = (await c.query(
    `SELECT code, label, category FROM review_reason_codes WHERE is_active
      ORDER BY category, sort_order`)).rows;
  const restricted = (await c.query(
    `SELECT DISTINCT name, block_message FROM restricted_industries
      WHERE block_message IS NOT NULL ORDER BY name`)).rows;
  const settings = (await c.query(
    `SELECT key, value, description FROM site_settings
      WHERE key LIKE 'legal.%' OR key LIKE '%label%' OR key LIKE '%notice%'
      ORDER BY key`)).rows;
  await c.end();

  const spec = JSON.parse(fs.readFileSync('spec/notifications.json', 'utf8'));

  /* ── 21. 알림 문구 정의서 ── */
  const A = [];
  A.push('# 소개뱅크 — 사용자 알림 문구 정의서', '');
  A.push('**자동 생성** `node scripts/gen-message-doc.js` · 정본은 `notification_templates`');
  A.push(`**이벤트 ${spec.events.length} · 템플릿 ${tpl.length} · 운영 경보 ${spec.admin_alerts.length}**`, '');
  A.push('---', '');

  A.push('## 채널별 원칙', '');
  A.push('| 채널 | 길이 | 쓰는 법 |');
  A.push('|---|---|---|');
  A.push('| 인앱 | 제한 없음 | 본문까지 충분히. 무엇을 해야 하는지까지 |');
  A.push('| 메일 | 제한 없음 | 제목에 `[소개뱅크]` 접두 · 발신전용 안내 |');
  A.push('| **문자** | **90바이트** | 제목만. 상세는 앱으로 유도 |');
  A.push('| 푸시 | 한 줄 | 잠금화면에서 잘립니다 |', '');
  A.push('**조용한 시간** 21:00~08:00 에는 문자·푸시를 보내지 않습니다. 인앱·메일은 제한 없습니다.', '');
  A.push('**중복 방지** 같은 이벤트·대상은 10분에 한 번만 발송합니다.', '');

  A.push('## ★ 수신거부할 수 없는 알림', '');
  A.push('거래·금전·법정 고지는 끌 수 없습니다. **끄려 하면 DB 가 거부합니다.**', '');
  A.push('```');
  A.push('NOTIFICATION_OPTOUT_FORBIDDEN: 정산 지급 완료는 수신거부할 수 없습니다.');
  A.push('```', '');
  const noOptout = spec.events.filter(e => !e.optout);
  A.push(`| 이벤트 | 이름 | 왜 |`);
  A.push('|---|---|---|');
  const WHY = {
    LISTING_APPROVED: '노출 시작을 모르면 문의를 놓칩니다',
    LISTING_REJECTED: '무엇을 고쳐야 할지 알아야 합니다',
    LISTING_RESTRICTED: '노출 중단은 즉시 알려야 합니다',
    BADGE_REJECTED: '반려 사유 전달',
    CONTRACT_ISSUED: '금액이 잠기는 시점입니다',
    CONTRACT_SIGN_REQUIRED: '서명하지 않으면 성사되지 않습니다',
    DEAL_CONFIRMED: '금전이 오가는 확정 시점',
    PAYMENT_REPORTED: '7일 뒤 자동 확정되므로 반드시 알아야 합니다',
    SETTLEMENT_REQUESTED: '금전 관련',
    SETTLEMENT_PAID: '금전 지급 사실',
    SETTLEMENT_HELD: '보류 사유를 알아야 합니다',
    SETTLEMENT_BLOCKED_INDIVIDUAL: '받을 계좌를 확인하지 않으면 정산이 기록되지 않습니다',
    SUBSCRIPTION_RENEWED: '결제 사실 고지',
    SUBSCRIPTION_PAYMENT_FAILED: '방치하면 노출이 줄어듭니다',
    PROMO_ENDING: '자동 유료 전환 고지 의무 (B-14)',
    BUSINESS_APPROVED: '수령 자격 기준일이 정해집니다',
    BUSINESS_REJECTED: '재신청 안내',
    DISPUTE_OPENED: '정산이 보류됩니다',
    DISPUTE_RESOLVED: '처리 결과 통지',
  };
  for (const e of noOptout) {
    A.push(`| \`${e.code}\` | ${e.name} | ${WHY[e.code] ?? '거래 관련'} |`);
  }
  A.push('');

  A.push('## 이벤트별 문구', '');
  const byCode = {};
  for (const t of tpl) (byCode[t.code.replace(/_(INAPP|EMAIL|SMS|PUSH|ALIMTALK)$/, '')] ??= []).push(t);

  for (const e of spec.events) {
    const rows = byCode[e.code] ?? [];
    A.push(`### \`${e.code}\` — ${e.name}`);
    A.push('');
    A.push(`**수신자** ${e.actor} · **계기** \`${e.trigger}\` · ` +
           `**수신거부** ${e.optout ? '가능' : '**불가**'} · **화면** \`${e.screen}\``);
    A.push('');
    if (!rows.length) { A.push('> ⚠️ 템플릿 없음'); A.push(''); continue; }
    A.push('| 채널 | 제목 | 본문 |');
    A.push('|---|---|---|');
    for (const r of rows) {
      const body = (r.body || '').replace(/\n/g, '<br>').replace(/\|/g, '\\|');
      A.push(`| ${CH[r.channel] ?? r.channel} | ${r.title || '—'} | ${body} |`);
    }
    const vars = rows[0].variables ?? [];
    if (vars.length) A.push('', `**변수** ${vars.map(v => `\`{${v}}\``).join(' · ')}`);
    A.push('');
  }

  A.push('## 변수 치환', '');
  A.push('`{name}` 형태이며 발송 시 치환합니다. **치환되지 않은 채로 저장하면 DB 가 거부합니다.**', '');
  A.push('```');
  A.push('UNRESOLVED_TEMPLATE_VAR: 치환되지 않은 변수가 있습니다 — {amount}');
  A.push('```', '');
  A.push('`"{amount}원이 지급되었습니다"` 가 사용자에게 나가면 신뢰가 무너집니다.', '');

  A.push('## 운영 경보 (관리자 전용)', '');
  A.push('| 코드 | 이름 | 등급 |');
  A.push('|---|---|---|');
  for (const a of spec.admin_alerts) {
    A.push(`| \`${a.code}\` | ${a.name} | ${a.severity ?? ''} |`);
  }

  fs.writeFileSync('docs/21_알림문구정의서.md', A.join('\n') + '\n');

  /* ── 22. 메시지 정의서 (화면 문구) ── */
  const M = [];
  M.push('# 소개뱅크 — 메시지 정의서', '');
  M.push('**자동 생성** `node scripts/gen-message-doc.js`');
  M.push('**범위** 화면에 나가는 오류·안내 문구. 알림은 `21_알림문구정의서` 참조', '');
  M.push('---', '');

  M.push('## 오류 문구 규약', '');
  M.push('| 상태 | 의미 | 문구 성격 |');
  M.push('|---|---|---|');
  M.push('| 400 | 형식 오류 | 어느 필드가 잘못됐는지 |');
  M.push('| 403 | 권한·게이트 | **무엇을 하면 되는지** — 막는 게 목적이 아닙니다 |');
  M.push('| 409 | 상태 충돌 | 재시도해도 같다는 것을 알려야 합니다 |');
  M.push('| 422 | 정책 위반 | **그대로 사용자에게 보여도 되는 문장** |', '');
  M.push('**422 는 프런트가 가공하지 않습니다.** 서버 문구를 그대로 띄웁니다 —');
  M.push('제한업종 차단 문구처럼 관리자가 바꿀 수 있어야 하기 때문입니다.', '');

  // 소스에서 throw 문구 수집
  const walk = (dir, acc = []) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p, acc);
      else if (f.endsWith('.ts')) acc.push(p);
    }
    return acc;
  };
  const msgs = [];
  for (const f of walk('src')) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /(StateConflict|PolicyViolation|Forbidden|NotFound|Unauthorized)\(\s*'([A-Z_0-9]+)',\s*\n?\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src))) {
      msgs.push({ kind: m[1], code: m[2], text: m[3], file: f.replace('src/', '') });
    }
  }
  const STATUS = {
    StateConflict: 409, PolicyViolation: 422, Forbidden: 403,
    NotFound: 404, Unauthorized: 401,
  };
  const byStatus = {};
  for (const m of msgs) (byStatus[STATUS[m.kind]] ??= []).push(m);

  M.push(`## API 오류 문구 (${msgs.length}건)`, '');
  for (const st of [401, 403, 404, 409, 422]) {
    const rows = byStatus[st] ?? [];
    if (!rows.length) continue;
    M.push(`### ${st}`, '');
    M.push('| 코드 | 문구 | 위치 |');
    M.push('|---|---|---|');
    const seen = new Set();
    for (const r of rows.sort((a, b) => a.code.localeCompare(b.code))) {
      const k = r.code + r.text;
      if (seen.has(k)) continue;
      seen.add(k);
      M.push(`| \`${r.code}\` | ${r.text} | ${r.file} |`);
    }
    M.push('');
  }

  M.push('## DB 가 던지는 문구', '');
  M.push('규칙 판정은 DB 가 합니다. 앱은 이 예외를 상태코드로 옮기기만 합니다.', '');
  M.push('| 예외 코드 | 문구 | HTTP |');
  M.push('|---|---|---|');
  const dbMsgs = [];
  for (const d of fs.readdirSync('prisma/migrations')) {
    const f = path.join('prisma/migrations', d, 'migration.sql');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const re = /RAISE EXCEPTION '([A-Z_0-9]+): ([^']+)'/g;
    let m;
    while ((m = re.exec(src))) dbMsgs.push([m[1], m[2]]);
  }
  const seenDb = new Set();
  for (const [code, text] of dbMsgs.sort()) {
    if (seenDb.has(code)) continue;
    seenDb.add(code);
    const http = /append-only|ALREADY|EXISTS/.test(code) ? 409 : 422;
    M.push(`| \`${code}\` | ${text.replace(/%/g, '{값}')} | ${http} |`);
  }
  M.push('');

  M.push('## 검수 반려 사유', '');
  M.push('**등록자에게 그대로 보이는 문구입니다.** 사유 없이 반려할 수 없습니다.', '');
  const byCat = {};
  for (const r of reasons) (byCat[r.category] ??= []).push(r);
  for (const [cat, rows] of Object.entries(byCat)) {
    M.push(`### ${cat}`, '');
    M.push('| 코드 | 문구 |');
    M.push('|---|---|');
    for (const r of rows) M.push(`| \`${r.code}\` | ${r.label} |`);
    M.push('');
  }

  M.push('## 제한업종 차단 문구', '');
  M.push('`restricted_industries.block_message` — **관리자가 바꿀 수 있습니다.**', '');
  M.push('| 업종 | 문구 |');
  M.push('|---|---|');
  for (const r of restricted) M.push(`| ${r.name} | ${r.block_message} |`);
  M.push('');

  M.push('## 설정에서 오는 문구', '');
  M.push('| 키 | 값 | 설명 |');
  M.push('|---|---|---|');
  for (const s of settings) {
    M.push(`| \`${s.key}\` | ${s.value || '**(미입력)**'} | ${s.description ?? ''} |`);
  }
  M.push('');

  M.push('## 화면 고정 문구', '');
  M.push('코드에 있으나 자주 확인이 필요한 것들입니다.', '');
  M.push('| 위치 | 문구 | 이유 |');
  M.push('|---|---|---|');
  M.push('| 상세 CTA 하단 | 문의로 진행하면 소개 이력이 기록됩니다. | 귀속 안내 (INV-2) |');
  M.push('| 스텁 연동 | 연동 준비 중 — 실제 확인이 이루어지지 않았습니다. | 실동작 오인 방지 |');
  M.push('| 사업자 전환 | 거래 만들기 · 소개비 제시 · 계약서 발급은 사업자 인증 뒤에 됩니다. | INV-10 · v10.28 개인 수령(INV-10R) |');
  M.push('| 공개 문의 | 공개 문의는 누구나 볼 수 있습니다. 연락처는 자동으로 가려집니다. | 마스킹 고지 |');
  M.push('| 정산 내역 | 소개비는 공제 없이 전액 지급됩니다. | INV-9 |');
  M.push('| 매물 수정 | 수정하면 다시 검수를 받습니다. 부여된 배지도 회수됩니다. | 재검수 고지 |');
  M.push('| 분쟁 접수 | 접수하면 해당 거래의 정산이 자동으로 보류됩니다. | B-11 |');
  M.push('| 광고 영역 | 광고 영역은 유료 노출입니다. | 전상법 표시 의무 |');

  fs.writeFileSync('docs/22_메시지정의서.md', M.join('\n') + '\n');
  console.log(`알림 문구 ${tpl.length}건 · 메시지 ${msgs.length}건 · DB 예외 ${seenDb.size}건`);
})().catch(e => { console.error(e.message); process.exit(1); });
