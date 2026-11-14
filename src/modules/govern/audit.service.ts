import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/** v10.288 (D215 · docs/413) 감사 기록 찾기 조건 */
export interface AuditQuery { who?: string; action?: string; target?: string; from?: string; to?: string; kind?: string; page?: number }
const STAFF_ROLES = `('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF')`;

/**
 * 감사.
 *
 * ── 징후는 뷰가 만듭니다 ──────────────────────────────────────
 * 임계값은 `audit_thresholds` 에 있고, 운영이 바꿀 수 있습니다.
 * 여기서는 그 결과를 모아 보여 주기만 합니다.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  async signals() {
    const VIEWS: Array<[string, string, string]> = [
      ['PII_BURST', 'v_audit_pii_burst', '하루에 개인정보를 많이 본 사람'],
      ['PII_NIGHT', 'v_audit_night_access', '업무 시간 밖 열람'],
      ['ADMIN_BURST', 'v_audit_admin_burst', '운영 행위가 몰림 — 자동화 도구일 수 있습니다'],
      ['ADMIN_NIGHT', 'v_audit_admin_night', '밤중 운영 행위 — 계정이 털렸을 수 있습니다'],
      ['SAME_TARGET', 'v_audit_same_target', '한 사람을 반복 열람 — 가장 흔한 유출 형태입니다'],
      ['NO_REASON', 'v_audit_no_reason', '이유 없이 개인정보를 본 기록'],
    ];
    const items: Array<Record<string, unknown>> = [];
    for (const [code, view, note] of VIEWS) {
      try {
        const [r] = await this.db.query(`SELECT count(*)::int AS n FROM ${view}`);
        const [last] = await this.db.query(
          `SELECT reviewed_at AS "reviewedAt", verdict, reason
             FROM audit_reviews WHERE signal_code = $1
            ORDER BY reviewed_at DESC LIMIT 1`, [code]);
        items.push({
          code, view, note,
          count: r?.n ?? 0,
          ok: (r?.n ?? 0) === 0,
          lastReview: last ?? null,
        });
      } catch {
        items.push({ code, view, note, count: null, ok: false, note2: '뷰를 읽을 수 없습니다' });
      }
    }
    const overdue = await this.db.query(
      `SELECT code, signal_count AS "signalCount", last_reviewed AS "lastReviewed"
         FROM v_audit_review_overdue`);
    const hit = items.filter((x) => !x.ok);
    return {
      items,
      overdue,
      note: overdue.length
        ? `${overdue.length}건이 정해진 시간 안에 확인되지 않았습니다. 밀리면 아무도 안 봅니다.`
        : hit.length
          ? '징후가 있습니다. 0이 아니라고 곧바로 유출은 아닙니다 — 무엇을 보았는지 확인한 뒤 판단하십시오.'
          : '징후가 없습니다.',
    };
  }

  /** v10.32 — 보관 · 확인 기한(site_settings) · 임계(audit_thresholds). 값이 없으면 null(화면은 「—」) */
  async policy() {
    const set = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key IN ('audit.retention_days','audit.review_sla_hours')`);
    const v = (k: string) => { const x = set.find((r) => r.key === k)?.value; return x != null && /^\d+$/.test(x) ? Number(x) : null; };
    const thresholds = await this.db.query(
      `SELECT code, label, threshold, window_hrs AS "windowHrs", note, is_active AS "active"
         FROM audit_thresholds ORDER BY code`);
    return { retentionDays: v('audit.retention_days'), reviewSlaHours: v('audit.review_sla_hours'), thresholds };
  }

  /** v10.31 (시안 SB-ADM-AUD-020 거르기 칩 「전체 · 운영 · 회원 · 개인정보 열람」) — kind = OPS · MEMBER · PII */
  logs(action?: string, days?: number, kind?: string) {
    const d = Math.min(Math.max(Number(days) || 7, 1), 90);
    const k = ['OPS', 'MEMBER', 'PII'].includes(kind ?? '') ? kind! : null;
    return this.db.query(
      `SELECT l.occurred_at AS "at", l.action, l.target_type AS "targetType",
              l.target_id AS "targetId", l.actor_role AS "role",
              coalesce(a.name, '(탈퇴)') AS actor
         FROM audit.audit_logs l
         LEFT JOIN accounts a ON a.id = l.actor_account_id
        WHERE l.occurred_at >= now() - ($2 || ' days')::interval
          AND ($1::text IS NULL OR l.action = $1)
          AND ($3::text IS NULL
               OR ($3 = 'OPS' AND l.actor_role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF'))
               OR ($3 = 'MEMBER' AND coalesce(l.actor_role, '') NOT IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF'))
               OR ($3 = 'PII' AND (l.action LIKE 'PII%' OR l.action IN ('ACCOUNT_VIEW','ACCOUNT_LIST') OR l.action LIKE '%_VIEW')))
        ORDER BY l.occurred_at DESC LIMIT 200`, [action ?? null, d, k]);
  }

  /* ── v10.288 (D215 · docs/413) 감사 기록 찾기 — 사람 · 행위 · 대상 · 기간 · 100줄씩 · 상세 · CSV(SUPER · 1만 줄) ── */
  private where(q: AuditQuery) {
    const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    let from = ymd(q.from), to = ymd(q.to);
    if (!from && !to) from = new Date(Date.now() + 9 * 3600e3 - 6 * 86400e3).toISOString().slice(0, 10);   // 아무것도 없으면 최근 7일(한국 날짜)
    if (from && to && from > to) throw new PolicyViolation('BAD_PERIOD', '시작 날짜가 끝 날짜보다 늦습니다.');
    if (from && to && (Date.parse(to) - Date.parse(from)) / 86400e3 > 366) throw new PolicyViolation('PERIOD_TOO_LONG', '기간은 1년(366일)까지 고를 수 있습니다.');
    const who = (q.who ?? '').trim().slice(0, 100) || null;
    const action = (q.action ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 60) || null;
    const target = (q.target ?? '').trim().slice(0, 60) || null;
    const uuid = target && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target) ? target : null;
    const k = ['OPS', 'MEMBER', 'PII'].includes(q.kind ?? '') ? q.kind! : null;
    const args = [who, action, uuid ? null : target?.toUpperCase() ?? null, uuid, from, to, k];
    const sql = `WHERE ($5::date IS NULL OR l.occurred_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Seoul'))
        AND ($6::date IS NULL OR l.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'))
        AND ($2::text IS NULL OR l.action LIKE $2 || '%')
        AND ($3::text IS NULL OR l.target_type = $3)
        AND ($4::uuid IS NULL OR l.target_id = $4 OR l.actor_account_id = $4)
        AND ($1::text IS NULL OR l.actor_account_id IN (SELECT id FROM accounts WHERE name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' LIMIT 200))
        AND ($7::text IS NULL
             OR ($7 = 'OPS' AND l.actor_role IN ${STAFF_ROLES})
             OR ($7 = 'MEMBER' AND coalesce(l.actor_role, '') NOT IN ${STAFF_ROLES})
             OR ($7 = 'PII' AND (l.action LIKE 'PII%' OR l.action IN ('ACCOUNT_VIEW','ACCOUNT_LIST') OR l.action LIKE '%_VIEW')))`;
    return { sql, args, from, to };
  }

  async search(q: AuditQuery) {
    const page = Math.max(1, Math.min(Number(q.page) || 1, 1000));
    const w = this.where(q);
    const [items, [t]] = await Promise.all([
      this.db.query(
        `SELECT l.id::text AS id, l.occurred_at AS "at", l.action, l.target_type AS "targetType", l.target_id AS "targetId",
                l.actor_role AS "role", coalesce(a.name, CASE WHEN l.actor_account_id IS NULL THEN '(시스템)' ELSE '(탈퇴)' END) AS actor,
                host(l.ip) AS ip
           FROM audit.audit_logs l LEFT JOIN accounts a ON a.id = l.actor_account_id
          ${w.sql} ORDER BY l.occurred_at DESC, l.id DESC LIMIT 100 OFFSET ${(page - 1) * 100}`, w.args),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit.audit_logs l ${w.sql}`, w.args),
    ]);
    return { items, total: Number(t?.n ?? 0), page, pageSize: 100, from: w.from, to: w.to };
  }

  async detail(id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('감사 기록을 찾을 수 없습니다.');
    const [r] = await this.db.query(
      `SELECT l.id::text AS id, l.occurred_at AS "at", l.action, l.target_type AS "targetType", l.target_id AS "targetId",
              l.actor_role AS "role", coalesce(a.name, CASE WHEN l.actor_account_id IS NULL THEN '(시스템)' ELSE '(탈퇴)' END) AS actor,
              host(l.ip) AS ip, l.user_agent AS "userAgent", l.before_data AS "before", l.after_data AS "after"
         FROM audit.audit_logs l LEFT JOIN accounts a ON a.id = l.actor_account_id WHERE l.id = $1::bigint`, [id]);
    if (!r) throw new NotFound('감사 기록을 찾을 수 없습니다.');
    return r;
  }

  /** CSV(엑셀용) — 최근 순 1만 줄까지 · 상세(전 · 후 내용)는 넣지 않음 · 감사 AUDIT_LOG_EXPORT 에 조건 · 줄 수만 */
  async exportCsv(q: AuditQuery) {
    const w = this.where(q);
    const rows = await this.db.query<{ at: string; action: string; targetType: string | null; targetId: string | null; role: string | null; actor: string; ip: string | null }>(
      `SELECT to_char(l.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS "at", l.action, l.target_type AS "targetType", l.target_id::text AS "targetId",
              l.actor_role AS "role", coalesce(a.name, CASE WHEN l.actor_account_id IS NULL THEN '(시스템)' ELSE '(탈퇴)' END) AS actor, host(l.ip) AS ip
         FROM audit.audit_logs l LEFT JOIN accounts a ON a.id = l.actor_account_id
        ${w.sql} ORDER BY l.occurred_at DESC, l.id DESC LIMIT 10001`, w.args);
    const truncated = rows.length > 10000;
    const list = rows.slice(0, 10000);
    const c = (v: unknown) => { const t = v == null ? '' : String(v); return /^[=+\-@]/.test(t) ? `'${t}` : /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = '\uFEFF' + [['일시(한국)', '행위', '대상 종류', '대상 번호', '역할', '누가', 'IP'].join(','),
      ...list.map((r) => [r.at, r.action, r.targetType, r.targetId, r.role, r.actor, r.ip].map(c).join(','))].join('\r\n') + '\r\n';
    const cond = { who: q.who || null, action: q.action || null, target: q.target || null, from: w.from, to: w.to, kind: q.kind || null };
    await this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, 'AUDIT_LOG_EXPORT', 'AUDIT', NULL, $3::jsonb, $4, $5)`,
      [this.me, RequestCtx.get()?.actorRole ?? null, JSON.stringify({ ...cond, rows: list.length, truncated }), RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
    return { filename: `audit-logs-${w.from ?? 'start'}_${w.to ?? 'now'}.csv`, csv, rows: list.length, truncated,
      note: truncated ? '1만 줄이 넘어 최근 1만 줄만 담았습니다 — 기간을 좁혀 나눠 받으십시오.' : `${list.length}줄을 담았습니다.` };
  }

  async reviews() {
    const items = await this.db.query(
      `SELECT r.id, r.signal_code AS "signalCode", r.verdict, r.reason,
              r.action_taken AS "actionTaken", r.reviewed_at AS "reviewedAt",
              coalesce(a.name,'(탈퇴)') AS "reviewedBy"
         FROM audit_reviews r
         LEFT JOIN accounts a ON a.id = r.reviewed_by
        ORDER BY r.reviewed_at DESC LIMIT 100`);
    const [thin] = await this.db.query(`SELECT count(*)::int AS n FROM v_audit_review_thin`);
    return {
      items,
      thinCount: thin?.n ?? 0,
      note: (thin?.n ?? 0) > 0
        ? '사유가 열 자도 안 되는 기록이 있습니다 — 나중에 근거가 되지 않습니다.'
        : null,
    };
  }

  async review(dto: {
    signalCode: string; verdict: string; reason: string;
    actionTaken?: string; targetKind?: string; targetId?: string;
  }) {
    /* ★ 막는 것은 DB 트리거가 합니다(C890). 여기서 막으면
     *   배치가 직접 INSERT 할 때 통과합니다. */
    const [r] = await this.db.query(
      `INSERT INTO audit_reviews
         (signal_code, verdict, reason, action_taken, target_kind, target_id, reviewed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, signal_code AS "signalCode", verdict, reviewed_at AS "reviewedAt"`,
      [dto.signalCode, dto.verdict, dto.reason, dto.actionTaken ?? null,
       dto.targetKind ?? null, dto.targetId ?? null, this.me]);
    return {
      ok: true, ...r,
      note: dto.verdict === 'ESCALATED'
        ? '윗선에 보고하신 것으로 기록했습니다. 후속 조치도 남기십시오.'
        : '기록했습니다.',
    };
  }
}
