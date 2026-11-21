/* ---------------------------------------------------------------------
 * v10.590 (docs/732) ⑥ 운영자 이상 행동 감지 — 위험감지 › 「이상 행동 감지」(SB-ADM-SCX-010 · SUPER)
 *
 *   새 기록을 모으지 않습니다 — 이미 쌓이는 감사 기록(audit.audit_logs) · 개인정보 접속기록(audit.pii_access_logs) ·
 *   내려받기 승인(export_requests) · 로그인 기록(login_history)을 DB 함수 sec2_staff_day_counts(하루)로 셉니다.
 *   기준: 그날 수 ≥ 최소(sec2.anomaly_*_min) 이면서 ≥ 지난 30일 하루 평균 × 배수(sec2.anomaly_factor) — 둘 다.
 *   자동으로 막지 않습니다. 운영 알림 STAFF_ANOMALY(WARN · 셈 한 번에 한 건 · 이름 없이 수만) · SUPER 가 「확인」에 메모(본인 줄은 못 함).
 *   스위치 sec2.anomaly_watch 처음 off — 정기 작업은 셈하지 않음(화면의 「다시 셈」은 꺼져도 됨 · 알림은 안 올림).
 * ------------------------------------------------------------------- */
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { Sec2Db, sec2Audit, sec2Mask, sec2Settings } from './common';

export const SEC2_KIND_KO: Record<string, string> = { VIEW: '개인정보 열람', EXPORT: '내려받기', NIGHT: '밤(22 ~ 06시) 활동' };

/** 한국 날짜(YYYY-MM-DD) — 오늘 기준 며칠 전 */
export async function sec2KstDay(db: Sec2Db, back: number): Promise<string> {
  const [r] = await db.query<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date - $1::int, 'YYYY-MM-DD') AS d`, [back]);
  return r!.d;
}

/** 하루 셈 → 기준 넘은 줄을 남김(같은 날 · 사람 · 종류는 한 줄 — 다시 셈은 더하지 않음) · alert=true 는 정기 작업(그날 넘은 것이 있으면 알림 한 번 · 셈 기록 auto) */
export async function sec2AnomalyScan(db: Sec2Db, day: string, alert: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new PolicyViolation('SEC2_DAY', '날짜는 YYYY-MM-DD 입니다.');
  const s = await sec2Settings(db);
  const rows = await db.query<{ account_id: string; views: number; exports: number; night: number; views_avg: string; exports_avg: string; night_avg: string }>(
    `SELECT account_id::text AS account_id, views, exports, night, views_avg::text, exports_avg::text, night_avg::text FROM sec2_staff_day_counts($1::date)`, [day]);
  const hits: Array<{ id: string; kind: string; n: number; avg: number; th: number }> = [];
  for (const r of rows) {
    const chk = (kind: string, n: number, avg: number, min: number) => {
      const th = Math.max(min, Math.ceil(avg * s.factor));
      if (n >= th) hits.push({ id: r.account_id, kind, n, avg, th });
    };
    chk('VIEW', Number(r.views), Number(r.views_avg), s.viewMin);
    chk('EXPORT', Number(r.exports), Number(r.exports_avg), s.exportMin);
    chk('NIGHT', Number(r.night), Number(r.night_avg), s.nightMin);
  }
  let added = 0;
  for (const h of hits) {
    const ins = await db.query(
      `INSERT INTO sec2_staff_anomalies (day, account_id, kind, n, avg30, threshold) VALUES ($1::date, $2::uuid, $3, $4::int, $5::numeric, $6::int)
       ON CONFLICT (day, account_id, kind) DO NOTHING RETURNING id`, [day, h.id, h.kind, h.n, h.avg, h.th]);
    if (ins.length) added++;
  }
  let alerted = false;
  if (alert && hits.length > 0) {   // 정기 작업 — 미리 「다시 셈」으로 줄이 있어도 그날 넘은 것이 있으면 한 번 알림
    const kinds = [...new Set(hits.map((h) => SEC2_KIND_KO[h.kind]))].join(' · ');
    const people = new Set(hits.map((h) => h.id)).size;
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       VALUES ('STAFF_ANOMALY', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id`,
      [`운영자 이상 행동 ${day} — ${people}명 · ${hits.length}건(${kinds}) · 위험감지 › 이상 행동 감지에서 확인`.slice(0, 280),
       JSON.stringify({ day, people, found: hits.length, kinds: [...new Set(hits.map((h) => h.kind))] })]).catch(() => []);
    alerted = r.length > 0;
  }
  await db.query(
    `INSERT INTO sec2_anomaly_runs (day, run_at, actors, found, alerted, auto) VALUES ($1::date, now(), $2::int, $3::int, $4, $5)
     ON CONFLICT (day) DO UPDATE SET run_at = now(), actors = EXCLUDED.actors, found = EXCLUDED.found,
                                     alerted = sec2_anomaly_runs.alerted OR EXCLUDED.alerted, auto = sec2_anomaly_runs.auto OR EXCLUDED.auto`,
    [day, rows.length, hits.length, alerted, alert]);
  return { day, actors: rows.length, found: hits.length, added, alerted };
}

/** 정기 작업(sec2_tick) — 켜져 있고 07시(한국) 뒤이고 어제 셈이 없으면 한 번 */
export async function sec2AnomalyDaily(db: Sec2Db) {
  const s = await sec2Settings(db);
  if (!s.anomalyWatch) return { skipped: 'OFF' as const };
  const [t] = await db.query<{ h: number; y: string; done: boolean }>(
    `SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Seoul')::int AS h,
            to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 1, 'YYYY-MM-DD') AS y,
            EXISTS (SELECT 1 FROM sec2_anomaly_runs WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date - 1 AND auto) AS done`);   // 「다시 셈」(auto false)은 정기 셈을 막지 않음
  if (!t || t.h < 7 || t.done) return { skipped: t?.done ? 'DONE' as const : 'EARLY' as const };
  return sec2AnomalyScan(db, t.y, true);
}

/** 화면 — 최근 30일 줄 · 셈 기록 · 설정 · 회원 보안 숫자(유출 막기 · 2단계 · 낯선 로그인) */
export async function sec2WatchView(db: Sec2Db) {
  const s = await sec2Settings(db);
  const items = await db.query<{ id: string; day: string; email: string | null; name: string | null; kind: string; n: number; avg30: string; threshold: number; reviewedAt: string | null; reviewer: string | null; note: string | null; accountId: string }>(
    `SELECT x.id::text AS id, to_char(x.day, 'YYYY-MM-DD') AS day, a.email::text AS email, a.name, x.kind, x.n, x.avg30::text AS avg30, x.threshold,
            x.reviewed_at AS "reviewedAt", rv.email::text AS reviewer, x.review_note AS note, x.account_id::text AS "accountId"
       FROM sec2_staff_anomalies x JOIN accounts a ON a.id = x.account_id LEFT JOIN accounts rv ON rv.id = x.reviewed_by
      WHERE x.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 30
      ORDER BY (x.reviewed_at IS NULL) DESC, x.day DESC, x.id DESC LIMIT 200`);
  const runs = await db.query<{ day: string; runAt: string; actors: number; found: number; alerted: boolean }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, run_at AS "runAt", actors, found, alerted FROM sec2_anomaly_runs ORDER BY day DESC LIMIT 14`);
  const [m] = await db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM sec2_pwned_log WHERE at > now() - interval '30 days' AND result = 'BLOCK') AS "pwnedBlock30",
            (SELECT count(*)::int FROM sec2_pwned_log WHERE at > now() - interval '30 days' AND result = 'PASS') AS "pwnedPass30",
            (SELECT count(*)::int FROM sec2_pwned_log WHERE at > now() - interval '30 days' AND result = 'ERROR') AS "pwnedError30",
            (SELECT count(*)::int FROM account_mfa m WHERE m.enabled_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = m.account_id
                                 AND r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'))) AS "memberMfa",
            (SELECT count(*)::int FROM sec2_login_alerts WHERE created_at > now() - interval '30 days') AS "alerts30",
            (SELECT count(*)::int FROM sec2_login_alerts WHERE answer = 'NOT_ME' AND answered_at > now() - interval '30 days') AS "notMe30",
            (SELECT count(*)::int FROM sec2_login_alerts WHERE answer = 'ME' AND answered_at > now() - interval '30 days') AS "me30"`);
  const me = RequestCtx.actorId() ?? '';
  return {
    settings: s,
    items: items.map((r) => ({ ...r, email: sec2Mask(r.email), reviewer: sec2Mask(r.reviewer), kindKo: SEC2_KIND_KO[r.kind] ?? r.kind, avg30: Number(r.avg30), mine: r.accountId === me })),
    open: items.filter((r) => !r.reviewedAt).length,
    runs,
    member: m ?? {},
    canEdit: RequestCtx.get()?.actorRole === 'SUPER',
    note: s.anomalyWatch ? '매일 07시 뒤 어제(한국)를 셈합니다. 자동으로 막지 않습니다 — 사유를 듣고 「확인」에 메모를 남기십시오.'
      : '감지가 꺼져 있습니다(처음) — 정기 작업은 셈하지 않습니다. 「다시 셈」으로 하루를 미리 볼 수 있습니다(알림 없음).',
  };
}

/** SUPER — 확인 한 번(본인 줄은 다른 SUPER 가) */
export async function sec2AnomalyReview(db: Sec2Db, id: string, note: string) {
  const me = RequestCtx.actorId();
  if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
  const why = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('SEC2_NOTE', '확인 메모는 2 ~ 200자입니다.');
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('그 줄이 없습니다.');
  const [r] = await db.query<{ account_id: string; reviewed_at: string | null }>(
    `SELECT account_id::text AS account_id, reviewed_at FROM sec2_staff_anomalies WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('그 줄이 없습니다.');
  if (r.account_id === me) throw new PolicyViolation('SEC2_SELF_REVIEW', '자신의 이상 행동 줄은 확인할 수 없습니다 — 다른 최고 관리자에게 맡기십시오.');
  if (r.reviewed_at) throw new StateConflict('SEC2_REVIEWED', '이미 확인한 줄입니다.');
  const u = await db.query(
    `UPDATE sec2_staff_anomalies SET reviewed_at = now(), reviewed_by = $2::uuid, review_note = $3 WHERE id = $1::bigint AND reviewed_at IS NULL RETURNING id`,
    [id, me, why]);
  if (!u.length) throw new StateConflict('SEC2_REVIEWED', '이미 확인한 줄입니다.');
  await sec2Audit(db, 'SEC2_ANOMALY_REVIEW', 'ACCOUNT', r.account_id, { anomalyId: id });
  return { ok: true, id, note: '확인을 남겼습니다.' };
}
