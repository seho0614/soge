#!/usr/bin/env node
/**
 * v10.596 (docs/738) ⑫ API 바뀐 점 자동 기록 — openapi(코드에서 뽑은 Swagger) 두 판 비교 → 마크다운 · JSON
 *
 *   쓰는 법:
 *     node scripts/api-diff.js <옛 판 json> <새 판 json> [--out docs/파일.md] [--json 파일.json] [--screens spec/screens.json] [--title v10.590 → v10.596]
 *   옛 판 json: 운영에 있는 킷(~/kits/release/<판>/sgb/docs/_swagger_from_code.json) · 새 판: npm run docs:swagger 결과(docs/_swagger_from_code.json)
 *   (docs/06_openapi.json — merge-openapi 결과 — 도 같은 모양이라 둘 중 무엇이든 됨 · x-roles · x-screens 가 있으면 함께 비교)
 *
 *   보는 것: 더해진 API · 없어진 API · 바뀐 API(요약 · 매개변수 더함/뺌/필수 바뀜 · 요청 본문 칸 더함/뺌/필수 바뀜 · 응답 코드 더함/뺌 ·
 *            응답 스키마 칸 더함/뺌(한 단계) · 역할 x-roles · 사용 안 함 deprecated) · 화면(spec/screens.json apis)으로 어느 화면 API 인지
 *   새 패키지 없음 · 네트워크 없음 · DB 없음. 종료 코드 0(바뀐 것이 있어도) · 파일을 못 읽으면 2.
 *   「없어진 API」 · 「필수로 바뀐 칸」은 앞 판 화면 · 앱이 깨질 수 있는 것이라 문서 맨 위 「주의」에 따로 모음.
 */
const fs = require('fs');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error(`읽지 못함: ${p} — ${e.message}`); process.exit(2); }
}
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (pos.length < 2) { console.error('쓰는 법: node scripts/api-diff.js <옛 판 json> <새 판 json> [--out 파일.md] [--json 파일.json] [--screens spec/screens.json] [--title 글]'); process.exit(2); }
const A = readJson(pos[0]), B = readJson(pos[1]);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** $ref → 스키마(한 번만 따라감 · 돌고 도는 것 막음) */
function deref(doc, s, depth = 0) {
  if (!s || depth > 3) return s || {};
  if (s.$ref) { const k = s.$ref.split('/').pop(); return deref(doc, doc.components?.schemas?.[k] ?? {}, depth + 1); }
  if (s.allOf) return s.allOf.reduce((acc, x) => { const d = deref(doc, x, depth + 1); return { ...acc, properties: { ...(acc.properties ?? {}), ...(d.properties ?? {}) }, required: [...(acc.required ?? []), ...(d.required ?? [])] }; }, {});
  return s;
}
function shape(doc, s) {
  const d = deref(doc, s);
  const t = d.type === 'array' ? deref(doc, d.items) : d;
  return { props: Object.keys(t.properties ?? {}).sort(), required: [...new Set(t.required ?? [])].sort(), array: d.type === 'array' };
}
function ops(doc) {
  const m = new Map();
  for (const [p, item] of Object.entries(doc.paths ?? {})) {
    for (const k of METHODS) {
      const o = item[k];
      if (!o) continue;
      const params = [...(item.parameters ?? []), ...(o.parameters ?? [])].map((x) => deref(doc, x)).map((x) => ({ key: `${x.in}:${x.name}`, required: !!x.required }));
      const body = o.requestBody ? shape(doc, Object.values(o.requestBody.content ?? {})[0]?.schema) : null;
      const responses = Object.keys(o.responses ?? {}).sort();
      const ok = o.responses?.['200'] ?? o.responses?.['201'];
      const okShape = ok ? shape(doc, Object.values(ok.content ?? {})[0]?.schema) : null;
      m.set(`${k.toUpperCase()} ${p}`, {
        summary: o.summary ?? '', params, body, bodyRequired: !!o.requestBody?.required, responses, okShape,
        roles: (o['x-roles'] ?? []).slice().sort(), deprecated: !!o.deprecated, tag: (o.tags ?? [])[0] ?? '',
      });
    }
  }
  return m;
}
const oa = ops(A), ob = ops(B);
const added = [...ob.keys()].filter((k) => !oa.has(k)).sort();
const removed = [...oa.keys()].filter((k) => !ob.has(k)).sort();
const changed = [];
const warn = [];
const diffList = (x, y) => ({ plus: y.filter((v) => !x.includes(v)), minus: x.filter((v) => !y.includes(v)) });
for (const k of [...ob.keys()].filter((x) => oa.has(x)).sort()) {
  const a = oa.get(k), b = ob.get(k), c = [];
  if (a.summary !== b.summary) c.push(`요약: 「${a.summary}」 → 「${b.summary}」`);
  const pa = a.params.map((x) => x.key), pb = b.params.map((x) => x.key);
  const pd = diffList(pa, pb);
  if (pd.plus.length) c.push(`매개변수 더함: ${pd.plus.join(', ')}`);
  if (pd.minus.length) c.push(`매개변수 뺌: ${pd.minus.join(', ')}`);
  for (const p of b.params) {
    const o = a.params.find((x) => x.key === p.key);
    if (o && o.required !== p.required) { c.push(`매개변수 ${p.key}: ${p.required ? '필수가 됨' : '선택이 됨'}`); if (p.required) warn.push(`${k} — 매개변수 ${p.key} 필수가 됨`); }
    if (!o && p.required) warn.push(`${k} — 필수 매개변수 ${p.key} 새로 생김`);
  }
  if (a.body || b.body) {
    const ba = a.body ?? { props: [], required: [] }, bb = b.body ?? { props: [], required: [] };
    const bd = diffList(ba.props, bb.props), rd = diffList(ba.required, bb.required);
    if (bd.plus.length) c.push(`요청 칸 더함: ${bd.plus.join(', ')}`);
    if (bd.minus.length) c.push(`요청 칸 뺌: ${bd.minus.join(', ')}`);
    if (rd.plus.length) { c.push(`요청 칸 필수가 됨: ${rd.plus.join(', ')}`); warn.push(`${k} — 요청 칸 필수: ${rd.plus.join(', ')}`); }
    if (rd.minus.length) c.push(`요청 칸 선택이 됨: ${rd.minus.join(', ')}`);
  }
  const rs = diffList(a.responses, b.responses);
  if (rs.plus.length) c.push(`응답 코드 더함: ${rs.plus.join(', ')}`);
  if (rs.minus.length) c.push(`응답 코드 뺌: ${rs.minus.join(', ')}`);
  if (a.okShape && b.okShape) {
    const od = diffList(a.okShape.props, b.okShape.props);
    if (od.plus.length) c.push(`응답 칸 더함: ${od.plus.join(', ')}`);
    if (od.minus.length) { c.push(`응답 칸 뺌: ${od.minus.join(', ')}`); warn.push(`${k} — 응답 칸 없어짐: ${od.minus.join(', ')}`); }
  }
  const rl = diffList(a.roles, b.roles);
  if (rl.plus.length || rl.minus.length) c.push(`역할: ${a.roles.join(' · ') || '—'} → ${b.roles.join(' · ') || '—'}`);
  if (a.deprecated !== b.deprecated) c.push(b.deprecated ? '사용 안 함(deprecated)으로 표시' : '사용 안 함 표시 풂');
  if (c.length) changed.push({ op: k, changes: c });
}
for (const k of removed) warn.unshift(`${k} — 없어짐`);

/* 화면 표시 — spec/screens.json 의 apis 는 「METHOD /경로」(앞 /api/v1 없음) */
const scrPath = opt('--screens');
const scr = new Map();
if (scrPath && fs.existsSync(scrPath)) {
  const S = readJson(scrPath);
  for (const s of S.screens ?? []) for (const a of s.apis ?? []) { const key = a.replace(/\s+/, ' '); (scr.get(key) ?? scr.set(key, []).get(key)).push(s.id); }
}
const short = (k) => k.replace(' /api/v1/', ' /');
const screensOf = (k) => (scr.get(short(k)) ?? []).join(' · ');

const title = opt('--title') ?? `${pos[0]} → ${pos[1]}`;
const lines = [];
lines.push(`# API 바뀐 점 — ${title}`, '', `> scripts/api-diff.js 로 만듦(${new Date().toISOString().slice(0, 10)}) · 옛 판 ${oa.size}개 · 새 판 ${ob.size}개 API`, '');
lines.push('| 구분 | 수 |', '|---|---|', `| 더해진 API | ${added.length} |`, `| 없어진 API | ${removed.length} |`, `| 바뀐 API | ${changed.length} |`, `| 주의(앞 판 화면 · 앱이 깨질 수 있음) | ${warn.length} |`, '');
if (warn.length) { lines.push('## 주의', ''); warn.forEach((w) => lines.push(`- ${w}`)); lines.push(''); }
lines.push('## 더해진 API', '');
if (!added.length) lines.push('없음');
else { lines.push('| API | 요약 | 역할 | 화면 |', '|---|---|---|---|'); for (const k of added) { const o = ob.get(k); lines.push(`| \`${short(k)}\` | ${o.summary.replace(/\|/g, '\\|')} | ${o.roles.join(' · ')} | ${screensOf(k)} |`); } }
lines.push('', '## 없어진 API', '');
if (!removed.length) lines.push('없음');
else removed.forEach((k) => lines.push(`- \`${short(k)}\` — ${oa.get(k).summary}`));
lines.push('', '## 바뀐 API', '');
if (!changed.length) lines.push('없음');
else for (const c of changed) { lines.push(`### \`${short(c.op)}\`${screensOf(c.op) ? ` (${screensOf(c.op)})` : ''}`, ''); c.changes.forEach((x) => lines.push(`- ${x}`)); lines.push(''); }
const md = lines.join('\n') + '\n';

const out = opt('--out');
if (out) fs.writeFileSync(out, md); else process.stdout.write(md);
const js = opt('--json');
if (js) fs.writeFileSync(js, JSON.stringify({ title, added, removed, changed, warn, counts: { old: oa.size, new: ob.size } }, null, 2) + '\n');
if (out) console.log(`API 바뀐 점 — 더함 ${added.length} · 없어짐 ${removed.length} · 바뀜 ${changed.length} · 주의 ${warn.length} → ${out}`);
process.exit(0);
