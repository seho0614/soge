import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ServerHealth, serverHealth } from '../../common/server-health';

/* ---------------------------------------------------------------------
 * v10.248 (D203 · docs/386) — 서버 자원 추세
 *
 *   ① 정기 작업 launch_watch(10분)가 잰 값을 그날(한국 날짜) 처음 한 번만 ops_server_daily 에 적음(같은 날은 넣지 않음 · 쌓기만).
 *   ② 운영 화면 「서버 자원 추세」 — 최근 30일 · 최근 14일 디스크가 하루에 몇 %p 늘었는지(최소제곱 기울기) ·
 *      이대로면 기준(ops.disk_warn_pct · 기본 85)까지 약 며칠. 기록이 3일 이상 있어야 계산합니다.
 *   ③ 하루 요약 한 줄. 읽기만 — 아무것도 지우지 않습니다.
 * ------------------------------------------------------------------- */
export type TrendRow = { day: string; disk: number | null; freeGB: number | null; mem: number };
export type TrendCalc = { slope: number | null; daysToLimit: number | null; points: number; last: number | null };

/** 최근 14일(기록이 있는 날만) 디스크 % 의 하루 기울기 · 기준까지 남은 날 — 3일 미만이면 계산하지 않음 */
export function diskTrend(rows: TrendRow[], limit: number): TrendCalc {
  const pts = rows.filter((r) => r.disk !== null).slice(-14)
    .map((r) => ({ x: Date.parse(r.day + 'T00:00:00Z') / 86_400_000, y: r.disk as number }));
  if (pts.length < 3) return { slope: null, daysToLimit: null, points: pts.length, last: pts.length ? pts[pts.length - 1]!.y : null };
  const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const slope = sxx ? pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const last = pts[n - 1]!.y;
  const daysToLimit = limit > 0 && slope > 0.05 && last < limit ? Math.ceil((limit - last) / slope) : null;
  return { slope: Math.round(slope * 100) / 100, daysToLimit, points: n, last };
}

@Injectable()
export class ServerTrendService {
  constructor(private readonly db: DatabaseService) {}

  /** 그날 처음 잰 값만 한 줄(같은 날이면 넣지 않음) — 넣었으면 true */
  async record(h: ServerHealth = serverHealth()): Promise<boolean> {
    const r = await this.db.query<{ day: string }>(
      `INSERT INTO ops_server_daily (day, disk_pct, disk_free_gb, mem_pct)
       VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2, $3)
       ON CONFLICT (day) DO NOTHING RETURNING day::text`,
      [h.disk ? Math.round(h.disk.usedPct) : null, h.disk ? h.disk.freeGB : null, Math.round(h.mem.usedPct)]);
    return r.length > 0;
  }

  private async limit(): Promise<number> {
    const [c] = await this.db.query<{ lim: number }>(
      `SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.disk_warn_pct'), 85) AS lim`);
    return c?.lim ?? 85;
  }

  /** 운영 화면 카드 — 최근 30일(오래된 것부터) · 기울기 · 기준까지 남은 날 */
  async trend() {
    const rows = (await this.db.query<TrendRow>(
      `SELECT day::text AS day, disk_pct AS disk, disk_free_gb::float8 AS "freeGB", mem_pct AS mem
         FROM ops_server_daily ORDER BY day DESC LIMIT 30`)).reverse();
    const limit = await this.limit();
    return { rows, limit, ...diskTrend(rows, limit) };
  }

  /** 하루 요약 한 줄 — 「디스크 추세 하루 +0.3%p · 85% 까지 약 40일」 */
  async digestLine(): Promise<string> {
    const t = await this.trend();
    if (t.slope === null) return `디스크 추세 — 기록 ${t.points}일(3일부터 계산)`;
    const s = `${t.slope > 0 ? '+' : ''}${t.slope}%p`;
    if (t.limit > 0 && t.last !== null && t.last >= t.limit) return `디스크 추세 하루 ${s} · 이미 ${t.limit}% 넘음(${t.last}%)`;
    if (t.daysToLimit !== null) return `디스크 추세 하루 ${s} · ${t.limit}% 까지 약 ${t.daysToLimit}일`;
    return `디스크 추세 하루 ${s} · 늘지 않음`;
  }
}
