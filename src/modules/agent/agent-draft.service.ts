import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound } from '../../core/errors';
import { AgentTool } from './agent.provider';

/**
 * AI 상담 4단계 — 신청서 초안 도구 2개 (v10.139 · D135 · docs/209 · 설계 docs/208 · ai-agent #25).
 *
 *   **초안만 만듭니다** — 이 파일에는 접수(INSERT inquiries · hlt_returns)하는 길이 없습니다. 회원이 카드의 「신청서 열기」를 눌러
 *   지금 쓰는 신청 화면(/support/new · /my/health/returns/new)에서 직접 제출합니다(「회원 확인 없이 접수 0」 · docs/149 5절).
 *   회원 번호는 서버가 넣고(RequestCtx), 반품 초안의 주문은 **본인 주문에서 끝 4자리로** 찾습니다 — 전체 주문번호는 AI 에게 보내지 않음.
 *   초안 줄은 대화가 저장될 때 같은 거래로 넣습니다(AgentChatService) — 여기서는 검사 · 모양만 만듭니다.
 */
export const DRAFT_CATEGORIES = ['DEAL', 'SETTLE', 'ACCOUNT', 'ETC'];   // 문의 화면 유형 중 분쟁(DISPUTE)은 뺌 — 분쟁 접수 화면 그대로
export const DRAFT_REASONS = ['CHANGE_MIND', 'WRONG_ORDER', 'DEFECT', 'WRONG_ITEM', 'MISMATCH', 'DELAY'];   // health-shop.dto RETURN_REASONS 와 같음
export const DRAFT_KINDS = ['CANCEL', 'RETURN', 'EXCHANGE'];

export const DRAFT_TOOLS: AgentTool[] = [
  { name: 'draft_inquiry',
    description: "Prepare a DRAFT of a 1:1 inquiry for the signed-in member when they clearly want to send an inquiry. It is NOT submitted: the member opens the draft card and submits it on the inquiry page. category: DEAL (a trade), SETTLE (settlement/referral fee), ACCOUNT (account/login), ETC (other). Write title and body in the member's language from what they said; do not add facts they did not say.",
    input_schema: { type: 'object', additionalProperties: false, required: ['category', 'title', 'body'],
      properties: { category: { type: 'string', enum: DRAFT_CATEGORIES }, title: { type: 'string', maxLength: 60 }, body: { type: 'string', maxLength: 2000 } } } },
  { name: 'draft_return',
    description: "Prepare a DRAFT of a Sogae Mall (health mall) cancel / return / exchange request for one of the signed-in member's own orders. It is NOT submitted and NOT judged: the member opens the draft card, checks the legal notices and submits on the request page. orderTail is the last 4 characters of the order number (from my_orders). kind: CANCEL (before shipping), RETURN, EXCHANGE. reason: CHANGE_MIND, WRONG_ORDER, DEFECT, WRONG_ITEM, MISMATCH (differs from description), DELAY.",
    input_schema: { type: 'object', additionalProperties: false, required: ['orderTail', 'kind', 'reason'],
      properties: { orderTail: { type: 'string', pattern: '^[A-Za-z0-9]{4}$' }, kind: { type: 'string', enum: DRAFT_KINDS },
        reason: { type: 'string', enum: DRAFT_REASONS }, detail: { type: 'string', maxLength: 500 } } } },
];
export const DRAFT_NAMES = DRAFT_TOOLS.map((t) => t.name);

/** 대화가 저장될 때 넣을 초안 · 회원 화면 카드 */
export type PendingDraft = { id: string; kind: 'INQUIRY' | 'HLT_RETURN'; fields: Record<string, unknown>; card: DraftCard };
export type DraftCard = { id: string; kind: 'INQUIRY' | 'HLT_RETURN'; title: string; href: string };

const ID_RE = /^[0-9a-f-]{36}$/i;

@Injectable()
export class AgentDraftService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * 도구 하나를 검사해 초안 모양을 만듦(저장은 부르는 쪽 · 대화와 한 거래). AI 에게 돌려줄 글(result)은 번호 · 전체 주문번호 없이.
   *   틀린 입력이면 초안을 만들지 않고 이유만 돌려줌(AI 가 회원에게 다시 묻게). 글은 redact(상담 가림 redactChat)를 거쳐 저장 · 화면에.
   */
  async prepare(name: string, input: Record<string, unknown>, accountId: string, redact: (s: string) => string): Promise<{ draft: PendingDraft | null; result: Record<string, unknown>; fields: string[] }> {
    if (!DRAFT_NAMES.includes(name) || !ID_RE.test(accountId)) return { draft: null, result: { ok: false, error: 'unknown tool' }, fields: [] };
    const id = randomUUID();
    const clean = (v: unknown, max: number) => redact(String(v ?? '').trim()).slice(0, max);
    if (name === 'draft_inquiry') {
      const category = String(input.category ?? '');
      const title = clean(input.title, 60);
      const body = clean(input.body, 2000);
      if (!DRAFT_CATEGORIES.includes(category)) return { draft: null, result: { ok: false, error: 'category must be one of ' + DRAFT_CATEGORIES.join(', ') }, fields: [] };
      if (title.length < 2 || body.length < 5) return { draft: null, result: { ok: false, error: 'title (2+) and body (5+ characters) are required — ask the member what to write' }, fields: [] };
      const fields = { category, title, body };
      return { draft: { id, kind: 'INQUIRY', fields, card: { id, kind: 'INQUIRY', title, href: `/support/new?draft=${id}` } },
               result: { ok: true, kind: 'INQUIRY', category, note: 'Draft card shown to the member. NOT submitted — the member must open it and press submit on the page.' },
               fields: Object.keys(fields).sort() };
    }
    // draft_return — 본인 주문에서 끝 4자리로(없음 · 둘 이상이면 초안 없음) · 판정(fn_hlt_return_judge)은 제출 때 지금처럼
    const tail = String(input.orderTail ?? '');
    const kind = String(input.kind ?? '');
    const reason = String(input.reason ?? '');
    if (!/^[A-Za-z0-9]{4}$/.test(tail)) return { draft: null, result: { ok: false, error: 'orderTail must be the last 4 characters of the order number' }, fields: [] };
    if (!DRAFT_KINDS.includes(kind) || !DRAFT_REASONS.includes(reason)) return { draft: null, result: { ok: false, error: 'kind or reason is not in the allowed list' }, fields: [] };
    const orders = await this.db.query<{ orderNo: string }>(
      `SELECT order_no AS "orderNo" FROM hlt_orders WHERE account_id = $1 AND right(order_no, 4) = $2 AND status NOT IN ('CANCELED','RETURNED') LIMIT 2`,
      [accountId, tail]);
    if (orders.length !== 1) {
      return { draft: null, result: { ok: false, error: orders.length ? 'more than one order ends with these 4 characters — ask the member to pick the order on /my/health/returns/new' : 'no open order of this member ends with these 4 characters' }, fields: [] };
    }
    const detail = clean(input.detail, 500);
    const fields = { orderNo: orders[0].orderNo, kind, reason, ...(detail ? { detail } : {}) };
    return { draft: { id, kind: 'HLT_RETURN', fields,
                      card: { id, kind: 'HLT_RETURN', title: `${tail} · ${kind}`, href: `/my/health/returns/new?o=${encodeURIComponent(orders[0].orderNo)}&draft=${id}` } },
             result: { ok: true, kind: 'HLT_RETURN', orderTail: tail, requestKind: kind, reason, note: 'Draft card shown to the member. NOT submitted and NOT judged — the member must open it, read the notices and submit on the page.' },
             fields: Object.keys(fields).filter((k) => k !== 'orderNo').concat('orderTail').sort() };
  }

  /** 회원 화면 — 본인 초안 하나(신청 화면이 칸을 채우려고 읽음) · 처음 열면 opened_at · 만료 · 비운 초안 · 남의 것은 없음 */
  async mine(id: string) {
    const me = RequestCtx.actorId();
    if (!me || !ID_RE.test(id ?? '')) throw new NotFound('초안이 없습니다.');
    const [d] = await this.db.query<{ id: string; kind: string; fields: Record<string, unknown> }>(
      `UPDATE agent_drafts SET opened_at = coalesce(opened_at, now())
        WHERE id = $1 AND account_id = $2 AND expires_at > now() AND submitted_at IS NULL AND fields <> '{}'::jsonb
        RETURNING id::text, kind, fields`, [id, me]);
    if (!d) throw new NotFound('초안이 없습니다.');
    return d;
  }

  /** 신청 API 가 부름 — 그 초안으로 실제 접수됐음을 적음(본인 · 같은 종류 · 처음 한 번만). 틀려도 접수는 그대로(오류 없음) */
  async markSubmitted(id: string | undefined, kind: 'INQUIRY' | 'HLT_RETURN', ref: string): Promise<void> {
    const me = RequestCtx.actorId();
    if (!id || !me || !ID_RE.test(id)) return;
    await this.db.query(
      `UPDATE agent_drafts SET submitted_at = now(), submitted_ref = $4
        WHERE id = $1 AND account_id = $2 AND kind = $3 AND submitted_at IS NULL`, [id, me, kind, ref]).catch(() => undefined);
  }
}
