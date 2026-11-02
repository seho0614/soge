import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.179 (D168 · docs/279) — 개인정보 접속기록 월 점검
 *
 *   운영자가 회원 · 사업자 · 리드 개인정보를 본 기록을 한 달 단위로 모아 봅니다.
 *     ① audit.pii_access_logs — @PiiAccess(사업자 심사 · 거래 모니터링) · 리드 연락처 열람(DB 함수)
 *     ② audit.audit_logs 의 ACCOUNT_VIEW(회원 상세) · LEAD_VIEW(리드 보기)
 *   운영자마다 본 수 · 서로 다른 대상 수 · 하루 최다 · 밤(22 ~ 06시 한국 시간) 조회 · 내려받기(EXPORT)를 보이고,
 *   하루 최다가 pii.review_flag_daily(기본 50) 이상이거나 밤 조회가 10건 이상이면 「살펴볼 것」.
 *   SUPER 가 메모(5자 이상)를 남겨 「점검 완료」 — audit.pii_reviews 한 달 한 줄 · 고치거나 지울 수 없음.
 *   매달 5일부터 지난달 점검이 없으면 하루 요약(09:00) 때 운영 알림 PII_REVIEW_DUE(그달 한 번).
 *   ★ 법이 정한 점검 주기 · 접속기록 보관 기간은 최신 고시로 확인이 필요합니다(docs/279 5절).
 * ------------------------------------------------------------------- */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class PiiReviewService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  private month(m: unknown): string {
    if (typeof m !== 'string' || !MONTH.test(m)) throw new PolicyViolation('PII_REVIEW_MONTH', '달은 YYYY-MM 으로 적어 주십시오.');
    return `${m}-01`;
  }

  /** 지난 12달 — 달마다 조회 수 · 점검 여부 */
  async months() {
    return this.db.query(
      `WITH m AS (
         SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - make_interval(months => g))::date AS month
           FROM generate_series(0, 11) AS g)
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              ((SELECT count(*) FROM audit.pii_access_logs l
                 WHERE (l.occurred_at AT TIME ZONE 'Asia/Seoul') >= m.month AND (l.occurred_at AT TIME ZONE 'Asia/Seoul') < m.month + interval '1 month')
             + (SELECT count(*) FROM audit.audit_logs a WHERE a.action IN ('ACCOUNT_VIEW', 'LEAD_VIEW')
                 AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') >= m.month AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') < m.month + interval '1 month'))::int AS views,
              r.reviewed_at AS "reviewedAt", ra.name AS "reviewedBy",
              (m.month < date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date) AS closed
         FROM m LEFT JOIN audit.pii_reviews r ON r.month = m.month LEFT JOIN accounts ra ON ra.id = r.reviewed_by
        ORDER BY m.month DESC`);
  }

  /** 한 달 요약 — 운영자별 · 대상 종류별 · 점검 기록 */
  async detail(m: unknown) {
    const month = this.month(m);
    const actors = await this.db.query<{ flagged: boolean }>(
      `WITH v AS (
         SELECT l.actor_account_id AS actor, l.occurred_at AS at, l.access_type AS kind, l.target_type AS ttype,
                coalesce(l.target_account_id::text, l.lead_id::text) AS target
           FROM audit.pii_access_logs l
          WHERE (l.occurred_at AT TIME ZONE 'Asia/Seoul') >= $1::date AND (l.occurred_at AT TIME ZONE 'Asia/Seoul') < $1::date + interval '1 month'
         UNION ALL
         SELECT a.actor_account_id, a.occurred_at, 'VIEW', a.target_type, a.target_id::text
           FROM audit.audit_logs a
          WHERE a.action IN ('ACCOUNT_VIEW', 'LEAD_VIEW') AND a.actor_account_id IS NOT NULL
            AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') >= $1::date AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') < $1::date + interval '1 month'),
       d AS (SELECT actor, (at AT TIME ZONE 'Asia/Seoul')::date AS day, count(*) AS n FROM v GROUP BY 1, 2),
       lim AS (SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'pii.review_flag_daily'), 50) AS n)
       SELECT v.actor::text AS "actorId", acc.name, acc.email,
              coalesce((SELECT string_agg(r.role, ' · ' ORDER BY r.role) FROM account_roles r WHERE r.account_id = v.actor), '') AS roles,
              count(*)::int AS views, count(*) FILTER (WHERE v.kind = 'EXPORT')::int AS exports,
              count(DISTINCT v.target)::int AS targets,
              (SELECT max(d.n) FROM d WHERE d.actor = v.actor)::int AS "maxPerDay",
              count(*) FILTER (WHERE extract(hour FROM v.at AT TIME ZONE 'Asia/Seoul') >= 22 OR extract(hour FROM v.at AT TIME ZONE 'Asia/Seoul') < 6)::int AS "nightViews",
              ((SELECT max(d.n) FROM d WHERE d.actor = v.actor) >= (SELECT n FROM lim)
                OR count(*) FILTER (WHERE extract(hour FROM v.at AT TIME ZONE 'Asia/Seoul') >= 22 OR extract(hour FROM v.at AT TIME ZONE 'Asia/Seoul') < 6) >= 10) AS flagged
         FROM v LEFT JOIN accounts acc ON acc.id = v.actor
        GROUP BY v.actor, acc.name, acc.email
        ORDER BY count(*) DESC`, [month]);
    const kinds = await this.db.query(
      `SELECT k, count(*)::int AS n FROM (
         SELECT l.target_type || ' ' || l.access_type AS k FROM audit.pii_access_logs l
          WHERE (l.occurred_at AT TIME ZONE 'Asia/Seoul') >= $1::date AND (l.occurred_at AT TIME ZONE 'Asia/Seoul') < $1::date + interval '1 month'
         UNION ALL
         SELECT a.action FROM audit.audit_logs a
          WHERE a.action IN ('ACCOUNT_VIEW', 'LEAD_VIEW')
            AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') >= $1::date AND (a.occurred_at AT TIME ZONE 'Asia/Seoul') < $1::date + interval '1 month') x
        GROUP BY k ORDER BY count(*) DESC`, [month]);
    const [rv] = await this.db.query(
      `SELECT r.reviewed_at AS "reviewedAt", a.name AS "reviewedBy", r.note, r.summary
         FROM audit.pii_reviews r LEFT JOIN accounts a ON a.id = r.reviewed_by WHERE r.month = $1::date`, [month]);
    const [lim] = await this.db.query<{ n: number; closed: boolean }>(
      `SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'pii.review_flag_daily'), 50) AS n,
              ($1::date < date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date) AS closed`, [month]);
    return {
      month: month.slice(0, 7), closed: lim!.closed, flagDaily: lim!.n,
      total: actors.reduce((s, a: any) => s + a.views, 0), flagged: actors.filter((a) => a.flagged).length,
      actors, kinds, review: rv ?? null,
    };
  }

  /** 점검 완료 — 끝난 달만 · 한 달에 한 번 · 요약을 함께 남김 */
  async review(m: unknown, note: string) {
    const d = await this.detail(m);
    if (!d.closed) throw new PolicyViolation('PII_REVIEW_OPEN_MONTH', '끝난 달만 점검 완료로 남길 수 있습니다 — 이번 달은 다음 달에 점검하십시오.');
    if (d.review) throw new StateConflict('PII_REVIEW_DONE', '이미 점검한 달입니다 — 점검 기록은 고칠 수 없습니다.');
    const summary = { total: d.total, flagged: d.flagged, flagDaily: d.flagDaily,
      actors: (d.actors as any[]).map((a) => ({ name: a.name, views: a.views, targets: a.targets, maxPerDay: a.maxPerDay, nightViews: a.nightViews, exports: a.exports, flagged: a.flagged })) };
    await this.db.query(
      `INSERT INTO audit.pii_reviews (month, reviewed_by, note, summary) VALUES ($1::date, $2, $3, $4::jsonb)`,
      [`${d.month}-01`, this.me, note.trim(), JSON.stringify(summary)]);
    return { ok: true, month: d.month, note: `${d.month} 점검을 남겼습니다.` };
  }

  /** 하루 요약 때 — 매달 5일부터 지난달 점검이 없고 그달 알림이 없으면 알릴 것 */
  async due(): Promise<{ month: string; alert: boolean }> {
    const [r] = await this.db.query<{ month: string; alert: boolean }>(
      `SELECT to_char(p.m, 'YYYY-MM') AS month,
              (extract(day FROM (now() AT TIME ZONE 'Asia/Seoul')) >= 5
               AND NOT EXISTS (SELECT 1 FROM audit.pii_reviews r WHERE r.month = p.m)
               AND NOT EXISTS (SELECT 1 FROM ops_alerts o WHERE o.alert_code = 'PII_REVIEW_DUE' AND o.detail->>'month' = to_char(p.m, 'YYYY-MM'))) AS alert
         FROM (SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '1 month')::date AS m) p`);
    return r!;
  }
}
