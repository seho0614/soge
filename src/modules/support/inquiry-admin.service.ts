import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';
import { inquiryNo } from '../public/public.service';
import { permDecideMode } from '../admin/perm-mode';   // v10.615 (docs/757) GROUPS 면 담당 = 1:1 문의 고치기 이상

export const INQUIRY_STATES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
export const INQUIRY_PAGE = 30;
export const INQUIRY_ANSWER_MAX = 4000;

/**
 * v10.333 (D225 · docs/464) — 운영 화면 「1:1 문의」 답변함(SB-ADM-INQ-010)
 *
 *   대표 11/17 「개발 후보 목록」 → 「① 1:1 문의 답변함」. 전에는 문의를 받기만 하고 운영에서 답할 길이 없었습니다.
 *   목록(상태 · 분류 · 기한 넘김 · 찾기) · 한 건(본문 · 첨부 · 관련 거래 · 이 회원의 지난 문의) · 답변(회원 알림 INQUIRY_ANSWERED) · 담당 · 메모 · 닫기 · 다시 열기.
 *   답변을 고치면 옛 답은 감사 기록(INQUIRY_ANSWER · before)에 남습니다. 비회원 문의는 메일로만 답이 갑니다(운영 메일 준비 전이면 「메일 대기」).
 */
@Injectable()
export class InquiryAdminService {
  constructor(private readonly db: DatabaseService) {}

  async list(q: { status?: string; category?: string; overdue?: boolean; q?: string; page?: number }) {
    const st = (INQUIRY_STATES as readonly string[]).includes(q.status ?? '') ? q.status! : null;
    const word = (q.q ?? '').trim().slice(0, 100);
    const page = Math.max(1, Math.min(1000, Math.floor(Number(q.page) || 1)));
    const where = `($1::text IS NULL OR i.status = $1) AND ($2::text IS NULL OR i.category = $2)
                   AND (NOT $3::boolean OR (i.status = 'OPEN' AND i.due_at < now()))
                   AND ($4::text = '' OR i.title ILIKE '%' || $4 || '%' OR i.body ILIKE '%' || $4 || '%' OR a.email::text ILIKE '%' || $4 || '%' OR i.email::text ILIKE '%' || $4 || '%')`;
    const args = [st, q.category || null, !!q.overdue, word];
    const rows = await this.db.query<Record<string, unknown> & { id: string; createdAt: Date; email: string | null }>(
      `SELECT i.id::text AS id, i.category, cl.label AS "categoryLabel", i.title, i.status, i.channel,
              i.created_at AS "createdAt", i.due_at AS "dueAt", i.answered_at AS "answeredAt",
              (i.status = 'OPEN' AND i.due_at < now()) AS overdue, (i.account_id IS NULL) AS guest,
              coalesce(a.email, i.email)::text AS email, left(coalesce(a.name, ''), 1) AS "nameHead",
              s.email::text AS assignee, cardinality(i.attachment_keys) AS files, i.feedback, i.reopen_count AS "reopenCount"
         FROM inquiries i
         LEFT JOIN accounts a ON a.id = i.account_id
         LEFT JOIN accounts s ON s.id = i.assignee_id
         LEFT JOIN code_labels cl ON cl.domain = 'inquiry.category' AND cl.code = i.category
        WHERE ${where}
        ORDER BY (i.status = 'OPEN') DESC, CASE WHEN i.status = 'OPEN' THEN i.due_at END ASC NULLS LAST, i.created_at DESC
        LIMIT ${INQUIRY_PAGE + 1} OFFSET ${(page - 1) * INQUIRY_PAGE}`, args);
    const [c] = await this.db.query<{ open: number; overdue: number; answered: number; closed: number }>(
      `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open,
              count(*) FILTER (WHERE status = 'OPEN' AND due_at < now())::int AS overdue,
              count(*) FILTER (WHERE status = 'ANSWERED')::int AS answered,
              count(*) FILTER (WHERE status = 'CLOSED')::int AS closed FROM inquiries`);
    const cats = await this.db.query<{ code: string; label: string }>(
      `SELECT code, label FROM code_labels WHERE domain = 'inquiry.category' AND is_active ORDER BY sort_order, code`);
    return {
      rows: rows.slice(0, INQUIRY_PAGE).map((r) => ({ ...r, no: inquiryNo(r.id, r.createdAt), email: maskMail(r.email) })),
      more: rows.length > INQUIRY_PAGE, page, counts: c, categories: cats,
    };
  }

  private async row(id: string) {
    const [r] = await this.db.query<Record<string, unknown> & { id: string; createdAt: Date; accountId: string | null; email: string | null; status: string; answer: string | null }>(
      `SELECT i.id::text AS id, i.account_id AS "accountId", i.category, cl.label AS "categoryLabel", i.title, i.body, i.status, i.channel,
              i.answer, i.answered_at AS "answeredAt", ab.email::text AS "answeredBy", i.created_at AS "createdAt", i.due_at AS "dueAt",
              (i.status = 'OPEN' AND i.due_at < now()) AS overdue, i.assignee_id AS "assigneeId", s.email::text AS assignee, i.staff_note AS "staffNote",
              coalesce(a.email, i.email)::text AS email, a.name, i.attachment_keys AS files, i.deal_id AS "dealId", d.status AS "dealStatus"
         FROM inquiries i
         LEFT JOIN accounts a ON a.id = i.account_id
         LEFT JOIN accounts s ON s.id = i.assignee_id
         LEFT JOIN accounts ab ON ab.id = i.answered_by
         LEFT JOIN deals d ON d.id = i.deal_id
         LEFT JOIN code_labels cl ON cl.domain = 'inquiry.category' AND cl.code = i.category
        WHERE i.id = $1::uuid`, [id]);
    if (!r) throw new NotFound('그 문의가 없습니다.');
    return r;
  }

  async one(id: string) {
    const r = await this.row(id);
    const past = r.accountId ? await this.db.query<{ id: string; createdAt: Date }>(
      `SELECT id::text AS id, title, status, created_at AS "createdAt" FROM inquiries
        WHERE account_id = $1 AND id <> $2::uuid ORDER BY created_at DESC LIMIT 10`, [r.accountId, id]) : [];
    const groups = (await permDecideMode(this.db).catch(() => 'ROLE')) === 'GROUPS';   // v10.615 (docs/757) — ROLE · COMPARE 는 지금처럼 ADMIN · SUPER
    const staff = await this.db.query<{ id: string; email: string }>(
      `SELECT DISTINCT a.id::text AS id, a.email::text AS email FROM accounts a JOIN account_roles ar ON ar.account_id = a.id
        WHERE a.status = 'ACTIVE'
          AND CASE WHEN $1::boolean
                   THEN ar.role = 'SUPER' OR (ar.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
                        AND EXISTS (SELECT 1 FROM fn_perm_effective(a.id) e WHERE e.task_key = 'inquiries' AND e.level IN ('EDIT', 'APPROVE')))
                   ELSE ar.role IN ('ADMIN', 'SUPER') END
        ORDER BY 2 LIMIT 50`, [groups]);
    return {
      ...r, no: inquiryNo(r.id, r.createdAt), email: maskMail(r.email), guest: !r.accountId,
      past: past.map((p) => ({ ...p, no: inquiryNo(p.id, p.createdAt) })),
      staff: staff.map((s) => ({ id: s.id, email: maskMail(s.email) })),
    };
  }

  /**
   * v10.337 (docs/470) — 1:1 문의 처리 지표(최근 days 일 · 7 ~ 90 · 처음 30)
   *   처음 답 시각 = 감사 기록 INQUIRY_ANSWER 가장 이른 것(answered_at 은 고치면 바뀜). 시간은 접수부터 · 시간 단위(소수 한 자리).
   *   기한 안 = 처음 답이 due_at 전(기한 없는 옛 문의는 답했으면 기한 안으로 셈).
   */
  async stats(daysIn?: number) {
    const days = Math.max(7, Math.min(90, Math.floor(Number(daysIn) || 30)));
    const [s] = await this.db.query<Record<string, number | null>>(
      `WITH w AS (
        SELECT i.id, i.category, i.status, i.created_at, i.due_at, i.feedback,
               (SELECT min(l.occurred_at) FROM audit.audit_logs l WHERE l.action = 'INQUIRY_ANSWER' AND l.target_id = i.id) AS first_at
          FROM inquiries i WHERE i.created_at > now() - make_interval(days => $1))
       SELECT count(*)::int AS received, count(first_at)::int AS answered,
              count(*) FILTER (WHERE status = 'OPEN')::int AS "stillOpen",
              round((avg(extract(epoch FROM first_at - created_at)) / 3600)::numeric, 1)::float AS "avgHours",
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at - created_at)) / 3600)::numeric, 1)::float AS "medianHours",
              count(*) FILTER (WHERE first_at IS NOT NULL AND (due_at IS NULL OR first_at <= due_at))::int AS "inTime",
              count(*) FILTER (WHERE feedback = 'RESOLVED')::int AS resolved,
              count(*) FILTER (WHERE feedback = 'UNRESOLVED')::int AS unresolved
         FROM w`, [days]);
    const byCategory = await this.db.query<{ category: string; label: string | null; received: number; answered: number }>(
      `WITH w AS (
        SELECT i.id, i.category, i.status, i.created_at, i.due_at, i.feedback,
               (SELECT min(l.occurred_at) FROM audit.audit_logs l WHERE l.action = 'INQUIRY_ANSWER' AND l.target_id = i.id) AS first_at
          FROM inquiries i WHERE i.created_at > now() - make_interval(days => $1))
       SELECT w.category, cl.label, count(*)::int AS received, count(first_at)::int AS answered
         FROM w LEFT JOIN code_labels cl ON cl.domain = 'inquiry.category' AND cl.code = w.category
        GROUP BY w.category, cl.label ORDER BY count(*) DESC, w.category`, [days]);
    const templates = await this.db.query<{ id: string; title: string; used: number }>(
      `SELECT t.id::text AS id, t.title, count(l.occurred_at)::int AS used
         FROM inquiry_templates t
         LEFT JOIN audit.audit_logs l ON l.action = 'INQUIRY_ANSWER' AND l.after_data->>'templateId' = t.id::text
                                     AND l.occurred_at > now() - make_interval(days => $1)
        WHERE t.is_active GROUP BY t.id, t.title, t.sort_order ORDER BY count(l.occurred_at) DESC, t.sort_order, t.title`, [days]);
    /* v10.340 (D230) — 문의하기 폼에서 「이걸로 해결됨」(문의 전 해결) */
    const [df] = await this.db.query<{ n: number }>(
      `SELECT coalesce(sum(deflect), 0)::int AS n FROM faq_daily WHERE day > (now() AT TIME ZONE 'Asia/Seoul')::date - $1::int`, [days]);
    const received = Number(s?.received ?? 0), answered = Number(s?.answered ?? 0);
    return {
      days, received, answered, stillOpen: Number(s?.stillOpen ?? 0), avgHours: s?.avgHours ?? null, medianHours: s?.medianHours ?? null,
      inTime: Number(s?.inTime ?? 0), inTimeRate: answered ? Math.round((Number(s?.inTime ?? 0) / answered) * 1000) / 10 : null,
      byCategory, templates, deflected: Number(df?.n ?? 0),
      /* v10.341 (D231) — 답변 만족도: 해결됨 · 아직 해결 안 됨 · 해결률(남긴 것 중) */
      resolved: Number(s?.resolved ?? 0), unresolved: Number(s?.unresolved ?? 0),
      resolvedRate: Number(s?.resolved ?? 0) + Number(s?.unresolved ?? 0) ? Math.round((Number(s?.resolved ?? 0) / (Number(s?.resolved ?? 0) + Number(s?.unresolved ?? 0))) * 1000) / 10 : null,
    };
  }

  async answer(id: string, text: string, close?: boolean, templateId?: string) {
    const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (body.length < 2) throw new PolicyViolation('INQUIRY_ANSWER_SHORT', '답변을 2자 이상 적어 주십시오.');
    if (body.length > INQUIRY_ANSWER_MAX) throw new PolicyViolation('INQUIRY_ANSWER_LONG', `답변은 ${INQUIRY_ANSWER_MAX.toLocaleString('ko-KR')}자까지입니다.`);
    return this.db.transaction(async () => {
      const [cur] = await this.db.query<{ status: string; answer: string | null; accountId: string | null; title: string; email: string | null }>(
        `SELECT status, answer, account_id AS "accountId", title, email::text AS email FROM inquiries WHERE id = $1::uuid FOR UPDATE`, [id]);
      if (!cur) throw new NotFound('그 문의가 없습니다.');
      if (cur.status === 'CLOSED') throw new StateConflict('INQUIRY_CLOSED', '닫힌 문의입니다 — 「다시 열기」 뒤 답하십시오.');
      if (cur.answer === body && !close) return { ok: true, id, note: '바뀐 내용이 없습니다.' };
      await this.db.query(
        `UPDATE inquiries SET answer = $2, answered_at = now(), answered_by = $3, status = $4, feedback = NULL, feedback_at = NULL WHERE id = $1::uuid`,
        [id, body, RequestCtx.actorId() ?? null, close ? 'CLOSED' : 'ANSWERED']);
      const edit = cur.answer !== null;
      /* v10.337 — 답변 틀을 골라 썼으면 감사 기록에 틀 번호(지표 「답변 틀별 쓴 횟수」) · 없는 틀이면 적지 않음 */
      const [t] = templateId ? await this.db.query<{ id: string }>(`SELECT id::text AS id FROM inquiry_templates WHERE id::text = $1`, [templateId]) : [];
      const tpl = t?.id ?? null;
      if (cur.accountId) {
        await this.db.query(`SELECT fn_notify($1::uuid, 'INQUIRY_ANSWERED', jsonb_build_object('title', $2::text), '/support/history')`,
          [cur.accountId, cur.title]);
      }
      await this.db.query(
        `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, before_data, after_data, ip, user_agent)
         VALUES ($1, $2, 'INQUIRY_ANSWER', 'INQUIRY', $3::uuid, $4::jsonb, $5::jsonb, $6, $7)`,
        [RequestCtx.actorId(), RequestCtx.get()?.actorRole ?? null, id, JSON.stringify({ status: cur.status, answer: cur.answer }),
         JSON.stringify({ status: close ? 'CLOSED' : 'ANSWERED', chars: body.length, edit, templateId: tpl }), RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
      const who = cur.accountId ? '회원에게 알림을 보냈습니다(나의공간 · 내 문의 내역에 보임)' : '비회원 문의라 메일로만 답이 갑니다 — 운영 메일 준비 전이면 메일 대기';
      return { ok: true, id, note: `${edit ? '답변을 고쳤습니다' : '답변했습니다'}${close ? '(닫음)' : ''} — ${who}.` };
    });
  }

  async patch(id: string, v: { assigneeId?: string; staffNote?: string; status?: string }) {
    const cur = await this.row(id);
    const next = v.status ?? (cur.status as string);
    if (v.status === 'OPEN' && cur.status === 'OPEN') throw new StateConflict('INQUIRY_ALREADY_OPEN', '이미 열린 문의입니다.');
    if (v.status === 'ANSWERED') throw new PolicyViolation('INQUIRY_STATUS', '「답변 완료」는 답변을 보내면 저절로 됩니다.');
    if (v.status && !(INQUIRY_STATES as readonly string[]).includes(v.status)) throw new PolicyViolation('INQUIRY_STATUS', '상태가 올바르지 않습니다.');
    let assignee: string | null = (cur.assigneeId as string | null) ?? null;
    if (v.assigneeId !== undefined) {
      assignee = v.assigneeId || null;
      if (assignee) {
        const groups = (await permDecideMode(this.db).catch(() => 'ROLE')) === 'GROUPS';   // v10.615 (docs/757)
        const [ok] = await this.db.query(
          `SELECT 1 FROM account_roles r WHERE r.account_id = $1::uuid
              AND CASE WHEN $2::boolean
                       THEN r.role = 'SUPER' OR (r.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
                            AND EXISTS (SELECT 1 FROM fn_perm_effective(r.account_id) e WHERE e.task_key = 'inquiries' AND e.level IN ('EDIT', 'APPROVE')))
                       ELSE r.role IN ('ADMIN', 'SUPER') END
            LIMIT 1`, [assignee, groups]);
        if (!ok) throw new PolicyViolation('INQUIRY_ASSIGNEE', '담당은 운영자(ADMIN · SUPER)만 정할 수 있습니다.');
      }
    }
    const note = v.staffNote !== undefined ? (v.staffNote.trim().slice(0, 1000) || null) : ((cur.staffNote as string | null) ?? null);
    await this.db.query(
      `UPDATE inquiries SET status = $2, assignee_id = $3, staff_note = $4,
              due_at = CASE WHEN $2 = 'OPEN' AND status <> 'OPEN' THEN fn_business_day_after(now()) ELSE due_at END
        WHERE id = $1::uuid`, [id, next, assignee, note]);
    const what = next !== cur.status ? (next === 'CLOSED' ? '닫았습니다' : '다시 열었습니다(기한은 지금부터 영업일 1일)') : '저장했습니다';
    return { ok: true, id, note: `문의를 ${what}.` };
  }
}
