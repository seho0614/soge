import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 문의 · 거래 (SB-HOM-MCH-010 · SB-HOM-DEL-010~030).
 *
 * 이 모델의 급소입니다. 대화가 플랫폼 밖으로 나가면 소개가 누구의 실적인지 남지 않습니다.
 * 성사 확정과 정산 신청은 DB 트리거가 자동으로 처리합니다 (A-15) —
 * 여기서는 계약서 서명만 기록하고, 결과를 응답에 담습니다.
 *
 * v10.92 (리팩토링) — 계약서(상태 · 초안 · 동의 · 수정 · 이행 · 취소 · 이력 · 양식 · 전자서명)는 deal-contract.service.ts 로 나눴습니다.
 */
@Injectable()
export class DealService {
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

  /**
   * Deal 생성. 귀속 판정은 여기서 하지 않습니다 —
   * 확정 시점에 DB 트리거가 first-touch 를 확정합니다 (INV-2).
   * 여기서는 후보 코드만 스냅샷해 둡니다.
   */
  async createDeal(conversationId: string) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [c] = await this.db.query<{
        id: string; target_id: string; initiator_id: string; counterpart_id: string;
        attributed_code: string | null; attributed_at: Date | null;
      }>(`SELECT id, target_id, initiator_id, counterpart_id, attributed_code, attributed_at FROM conversations
           WHERE id = $1 AND $2 IN (initiator_id, counterpart_id) FOR UPDATE`, [conversationId, actor]);
      if (!c) throw new Forbidden('NOT_PARTICIPANT', '이 대화의 참여자가 아닙니다.');

      /* v10.27 (G-193) — 이 대화에 **진행 중인** 거래가 있으면 그 거래를 돌려줍니다. 「계약서 요청하기」를 두 번 눌러도 거래는 하나입니다
       * (대화 줄을 잠가 동시에 두 번 눌러도 하나). 앞 거래가 끝났으면(확정 · 정산 · 취소) 같은 상대와의 새 거래로 새로 만듭니다. */
      const [prev] = await this.db.query<{ id: string; attributed_code: string | null }>(
        `SELECT id, attributed_code FROM deals
          WHERE conversation_id = $1 AND status NOT IN ('CONFIRMED','SETTLED','CANCELLED')
          ORDER BY created_at DESC LIMIT 1`, [c.id]);
      if (prev) return { dealId: prev.id, attributedCode: prev.attributed_code, existing: true };

      /* D012 (10/2 「소개코드는 매물별로」) — 이 거래의 매물에 묶인 코드의 유입만 봅니다
       * (매물에 안 묶인 옛 코드 · scope=all 코드는 전처럼). A 매물 코드로 들어와 B 매물에 문의하면 소개자가 없습니다.
       * 규칙은 DB 함수 fn_attribution_resolve_listing 에 있습니다. */
      /* v10.31 — 대화를 열 때 찍어 둔 귀속(conversations.attributed_*)이 있으면 그것을 씁니다(시안 INV-2). 그 전에 열린 대화만 예전처럼 지금 판정합니다 */
      const resolved = c.attributed_at
        ? (c.attributed_code ? { code: c.attributed_code } : null)
        : await this.attribution.resolveForListing(c.initiator_id, c.target_id);

      /* 10/2 — 소개코드 유입 기록이 실제로 연결되면서(D010), 소개 링크로 들어온 사람이 보험·의료(소개 금지 업종)
       * 매물에 문의하면 trg_gated_no_intro_deal 이 거래 생성 자체를 422 로 막게 됐습니다.
       * 소개 금지 업종이면 소개자 · 귀속 코드를 비우고 거래는 만듭니다(의료법 27조 · 보험업법 — 소개자만 두지 않음). */
      const [g] = await this.db.query<{ no_intro: boolean }>(
        `SELECT coalesce(fn_category_no_intro(l.category_id), false) AS no_intro
           FROM listings l WHERE l.id = $1`, [c.target_id]);
      const code = g?.no_intro ? null : (resolved?.code ?? null);

      const [d] = await this.db.query<{ id: string }>(
        `INSERT INTO deals
           (conversation_id, listing_id, buyer_account_id, seller_account_id,
            introducer_account_id, attributed_code, status)
         SELECT $1, $2, $3, $4,
                (SELECT owner_account_id FROM referral_codes rc
                  JOIN accounts a ON a.id = rc.owner_account_id
                 WHERE rc.code = $5 LIMIT 1),
                $5, 'INQUIRY'
         RETURNING id`,
        [c.id, c.target_id, c.initiator_id, c.counterpart_id, code]);

      await this.db.query(
        `UPDATE conversations SET status = 'DEAL_CREATED' WHERE id = $1`, [c.id]);
      return { dealId: d.id, attributedCode: code };
    });
  }

  /** 소개비 제안. append-only 이므로 수정이 아니라 새 버전이 쌓입니다 (D-03). */
  async proposeFee(dealId: string, dto: { amount: number; reasonCode?: string }) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [d] = await this.db.query<{ buyer: string; seller: string }>(
        `SELECT buyer_account_id AS buyer, seller_account_id AS seller
           FROM deals WHERE id = $1 AND status IN ('INQUIRY','NEGOTIATING')`, [dealId]);
      if (!d) throw new StateConflict('DEAL_NOT_NEGOTIABLE', '협의할 수 있는 상태가 아닙니다.');
      if (![d.buyer, d.seller].includes(actor)) {
        throw new Forbidden('NOT_PARTY', '거래 당사자가 아닙니다.');
      }

      const [last] = await this.db.query<{ version: number }>(
        `SELECT max(version) AS version FROM fee_agreements WHERE deal_id = $1`, [dealId]);
      const version = (last?.version ?? 0) + 1;

      const [row] = await this.db.query(
        `INSERT INTO fee_agreements (deal_id, version, proposed_by, amount, state, reason_code)
         VALUES ($1,$2,$3,$4,'PROPOSED',$5)
         RETURNING version, amount, state, created_at AS "createdAt"`,
        [dealId, version, actor, dto.amount, dto.reasonCode ?? null]);

      await this.db.query(
        `UPDATE deals SET status = 'NEGOTIATING' WHERE id = $1 AND status = 'INQUIRY'`, [dealId]);
      return row;
    });
  }

  async agreeFee(dealId: string, version: number) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [d] = await this.db.query<{ buyer: string; seller: string }>(
        `SELECT buyer_account_id AS buyer, seller_account_id AS seller FROM deals WHERE id = $1`,
        [dealId]);
      const col = actor === d?.buyer ? 'agreed_by_buyer_at'
                : actor === d?.seller ? 'agreed_by_seller_at' : null;
      if (!col) throw new Forbidden('NOT_PARTY', '거래 당사자가 아닙니다.');

      // append-only 이므로 UPDATE 대신 동의 상태를 담은 새 행을 씁니다.
      const [prev] = await this.db.query<{
        amount: number; agreed_by_buyer_at: string | null; agreed_by_seller_at: string | null;
        proposed_by: string;
      }>(`SELECT amount, agreed_by_buyer_at, agreed_by_seller_at, proposed_by
            FROM fee_agreements WHERE deal_id = $1 AND version = $2`, [dealId, version]);
      if (!prev) throw new NotFound('제안을 찾을 수 없습니다.');

      const buyerAt  = col === 'agreed_by_buyer_at'  ? new Date() : prev.agreed_by_buyer_at;
      const sellerAt = col === 'agreed_by_seller_at' ? new Date() : prev.agreed_by_seller_at;
      const both = !!buyerAt && !!sellerAt;

      const [row] = await this.db.query(
        `INSERT INTO fee_agreements
           (deal_id, version, proposed_by, amount, state,
            agreed_by_buyer_at, agreed_by_seller_at, reason_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'AGREE')
         RETURNING version, amount, state`,
        [dealId, version + 1, prev.proposed_by, prev.amount,
         both ? 'AGREED' : 'PROPOSED', buyerAt, sellerAt]);
      return { ...row, bothAgreed: both };
    });
  }

  /** 계약서 발급. 발급 시점에 합의 금액이 LOCKED 로 고정됩니다 — 트리거가 처리합니다. */
  async issueContract(dealId: string, templateCode = 'STD_V1') {
    await this.assertParty(dealId);
    return this.db.transaction(async () => {
      const [row] = await this.db.query(
        `INSERT INTO deal_contracts (deal_id, template_code, document_key)
         VALUES ($1,$2,$3)
         RETURNING id, document_key AS "documentKey",
                   signed_by_buyer_at AS "signedByBuyerAt",
                   signed_by_seller_at AS "signedBySellerAt"`,
        [dealId, templateCode, `s3://contracts/${dealId}.pdf`]);
      await this.db.query(
        `UPDATE deals SET status = 'CONTRACTED' WHERE id = $1 AND status = 'NEGOTIATING'`, [dealId]);
      const [d] = await this.db.query<{ agreed_fee: number }>(
        `SELECT agreed_fee FROM deals WHERE id = $1`, [dealId]);
      return { ...row, lockedFee: d.agreed_fee };
    });
  }

  /**
   * 서명. 양측이 끝나면 트리거가 성사 확정 + 정산 신청까지 처리합니다 (A-15).
   * 여기서는 그 결과를 조회해 응답에 담기만 합니다.
   */
  async sign(dealId: string) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [d] = await this.db.query<{ buyer: string; seller: string }>(
        `SELECT buyer_account_id AS buyer, seller_account_id AS seller FROM deals WHERE id = $1`,
        [dealId]);
      const col = actor === d?.buyer ? 'signed_by_buyer_at'
                : actor === d?.seller ? 'signed_by_seller_at' : null;
      if (!col) throw new Forbidden('NOT_PARTY', '거래 당사자가 아닙니다.');

      await this.db.query(
        `UPDATE deal_contracts SET ${col} = now()
          WHERE deal_id = $1 AND ${col} IS NULL`, [dealId]);

      const [c] = await this.db.query<{ b: string | null; s: string | null }>(
        `SELECT signed_by_buyer_at AS b, signed_by_seller_at AS s
           FROM deal_contracts WHERE deal_id = $1`, [dealId]);
      const [after] = await this.db.query<{ status: string }>(
        `SELECT status FROM deals WHERE id = $1`, [dealId]);
      const [st] = await this.db.query<{ id: string }>(
        `SELECT id FROM settlements WHERE deal_id = $1`, [dealId]);

      return {
        signedAs: col === 'signed_by_buyer_at' ? 'BUYER' : 'SELLER',
        bothSigned: !!c.b && !!c.s,
        dealStatus: after.status,
        settlementId: st?.id ?? null,
      };
    });
  }

  /** INV-11 — 금액도 계좌도 받지 않습니다. 증빙과 신고 시각만 남깁니다. */
  async reportPayment(dealId: string, dto: { method: string; evidenceKey?: string; memo?: string }) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      /* v10.27 (G-213) — 당사자 확인. 전에는 본인인증만 된 회원이면 **남의 거래에도** 신고를 남기고
       * 상태를 CONTRACTED → PAYMENT_REPORTED 로 바꿀 수 있었습니다(confirmDeal 은 확인하는데 여기만 빠짐).
       * 취소된 거래에는 신고를 받지 않습니다. 확정 뒤 신고는 그대로 받습니다(대금은 확정 뒤에 오가기도 함). */
      const [d] = await this.db.query<{ buyer: string; seller: string; status: string }>(
        `SELECT buyer_account_id AS buyer, seller_account_id AS seller, status
           FROM deals WHERE id = $1 FOR UPDATE`, [dealId]);
      if (!d || (actor !== d.buyer && actor !== d.seller)) {
        throw new Forbidden('NOT_A_PARTY', '이 거래의 당사자만 대금 지급을 신고할 수 있습니다.');
      }
      if (d.status === 'CANCELLED') {
        throw new StateConflict('DEAL_CANCELLED', '취소된 거래에는 신고할 수 없습니다.');
      }
      const [row] = await this.db.query(
        `INSERT INTO deal_payment_records (deal_id, method, evidence_key, reported_by, memo)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, reported_at AS "reportedAt"`,
        [dealId, dto.method, dto.evidenceKey ?? null, actor, dto.memo ?? null]);
      await this.db.query(
        `UPDATE deals SET status = 'PAYMENT_REPORTED'
          WHERE id = $1 AND status = 'CONTRACTED'`, [dealId]);
      const [after] = await this.db.query<{ status: string }>(`SELECT status FROM deals WHERE id = $1`, [dealId]);
      /* G-201 — 화면 안내를 상태에 맞춥니다(확정된 거래에 「상대방이 확인하면 계약서 서명으로…」가 나갔음). */
      return { ...row, dealStatus: after.status };
    });
  }

  myDeals(limit = 20) {
    return this.db.query(
      `SELECT d.id, d.status, d.agreed_fee AS "agreedFee", d.tier,
              d.attributed_code AS "attributedCode",
              d.confirmed_at AS "confirmedAt", d.confirm_mode AS "confirmMode",
              l.title AS "listingTitle",
              ab.name AS "buyerName", asl.name AS "sellerName", ai.name AS "introducerName",
              (SELECT label FROM code_labels WHERE domain='deal.status' AND code=d.status) AS "statusLabel",
              coalesce((SELECT array_agg(party) FROM deal_confirmations dc
                         WHERE dc.deal_id = d.id), '{}') AS "confirmedParties"
         FROM deals d
         LEFT JOIN listings l  ON l.id = d.listing_id
         JOIN accounts ab      ON ab.id = d.buyer_account_id
         JOIN accounts asl     ON asl.id = d.seller_account_id
         LEFT JOIN accounts ai ON ai.id = d.introducer_account_id
        WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
        ORDER BY d.updated_at DESC LIMIT $2`,
      [RequestCtx.actorId(), limit]);
  }

  /**
   * 성사 확정 (수동 경로).
   *
   * 보통은 계약 양측 서명으로 트리거가 확정합니다 (A-15).
   * 여기서는 확인 행만 남기고, CONFIRMED 전이는 트리거가 판단합니다 —
   * INV-4(양측 확인)를 앱이 우회하지 않게 하려는 것입니다.
   */
  async confirmDeal(dealId: string) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [d] = await this.db.query<{ buyer: string; seller: string; status: string }>(
        `SELECT buyer_account_id AS buyer, seller_account_id AS seller, status
           FROM deals WHERE id = $1`, [dealId]);
      if (!d) throw new StateConflict('NOT_FOUND', '거래를 찾을 수 없습니다.');
      /* 20261001 — 당사자 확인을 먼저 합니다. 전에는 상태를 먼저 봐서
       * 당사자가 아닌 사람도 "이미 확정" 여부를 알 수 있었습니다. */
      const party = actor === d.buyer ? 'BUYER' : actor === d.seller ? 'SELLER' : null;
      if (!party) throw new StateConflict('NOT_A_PARTY', '이 거래의 당사자가 아닙니다.');
      if (d.status === 'CONFIRMED' || d.status === 'SETTLED') {
        throw new StateConflict('ALREADY_CONFIRMED', '이미 성사가 확정된 거래입니다.');
      }

      await this.db.query(
        `INSERT INTO deal_confirmations (deal_id, party, confirmed_by, is_auto, source)
         VALUES ($1,$2,$3,false,'MANUAL') ON CONFLICT (deal_id, party) DO NOTHING`,
        [dealId, party, actor]);

      const [after] = await this.db.query<{ status: string }>(
        `SELECT status FROM deals WHERE id = $1`, [dealId]);
      const [c] = await this.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM deal_confirmations WHERE deal_id = $1`, [dealId]);

      return {
        dealId,
        status: after.status,
        confirmations: Number(c.n),
        // 상대방이 아직이면 확정되지 않습니다 (INV-4)
        waitingCounterpart: Number(c.n) < 2,
        /* C997 — 양측 확인이 모이면 DB 가 바로 CONFIRMED 로 바꿉니다.
         * 그래도 확정이 아니면 이유는 하나뿐입니다: 소개비 기능이 켜져 있고 약정이 없음. */
        note: Number(c.n) < 2 ? '상대방 확인을 기다립니다.'
          : after.status === 'CONFIRMED' ? '양측이 확인해 거래가 확정되었습니다.'
          : '양측이 확인했지만 소개비 약정이 먼저입니다 — 소개비를 합의하면 확정됩니다.',
      };
    });
  }

  /* ── 계약 진행 ────────────────────────────────────────────────────
   *
   * 플랫폼은 계약 당사자가 아닙니다. 양식을 주고 **어디까지 왔는지
   * 기록할 뿐**이며, 대금에도 관여하지 않습니다(INV-11).
   *
   * 핵심 원칙은 **한쪽이 혼자 진도를 뺄 수 없다**는 것입니다 —
   * 합의도 서명도 이행도 양측이 각각 눌러야 넘어갑니다(INV-4 와 같은 결).
   * DB 트리거가 이것을 강제하므로, 여기서 빠뜨려도 뚫리지 않습니다.
   * ─────────────────────────────────────────────────────────────── */

  /** v10.27 (G-213) — 거래 당사자(매수 · 매도)인지 확인합니다. 아니면 403.
   *  계약 상태 · 이력 · 전자서명 상태 · 계약서 발급이 거래 번호만 알면 누구나 열렸습니다(이력에는 당사자 실명이 들어 있음). */
  private async assertParty(dealId: string) {
    const me = RequestCtx.actorId();
    const [d] = await this.db.query<{ ok: boolean }>(
      `SELECT ($2::uuid IN (buyer_account_id, seller_account_id)) AS ok FROM deals WHERE id = $1`, [dealId, me ?? null]);
    if (!d?.ok) throw new Forbidden('NOT_PARTY', '이 거래의 당사자가 아닙니다.');
  }
}
