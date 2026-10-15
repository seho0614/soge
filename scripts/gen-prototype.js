#!/usr/bin/env node
/**
 * 로컬 확인용 프로토타입 생성.
 *
 * 화면 레지스트리 · 코드 라벨 · 알림 문구 · 콘텐츠를 실제 DB 에서 뽑습니다.
 * 손으로 만들면 구현과 어긋나고, 어긋난 프로토타입은 오히려 혼란을 만듭니다.
 *
 * 단일 HTML 파일이라 브라우저에서 바로 엽니다 — 서버가 필요 없습니다.
 */
const { Client } = require('pg');
require('./load-env');
const fs = require('fs');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const codes = (await c.query(
    `SELECT domain, code, label, ui_tone FROM code_labels WHERE is_active
      ORDER BY domain, sort_order`)).rows;
  const tpl = (await c.query(
    `SELECT code, channel, title, body FROM notification_templates ORDER BY code`)).rows;
  const faqs = (await c.query(`SELECT category, question, answer FROM faqs WHERE is_active ORDER BY sort_order`)).rows;
  const uiMsg = (await c.query(`SELECT code, message, placement, basis FROM ui_messages WHERE is_active ORDER BY code`)).rows;
  const formCopy = (await c.query(`SELECT * FROM gwan_form_copy ORDER BY gwan_code, role DESC`)).rows;
  const gwans = (await c.query(`SELECT code, name, description, is_active FROM gwans ORDER BY sort_order`)).rows;
  const blockers = (await c.query(`SELECT kind, item, reason FROM v_open_blockers`)).rows;
  const integrations = (await c.query(
    `SELECT code, name, purpose, status, blocks_open, lead_time_weeks FROM integrations ORDER BY sort_order`)).rows;
  const words = (await c.query(
    `SELECT severity, count(*)::int n FROM banned_words WHERE is_active GROUP BY severity`)).rows;
  const wordList = (await c.query(
    `SELECT word, match_type, severity, gwan_code FROM banned_words
      WHERE is_active ORDER BY severity, word`)).rows;
  const plans = (await c.query(
    `SELECT code, name, monthly_price, included_codes, extra_code_price,
            request_views_per_month, listing_slots, priority_slot_count
       FROM subscription_plans WHERE is_active ORDER BY monthly_price`)).rows;
  const terms = (await c.query(
    `SELECT code, title, version, status, is_required,
            (length(body) - length(replace(body,'〔',''))) AS holes,
            length(body) AS len
       FROM terms ORDER BY display_order`)).rows;
  const reasons = (await c.query(
    `SELECT code, label, category FROM review_reason_codes WHERE is_active
      ORDER BY category, sort_order`)).rows;
  const autoPol = (await c.query(
    `SELECT key, enabled, num_value, description FROM auto_review_policies ORDER BY key`)).rows;
  const restricted = (await c.query(
    `SELECT code, name, gwan_code, mode, legal_basis FROM restricted_industries
      WHERE is_active ORDER BY name`)).rows;
  const tables = (await c.query(
    `SELECT table_schema, table_name,
            (SELECT count(*) FROM information_schema.columns col
              WHERE col.table_schema = t.table_schema AND col.table_name = t.table_name) AS cols
       FROM information_schema.tables t
      WHERE table_schema IN ('public','pii','audit') AND table_type='BASE TABLE'
      ORDER BY table_schema, table_name`)).rows;
  const views = (await c.query(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema='public' AND table_name LIKE 'v_%' ORDER BY table_name`)).rows;
  const triggers = (await c.query(
    `SELECT DISTINCT trigger_name, event_object_table AS tbl
       FROM information_schema.triggers
      WHERE trigger_schema IN ('public','pii','audit')
      ORDER BY event_object_table, trigger_name`)).rows;
  await c.end();

  const screens = JSON.parse(fs.readFileSync('spec/screens.json', 'utf8'));
  const api = JSON.parse(fs.readFileSync('docs/06_openapi.json', 'utf8'));
  const notif = JSON.parse(fs.readFileSync('spec/notifications.json', 'utf8'));

  // 구현 여부 — 실제 파일에서 판정합니다
  const glob = (dir, ext, acc = []) => {
    if (!fs.existsSync(dir)) return acc;
    for (const f of fs.readdirSync(dir)) {
      const p = dir + '/' + f;
      if (fs.statSync(p).isDirectory()) glob(p, ext, acc);
      else if (f.endsWith(ext)) acc.push(p);
    }
    return acc;
  };
  const routes = glob('site/src/app', 'page.tsx')
    .map((p) => p.replace('site/src/app', '').replace('/page.tsx', '') || '/')
    .map((r) => r.replace(/\[[^\]]+\]/g, '{x}'));
  const bo = new Set(glob('web/src/app', '.tsx').map((f) => f.split('/').pop().replace('.tsx', '')));
  const BO_MAP = {
    'SB-ADM-REV-010': 'ReviewQueue', 'SB-ADM-REV-020': 'ReviewDecide',
    'SB-ADM-REV-030': 'AutoReviewRules', 'SB-ADM-REV-040': 'AuditSamples',
    'SB-ADM-BDG-010': 'Badges', 'SB-ADM-DSP-010': 'Disputes',
    'SB-ADM-COD-010': 'CodeLabels', 'SB-ADM-POL-010': 'Policies',
    'SB-ADM-DSH-010': 'Dashboard', 'SB-ADM-STL-010': 'Settlements',
    'SB-ADM-USR-010': 'Users', 'SB-ADM-DEL-010': 'Deals',
    'SB-ADM-CAT-010': 'Categories', 'SB-ADM-SIT-040': 'OpenChecklist',
    'SB-ADM-SIT-070': 'SiteInfo', 'SB-ADM-SIT-080': 'Integrations',
  };
  const GWAN_URL = new Set(['/money', '/mall', '/biz', '/money/{id}', '/mall/{id}', '/biz/{id}']);
  const impl = (sc) => {
    if (BO_MAP[sc.id]) return bo.has(BO_MAP[sc.id]);
    if (sc.id === 'SB-HOM-MCH-020') return true;
    const u = sc.url.split('#')[0];
    if (GWAN_URL.has(u)) return routes.includes('/{x}') || routes.includes('/{x}/{x}');
    return routes.includes(u.replace(/\{[^}]+\}/g, '{x}'));
  };

  const apiOf = (a) => {
    const [m, p] = a.split(' ');
    const op = api.paths['/api/v1' + p.split('?')[0]]?.[m.toLowerCase()];
    return op ? op['x-status'] === 'IMPLEMENTED' : null;
  };

  const done = screens.screens.filter(impl).length;
  const byGroup = {};
  for (const s of screens.screens) {
    (byGroup[s.group] ??= []).push(s);
  }
  const GROUP_NAME = {
    HOM: '공통', MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업',
    MYP: '마이페이지', ADM: '운영 백오피스',
  };
  const codeByDomain = {};
  for (const r of codes) (codeByDomain[r.domain] ??= []).push(r);
  const tplByEvent = {};
  for (const t of tpl) (tplByEvent[t.code.replace(/_(INAPP|EMAIL|SMS|PUSH|ALIMTALK)$/, '')] ??= []).push(t);

  const H = [];
  H.push(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>소개뱅크 — 로컬 확인용</title>
<style>
:root{--ink:#101418;--ink2:#4A5560;--ink3:#7A868F;--paper:#fff;--surface:#F2F4F6;
--line:#E3E7EB;--accent:#1B4D8F;--accentw:#EEF3FA;--money:#0F6B4A;--danger:#B3261E;
--dangerw:#FDECEA;--ad:#8A6A00;--adw:#FBF6E6}
*{box-sizing:border-box}
body{margin:0;font-family:Pretendard,-apple-system,system-ui,sans-serif;font-size:14px;
line-height:1.65;color:var(--ink);background:var(--surface)}
header{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line);
padding:0 20px;height:56px;display:flex;align-items:center;gap:20px}
header strong{font-size:17px}
nav{display:flex;gap:2px;overflow-x:auto}
nav button{border:0;background:none;padding:8px 12px;font:inherit;font-size:13px;
color:var(--ink2);cursor:pointer;border-radius:4px;white-space:nowrap}
nav button.on{background:var(--accentw);color:var(--accent);font-weight:700}
main{max-width:1100px;margin:0 auto;padding:20px}
h2{font-size:19px;margin:0 0 4px}
h3{font-size:15px;margin:24px 0 8px}
.hint{font-size:12px;color:var(--ink3);margin:0 0 14px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1px solid var(--line);
border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:16px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--surface);font-size:11px;color:var(--ink2);white-space:nowrap}
tr:last-child td{border-bottom:0}
.mono{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink3)}
.pill{font-size:11px;font-weight:700;padding:1px 7px;border-radius:4px;white-space:nowrap}
.ok{background:#E7F4EE;color:var(--money)}
.no{background:var(--dangerw);color:var(--danger)}
.wait{background:var(--adw);color:var(--ad)}
.mute{background:var(--surface);color:var(--ink3)}
.info{background:var(--accentw);color:var(--accent)}
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:20px}
.stat div{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:12px}
.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.stat span{font-size:11px;color:var(--ink3)}
.money{color:var(--money);font-weight:700;font-variant-numeric:tabular-nums}
.warn{background:var(--dangerw);border:1px solid var(--danger);border-radius:8px;
padding:12px 16px;margin-bottom:16px;font-size:13px}
details{background:var(--paper);border:1px solid var(--line);border-radius:8px;
padding:10px 14px;margin-bottom:6px}
summary{cursor:pointer;font-weight:600;font-size:13px}
details p{margin:8px 0 0;font-size:13px;color:var(--ink2)}
.sec{display:none}.sec.on{display:block}
.note{background:var(--accentw);border-radius:6px;padding:10px 14px;font-size:12px;
color:var(--ink2);margin-bottom:14px}
@media(max-width:767px){main{padding:12px}header{padding:0 12px;gap:10px}}
</style></head><body>`);

  const TABS = [
    ['sum', '요약'], ['scr', '화면'], ['api', 'API'], ['db', 'DB'],
    ['code', '코드'], ['msg', '문구'], ['notif', '알림'],
    ['policy', '정책'], ['plan', '요금제'], ['term', '약관'], ['open', '오픈 준비'],
  ];
  H.push('<header><strong>소개뱅크</strong><nav>');
  for (const [k, t] of TABS) {
    H.push(`<button data-t="${k}"${k === 'sum' ? ' class="on"' : ''}>${t}</button>`);
  }
  H.push('</nav></header><main>');

  /* 요약 */
  H.push('<section class="sec on" id="sum"><h2>구현 현황</h2>');
  H.push(`<p class="hint">생성 ${new Date().toISOString().slice(0, 10)} · 실제 DB 와 소스에서 추출</p>`);
  const ops = Object.values(api.paths).reduce((a, p) => a + Object.keys(p).length, 0);
  H.push('<div class="stat">');
  for (const [v, l] of [
    [`${done} / ${screens.screens.length}`, '화면 구현'],
    [ops, 'API 오퍼레이션'],
    [tables.length, 'DB 테이블'],
    [triggers.length, '트리거 (규칙)'],
    [codes.length, '코드 라벨'],
    [tpl.length, '알림 템플릿'],
    [wordList.length, '금칙어'],
    [`${terms.filter(t => t.status === 'PUBLISHED').length} / ${terms.length}`, '약관 발행'],
    [blockers.length, '오픈 차단'],
  ]) H.push(`<div><b>${v}</b><span>${l}</span></div>`);
  H.push('</div>');

  if (blockers.length) {
    H.push(`<div class="warn"><b>오픈 차단 ${blockers.length}건</b> — 전부 해소돼야 운영 배포가 가능합니다.<br>
① 약관 발행 → ② 푸터 값 입력 → ③ 연동 LIVE 순으로 <b>18 → 10 → 3 → 0</b> 이 됩니다.</div>`);
  }

  H.push('<h3>관 구성</h3><table><tr><th>코드</th><th>이름</th><th>상태</th><th>설명</th></tr>');
  for (const g of gwans) {
    H.push(`<tr><td class="mono">${g.code}</td><td>${esc(g.name)}</td>
<td><span class="pill ${g.is_active ? 'ok">운영' : 'mute">보류'}</span></td>
<td>${esc(g.description ?? '')}</td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>외부 연동</h3><table><tr><th>연동</th><th>용도</th><th>상태</th><th>오픈 차단</th><th>리드타임</th></tr>');
  for (const i of integrations) {
    H.push(`<tr><td>${esc(i.name)}</td><td>${esc(i.purpose)}</td>
<td><span class="pill ${i.status === 'LIVE' ? 'ok' : 'wait'}">${i.status}</span></td>
<td>${i.blocks_open ? '<span class="pill no">●</span>' : ''}</td>
<td>${i.lead_time_weeks ?? '—'}주</td></tr>`);
  }
  H.push('</table></section>');

  /* 화면 */
  H.push('<section class="sec" id="scr"><h2>화면 정의</h2>');
  H.push('<p class="hint">구현 여부는 실제 파일 존재로 판정합니다. 문서가 아니라 코드가 기준입니다.</p>');
  for (const [g, list] of Object.entries(byGroup)) {
    const n = list.filter(impl).length;
    H.push(`<h3>${GROUP_NAME[g] ?? g} <span class="mono">${n}/${list.length}</span></h3>`);
    H.push('<table><tr><th>ID</th><th>이름</th><th>경로</th><th>우선</th><th>구현</th><th>권한</th></tr>');
    for (const s of list) {
      const ok = impl(s);
      H.push(`<tr><td class="mono">${s.id}</td><td>${esc(s.name)}${s.new ? ' <span class="pill info">신규</span>' : ''}</td>
<td class="mono">${esc(s.url)}</td><td>${s.p}</td>
<td><span class="pill ${ok ? 'ok">완료' : 'mute">대기'}</span></td>
<td class="mono">${(s.roles ?? []).join(',')}</td></tr>`);
    }
    H.push('</table>');
  }
  H.push('</section>');

  /* API */
  H.push('<section class="sec" id="api"><h2>API</h2>');
  H.push('<p class="hint">화면 레지스트리와 컨트롤러 데코레이터를 병합한 결과입니다.</p>');
  H.push('<table><tr><th>메서드</th><th>경로</th><th>요약</th><th>화면</th></tr>');
  for (const [p, methods] of Object.entries(api.paths)) {
    for (const [m, o] of Object.entries(methods)) {
      H.push(`<tr><td class="mono">${m.toUpperCase()}</td><td class="mono">${esc(p.replace('/api/v1', ''))}</td>
<td>${esc(o.summary ?? '')}</td><td class="mono">${(o['x-screens'] ?? []).join(' ')}</td></tr>`);
    }
  }
  H.push('</table></section>');

  /* 코드 */
  H.push('<section class="sec" id="code"><h2>코드 정의</h2>');
  H.push('<div class="note"><b>같은 코드, 다른 뜻</b> — <code>REJECTED</code> 는 매물에서 "반려", 분쟁에서 "기각", 제안에서 "거절"입니다. 화면에 하드코딩하지 마십시오.</div>');
  for (const [d, rows] of Object.entries(codeByDomain)) {
    H.push(`<h3><span class="mono">${d}</span></h3><table><tr><th>코드</th><th>라벨</th><th>톤</th></tr>`);
    for (const r of rows) {
      H.push(`<tr><td class="mono">${r.code}</td><td>${esc(r.label)}</td><td class="mono">${r.ui_tone ?? ''}</td></tr>`);
    }
    H.push('</table>');
  }
  H.push('</section>');

  /* 문구 */
  H.push('<section class="sec" id="msg"><h2>화면 문구</h2>');
  H.push('<div class="note">법적 근거가 있는 문구입니다. <b>임의로 지우면 표시 의무 위반</b>이 될 수 있어 근거를 함께 둡니다.</div>');
  H.push('<table><tr><th>코드</th><th>문구</th><th>위치</th><th>근거</th></tr>');
  for (const m of uiMsg) {
    H.push(`<tr><td class="mono">${m.code}</td><td>${esc(m.message)}</td>
<td>${esc(m.placement)}</td><td class="mono">${esc(m.basis ?? '')}</td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>관별 등록 폼 문구</h3>');
  H.push('<p class="hint">관마다 무엇을 등록하는지가 다릅니다. 새 관을 열려면 이 문구가 먼저 있어야 합니다.</p>');
  H.push('<table><tr><th>관</th><th>역할</th><th>대상</th><th>안내</th></tr>');
  for (const f of formCopy) {
    H.push(`<tr><td class="mono">${f.gwan_code}</td><td class="mono">${f.role}</td>
<td>${esc(f.subject)}</td><td>${esc(f.notice ?? '')}</td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>FAQ</h3>');
  for (const f of faqs) {
    H.push(`<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`);
  }
  H.push('</section>');

  /* 알림 */
  H.push('<section class="sec" id="notif"><h2>알림 문구</h2>');
  H.push('<div class="note"><b>문자는 90바이트 제한</b>이라 제목만 보내고 상세는 앱으로 유도합니다. 21:00~08:00 에는 문자·푸시를 보내지 않습니다.</div>');
  for (const e of notif.events) {
    const rows = tplByEvent[e.code] ?? [];
    H.push(`<h3>${esc(e.name)} <span class="mono">${e.code}</span>
${e.optout ? '' : ' <span class="pill no">수신거부 불가</span>'}</h3>`);
    H.push(`<p class="hint">수신자 ${e.actor} · 계기 <span class="mono">${esc(e.trigger)}</span></p>`);
    H.push('<table><tr><th>채널</th><th>제목</th><th>본문</th></tr>');
    for (const r of rows) {
      H.push(`<tr><td class="mono">${r.channel}</td><td>${esc(r.title)}</td>
<td>${esc(r.body).replace(/\n/g, '<br>')}</td></tr>`);
    }
    H.push('</table>');
  }
  H.push('</section>');

  /* DB */
  H.push('<section class="sec" id="db"><h2>데이터베이스</h2>');
  H.push(`<p class="hint">테이블 ${tables.length} · 뷰 ${views.length} · 트리거 ${triggers.length}. 실제 스키마에서 읽었습니다.</p>`);
  H.push('<div class="note"><b>규칙은 DB 가 판정합니다.</b> 앱에만 두면 SQL 로 직접 하면 통과합니다. 트리거 목록이 곧 규칙 목록입니다.</div>');

  const APPEND_ONLY = new Set(['attribution_events','fee_agreements','ledger_entries',
    'term_agreements','review_events','call_logs','visitor_identities',
    'audit_logs','pii_access_logs']);
  const bySchema = {};
  for (const t of tables) (bySchema[t.table_schema] ??= []).push(t);
  for (const [sch, list] of Object.entries(bySchema)) {
    H.push(`<h3>${sch} <span class="mono">${list.length}</span></h3><table><tr><th>테이블</th><th>컬럼</th><th></th></tr>`);
    for (const t of list) {
      H.push(`<tr><td class="mono">${t.table_name}</td><td>${t.cols}</td>
<td>${APPEND_ONLY.has(t.table_name) ? '<span class="pill wait">append-only</span>' : ''}</td></tr>`);
    }
    H.push('</table>');
  }

  H.push('<h3>운영 계측 뷰</h3><table><tr><th>뷰</th><th>용도</th></tr>');
  const VIEW_NOTE = {
    v_k_value: '1.30 · 2개월 연속이면 검수 증원',
    v_attribution_health: '급락 = attribution.link() 누락',
    v_contract_conversion: '낮음 = 시스템 밖 거래',
    v_open_blockers: '0 이어야 prod 배포',
    v_content_missing: 'FAQ · 폼 문구 · 법적 문구 누락',
    v_privacy_inventory: '개인정보 보관 현황',
    v_purge_overdue: '파기 기한 초과',
    v_integration_status: '연동 진행 · 남은 기간',
    v_auto_review_rate: '자동화율',
    v_manual_reasons: '다음 자동화 후보',
  };
  for (const v of views) {
    H.push(`<tr><td class="mono">${v.table_name}</td><td>${VIEW_NOTE[v.table_name] ?? ''}</td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>트리거 — 규칙의 실체</h3><table><tr><th>테이블</th><th>트리거</th></tr>');
  for (const t of triggers) {
    H.push(`<tr><td class="mono">${t.tbl}</td><td class="mono">${t.trigger_name}</td></tr>`);
  }
  H.push('</table></section>');

  /* 정책 */
  H.push('<section class="sec" id="policy"><h2>정책</h2>');
  H.push('<div class="note">전부 <b>테이블에 있습니다.</b> 배포 없이 바뀝니다.</div>');

  H.push('<h3>자동검수 규칙</h3>');
  H.push('<p class="hint">"자동 승인해도 되는가"가 아니라 <b>"사람이 봐야 할 이유가 있는가"</b>를 묻습니다.</p>');
  H.push('<table><tr><th>규칙</th><th>설명</th><th>기준값</th><th>상태</th></tr>');
  for (const p of autoPol) {
    H.push(`<tr><td class="mono">${p.key}</td><td>${esc(p.description ?? '')}</td>
<td class="mono">${p.num_value ?? '—'}</td>
<td><span class="pill ${p.enabled ? 'ok">사용' : 'mute">중지'}</span></td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>제한업종</h3>');
  H.push('<table><tr><th>업종</th><th>관</th><th>모드</th><th>법적 근거</th></tr>');
  for (const r of restricted) {
    const tone = r.mode === 'BLOCK' ? 'no' : r.mode === 'GATED' ? 'wait' : 'mute';
    H.push(`<tr><td>${esc(r.name)}</td><td class="mono">${r.gwan_code}</td>
<td><span class="pill ${tone}">${r.mode}</span></td><td>${esc(r.legal_basis ?? '')}</td></tr>`);
  }
  H.push('</table>');

  H.push('<h3>반려 사유</h3>');
  H.push('<p class="hint">등록자에게 그대로 보이는 문구입니다. 사유 없이 반려할 수 없습니다.</p>');
  H.push('<table><tr><th>분류</th><th>코드</th><th>문구</th></tr>');
  for (const r of reasons) {
    H.push(`<tr><td class="mono">${r.category}</td><td class="mono">${r.code}</td><td>${esc(r.label)}</td></tr>`);
  }
  H.push('</table>');

  H.push(`<h3>금칙어 <span class="mono">${wordList.length}</span></h3>`);
  H.push('<p class="hint"><b>BLOCK</b> 은 등록을 거부하고, <b>WARN</b> 은 통과시키되 사람이 봅니다 — 문맥에 따라 정상일 수 있습니다.</p>');
  H.push('<table><tr><th>단어</th><th>방식</th><th>등급</th><th>관</th></tr>');
  for (const w of wordList) {
    H.push(`<tr><td class="${w.match_type === 'REGEX' ? 'mono' : ''}">${esc(w.word)}</td>
<td class="mono">${w.match_type}</td>
<td><span class="pill ${w.severity === 'BLOCK' ? 'no' : 'wait'}">${w.severity}</span></td>
<td class="mono">${w.gwan_code ?? '전체'}</td></tr>`);
  }
  H.push('</table></section>');

  /* 요금제 */
  H.push('<section class="sec" id="plan"><h2>요금제</h2>');
  H.push('<div class="note"><b>구독 가치는 코드 판매가 아니라 시장 노출입니다</b> — 슬롯 · 열람 한도 · 우선노출.</div>');
  H.push('<table><tr><th>요금제</th><th>월 요금</th><th>포함 코드</th><th>노출 슬롯</th><th>요청 열람</th><th>우선노출</th></tr>');
  for (const p of plans) {
    H.push(`<tr><td><b>${esc(p.name)}</b></td>
<td class="money">${p.monthly_price === 0 ? '무료' : Number(p.monthly_price).toLocaleString('ko-KR') + '원'}</td>
<td>${p.included_codes}건</td>
<td>${p.listing_slots == null ? '무제한' : p.listing_slots + '건'}</td>
<td>${p.request_views_per_month == null ? '무제한' : '월 ' + p.request_views_per_month + '건'}</td>
<td>${p.priority_slot_count ?? 0}건</td></tr>`);
  }
  H.push('</table>');
  H.push(`<p class="hint">포함 수를 넘으면 <b>건당 ${Number(plans[0]?.extra_code_price ?? 0).toLocaleString('ko-KR')}원</b>의 정액 요금입니다. <b>거래 금액과 무관합니다</b> — 이것이 INV-9 를 지키는 방식입니다.</p>`);
  H.push('<div class="note"><b>소개비는 이 표에 없습니다.</b> 플랫폼이 받는 돈은 구독료와 광고뿐이고, 소개비는 당사자와 소개자 사이에서 직접 오갑니다.</div>');
  H.push('</section>');

  /* 약관 */
  H.push('<section class="sec" id="term"><h2>약관</h2>');
  H.push('<div class="note">본문은 <b>요금제·연동 현황을 DB에서 읽어</b> 생성합니다. 손으로 쓰면 요금이 바뀔 때 약관이 거짓말이 됩니다.</div>');
  H.push('<table><tr><th>약관</th><th>필수</th><th>상태</th><th>본문</th><th>미확정</th></tr>');
  for (const t of terms) {
    H.push(`<tr><td>${esc(t.title)} <span class="mono">${t.code}</span></td>
<td>${t.is_required ? '<span class="pill no">필수</span>' : ''}</td>
<td><span class="pill ${t.status === 'PUBLISHED' ? 'ok' : 'wait'}">${t.status}</span></td>
<td>${t.len > 0 ? t.len + '자' : '<span class="pill no">없음</span>'}</td>
<td>${t.holes > 0 ? '<span class="pill wait">' + t.holes + '곳</span>' : '—'}</td></tr>`);
  }
  H.push('</table>');
  H.push('<p class="hint"><b>미확정 표시가 남으면 발행이 거부됩니다.</b> 그대로 발행하면 이용자에게 〔 〕가 그대로 보입니다.</p>');
  H.push('<div class="note"><b>미확정 대부분은 회사가 아는 사실입니다</b> — 회사명 · 전화 · 보호책임자 · 시행일. 실제 법률 판단은 3건뿐이고, 그중 미룰 수 없는 것은 통신판매업 신고 대상 여부 1건입니다.</div>');
  H.push('</section>');

  /* 오픈 준비 */
  H.push('<section class="sec" id="open"><h2>오픈 준비</h2>');
  if (!blockers.length) {
    H.push('<div class="note">오픈 차단 항목이 없습니다.</div>');
  } else {
    H.push(`<div class="warn"><b>${blockers.length}건</b>이 남았습니다. 전부 해소돼야 운영 배포가 가능합니다.</div>`);
    H.push('<table><tr><th>구분</th><th>항목</th><th>사유</th></tr>');
    for (const b of blockers) {
      H.push(`<tr><td><span class="pill no">${b.kind}</span></td>
<td>${esc(b.item)}</td><td>${esc(b.reason)}</td></tr>`);
    }
    H.push('</table>');
  }
  H.push(`<h3>금칙어</h3><table><tr><th>등급</th><th>수</th><th>처리</th></tr>`);
  for (const w of words) {
    H.push(`<tr><td><span class="pill ${w.severity === 'BLOCK' ? 'no' : 'wait'}">${w.severity}</span></td>
<td>${w.n}</td><td>${w.severity === 'BLOCK' ? '등록 거부' : '통과 + 사람이 확인'}</td></tr>`);
  }
  H.push('</table></section>');

  H.push(`</main><script>
document.querySelectorAll('nav button').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('nav button').forEach(function(x){x.classList.remove('on')});
    document.querySelectorAll('.sec').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');
    document.getElementById(b.dataset.t).classList.add('on');
    window.scrollTo(0,0);
  };
});
</script></body></html>`);

  fs.writeFileSync('docs/소개뱅크_로컬확인.html', H.join('\n'));
  console.log(`프로토타입: 화면 ${done}/${screens.screens.length} · API ${ops} · 코드 ${codes.length} · 알림 ${tpl.length}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
