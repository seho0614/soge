#!/usr/bin/env node
/**
 * 통합 매트릭스 — 화면 · 백엔드 · API · DB 를 코드에서 직접 뽑아 서로 대조합니다.
 *
 *   DATABASE_URL=... node scripts/gen-matrix.js
 *
 * 산출
 *   docs/matrix/screens.csv    화면 → 구현 위치(사용자 웹·관리자·시안) → 호출 API
 *   docs/matrix/backend.csv    컨트롤러 핸들러 → 서비스 → 사용 테이블
 *   docs/matrix/apis.csv       API → 권한 → 구현 여부 → 부르는 화면/파일 → 테이블
 *   docs/matrix/db.csv         테이블·뷰 → 쓰는 API 수 → 행 수 → 설명
 *   docs/matrix/matrix.json    위 전부 + 교차 점검 결과
 *
 * ── 왜 손으로 쓰지 않는가 ─────────────────────────────────────────
 * 손으로 쓴 목록은 쓰는 날부터 코드와 갈라집니다. 이 스크립트는 코드와
 * 실제 DB 를 읽으므로, 다시 돌리면 그날의 사실이 나옵니다.
 *
 * ── 정밀도 ────────────────────────────────────────────────────────
 * 핸들러 → 서비스 메서드 → SQL 의 테이블 이름을 정적으로 따라갑니다.
 * 동적으로 만든 SQL(문자열 조합)은 놓칠 수 있습니다. 그런 곳은
 * "모듈 단위" 로 한 번 더 잡아 table_scope=module 로 표시합니다.
 */
require('./load-env');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir, re) => {
  const out = [];
  const go = (d) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f.startsWith('.')) continue;
      const st = fs.statSync(p);
      if (st.isDirectory()) go(p); else if (re.test(f)) out.push(p);
    }
  };
  go(path.join(ROOT, dir));
  return out;
};
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const ID_RE = /SB-[A-Z]{3}-[A-Z0-9]{3,4}-\d{3}/g;
const uniq = (a) => [...new Set(a)];
const reEsc = (x) => x.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

/* 경로 정규화 — {id} · :id · ${x} 를 모두 {} 로 */
const norm = (p) => p.split('?')[0]
  .replace(/^\/api\/v1/, '')
  .replace(/\$\{[^}]*$/, '')                      // 닫히지 않은 ${ (쿼리 조립 중간에서 잘림)
  .replace(/([^/])\$\{[^}]*\}$/, '$1/**')          // 세그먼트에 바로 붙은 ${path} = 하위 경로 가변
  .replace(/\$\{[^}]*\}/g, '{}')
  .replace(/\{[^}]*\}/g, '{}')
  .replace(/:[A-Za-z_]+/g, '{}')
  .replace(/\/+$/, '') || '/';

/* 괄호 짝을 맞춰 블록 본문을 잘라냅니다 */
function block(src, openIdx) {
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}

(async () => {
  /* ═════ 1. DB ═════════════════════════════════════════════════════ */
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows: rels } = await db.query(`
    SELECT n.nspname sch, c.relname name,
           CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE'
                          WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MVIEW' END kind,
           obj_description(c.oid) cmt,
           (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)::int cols,
           c.reltuples::bigint est,
           (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)::int trg
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind IN ('r','p','v','m') AND NOT c.relispartition
       AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     ORDER BY 1,2`);
  const { rows: fns } = await db.query(`
    SELECT p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`);
  for (const r of rels.filter((x) => x.kind === 'TABLE' && x.sch === 'public')) {
    try {
      const { rows } = await db.query(`SELECT count(*)::int n FROM public."${r.name}"`);
      r.rows = rows[0].n;
    } catch { r.rows = null; }
  }
  const { rows: [ver] } = await db.query(`SELECT count(*)::int n FROM schema_migrations`);
  await db.end();
  const relNames = new Set(rels.map((r) => r.name));
  const fnNames = new Set(fns.map((f) => f.name));
  const relByName = Object.fromEntries(rels.map((r) => [r.name, r]));

  /* SQL 조각에서 테이블·뷰·함수 이름을 뽑습니다 */
  const TBL_RE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:ONLY\s+)?(?:public\.|"?)([a-z_][a-z0-9_]*)/gi;
  const FN_RE = /\b(fn_[a-z0-9_]+)\s*\(/g;
  function tablesIn(src) {
    const t = [], f = [];
    for (const m of src.matchAll(TBL_RE)) { const n = m[1].toLowerCase(); if (relNames.has(n)) t.push(n); }
    for (const m of src.matchAll(FN_RE)) if (fnNames.has(m[1])) f.push(m[1]);
    return { tables: uniq(t), fns: uniq(f) };
  }

  /* ═════ 2. 백엔드 ═════════════════════════════════════════════════ */
  const srcFiles = walk('src', /\.ts$/).filter((f) => !f.includes('/generated/'));
  const fileText = Object.fromEntries(srcFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

  /* 메서드 정의 찾기: 이름 → [{file, body}] */
  const methodIndex = {};
  for (const [f, s] of Object.entries(fileText)) {
    const re = /^\s{2,4}(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{;]*\{/gm;
    for (const m of s.matchAll(re)) {
      const name = m[1];
      if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'function'].includes(name)) continue;
      const body = block(s, m.index + m[0].length - 1);
      (methodIndex[name] ??= []).push({ file: f, body });
    }
  }
  /* 호출을 두 단계까지 따라가며 SQL 을 모읍니다 */
  function traceSql(body, file, depth = 0, seen = new Set()) {
    let acc = body;
    if (depth >= 3) return acc;
    const calls = uniq([...body.matchAll(/this\.(?:\w+\.)?(\w+)\s*\(/g)].map((m) => m[1]));
    for (const c of calls) {
      if (seen.has(c) || ['query', 'transaction', 'one', 'many', 'get', 'set', 'log'].includes(c)) continue;
      seen.add(c);
      const defs = methodIndex[c] ?? [];
      /* 같은 모듈 파일을 먼저 봅니다 — 이름이 흔하면 엉뚱한 곳을 잡습니다 */
      const mod = path.dirname(file);
      const pick = defs.filter((d) => path.dirname(d.file) === mod);
      for (const d of (pick.length ? pick : defs.length <= 2 ? defs : [])) {
        acc += '\n' + traceSql(d.body, d.file, depth + 1, seen);
      }
    }
    return acc;
  }

  const handlers = [];
  for (const f of srcFiles.filter((x) => x.endsWith('.controller.ts') || /controller/i.test(x))) {
    const s = fileText[f];
    const ctrlRe = /@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)[\s\S]*?export\s+class\s+(\w+)/g;
    const ctrls = [...s.matchAll(ctrlRe)];
    for (let ci = 0; ci < ctrls.length; ci++) {
      const cm = ctrls[ci];
      const start = cm.index;
      const end = ci + 1 < ctrls.length ? ctrls[ci + 1].index : s.length;
      const seg = s.slice(start, end);
      const prefix = cm[1];
      const cls = cm[2];
      const clsHead = seg.slice(0, seg.indexOf('export class'));
      const clsRoles = (clsHead.match(/@Roles\(([^)]*)\)/) || [, ''])[1].replace(/['"\s]/g, '');
      const hRe = /@(Get|Post|Patch|Put|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)([\s\S]*?)\n\s{2}(?:async\s+)?(\w+)\s*\(/g;
      for (const hm of seg.matchAll(hRe)) {
        const method = hm[1].toUpperCase();
        const sub = hm[2] ?? '';
        const deco = hm[3];
        const name = hm[4];
        const full = '/' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '');
        const roles = (deco.match(/@Roles\(([^)]*)\)/) || [, ''])[1].replace(/['"\s]/g, '') || clsRoles;
        const gate = (deco.match(/@RequireGate\(([^)]*)\)/) || [, ''])[1].replace(/['"\s]/g, '');
        const isPublic = /@Public\(/.test(deco);
        const bodyStart = hm.index + hm[0].length;
        const braceIdx = seg.indexOf('{', bodyStart);
        const body = block(seg, braceIdx);
        const svc = uniq([...body.matchAll(/this\.(\w+)\.(\w+)\s*\(/g)].map((m) => `${m[1]}.${m[2]}`));
        const sql = traceSql(body, f);
        const { tables, fns: fnsUsed } = tablesIn(sql);
        handlers.push({
          method, path: full.replace(/^\/api\/v1/, '') || '/', full, key: `${method} ${norm(full)}`,
          controller: cls, handler: name, file: rel(f), module: rel(f).split('/')[2] ?? '',
          roles: isPublic ? 'PUBLIC' : roles, gate, services: svc, tables, fns: fnsUsed,
        });
      }
    }
  }
  /* 모듈 단위 테이블 (정적 추적이 비었을 때 보조) */
  const moduleTables = {};
  for (const [f, s] of Object.entries(fileText)) {
    const m = rel(f).split('/')[2];
    if (!m) continue;
    moduleTables[m] = uniq([...(moduleTables[m] ?? []), ...tablesIn(s).tables]);
  }

  /* 호출 키가 어느 핸들러로 가는가 — {} 는 한 세그먼트, /** 는 하위 경로 아무거나 */
  function matchHandlers(callKey) {
    const [m, p] = callKey.split(' ');
    const exact = handlers.filter((h) => h.key === callKey);
    if (exact.length) return exact;
    const re = new RegExp('^' + reEsc(p).replace(/\/\\\*\\\*/g, '(/.+)?').replace(/\\\{\\\}/g, '[^/]+').replace(/\{\}/g, '[^/]+') + '$');
    const hit = handlers.filter((h) => h.method === m && re.test(norm(h.full)));
    if (hit.length) return hit;
    /* v10.31 — 화면이 경로 변수 자리에 글자를 그대로 쓴 호출(/terms/doc/SERVICE · /biz/axis/SVC)은 핸들러 쪽 {} 가 그 글자를 받습니다 */
    return handlers.filter((h) => h.method === m && new RegExp('^' + reEsc(norm(h.full)).replace(/\{\}/g, '[^/]+') + '$').test(p));
  }
  const hasHandler = (k) => matchHandlers(k).length > 0;

  /* ═════ 3. OpenAPI (코드에서 생성된 것) ════════════════════════════ */
  const oa = JSON.parse(rd('docs/06_openapi.json'));
  const oaOps = {};
  for (const [p, ops] of Object.entries(oa.paths)) for (const [m, o] of Object.entries(ops)) {
    oaOps[`${m.toUpperCase()} ${norm(p)}`] = o;
  }

  /* ═════ 4. 화면 구현 — 사용자 웹(site) · 관리자(web) ════════════════ */
  function callsIn(s) {
    const out = [];
    const re = /(getJson|apiGetPersonal|apiGet|apiPost|apiPatch|apiDelete|api|useApi|fetch)\s*(?:<[^>]*>)?\(\s*([`'"])([^`'"]+)\2(?=([\s\S]{0,260}))/g;   // 꼬리는 미리보기만 — 먹으면 바로 뒤 호출을 놓칩니다
    for (const m of s.matchAll(re)) {
      let p = m[3];
      if (!p.startsWith('/')) continue;
      /* 꼬리는 다음 호출 앞에서 자릅니다 — 안 자르면 다음 호출의 method 를 빌려 옵니다 */
      const tail = m[4].split(/\b(?:useApi|getJson|apiGetPersonal|apiGet|apiPost|apiPatch|apiDelete|api|fetch)\s*(?:<[^>]*>)?\(/)[0];
      let meth = 'GET';
      const mm = tail.match(/method\s*:\s*['"`](\w+)['"`]/);
      if (mm && tail.indexOf(mm[0]) < 200) meth = mm[1].toUpperCase();
      if (/^apiPost/.test(m[1])) meth = 'POST';
      if (/^apiPatch/.test(m[1])) meth = 'PATCH';
      if (/^apiDelete/.test(m[1])) meth = 'DELETE';
      if (/^\{\}/.test(norm(p))) continue;   // v10.31 — 부르는 도우미 자체(fetch(`/api/v1${url}`)) — 실제 경로는 아래 api('POST', '/…') 쪽에서 잡습니다
      out.push(`${meth} ${norm(p)}`);
    }
    /* v10.31 — 파트너센터 도우미 api('POST', '/partner/…', body) · <ActButton method="POST" url="/partner/…"> */
    for (const m of s.matchAll(/\bapi\s*(?:<[^>]*>)?\(\s*['"](GET|POST|PATCH|PUT|DELETE)['"]\s*,\s*([`'"])(\/[^`'"]+)\2/g)) out.push(`${m[1]} ${norm(m[3])}`);
    for (const m of s.matchAll(/<ActButton\b([^>]*?)\burl=\{?\s*([`'"])(\/[^`'"]+)\2/g)) {
      const mm = m[1].match(/\bmethod=\{?\s*['"`](\w+)['"`]/) || m[0].match(/\bmethod=\{?\s*['"`](\w+)['"`]/);
      out.push(`${mm ? mm[1].toUpperCase() : 'POST'} ${norm(m[3])}`);
    }
    return uniq(out);
  }
  /* 20261002 — 보조 근거: 호출 도우미(patch() · run() · useState 경로 등)로 부르면 위 정규식이
   * 메서드·경로를 못 읽습니다. 파일 안의 **경로 문자열**과 **메서드 낱말**을 따로 모아
   * 레지스트리 API 가 "불리는지" 판정할 때만 씁니다(프런트→API 교차 점검에는 안 씀). */
  const mentionsIn = (s) => uniq([...s.matchAll(/[`'"]((?:\/api\/v1)?\/[a-z][\w\-/${}.:]*)/g)].flatMap((m) => [norm(m[1]), norm(m[1].replace(/\$\{[^}]*\}$/, ''))]));
  const methodsIn = (s) => uniq([...s.matchAll(/\b(POST|PATCH|PUT|DELETE)\b|\b(post|patch|put|del|remove)\s*\(/gi)]
    .map((m) => (m[1] || m[2]).toUpperCase().replace(/^DEL$|^REMOVE$/, 'DELETE')));
  const linksIn = (s) => uniq([...s.matchAll(/href=\{?\s*[`'"](\/[^`'"#?]*)[`'"]/g)].map((m) => norm(m[1])));
  const routeOf = (f) => '/' + rel(f).replace(/^site\/src\/app\/?/, '').replace(/\/?page\.tsx$/, '')
    .replace(/\[([^\]]+)\]/g, '{}');

  const sitePages = walk('site/src/app', /^page\.tsx$/).map((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return { app: 'site', file: rel(f), route: norm(routeOf(f)), ids: uniq(s.match(ID_RE) ?? []),
             calls: callsIn(s), links: linksIn(s), mentions: mentionsIn(s), methods: methodsIn(s) };
  });
  /* 페이지가 import 하는 컴포넌트(같은 폴더 · @/components)가 부르는 API 도
   * 그 페이지 것으로 칩니다. 폼은 대개 옆 파일(ServiceForm.tsx)에 있습니다. */
  const resolveImp = (fromFile, spec) => {
    let base;
    if (spec.startsWith('@/')) base = path.join(ROOT, 'site/src', spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
    else return null;
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (fs.existsSync(base + ext)) return base + ext;
    return null;
  };
  const expand = (file, seen = new Set(), depth = 0) => {
    if (seen.has(file) || depth > 3) return { calls: [], links: [] };
    seen.add(file);
    const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let calls = callsIn(s), links = linksIn(s), mentions = mentionsIn(s), methods = methodsIn(s);
    for (const m of s.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (/@\/lib\//.test(m[1])) continue;
      const f = resolveImp(file, m[1]);
      if (!f) continue;
      const r = expand(rel(f), seen, depth + 1);
      calls = calls.concat(r.calls); links = links.concat(r.links);
      mentions = mentions.concat(r.mentions); methods = methods.concat(r.methods);
    }
    return { calls: uniq(calls), links: uniq(links), mentions: uniq(mentions), methods: uniq(methods) };
  };
  for (const p of sitePages) { const r = expand(p.file); Object.assign(p, r); }
  const app = rd('web/src/App.tsx');
  const tabs = [...app.matchAll(/\['([\w-]+)',\s*'([^']+)'\]/g)].map((m) => ({ tab: m[1], label: m[2] }));
  const adminPages = walk('web/src/app', /\.tsx$/).map((f) => {
    const s = fs.readFileSync(f, 'utf8');
    const comp = path.basename(f, '.tsx');
    const tm = app.match(new RegExp(`tab === '([\\w-]+)'[^\\n]*<${comp}\\b`)) ||
               app.match(new RegExp(`'([\\w-]+)'\\s*(?:\\?|&&)[^\\n]*<${comp}\\b`));
    const tab = tm ? tm[1] : '';
    return { app: 'admin', file: rel(f), route: tab ? `admin#${tab}` : 'admin(하위)', tab,
             label: (tabs.find((t) => t.tab === tab) || {}).label ?? '', ids: uniq(s.match(ID_RE) ?? []),
             calls: callsIn(s), links: [], mentions: mentionsIn(s), methods: methodsIn(s) };
  });

  /* ═════ 5. 화면 레지스트리 · 시안 ═══════════════════════════════════ */
  const S = JSON.parse(rd('spec/screens.json'));
  let protoMap = {};
  if (fs.existsSync(path.join(ROOT, 'spec/proto_ids.json'))) protoMap = JSON.parse(rd('spec/proto_ids.json'));
  const protoById = {};
  for (const [k, v] of Object.entries(protoMap)) for (const id of v.ids ?? []) (protoById[id] ??= []).push(k);

  const allPages = [...sitePages, ...adminPages];
  const screens = S.screens.map((sc) => {
    const url = norm(sc.url.replace(/^https?:\/\/[^/]+/, '').replace(/^[a-z.]+\.co\.kr/, '') || '/');
    let impl = allPages.filter((p) => p.ids.includes(sc.id));
    let how = 'ID';
    if (!impl.length) { impl = sitePages.filter((p) => p.route === url); how = 'URL'; }
    /* 동적 경로 — /money 는 [gwan] 페이지, /money/{id} 는 [gwan]/[id] 페이지가 받습니다 */
    if (!impl.length && !url.startsWith('/admin')) {
      /* [gwan] 자리는 관 주소(money · mall · biz · health)만, 그 뒤 {} 자리는 식별자({})만 받습니다 —
       * 아니면 /my/account 가 [gwan]/[id] 로 잘못 붙습니다. */
      const GW = ['money', 'mall', 'biz', 'health'];
      impl = sitePages.filter((p) => {
        if (!p.route.includes('{}')) return false;
        const rs = p.route.split('/'), us = url.split('/');
        if (rs.length !== us.length) return false;
        return rs.every((sg, i) => sg === us[i] ||
          (sg === '{}' && (i === 1 && p.route.startsWith('/{}') ? GW.includes(us[i]) : us[i] === '{}')));
      });
      how = 'URL(동적)';
    }
    if (!impl.length) how = '';
    const regApis = (sc.apis ?? []).map((a) => { const [m, p] = a.split(' '); return `${m} ${norm(p)}`; });
    const called = uniq(impl.flatMap((p) => p.calls));
    return {
      id: sc.id, name: sc.name, group: sc.group, url: sc.url, bo: sc.bo ?? '', roles: sc.roles.join('|'), gates: sc.gates.join('|'),
      nav: sc.nav, impl: impl.map((p) => p.file), impl_route: impl.map((p) => p.route), match: how,
      proto: protoById[sc.id] ?? [],
      apis_registry: regApis, apis_called: called,
      apis_missing_backend: uniq([...regApis, ...called]).filter((a) => !hasHandler(a)),
      apis_registry_not_called: impl.length ? regApis.filter((a) => {
        if (called.includes(a)) return false;
        const [m, pth] = a.split(' ');
        const ment = impl.some((p) => (p.mentions ?? []).includes(pth) && (m === 'GET' || (p.methods ?? []).includes(m)));
        return !ment;
      }) : [],
    };
  });

  /* ═════ 6. API 교차 ═══════════════════════════════════════════════ */
  const apis = handlers.map((h) => {
    const o = oaOps[h.key] ?? {};
    const callers = allPages.filter((p) => p.calls.some((c) => matchHandlers(c).includes(h))).map((p) => p.file);
    const regScreens = screens.filter((s) => s.apis_registry.includes(h.key)).map((s) => s.id);
    return {
      method: h.method, path: h.path, module: h.module, controller: `${h.controller}.${h.handler}`,
      roles: h.roles, gate: h.gate, status: o['x-status'] ?? '(문서 없음)',
      screens_registry: regScreens, callers,
      tables: h.tables.length ? h.tables : [], table_scope: h.tables.length ? 'handler' : 'module',
      tables_module: h.tables.length ? [] : (moduleTables[h.module] ?? []), fns: h.fns,
    };
  });

  /* ═════ 7. DB 교차 ════════════════════════════════════════════════ */
  const dbRows = rels.map((r) => {
    const users = apis.filter((a) => a.tables.includes(r.name));
    const mods = Object.entries(moduleTables).filter(([, t]) => t.includes(r.name)).map(([m]) => m);
    return { schema: r.sch, name: r.name, kind: r.kind, cols: r.cols, rows: r.rows ?? '', triggers: r.trg,
             apis: users.length, modules: mods, comment: (r.cmt ?? '').replace(/\s+/g, ' ').slice(0, 140) };
  });

  /* ═════ 8. 교차 점검 ══════════════════════════════════════════════ */
  const issues = [];
  const add = (sev, area, what, detail) => issues.push({ sev, area, what, detail });
  /* v10.32 — 운영 화면(BO) 주소(spec/screens.json 의 bo = '#/탭' 또는 '#/탭/하위')가 실제로 열리는지 봅니다.
   *   탭 키가 adminMenu.ts TABS 에 있고 · App.tsx 가 그 탭에 그리는 화면이 있고 · 하위 키가 그 화면(또는 그 화면이 가져오는 파일)에 있어야 합니다. */
  const menuSrc = fs.existsSync(path.join(ROOT, 'web/src/lib/adminMenu.ts')) ? rd('web/src/lib/adminMenu.ts') : app;
  const menuTabs = new Set([...menuSrc.matchAll(/\['([\w-]+)',\s*'[^']+'\]/g)].map((m) => m[1]));
  const boCheck = (bo) => {
    const m = /^#\/([\w-]+)(?:\/([\w-]+))?$/.exec(bo);
    if (!m) return '주소 모양이 #/탭 또는 #/탭/하위 가 아님';
    if (!menuTabs.has(m[1])) return `탭 ${m[1]} 이 adminMenu TABS 에 없음`;
    const cm = app.match(new RegExp(`tab === '${reEsc(m[1])}'[^\\n]*?<(\\w+)`));
    if (!cm) return `App.tsx 가 탭 ${m[1]} 에 그리는 화면이 없음`;
    if (!m[2]) return null;
    const f = path.join(ROOT, 'web/src/app/admin', cm[1] + '.tsx');
    if (!fs.existsSync(f)) return `${cm[1]}.tsx 없음`;
    const src = fs.readFileSync(f, 'utf8');
    return new RegExp(`['"\`]${reEsc(m[2])}['"\`]`).test(src) ? null : `하위 ${m[2]} 이 ${cm[1]}.tsx 에 없음`;
  };
  for (const s of screens) {
    if (s.bo) { const why = boCheck(s.bo); if (why) add('중', '화면 주소', `${s.id} ${s.bo}`, why); }
    if (!s.impl.length && !s.proto.length) add('중', '화면', `${s.id} ${s.name}`, '구현 파일도 시안도 없음');
    for (const a of s.apis_missing_backend) add('상', '화면→API', `${s.id}`, `${a} — 백엔드에 없음`);
  }
  const allCalls = uniq(allPages.flatMap((p) => p.calls));
  for (const c of allCalls) if (!hasHandler(c)) {
    add('상', '프런트→API', c, `부르는 곳: ${allPages.filter((p) => p.calls.includes(c)).map((p) => p.file).join(', ')}`);
  }
  for (const a of apis) {
    if (!a.screens_registry.length && !a.callers.length && !/^\/(health|admin\/jobs)/.test(a.path)) {
      add('하', 'API', `${a.method} ${a.path}`, '화면·호출처 없음 (고아 API)');
    }
  }
  /* 라우트 가림 — 같은 메서드에서 `x/:id` 가 먼저 선언되면 뒤의 `x/manage` 는
   * 영영 닿지 않습니다(20260930 실측 3건). 등록 순서 = AppModule 컨트롤러 순서 × 파일 순서. */
  {
    const appSrc = rd('src/app.module.ts');
    const order = appSrc.split('controllers: [')[1].split(']')[0].split(',').map((x) => x.trim()).filter(Boolean);
    const rank = Object.fromEntries(order.map((c, i) => [c, i]));
    const seq = handlers.map((h, i) => ({ h, i })).sort((a, b) =>
      ((rank[a.h.controller] ?? 999) - (rank[b.h.controller] ?? 999)) || (a.i - b.i)).map((x) => x.h);
    const rxOf = (p) => new RegExp('^' + p.split('/').map((sg) => sg.startsWith(':') ? '[^/]+' : reEsc(sg)).join('/') + '$');
    seq.forEach((h, i) => {
      for (const prev of seq.slice(0, i)) {
        if (prev.method === h.method && prev.full !== h.full && prev.full.includes(':') &&
            !h.full.split('/').pop().startsWith(':') && rxOf(prev.full).test(h.full)) {
          add('상', '라우트 가림', `${h.method} ${h.path}`, `${prev.path} 가 먼저 잡습니다 (${prev.controller}) — 이 API 는 닿지 않습니다`);
          break;
        }
      }
    });
  }
  const routes = new Set(sitePages.map((p) => p.route));
  for (const p of sitePages) for (const l of p.links) {
    /* v10.31 — 링크의 {} 자리(`/deal/${id}/${path}` 같은 단계 이동)는 그 자리에 오는 어떤 경로든 받습니다 */
    const ok = routes.has(l) || [...routes].some((r) => new RegExp('^' + r.replace(/\{\}/g, '[^/]+') + '$').test(l)) ||
               [...routes].some((r) => new RegExp('^' + reEsc(l).replace(/\{\}/g, '[^/]+') + '$').test(r)) ||
               /^\/(api|docs)\b/.test(l);
    if (!ok) add('중', '링크', `${p.route} → ${l}`, `${p.file} — 목적지 페이지 없음`);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    migrations: ver.n,
    screens_registry: screens.length,
    screens_with_impl: screens.filter((s) => s.impl.length).length,
    screens_with_proto: screens.filter((s) => s.proto.length).length,
    site_pages: sitePages.length, admin_pages: adminPages.length,
    handlers: handlers.length, openapi_ops: Object.keys(oaOps).length,
    tables: rels.filter((r) => r.kind === 'TABLE').length, views: rels.filter((r) => r.kind !== 'TABLE').length,
    functions: fns.length,
    issues: { 상: issues.filter((i) => i.sev === '상').length, 중: issues.filter((i) => i.sev === '중').length, 하: issues.filter((i) => i.sev === '하').length },
  };

  /* ═════ 9. 쓰기 ═══════════════════════════════════════════════════ */
  const OUT = path.join(ROOT, 'docs/matrix');
  fs.mkdirSync(OUT, { recursive: true });
  const csv = (rows, cols) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => {
    const v = Array.isArray(r[c]) ? r[c].join(' | ') : (r[c] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','))].join('\n');
  fs.writeFileSync(path.join(OUT, 'screens.csv'), csv(screens,
    ['id', 'name', 'group', 'url', 'bo', 'roles', 'gates', 'impl', 'match', 'proto', 'apis_registry', 'apis_called', 'apis_missing_backend']));
  fs.writeFileSync(path.join(OUT, 'backend.csv'), csv(handlers,
    ['module', 'controller', 'handler', 'method', 'path', 'roles', 'gate', 'services', 'tables', 'fns', 'file']));
  fs.writeFileSync(path.join(OUT, 'apis.csv'), csv(apis,
    ['method', 'path', 'module', 'controller', 'roles', 'gate', 'status', 'screens_registry', 'callers', 'tables', 'table_scope', 'fns']));
  fs.writeFileSync(path.join(OUT, 'db.csv'), csv(dbRows,
    ['schema', 'name', 'kind', 'cols', 'rows', 'triggers', 'apis', 'modules', 'comment']));
  fs.writeFileSync(path.join(OUT, 'pages.csv'), csv(allPages.map((p) => ({ ...p })),
    ['app', 'route', 'file', 'ids', 'calls', 'links']));
  fs.writeFileSync(path.join(OUT, 'issues.csv'), csv(issues, ['sev', 'area', 'what', 'detail']));
  fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify({ summary, screens, pages: allPages, backend: handlers, apis, db: dbRows, issues }, null, 1));
  /* ── 사람이 읽는 판 (docs/39_통합매트릭스.md) ── */
  const esc = (v) => String(Array.isArray(v) ? v.join(', ') : (v ?? '')).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const tbl = (rows, cols, heads) => [
    '| ' + heads.join(' | ') + ' |', '|' + heads.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + cols.map((c) => esc(typeof c === 'function' ? c(r) : r[c])).join(' | ') + ' |')].join('\n');
  const short = (f) => f.replace(/^site\/src\/app/, 'site').replace(/^web\/src\/app\/admin\//, 'BO:').replace(/\/page\.tsx$/, '');
  const md = [
    '# 소개뱅크 통합 매트릭스 — 화면 · 백엔드 · API · DB',
    '',
    `생성 ${summary.generated_at.slice(0, 16).replace('T', ' ')} UTC · \`node scripts/gen-matrix.js\` 로 다시 만듭니다 (손으로 고치지 마십시오).`,
    '',
    '## 0. 요약',
    '',
    tbl([summary], [
      'screens_registry', (r) => `${r.screens_with_impl} / ${r.screens_with_proto}`, (r) => `${r.site_pages} + ${r.admin_pages}`,
      'handlers', (r) => `${r.tables} / ${r.views} / ${r.functions}`, 'migrations',
      (r) => `상 ${r.issues.상} · 중 ${r.issues.중} · 하 ${r.issues.하}`],
      ['화면(레지스트리)', '구현 연결 / 시안 연결', '페이지(사용자+BO)', 'API', '표 / 뷰 / 함수', '마이그레이션', '교차 점검']),
    '',
    '## 1. 교차 점검 결과',
    '',
    issues.length ? tbl(issues, ['sev', 'area', 'what', 'detail'], ['등급', '영역', '대상', '내용']) : '**0건** — 화면↔API↔백엔드↔DB 사이에 끊긴 곳이 없습니다.',
    '',
    '## 2. 화면 목록 (화면 → 구현 · 시안 · API)',
    '',
    tbl(screens, ['id', 'name', (r) => (r.bo ? `${r.url} · BO ${r.bo}` : r.url), 'roles', (r) => r.impl.map(short), 'proto', (r) => r.apis_registry],
      ['화면 ID', '이름', 'URL', '역할', '구현 파일', '시안 키', 'API']),
    '',
    '## 3. 백엔드 목록 (핸들러 → 서비스 → 테이블)',
    '',
    tbl(handlers, ['module', (r) => `${r.controller}.${r.handler}`, (r) => `${r.method} ${r.path}`, 'roles', 'gate',
      (r) => r.services, (r) => r.tables], ['모듈', '핸들러', 'API', '역할', '게이트', '서비스 호출', '테이블']),
    '',
    '## 4. API 목록 (API → 화면 · 호출 파일 · 테이블)',
    '',
    tbl(apis, [(r) => `${r.method} ${r.path}`, 'roles', 'status', 'screens_registry', (r) => r.callers.map(short),
      (r) => r.tables.length ? r.tables : r.tables_module.map((t) => t + '*')],
      ['API', '역할', '문서상태', '레지스트리 화면', '호출 파일', '테이블 (*=모듈 단위)']),
    '',
    '## 5. DB 목록 (표 · 뷰 → 쓰는 API · 모듈)',
    '',
    tbl(dbRows, ['schema', 'name', 'kind', 'cols', 'rows', 'triggers', 'apis', 'modules', 'comment'],
      ['스키마', '이름', '종류', '열', '행(개발 DB)', '트리거', 'API 수', '모듈', '설명']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'docs/39_통합매트릭스.md'), md);

  console.log(`매트릭스: 화면 ${summary.screens_registry} (구현 ${summary.screens_with_impl} · 시안 ${summary.screens_with_proto}) · ` +
              `페이지 ${summary.site_pages}+${summary.admin_pages} · API ${summary.handlers} · 표 ${summary.tables} · 뷰 ${summary.views} · 함수 ${summary.functions}`);
  console.log(`교차 점검: 상 ${summary.issues.상} · 중 ${summary.issues.중} · 하 ${summary.issues.하}`);
})().catch((e) => { console.error(e); process.exit(1); });
