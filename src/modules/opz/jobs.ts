import { DatabaseService } from '../../db/database.service';
import { opzSettings, opzYm } from './opz-settings';

/* ---------------------------------------------------------------------
 * v10.556 · 557 (D288) 정기 작업 opz_daily — 매일 09:10(한국)
 *   ① 끝난 지 opz.ir_review_days(3)일 넘었는데 되돌아보기를 확정하지 않은 장애 → OPZ_REVIEW_DUE(WARN · 장애마다 한 번)
 *   ② 열린(OPEN · MITIGATED) 장애인데 24시간 넘게 진행 기록이 없음 → OPZ_INCIDENT_STALE(WARN · 장애마다 하루 한 번)
 *   ③ opz.nl_enabled on 인데 이달(한국) 뉴스레터 호가 없음(10일부터) → OPZ_NL_REMIND(INFO · 달마다 한 번)
 *   알림만 — 무엇도 바꾸지 않음 · 보내지 않음
 * ------------------------------------------------------------------- */
export async function opzDailyJob(db: DatabaseService) {
  const s = await opzSettings(db);
  const due = await db.query<{ id: string }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'OPZ_REVIEW_DUE', 'WARN', left('장애 되돌아보기 기한 넘김 — ' || i.sev || ' · ' || i.title || ' — 위험감지 › 장애 대응', 300),
            jsonb_build_object('incident', i.id::text, 'closedAt', i.closed_at), clock_timestamp() + (row_number() OVER (ORDER BY i.id)) * interval '1 microsecond'
       FROM opz_incidents i LEFT JOIN opz_incident_reviews v ON v.incident_id = i.id
      WHERE i.state = 'CLOSED' AND i.closed_at < now() - make_interval(days => $1::int) AND v.finalized_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'OPZ_REVIEW_DUE' AND a.detail->>'incident' = i.id::text)
      LIMIT 50
     ON CONFLICT DO NOTHING RETURNING id::text AS id`, [s.irReviewDays]);
  const stale = await db.query<{ id: string }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'OPZ_INCIDENT_STALE', 'WARN', left('장애가 열린 채 24시간 넘게 기록 없음 — ' || i.sev || ' · ' || i.title || ' — 위험감지 › 장애 대응', 300),
            jsonb_build_object('incident', i.id::text), clock_timestamp() + (row_number() OVER (ORDER BY i.id)) * interval '1 microsecond'
       FROM opz_incidents i
      WHERE i.state <> 'CLOSED'
        AND coalesce((SELECT max(l.at) FROM opz_incident_logs l WHERE l.incident_id = i.id), i.opened_at) < now() - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'OPZ_INCIDENT_STALE' AND a.detail->>'incident' = i.id::text AND a.raised_at > now() - interval '20 hours')
      LIMIT 50
     ON CONFLICT DO NOTHING RETURNING id::text AS id`);
  let remind = 0;
  const ym = opzYm();
  const day = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(8, 10));
  if (s.nlOn && day >= 10) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'OPZ_NL_REMIND', 'INFO', $2, jsonb_build_object('ym', $1::text), clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM opz_nl_issues WHERE ym = $1 AND state <> 'CANCELED')
          AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'OPZ_NL_REMIND' AND a.detail->>'ym' = $1)
       ON CONFLICT DO NOTHING RETURNING id`, [ym, `이달(${ym}) 뉴스레터를 아직 만들지 않았습니다 — 회원 › 월간 뉴스레터`]);
    remind = r.length;
  }
  return { reviewDue: due.length, stale: stale.length, nlRemind: remind, irOn: s.irOn, nlOn: s.nlOn };
}
