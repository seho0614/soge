import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.180 (D169 · docs/281) — 운영자 권한 정기 점검(SB-ADM-ROLE-010 · SUPER) · 파기 실행 기록(SB-ADM-PURGE-010)
 *
 *   ① 운영자 권한 — 운영 역할(검수 · 운영 · 지급 · 최고)이 있는 계정마다 역할 · 받은 날 · 마지막 로그인 · 2단계 등록 ·
 *      ops.role_idle_days(90)일 넘게 안 쓴 계정 「정지 권함」(자동 정지 없음) · 최근 권한 변경(role_changes).
 *      SUPER 가 분기마다 메모를 남겨 「점검 완료」 — audit.role_reviews 분기 한 줄 · 고칠 수 없음.
 *      분기가 끝나고 15일이 지나도록 지난 분기 점검이 없으면 하루 요약 때 ROLE_REVIEW_DUE(그 분기 한 번).
 *   ② 파기 기록 — 매일 03:00 pii_purge 가 job_runs 에 남긴 건수(계정 · IP 가리기 · 리드 · 상담 · 인증 기록 · 기한 넘김)를
 *      날짜별 · 달별로. 새 표 없음 · 건수만(개인정보 없음). 하루 요약 때 마지막 실행이 실패면 PII_PURGE_FAILED(실행마다 한 번) ·
 *      30시간 넘게 돌지 않았으면 PII_PURGE_MISSED(하루 한 번).
 *   ★ 권한 점검 주기 · 파기 기록 보관 기간은 최신 고시 확인이 필요합니다(docs/281 5절).
 * ------------------------------------------------------------------- */
const QUARTER = /^\d{4}-Q[1-4]$/;
const OPS = `('REVIEWER','ADMIN','PAYOUT','SUPER')`;
const KST_NOW = `(now() AT TIME ZONE 'Asia/Seoul')`;

@Injectable()
export class RoleReviewService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  private quarter(q: unknown): string {
    if (typeof q !== 'string' || !QUARTER.test(q)) throw new PolicyViolation('ROLE_REVIEW_QUARTER', '분기는 2026-Q4 처럼 적어 주십시오.');
    const [y, n] = q.split('-Q');
    return `${y}-${String((Number(n) - 1) * 3 + 1).padStart(2, '0')}-01`;
  }

  /** 운영자 목록 — 역할 · 마지막 로그인 · 2단계 · 오래 안 씀 */
  async operators() {
    const [s] = await this.db.query<{ idle: number }>(`SELECT fn_setting_int('ops.role_idle_days', 90) AS idle`);
    const idle = Number(s?.idle ?? 90);
    const rows = await this.db.query<{ idle: boolean; mfa: boolean; status: string }>(
      `SELECT a.id, a.name, a.email, a.status,
              array_agg(r.role ORDER BY array_position(ARRAY['SUPER','ADMIN','REVIEWER','PAYOUT'], r.role)) AS roles,
              min(r.granted_at) AS "grantedAt", a.last_login_at AS "lastLoginAt",
              (m.enabled_at IS NOT NULL) AS mfa,
              (a.status = 'ACTIVE' AND (a.last_login_at IS NULL OR a.last_login_at < now() - make_interval(days => $1))) AS idle
         FROM accounts a
         JOIN account_roles r ON r.account_id = a.id AND r.role IN ${OPS}
         LEFT JOIN account_mfa m ON m.account_id = a.id
        GROUP BY a.id, m.enabled_at
        ORDER BY (a.status = 'ACTIVE') DESC, a.last_login_at DESC NULLS LAST`, [idle]);
    return {
      idleDays: idle, items: rows,
      total: rows.length,
      idleCount: rows.filter((r) => r.idle).length,
      noMfa: rows.filter((r) => r.status === 'ACTIVE' && !r.mfa).length,
    };
  }

  /** 최근 권한 변경 50건(role_changes · 고칠 수 없는 기록) */
  changes() {
    return this.db.query(
      `SELECT c.id::text AS id, c.role, c.action, c.reason, c.changed_at AS "changedAt",
              t.name AS "targetName", t.email AS "targetEmail", b.name AS "changedByName"
         FROM role_changes c
         LEFT JOIN accounts t ON t.id = c.account_id
         LEFT JOIN accounts b ON b.id = c.changed_by
        ORDER BY c.changed_at DESC LIMIT 50`);
  }

  /** 지난 4분기(이번 분기 포함) — 점검 여부 */
  quarters() {
    return this.db.query(
      `WITH q AS (SELECT (date_trunc('quarter', ${KST_NOW}) - make_interval(months => 3 * g))::date AS q FROM generate_series(0, 3) g)
       SELECT to_char(q.q, 'YYYY') || '-Q' || extract(quarter FROM q.q)::int AS quarter,
              r.reviewed_at AS "reviewedAt", ra.name AS "reviewedBy", r.note,
              (q.q = date_trunc('quarter', ${KST_NOW})::date) AS current
         FROM q LEFT JOIN audit.role_reviews r ON r.quarter = q.q LEFT JOIN accounts ra ON ra.id = r.reviewed_by
        ORDER BY q.q DESC`);
  }

  /** 점검 완료 — 이번 분기 또는 지난 분기 · 분기에 한 번 · 그때 요약을 함께 남김 */
  async review(q: unknown, note: string) {
    const quarter = this.quarter(q);
    if (!note?.trim() || note.trim().length < 5) throw new PolicyViolation('ROLE_REVIEW_NOTE', '점검 메모를 5자 이상 적어 주십시오.');
    const [ok] = await this.db.query<{ ok: boolean }>(
      `SELECT ($1::date <= date_trunc('quarter', ${KST_NOW})::date AND $1::date >= (date_trunc('quarter', ${KST_NOW}) - interval '3 months')::date) AS ok`, [quarter]);
    if (!ok?.ok) throw new PolicyViolation('ROLE_REVIEW_QUARTER_RANGE', '이번 분기나 지난 분기만 점검 완료를 남길 수 있습니다.');
    const ops = await this.operators();
    const summary = {
      total: ops.total, idle: ops.idleCount, noMfa: ops.noMfa, idleDays: ops.idleDays,
      idleAccounts: ops.items.filter((r: any) => r.idle).map((r: any) => r.email),
      roles: ops.items.reduce((m: Record<string, number>, r: any) => { for (const x of r.roles) m[x] = (m[x] ?? 0) + 1; return m; }, {}),
    };
    const [row] = await this.db.query(
      `INSERT INTO audit.role_reviews (quarter, reviewed_by, note, summary) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (quarter) DO NOTHING RETURNING to_char(quarter, 'YYYY-MM-DD') AS quarter, reviewed_at AS "reviewedAt"`,
      [quarter, this.me, note.trim(), JSON.stringify(summary)]);
    if (!row) throw new StateConflict('ROLE_REVIEW_DONE', '이 분기는 이미 점검 완료를 남겼습니다 — 기록은 고칠 수 없습니다.');
    return { ...row, summary };
  }

  /** 하루 요약 — 분기 시작 15일째부터 지난 분기 점검이 없으면(그 분기 한 번) */
  async due(): Promise<{ quarter: string; alert: boolean }> {
    const [r] = await this.db.query<{ quarter: string; alert: boolean }>(
      `SELECT to_char(p.q, 'YYYY') || '-Q' || extract(quarter FROM p.q)::int AS quarter,
              (${KST_NOW}::date >= date_trunc('quarter', ${KST_NOW})::date + 14
               AND NOT EXISTS (SELECT 1 FROM audit.role_reviews r WHERE r.quarter = p.q)
               AND NOT EXISTS (SELECT 1 FROM ops_alerts o WHERE o.alert_code = 'ROLE_REVIEW_DUE'
                                AND o.detail->>'quarter' = to_char(p.q, 'YYYY') || '-Q' || extract(quarter FROM p.q)::int)) AS alert
         FROM (SELECT (date_trunc('quarter', ${KST_NOW}) - interval '3 months')::date AS q) p`);
    return r!;
  }

  /* ── 파기 기록 ─────────────────────────────────────────────────── */

  /** 지난 days 일 pii_purge 실행(날짜별 건수) · 달별 합계 */
  async purges(days = 60) {
    const d = Math.min(Math.max(Math.trunc(Number(days) || 60), 1), 400);
    const runs = await this.db.query<{ detail: string | null; ok: boolean | null }>(
      `SELECT id::text AS id, to_char(started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS "startedAt",
              ended_at AS "endedAt", ok, affected, detail
         FROM job_runs WHERE job = 'pii_purge' AND started_at >= now() - make_interval(days => $1)
        ORDER BY started_at DESC`, [d]);
    const KEYS = ['accounts', 'ipMasked', 'leads', 'consultRequests', 'authRecords', 'overdue'] as const;
    const items = runs.map((r: any) => {
      let c: Record<string, number> = {};
      if (r.ok) { try { c = JSON.parse(r.detail ?? '{}'); } catch { c = {}; } }
      return { id: r.id, startedAt: r.startedAt, endedAt: r.endedAt, ok: r.ok, affected: r.affected,
        counts: Object.fromEntries(KEYS.map((k) => [k, Number(c[k] ?? 0)])),
        error: r.ok === false ? String(r.detail ?? '').slice(0, 200) : null };
    });
    const months: Record<string, Record<string, number>> = {};
    for (const it of items) {
      if (!it.ok) continue;
      const m = it.startedAt.slice(0, 7);
      months[m] ??= Object.fromEntries(KEYS.map((k) => [k, 0]));
      for (const k of KEYS) months[m][k] += k === 'overdue' ? 0 : it.counts[k];
    }
    const [st] = await this.db.query<{ last: string | null; hours: number | null }>(
      `SELECT to_char(max(started_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS last,
              round(extract(epoch FROM now() - max(started_at)) / 3600)::int AS hours
         FROM job_runs WHERE job = 'pii_purge'`);
    const [ov] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_purge_overdue`).catch(() => [{ n: 0 }]);
    return { days: d, items, months, last: st?.last ?? null, hoursSinceLast: st?.hours ?? null, overdueNow: Number(ov?.n ?? 0) };
  }

  /** 하루 요약 — 마지막 실행 실패(실행마다 한 번) · 30시간 넘게 안 돎(하루 한 번) */
  async purgeHealth(): Promise<{ failedRun: { id: string; at: string; error: string } | null; missedHours: number | null }> {
    const [last] = await this.db.query<{ id: string; at: string; ok: boolean | null; detail: string | null; hours: number; alerted: boolean }>(
      `SELECT j.id::text AS id, to_char(j.started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at, j.ok, j.detail,
              round(extract(epoch FROM now() - j.started_at) / 3600)::int AS hours,
              EXISTS (SELECT 1 FROM ops_alerts o WHERE o.alert_code = 'PII_PURGE_FAILED' AND o.detail->>'runId' = j.id::text) AS alerted
         FROM job_runs j WHERE j.job = 'pii_purge' ORDER BY j.started_at DESC LIMIT 1`);
    const failedRun = last && last.ok === false && !last.alerted ? { id: last.id, at: last.at, error: String(last.detail ?? '').slice(0, 200) } : null;
    let missedHours: number | null = null;
    if (!last || last.hours > 30) {
      const [a] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'PII_PURGE_MISSED' AND raised_at > now() - interval '20 hours'`);
      if (!a?.n) missedHours = last ? last.hours : -1;
    }
    return { failedRun, missedHours };
  }
}
