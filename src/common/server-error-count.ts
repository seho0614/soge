/**
 * v10.174 (D163 · docs/268) — API 서버 오류(5xx) 몰림을 셉니다(이 프로세스 메모리 · 최근 1시간 · 최대 2,000건).
 *   DbErrorFilter 가 5xx 를 보낼 때 기록하고, 정기 작업 launch_watch(10분)가 지난 10분 건수를 읽어
 *   ops.server_error_per_10min 이상이면 운영 알림 SERVER_ERROR_SPIKE. 다시 띄우면 0 부터(운영 서버는 API 프로세스 하나).
 */
const MAX = 2000;
const KEEP_MS = 60 * 60 * 1000;
const hits: Array<{ at: number; path: string }> = [];

/* v10.182 (D171 · docs/285) — 최근 서버 오류 50건(운영 화면 위험감지 › 서버 오류 · SB-ADM-ERR-010).
 *   남기는 것: 시각 · 방법 · 주소(물음표 뒤는 버림 · 숫자 · uuid 는 지움) · 응답 번호 · 오류 종류 · 요청 번호 · 짧은 설명.
 *   남기지 않는 것: 요청 본문 · 증표 · 검색어. 설명 안의 따옴표 값은 이름처럼 생긴 것(표 · 칸 이름)만 두고 나머지는 「…」로 가림. */
const LAST_MAX = 50;
export interface ServerErrorRow { at: string; method: string; path: string; status: number; code: string; detail: string | null; requestId: string | null }
const last: ServerErrorRow[] = [];

/* v10.250 (D204 · docs/387) — DB(ops_server_error_days)에 아직 안 넣은 건수 · 키 = 날짜(한국)|방법|주소|종류|응답 번호.
 *   정기 작업 launch_watch(10분)가 takeServerErrorPending() 으로 가져가 더함(넣지 못하면 restoreServerErrorPending 으로 되돌림).
 *   다시 띄우면 아직 넣지 않은 몫(최대 10분)은 빠집니다. */
export interface ServerErrorPending { day: string; method: string; path: string; code: string; status: number; n: number; detail: string | null; requestId: string | null; last: string }
const PENDING_MAX = 500;
const pending = new Map<string, ServerErrorPending>();
const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
function addPending(r: ServerErrorPending) {
  const k = `${r.day}|${r.method}|${r.path}|${r.code}|${r.status}`;
  const cur = pending.get(k);
  if (cur) { cur.n += r.n; if (r.last >= cur.last) { cur.last = r.last; cur.detail = r.detail; cur.requestId = r.requestId; } }
  else if (pending.size < PENDING_MAX) pending.set(k, { ...r });
}
export function takeServerErrorPending(): ServerErrorPending[] { const out = [...pending.values()]; pending.clear(); return out; }
export function restoreServerErrorPending(list: ServerErrorPending[]) { for (const r of list) addPending(r); }

/** 따옴표 안 값 가리기 — 표 · 칸 이름(영문 · 숫자 · _ · .)은 그대로, 나머지(입력값 · 이메일 · 숫자 섞인 값)는 「…」 */
export function maskDetail(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const pg = msg.match(/^\[[0-9A-Z]{5}\] /)?.[0] ?? '';   // PostgreSQL 오류 번호([42702])는 그대로
  return pg + msg.slice(pg.length).replace(/(["'])(.*?)\1/g, (_m, q, v) => (/^[A-Za-z_][A-Za-z_.]{0,62}$/.test(v) ? `${q}${v}${q}` : `${q}…${q}`))
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '…').replace(/\d{4,}/g, '…').slice(0, 200 - pg.length);
}

/** 주소의 숫자 · uuid 는 지워 같은 화면끼리 묶습니다(쿼리는 버림) */
const shape = (url: string) => url.split('?')[0]
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 120);

export function recordServerError(url: string | undefined, now = Date.now(),
  info?: { method?: string; status?: number; code?: string; detail?: string | null; requestId?: string | null }) {
  const path = shape(url ?? '');
  hits.push({ at: now, path });
  while (hits.length > MAX || (hits.length && hits[0].at < now - KEEP_MS)) hits.shift();
  last.unshift({ at: new Date(now).toISOString(), method: (info?.method ?? '').slice(0, 8), path, status: info?.status ?? 500,
    code: (info?.code ?? 'INTERNAL_ERROR').slice(0, 60), detail: maskDetail(info?.detail), requestId: info?.requestId ? String(info.requestId).slice(0, 64) : null });
  if (last.length > LAST_MAX) last.length = LAST_MAX;
  const r0 = last[0]!;
  addPending({ day: kstDay(now), method: r0.method, path: r0.path, code: r0.code || 'INTERNAL_ERROR', status: Math.min(599, Math.max(500, r0.status)), n: 1,
    detail: r0.detail, requestId: r0.requestId, last: r0.at });
}

/** v10.182 — 최근 서버 오류(새것부터 · 최대 50 · 1시간 안) */
export function recentServerErrors(now = Date.now()): ServerErrorRow[] {
  return last.filter((r) => Date.parse(r.at) >= now - KEEP_MS);
}

/** 지난 minutes 분 건수와 많이 난 주소 5개 */
export function serverErrorsSince(minutes: number, now = Date.now()) {
  const from = now - minutes * 60 * 1000;
  const recent = hits.filter((h) => h.at >= from);
  const by = new Map<string, number>();
  for (const h of recent) by.set(h.path, (by.get(h.path) ?? 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, n]) => ({ path, n }));
  return { n: recent.length, top };
}
