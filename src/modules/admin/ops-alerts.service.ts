import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, StateConflict } from '../../core/errors';
import { MailService } from '../../common/mail/mail.service';
import { maskMail } from '../../common/mail/mail-admin.service';

/* ---------------------------------------------------------------------
 * v10.179 (D168 · docs/279) — 운영 알림 목록 · 확인
 *
 *   정기 작업 · 스크립트가 남기는 운영 알림(ops_alerts — SERVER_ERROR_SPIKE · SLOW_API · UPLOADS_BACKUP_STALE ·
 *   POLL_HIDDEN_BY_REPORTS · DAILY_DIGEST · STUB_PAYMENT_ORDER …)을 운영 화면에서 보고 「확인」합니다.
 *   확인은 한 번만(누가 · 언제 · 메모) — 다시 「확인 안 함」으로 돌리거나 고치지 못함(DB fn_ops_alert_ack_guard).
 *   알림 내용 자체는 바꾸거나 지우지 않습니다.
 *
 *   v10.198 (D176 · docs/312) — 메일 준비 상태(mailStatus) · 시험 메일(mailTest · SUPER · 1분에 1번 · 감사 기록 OPS_MAIL_TEST)
 *   v10.199 (D177 · docs/314) — 「풀림」(resolved_at · 정기 작업이 적음) — 확인 안 한 목록 · 종류별 수에서 기본으로 뺌(resolved=show 면 같이)
 * ------------------------------------------------------------------- */
@Injectable()
export class OpsAlertsService {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}
  private static lastTestAt = 0;
  private get me() { return RequestCtx.actorId(); }

  async list(q: { state?: unknown; code?: unknown; severity?: unknown; page?: unknown; size?: unknown; resolved?: unknown }) {
    const open = q.state !== 'all';
    /* v10.199 (D177 · docs/314) — 확인 안 한 것만 볼 때는 원인이 없어진(풀린) 알림을 기본으로 뺌 · resolved=show 면 같이 */
    const hideResolved = open && q.resolved !== 'show';
    const code = typeof q.code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(q.code) ? q.code : null;
    const sev = typeof q.severity === 'string' && ['INFO', 'WARN', 'CRITICAL'].includes(q.severity) ? q.severity : null;
    const size = Math.min(100, Math.max(1, Number(q.size) || 30));
    const page = Math.max(1, Number(q.page) || 1);
    const items = await this.db.query(
      `SELECT o.id::text AS id, o.alert_code AS code, o.severity, o.title, o.detail, o.raised_at AS "raisedAt",
              o.acknowledged_at AS "acknowledgedAt", o.ack_note AS "ackNote", a.name AS "acknowledgedBy", o.mailed_at AS "mailedAt",
              o.remailed_at AS "remailedAt", o.resolved_at AS "resolvedAt", o.resolve_note AS "resolveNote"
         FROM ops_alerts o LEFT JOIN accounts a ON a.id = o.acknowledged_by
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL) AND ($6::boolean IS FALSE OR o.resolved_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)
        ORDER BY o.raised_at DESC, o.id DESC
        LIMIT $4 OFFSET $5`, [open, code, sev, size, (page - 1) * size, hideResolved]);
    const [t] = await this.db.query<{ n: number; resolved: number }>(
      `SELECT count(*) FILTER (WHERE $4::boolean IS FALSE OR o.resolved_at IS NULL)::int AS n,
              count(*) FILTER (WHERE o.resolved_at IS NOT NULL)::int AS resolved
         FROM ops_alerts o
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)`, [open, code, sev, hideResolved]);
    /* 종류별 — 확인 안 한 수 · 지난 7일 수 · 가장 최근(목록 위 묶음 칸) */
    const codes = await this.db.query(
      `SELECT alert_code AS code, count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL)::int AS open,
              count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NOT NULL)::int AS resolved,
              count(*) FILTER (WHERE raised_at > now() - interval '7 days')::int AS "last7d", max(raised_at) AS "lastAt",
              (array_agg(severity ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL))[1] AS "openSeverity"
         FROM ops_alerts GROUP BY alert_code
        HAVING count(*) FILTER (WHERE acknowledged_at IS NULL) > 0 OR max(raised_at) > now() - interval '7 days'
        ORDER BY count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL) DESC, max(raised_at) DESC`);
    return { items, total: t?.n ?? 0, resolvedHidden: hideResolved ? t?.resolved ?? 0 : 0, page, size, pages: Math.max(1, Math.ceil((t?.n ?? 0) / size)), codes };
  }

  async ack(id: string, note?: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 알림입니다.');
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by = $2, ack_note = $3
        WHERE id = $1::bigint AND acknowledged_at IS NULL RETURNING id::text AS id`, [id, this.me, note?.trim() || null]);
    if (r) return { ok: true, id, note: '확인했습니다.' };
    const [x] = await this.db.query(`SELECT 1 FROM ops_alerts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 알림입니다.');
    throw new StateConflict('ALERT_ACKED', '이미 확인한 알림입니다.');
  }

  /** 같은 종류의 확인 안 한 알림을 한꺼번에 확인 */
  async ackCode(code: string, note?: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by = $2, ack_note = $3
        WHERE alert_code = $1 AND acknowledged_at IS NULL RETURNING id::text AS id`, [code, this.me, note?.trim() || null]);
    return { ok: true, code, acknowledged: rows.length, note: rows.length ? `${rows.length}건을 확인했습니다.` : '확인할 알림이 없습니다.' };
  }

  /* ── v10.198 (D176 · docs/312) 메일 준비 상태 · 시험 메일 ─────────────── */

  private async digestTo(): Promise<string> {
    const [c] = await this.db.query<{ to: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to"`);
    return (c?.to ?? '').trim();
  }

  /** 운영 알림 화면 「메일」 줄 — 준비 여부 · 까닭 · 받는 주소(가림) · 마지막 정기 작업 결과 · 마지막 시험 메일 */
  async mailStatus() {
    const [st, to] = await Promise.all([this.mail.status(), this.digestTo()]);
    const [j] = await this.db.query<{ at: string; detail: string | null }>(
      `SELECT started_at AS at, detail FROM job_runs WHERE job = 'launch_watch' AND ok ORDER BY started_at DESC LIMIT 1`);
    let lastJob: { at: string; pending: number; mailed: number; reason: string | null } | null = null;
    const m = /"alertMail":(\{[^}]*\})/.exec(j?.detail ?? '');
    if (j && m) {
      try { const a = JSON.parse(m[1]); lastJob = { at: j.at, pending: Number(a.pending) || 0, mailed: Number(a.mailed) || 0, reason: a.reason ?? null }; } catch { /* 옛 기록 · 잘린 기록 */ }
    }
    const [t] = await this.db.query<{ at: string; result: any }>(
      `SELECT occurred_at AS at, after_data AS result FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST' ORDER BY occurred_at DESC LIMIT 1`);
    return {
      ready: st.ready, reason: st.reason, to: to ? maskMail(to) : null, lastJob,
      lastTest: t ? { at: t.at, ok: !!t.result?.ok, reason: t.result?.reason ?? null } : null,
    };
  }

  /** 시험 메일 한 통(SUPER · 1분에 1번) — 외부 연동 › 메일의 시험 메일(아무 주소 · 스위치와 따로)과 달리 **급한 알림 메일과 같은 길**
   *  (받는 주소 ops.digest_to · 메일 준비 ready)로 보냄. 못 보내도 200 으로 까닭을 돌려줌 — 감사 기록(OPS_MAIL_TEST)에 결과가 남도록 */
  async mailTest(): Promise<{ ok: boolean; reason: string | null; to: string | null; note: string }> {
    const [w] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST' AND occurred_at > now() - interval '1 minute'`);
    if (Date.now() - OpsAlertsService.lastTestAt < 60_000 || (w?.n ?? 0) > 0) throw new StateConflict('MAIL_TEST_WAIT', '시험 메일은 1분에 한 번만 보낼 수 있습니다.');
    OpsAlertsService.lastTestAt = Date.now();
    const to = await this.digestTo();
    if (!to) return { ok: false, reason: 'NO_TO', to: null, note: '하루 요약 받는 주소(ops.digest_to)가 비어 있습니다.' };
    const st = await this.mail.status();
    if (!st.ready) return { ok: false, reason: `MAIL_NOT_READY_${st.reason}`, to: maskMail(to), note: '메일이 준비되지 않았습니다 — 보내지 않았습니다.' };
    const r = await this.mail.send({
      to, subject: '[소개뱅크] 운영 알림 시험 메일',
      text: ['소개뱅크 운영 알림 시험 메일입니다.', '', '이 메일이 왔다면 급한 운영 알림 · 하루 요약 메일이 이 주소로 옵니다.', '운영 화면 › 운영 알림에서 SUPER 가 보냈습니다.'].join('\n'),
    });
    return r.ok
      ? { ok: true, reason: null, to: maskMail(to), note: '시험 메일을 보냈습니다 — 받은 편지함(스팸함 포함)을 확인하십시오.' }
      : { ok: false, reason: `SEND_${r.errorKind ?? 'FAILED'}`, to: maskMail(to), note: '보내지 못했습니다.' };
  }
}
