import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { ReviewService } from '../review/review.service';
import { AbuseService } from '../review/abuse.service';
import { InquiryAdminService } from '../support/inquiry-admin.service';
import { AdminMemberService } from '../admin/admin-member.service';

/* ---------------------------------------------------------------------
 * v10.511 (D275 · docs/649) 운영 화면 일괄 처리 — 대표 11/20 「㊺ ③」
 *
 *   검수(승인 · 반려) · 신고(인정 · 기각) · 1:1 문의(닫기 · 다시 열기 · 담당) · 회원(정지 · 정상)을 여러 줄 골라 한 번에 — 한 번 최대 100줄 · 사유 필수
 *   한 줄씩: 기존 한 건 처리 함수(ReviewService.decide · AbuseService.resolve · InquiryAdminService.patch · AdminMemberService.setAccountStatus)를
 *            그 줄만의 거래 안에서 부르고 같은 거래에서 감사 한 줄(한 건 처리와 같은 이름 · after_data 에 일괄 번호 · 사유) — 한 줄이 실패해도 다른 줄은 그대로
 *   결과는 opx_bulk_runs 한 줄(쌓기만 · 줄마다 됨 · 오류 코드)
 * ------------------------------------------------------------------- */

export const BULK_MAX = 100;
export const BULK_KINDS = ['REVIEW', 'REPORT', 'INQUIRY', 'MEMBER'] as const;
export const BULK_ACTIONS: Record<string, readonly string[]> = {
  REVIEW: ['APPROVE', 'REJECT'], REPORT: ['UPHOLD', 'DISMISS'], INQUIRY: ['CLOSE', 'REOPEN', 'ASSIGN'], MEMBER: ['SUSPEND', 'ACTIVATE'],
};
/* 한 건 처리와 같은 감사 이름 · 대상 종류(interceptor @Audit 와 같음) */
const AUDIT_OF: Record<string, [string, string]> = {
  REVIEW: ['REVIEW_DECIDE', 'REVIEW_ITEM'], REPORT: ['REPORT_RESOLVE', 'REPORT'], INQUIRY: ['INQUIRY_UPDATE', 'INQUIRY'], MEMBER: ['ACCOUNT_STATUS', 'ACCOUNT'],
};
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface BulkDeps { db: DatabaseService; review: ReviewService; abuse: AbuseService; inquiry: InquiryAdminService; member: AdminMemberService }
export interface BulkInput { ids: string[]; action: string; reason: string; reasonCode?: string; assigneeId?: string }
export interface ItemResult { id: string; ok: boolean; code?: string; message?: string }

function errOf(e: unknown): { code: string; message: string } {
  const r = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string; message?: string } | string | undefined;
  if (r && typeof r === 'object') return { code: String(r.code ?? 'ERROR'), message: String(r.message ?? '').slice(0, 200) };
  return { code: 'ERROR', message: String((e as Error)?.message ?? e).slice(0, 200) };
}

/** 입력 검사(DTO 뒤 한 번 더) — 줄 수 · 중복 · 형식 · 사유 */
export function bulkCheck(kind: string, v: BulkInput) {
  if (!(BULK_KINDS as readonly string[]).includes(kind)) throw new PolicyViolation('OPX_BULK_KIND', '일괄 처리 종류가 올바르지 않습니다.');
  if (!(BULK_ACTIONS[kind] ?? []).includes(v.action)) throw new PolicyViolation('OPX_BULK_ACTION', '이 종류에서 할 수 없는 처리입니다.');
  const ids = [...new Set((v.ids ?? []).map((x) => String(x).trim()))];
  if (!ids.length) throw new PolicyViolation('OPX_BULK_EMPTY', '처리할 줄을 고르십시오.');
  if (ids.length > BULK_MAX) throw new PolicyViolation('OPX_BULK_MAX', '한 번에 100줄까지 처리합니다.');
  if (ids.some((x) => !UUID_RE.test(x))) throw new PolicyViolation('OPX_BULK_ID', '번호 형식이 올바르지 않습니다.');
  const reason = String(v.reason ?? '').trim();
  if (reason.length < 2 || reason.length > 300) throw new PolicyViolation('OPX_BULK_REASON', '사유를 2 ~ 300자로 적으십시오.');
  if (kind === 'REVIEW' && v.action === 'REJECT' && !String(v.reasonCode ?? '').trim()) throw new PolicyViolation('OPX_BULK_REASON_CODE', '반려는 반려 사유 코드를 고르십시오.');
  if (kind === 'INQUIRY' && v.action === 'ASSIGN' && v.assigneeId !== '' && !UUID_RE.test(String(v.assigneeId ?? ''))) throw new PolicyViolation('OPX_BULK_ASSIGNEE', '담당 운영자를 고르십시오(빈 글자면 담당 없음).');
  return { ids, reason };
}

/** 한 줄 처리 — 기존 한 건 함수 */
async function one(d: BulkDeps, kind: string, id: string, v: BulkInput, reason: string, actor: string) {
  switch (kind) {
    case 'REVIEW':
      return d.review.decide(id, actor, { decision: v.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', reasonCode: v.action === 'REJECT' ? v.reasonCode : undefined, memo: reason.slice(0, 1000) });
    case 'REPORT':
      return d.abuse.resolve(id, { state: v.action === 'UPHOLD' ? 'UPHELD' : 'DISMISSED', resolution: reason });
    case 'INQUIRY':
      if (v.action === 'ASSIGN') return d.inquiry.patch(id, { assigneeId: v.assigneeId ?? '' });
      return d.inquiry.patch(id, { status: v.action === 'CLOSE' ? 'CLOSED' : 'OPEN' });
    default:
      return d.member.setAccountStatus(id, v.action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE', reason);
  }
}

export async function runBulk(d: BulkDeps, kind: string, v: BulkInput) {
  const { ids, reason } = bulkCheck(kind, v);
  const actor = RequestCtx.actorId();
  if (!actor) throw new PolicyViolation('UNAUTHENTICATED', '로그인이 필요합니다.');
  const c = RequestCtx.get();
  const [act, target] = AUDIT_OF[kind]!;
  const [run] = await d.db.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('opx_bulk_runs', 'id'))::text AS id`);
  const results: ItemResult[] = [];
  for (const id of ids) {
    try {
      await d.db.transaction(async () => {
        const out = await one(d, kind, id, v, reason, actor);
        await d.db.query(
          `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent) VALUES ($1, $2, $3, $4, $5::uuid, $6::jsonb, $7, $8)`,
          [actor, c?.actorRole ?? null, act, target, id, JSON.stringify({ bulkRun: run!.id, action: v.action, reason, result: out ?? {} }), c?.ip ?? null, c?.userAgent ?? null]);
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, ...errOf(e) });
    }
  }
  const okN = results.filter((r) => r.ok).length;
  await d.db.query(
    `INSERT INTO opx_bulk_runs (id, kind, action, reason, total, ok_count, fail_count, results, actor) VALUES ($1::bigint, $2, $3, $4, $5::int, $6::int, $7::int, $8::jsonb, $9)`,
    [run!.id, kind, v.action, reason, ids.length, okN, ids.length - okN, JSON.stringify(results), actor]);
  return { runId: run!.id, kind, action: v.action, total: ids.length, ok: okN, failed: ids.length - okN, results,
           note: okN === ids.length ? `${okN}줄 모두 처리했습니다.` : `${okN}줄 처리 · ${ids.length - okN}줄 실패(줄마다 까닭).` };
}

export async function bulkRuns(db: DatabaseService) {
  const items = await db.query(
    `SELECT r.id::text AS id, r.kind, r.action, r.reason, r.total, r.ok_count AS ok, r.fail_count AS failed, r.created_at AS "createdAt", coalesce(a.name, a.email::text) AS who
       FROM opx_bulk_runs r LEFT JOIN accounts a ON a.id = r.actor ORDER BY r.id DESC LIMIT 50`);
  return { items, max: BULK_MAX };
}
