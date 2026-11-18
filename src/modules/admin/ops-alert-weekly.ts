/* ---------------------------------------------------------------------
 * v10.375 (docs/510) — 운영 알림 주간 통계(지난주 월 ~ 일 · 한국)
 *   위험감지 › 「운영 알림」 상자 · 월요일 고객센터 주간 보고 한 줄(cs-weekly)이 함께 씀. 숫자만.
 * ------------------------------------------------------------------- */
interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export interface OpsAlertWeekly {
  from: string; to: string; total: number; critical: number; ackAvgMin: number | null; openNow: number; mutes: number;
  rows: Array<{ code: string; n: number; critical: number; open: number }>; line: string;
}

export async function opsAlertWeekly(db: Q): Promise<OpsAlertWeekly> {
  const W = `WITH r AS (SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days') AT TIME ZONE 'Asia/Seoul' AS f,
                               date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS t)`;
  const rows = await db.query<{ code: string; n: number; critical: number; open: number }>(
    `${W} SELECT a.alert_code AS code, count(*)::int AS n, count(*) FILTER (WHERE a.severity = 'CRITICAL')::int AS critical,
                 count(*) FILTER (WHERE a.acknowledged_at IS NULL AND a.resolved_at IS NULL)::int AS open
            FROM ops_alerts a, r WHERE a.raised_at >= r.f AND a.raised_at < r.t GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`);
  const [s] = await db.query<{ from: string; to: string; total: number; critical: number; ack: number | null; open: number; mutes: number }>(
    `${W} SELECT to_char(r.f AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "from", to_char((r.t - interval '1 day') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "to",
                 (SELECT count(*)::int FROM ops_alerts a WHERE a.raised_at >= r.f AND a.raised_at < r.t) AS total,
                 (SELECT count(*)::int FROM ops_alerts a WHERE a.severity = 'CRITICAL' AND a.raised_at >= r.f AND a.raised_at < r.t) AS critical,
                 (SELECT round((avg(extract(epoch FROM a.acknowledged_at - a.raised_at)) / 60)::numeric)::int FROM ops_alerts a
                   WHERE a.severity = 'CRITICAL' AND a.acknowledged_at IS NOT NULL AND a.raised_at >= r.f AND a.raised_at < r.t) AS ack,
                 (SELECT count(*)::int FROM ops_alerts a WHERE a.acknowledged_at IS NULL AND a.resolved_at IS NULL AND a.severity IN ('WARN', 'CRITICAL')) AS open,
                 (SELECT count(*)::int FROM alert_mutes m WHERE m.created_at >= r.f AND m.created_at < r.t) AS mutes
            FROM r`);
  const top = rows.slice(0, 3).map((x) => `${x.code} ${x.n}`).join(' · ');
  const ack = s?.ack == null ? null : Number(s.ack);
  const out = {
    from: s?.from ?? '', to: s?.to ?? '', total: Number(s?.total ?? 0), critical: Number(s?.critical ?? 0), ackAvgMin: ack, openNow: Number(s?.open ?? 0), mutes: Number(s?.mutes ?? 0),
    rows: rows.map((x) => ({ ...x, n: Number(x.n), critical: Number(x.critical), open: Number(x.open) })), line: '',
  };
  out.line = `운영 알림 ${out.total}(급함 ${out.critical} · 확인까지 평균 ${ack == null ? '—' : `${ack}분`}${top ? ` · 많은 것 ${top}` : ''}) · 지금 확인 안 한 경고 이상 ${out.openNow} · 잠시 끔 ${out.mutes}`;
  return out;
}
