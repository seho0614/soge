/**
 * v10.174 (D163 · docs/268) — API 서버 오류(5xx) 몰림을 셉니다(이 프로세스 메모리 · 최근 1시간 · 최대 2,000건).
 *   DbErrorFilter 가 5xx 를 보낼 때 기록하고, 정기 작업 launch_watch(10분)가 지난 10분 건수를 읽어
 *   ops.server_error_per_10min 이상이면 운영 알림 SERVER_ERROR_SPIKE. 다시 띄우면 0 부터(운영 서버는 API 프로세스 하나).
 */
const MAX = 2000;
const KEEP_MS = 60 * 60 * 1000;
const hits: Array<{ at: number; path: string }> = [];

/** 주소의 숫자 · uuid 는 지워 같은 화면끼리 묶습니다(쿼리는 버림) */
const shape = (url: string) => url.split('?')[0]
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 120);

export function recordServerError(url: string | undefined, now = Date.now()) {
  hits.push({ at: now, path: shape(url ?? '') });
  while (hits.length > MAX || (hits.length && hits[0].at < now - KEEP_MS)) hits.shift();
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
