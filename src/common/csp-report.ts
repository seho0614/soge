import express from 'express';
import type { NextFunction, Request, Response } from 'express';

/* ---------------------------------------------------------------------
 * v10.177 (docs/275) — 보안 정책 「보고만 하기」(Content-Security-Policy-Report-Only) 수집
 *
 *   사용자 웹 화면(site/next.config.js)이 「이 출처는 정책에 없다」는 보고를 브라우저에서 POST /api/v1/csp-report 로 보냅니다.
 *   **화면은 막지 않습니다**(Report-Only) — 1 ~ 2주 모아 실제로 쓰는 외부 출처(지도 · 결제창 · 분석 등)를 알아낸 뒤
 *   정책을 걸지 판단합니다(docs/273 「넣지 않은 것」).
 *   남기는 것: 어긴 규칙(script-src 등) · 막혔을 출처(주소의 앞부분 https://host 만 · 경로 · 물음표 뒤는 버림) · 화면 경로(물음표 뒤 버림).
 *   남기지 않는 것: IP · 쿠키 · 회원. 이 API 프로세스 메모리에서만 24시간(DB 에 남기지 않음 · 다시 띄우면 비워짐).
 *   Nest 를 거치지 않는 express 길입니다(로그인 · 요청 한도 · 감사와 상관없음) — 본문 16KB · 한 시간 5,000건 넘으면 버림.
 * ------------------------------------------------------------------- */

const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 500;
const MAX_PER_HOUR = 5000;

interface Row { directive: string; blocked: string; page: string; n: number; last: number }
const rows = new Map<string, Row>();
const hits: number[] = [];

/** 주소를 출처(https://host)만 남기고 줄임 — inline · eval · data 같은 낱말은 그대로 */
export function originOf(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return '(없음)';
  if (/^(inline|eval|data|blob|self|wasm-eval|trusted-types-sink)$/i.test(s)) return s.toLowerCase();
  try { const x = new URL(s); return x.protocol === 'data:' || x.protocol === 'blob:' ? x.protocol.slice(0, -1) : `${x.protocol}//${x.host}`; }
  catch { return s.slice(0, 40); }
}
function pathOf(u: unknown): string {
  try { return new URL(String(u)).pathname.slice(0, 80) || '/'; } catch { return '/'; }
}
const directiveOf = (d: unknown) => String(d ?? '').trim().split(/\s+/)[0]?.slice(0, 40) || '(모름)';

/** 보고 한 건 기록 — 옛 형식(report-uri · {"csp-report": {...}})과 새 형식(Reporting API · [{type, body}]) 둘 다 */
export function recordCspReport(body: unknown, now = Date.now()): number {
  const list: Array<{ directive: unknown; blocked: unknown; page: unknown }> = [];
  if (Array.isArray(body)) {
    for (const r of body.slice(0, 20)) {
      const b = (r as any)?.body;
      if ((r as any)?.type === 'csp-violation' && b) list.push({ directive: b.effectiveDirective ?? b.violatedDirective, blocked: b.blockedURL, page: b.documentURL });
    }
  } else {
    const b = (body as any)?.['csp-report'];
    if (b) list.push({ directive: b['effective-directive'] ?? b['violated-directive'], blocked: b['blocked-uri'], page: b['document-uri'] });
  }
  while (hits.length && hits[0] < now - 3600_000) hits.shift();
  let n = 0;
  for (const r of list) {
    if (hits.length >= MAX_PER_HOUR) break;
    hits.push(now);
    const row = { directive: directiveOf(r.directive), blocked: originOf(r.blocked), page: pathOf(r.page) };
    const key = `${row.directive}|${row.blocked}|${row.page}`;
    const cur = rows.get(key);
    if (cur) { cur.n += 1; cur.last = now; }
    else {
      if (rows.size >= MAX_KEYS) for (const [k, v] of rows) if (v.last < now - KEEP_MS) rows.delete(k);
      if (rows.size < MAX_KEYS) rows.set(key, { ...row, n: 1, last: now });
    }
    n += 1;
  }
  return n;
}

/** 지난 24시간 — 모두 몇 건 · 많이 걸린 (규칙 · 출처) 순 10개(화면 경로는 가장 최근 것 하나) */
export function cspReportsDay(now = Date.now()) {
  const live = [...rows.values()].filter((r) => r.last >= now - KEEP_MS);
  const byPair = new Map<string, { directive: string; blocked: string; n: number; page: string; last: number }>();
  for (const r of live) {
    const k = `${r.directive}|${r.blocked}`;
    const cur = byPair.get(k);
    if (!cur) byPair.set(k, { directive: r.directive, blocked: r.blocked, n: r.n, page: r.page, last: r.last });
    else { cur.n += r.n; if (r.last > cur.last) { cur.last = r.last; cur.page = r.page; } }
  }
  const top = [...byPair.values()].sort((a, b) => b.n - a.n).slice(0, 10).map(({ last: _l, ...x }) => x);
  return { n: live.reduce((s, r) => s + r.n, 0), top };
}

/** 시험용 — 비우기 */
export function resetCspReports() { rows.clear(); hits.length = 0; }

/** express 길 — 운영(main.ts)과 점검판(dev-server.js)이 applySecurityHeaders 안에서 같이 붙입니다 */
export const cspReportRoute = [
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }),
  (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    try { recordCspReport(req.body); } catch { /* 모양이 다른 보고는 버림 */ }
    res.status(204).end();
  },
  /* 본문이 16KB 를 넘거나 JSON 이 아니면 — 오류 화면 없이 버림 */
  (_err: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(204).end(); },
];
