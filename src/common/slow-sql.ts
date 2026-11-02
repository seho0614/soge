/* ---------------------------------------------------------------------
 * v10.179 (docs/279) — 느린 DB 조회 지켜보기
 *
 *   DatabaseService.query 가 300ms 이상 걸린 SQL 만 이 프로세스 메모리에 1시간(최대 5,000건) 기억합니다.
 *   SQL 은 모양만(빈칸을 줄이고 앞 160자 · 숫자 · 따옴표 글자는 ? 로) — 넘긴 값($1 …)은 담지 않습니다(개인정보 없음).
 *   운영 화면 「지켜보기」의 「느린 조회(1시간)」 칸 · 느린 조회 5개(모양마다 건수 · 가장 느린 시간). 알림은 아직 없음(느린 응답 SLOW_API 가 먼저 울림).
 * ------------------------------------------------------------------- */
export const SLOW_SQL_MS = 300;
const MAX = 5000;
const KEEP_MS = 60 * 60 * 1000;
const rows: Array<{ at: number; ms: number; sql: string }> = [];

export function sqlShape(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/'(?:[^']|'')*'/g, '?').replace(/\b\d+\b/g, '?').trim().slice(0, 160);
}

export function recordSql(sql: string, ms: number, now = Date.now()) {
  if (ms < SLOW_SQL_MS) return;
  rows.push({ at: now, ms, sql: sqlShape(sql) });
  while (rows.length > MAX || (rows.length && rows[0].at < now - KEEP_MS)) rows.shift();
}

/** 지난 minutes 분 — 느린 조회 건수 · 모양별 5개(가장 느린 시간 순) */
export function slowSqlSince(minutes: number, now = Date.now()) {
  const recent = rows.filter((r) => r.at >= now - minutes * 60 * 1000);
  const by = new Map<string, { n: number; maxMs: number }>();
  for (const r of recent) {
    const c = by.get(r.sql);
    if (c) { c.n += 1; c.maxMs = Math.max(c.maxMs, r.ms); } else by.set(r.sql, { n: 1, maxMs: r.ms });
  }
  const top = [...by.entries()].map(([sql, v]) => ({ sql, n: v.n, maxMs: Math.round(v.maxMs) }))
    .sort((a, b) => b.maxMs - a.maxMs).slice(0, 5);
  return { n: recent.length, thresholdMs: SLOW_SQL_MS, top };
}

/** 시험용 — 비우기 */
export function resetSlowSql() { rows.length = 0; }
