import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { Forbidden, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 문의 대화 — 대화 시작 · 메시지 · 보내기 (SB-HOM-MCH-010). 연락처로 보이는 글은 가립니다(mask).
 *
 * v10.108 (리팩토링 4차 · docs/168) — deal.service.ts 에서 함수 본문을 그대로 옮겼습니다.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly attribution: AttributionEngine,
  ) {}
  /** 연락처로 보이는 문자열을 가립니다. 대화가 밖으로 나가는 것을 늦춥니다. */
  private mask(body: string) {
    const masked = body
      .replace(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, '***-****-****')
      .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, '***-****-****')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***');
    return { text: masked, changed: masked !== body };
  }

  async startConversation(dto: { targetType: string; targetId: string; message: string }) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const table = dto.targetType === 'LISTING' ? 'listings' : 'requests';
      const [t] = await this.db.query<{ owner: string; title: string }>(
        `SELECT owner_account_id AS owner, title FROM ${table}
          WHERE id = $1 AND status = 'PUBLISHED'`, [dto.targetId]);
      if (!t) throw new NotFound('대상을 찾을 수 없습니다.');
      if (t.owner === actor) {
        throw new PolicyViolation('OWN_TARGET', '본인 게시물에는 문의할 수 없습니다.');
      }

      const [c] = await this.db.query<{ id: string }>(
        `INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (target_type, target_id, initiator_id) DO UPDATE SET status = 'OPEN'
         RETURNING id`, [dto.targetType, dto.targetId, actor, t.owner]);

      /* v10.31 (w2 · 시안 INV-2 「1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다」) —
       * 대화를 처음 여는 순간 그 매물에 묶인 소개코드 유입을 찍어 둡니다(한 번만). 거래 생성(createDeal)은 이 값을 씁니다 —
       * 대화를 연 뒤에 들어온 유입은 귀속을 바꾸지 않습니다. 소개 금지 업종이면 찍지 않습니다(의료법 27조 · 보험업법). */
      if (dto.targetType === 'LISTING') {
        const [snap] = await this.db.query<{ attributed_at: Date | null }>(
          `SELECT attributed_at FROM conversations WHERE id = $1`, [c.id]);
        if (!snap?.attributed_at) {
          const [g] = await this.db.query<{ no_intro: boolean }>(
            `SELECT coalesce(fn_category_no_intro(l.category_id), false) AS no_intro FROM listings l WHERE l.id = $1`, [dto.targetId]);
          const resolved = g?.no_intro ? null : await this.attribution.resolveForListing(actor, dto.targetId);
          await this.db.query(
            `UPDATE conversations SET attributed_code = $2, attributed_at = now() WHERE id = $1 AND attributed_at IS NULL`,
            [c.id, resolved?.code ?? null]);
        }
      }

      const m = this.mask(dto.message);
      await this.db.query(
        `INSERT INTO messages (conversation_id, sender_id, body, masked)
         VALUES ($1,$2,$3,$4)`, [c.id, actor, m.text, m.changed]);
      await this.db.query(
        `UPDATE conversations SET last_message_at = now() WHERE id = $1`, [c.id]);

      return { conversationId: c.id, masked: m.changed };
    });
  }

  /** 메시지 목록. 열어 본 사람이 받은 메시지는 읽음으로 표시합니다(v10.27 · G-193 —
   *  전에는 read_at 을 채우는 곳이 없어 「안 읽은 문의」를 셀 수 없었습니다). */
  async messages(conversationId: string, limit = 50) {
    const actor = RequestCtx.actorId()!;
    const rows = await this.db.query(
      `SELECT m.id, m.sender_id AS "senderId", m.body, m.masked,
              m.read_at AS "readAt", m.created_at AS "createdAt",
              (m.sender_id = $2) AS mine
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1
          AND $2 IN (c.initiator_id, c.counterpart_id)
        ORDER BY m.created_at ASC LIMIT $3`,
      [conversationId, actor, limit]);
    if (rows.length) {
      await this.db.query(
        `UPDATE messages SET read_at = now()
          WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
        [conversationId, actor]);
    }
    return rows;
  }

  async send(conversationId: string, dto: { body: string; attachmentKey?: string }) {
    const actor = RequestCtx.actorId()!;
    const [c] = await this.db.query<{ id: string }>(
      `SELECT id FROM conversations
        WHERE id = $1 AND $2 IN (initiator_id, counterpart_id)`, [conversationId, actor]);
    if (!c) throw new Forbidden('NOT_PARTICIPANT', '이 대화의 참여자가 아닙니다.');

    const m = this.mask(dto.body);
    const [row] = await this.db.query(
      `INSERT INTO messages (conversation_id, sender_id, body, masked, attachment_key)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, body, masked, created_at AS "createdAt"`,
      [conversationId, actor, m.text, m.changed, dto.attachmentKey ?? null]);
    await this.db.query(
      `UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
    return row;
  }
}
