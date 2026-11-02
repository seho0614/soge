import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/* ---------------------------------------------------------------------
 * v10.178 (D167 · docs/277) — API 응답 시간(느린 응답 지켜보기)
 *
 *   요청마다 끝난 시간(ms)을 이 프로세스 메모리에 1시간(최대 50,000건) 기억합니다 — DB 에 남기지 않음 · 다시 띄우면 0 부터.
 *   운영 화면 「지켜보기」의 「느린 응답(1시간)」 칸(느린 쪽 5% 기준 시간 = p95) · 정기 작업 launch_watch(10분)가
 *   지난 10분 p95 가 ops.slow_p95_ms(기본 1500 · 0 = 끔) 이상이고 요청이 50건 이상이면 운영 알림 SLOW_API(1시간에 한 번).
 *   세지 않음: 정기 작업 부르기(/api/v1/worker — 원래 오래 걸림).
 * ------------------------------------------------------------------- */
const MAX = 50_000;
const KEEP_MS = 60 * 60 * 1000;
const rows: Array<{ at: number; ms: number; path: string }> = [];

/** 주소의 숫자 · uuid 는 지워 같은 화면끼리 묶습니다(쿼리는 버림) — server-error-count 와 같은 모양 */
const shape = (url: string) => url.split('?')[0]
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 120);

export function recordResponse(url: string | undefined, ms: number, now = Date.now()) {
  const path = shape(url ?? '');
  if (path.startsWith('/api/v1/worker')) return;
  rows.push({ at: now, ms, path });
  while (rows.length > MAX || (rows.length && rows[0].at < now - KEEP_MS)) rows.shift();
}

const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]);
};

/** 지난 minutes 분 — 요청 수 · p95(ms) · 느린 주소 5곳(3건 이상 주소의 p95 순) */
export function slowSince(minutes: number, now = Date.now()) {
  const recent = rows.filter((r) => r.at >= now - minutes * 60 * 1000);
  const by = new Map<string, number[]>();
  for (const r of recent) { const a = by.get(r.path); if (a) a.push(r.ms); else by.set(r.path, [r.ms]); }
  const top = [...by.entries()].filter(([, v]) => v.length >= 3).map(([path, v]) => ({ path, p95: p95(v), n: v.length }))
    .sort((a, b) => b.p95 - a.p95).slice(0, 5);
  return { n: recent.length, p95: p95(recent.map((r) => r.ms)), top };
}

/** 시험용 — 비우기 */
export function resetResponseTimes() { rows.length = 0; }

@Injectable()
export class ResponseTimeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => recordResponse(req.originalUrl, Number(process.hrtime.bigint() - t0) / 1e6));
    next();
  }
}
