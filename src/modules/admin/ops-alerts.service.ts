import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.179 (D168 · docs/279) — 운영 알림 목록 · 확인
 *
 *   정기 작업 · 스크립트가 남기는 운영 알림(ops_alerts — SERVER_ERROR_SPIKE · SLOW_API · UPLOADS_BACKUP_STALE ·
 *   POLL_HIDDEN_BY_REPORTS · DAILY_DIGEST · STUB_PAYMENT_ORDER …)을 운영 화면에서 보고 「확인」합니다.
 *   확인은 한 번만(누가 · 언제 · 메모) — 다시 「확인 안 함」으로 돌리거나 고치지 못함(DB fn_ops_alert_ack_guard).
 *   알림 내용 자체는 바꾸거나 지우지 않습니다.
 * ------------------------------------------------------------------- */
@Injectable()
export class OpsAlertsService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  async list(q: { state?: unknown; code?: unknown; severity?: unknown; page?: unknown; size?: unknown }) {
    const open = q.state !== 'all';
    const code = typeof q.code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(q.code) ? q.code : null;
    const sev = typeof q.severity === 'string' && ['INFO', 'WARN', 'CRITICAL'].includes(q.severity) ? q.severity : null;
    const size = Math.min(100, Math.max(1, Number(q.size) || 30));
    const page = Math.max(1, Number(q.page) || 1);
    const items = await this.db.query(
      `SELECT o.id::text AS id, o.alert_code AS code, o.severity, o.title, o.detail, o.raised_at AS "raisedAt",
              o.acknowledged_at AS "acknowledgedAt", o.ack_note AS "ackNote", a.name AS "acknowledgedBy"
         FROM ops_alerts o LEFT JOIN accounts a ON a.id = o.acknowledged_by
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)
        ORDER BY o.raised_at DESC, o.id DESC
        LIMIT $4 OFFSET $5`, [open, code, sev, size, (page - 1) * size]);
    const [t] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ops_alerts o
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)`, [open, code, sev]);
    /* 종류별 — 확인 안 한 수 · 지난 7일 수 · 가장 최근(목록 위 묶음 칸) */
    const codes = await this.db.query(
      `SELECT alert_code AS code, count(*) FILTER (WHERE acknowledged_at IS NULL)::int AS open,
              count(*) FILTER (WHERE raised_at > now() - interval '7 days')::int AS "last7d", max(raised_at) AS "lastAt",
              (array_agg(severity ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END) FILTER (WHERE acknowledged_at IS NULL))[1] AS "openSeverity"
         FROM ops_alerts GROUP BY alert_code
        HAVING count(*) FILTER (WHERE acknowledged_at IS NULL) > 0 OR max(raised_at) > now() - interval '7 days'
        ORDER BY count(*) FILTER (WHERE acknowledged_at IS NULL) DESC, max(raised_at) DESC`);
    return { items, total: t?.n ?? 0, page, size, pages: Math.max(1, Math.ceil((t?.n ?? 0) / size)), codes };
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
}
