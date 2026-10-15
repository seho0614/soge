import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { resolveESignProvider } from './esign.provider';
import { RequestCtx } from '../../core/request-context';

/**
 * 문의 · 거래 (SB-HOM-MCH-010 · SB-HOM-DEL-010~030).
 *
 * 이 모델의 급소입니다. 대화가 플랫폼 밖으로 나가면 소개가 누구의 실적인지 남지 않습니다.
 * 성사 확정과 정산 신청은 DB 트리거가 자동으로 처리합니다 (A-15) —
 * 여기서는 계약서 서명만 기록하고, 결과를 응답에 담습니다.
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

  private async contractOf(dealId: string) {
    const [c] = await this.db.query<any>(
      `SELECT c.*, d.buyer_account_id, d.seller_account_id
         FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
        WHERE c.deal_id = $1 ORDER BY c.issued_at DESC LIMIT 1`, [dealId]);
    if (!c) throw new NotFound('계약이 없습니다.');
    return c;
  }

  /** 내가 매수 쪽인가 — 어느 칸에 도장을 찍을지 정합니다. */
  private sideOf(c: any, me: string): 'buyer' | 'seller' {
    if (c.buyer_account_id === me) return 'buyer';
    if (c.seller_account_id === me) return 'seller';
    throw new Forbidden('NOT_PARTY', '이 계약의 당사자가 아닙니다.');
  }

  async contractState(dealId: string) {
    await this.assertParty(dealId);
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    /* v10.31 (시안 표준계약서 제1조 · 제3조 · 제7조) — 당사자(가입 정보 자동 기입 · 연락처 뒤 4자리 · 사업자번호 끝 3자리 가림) ·
     *   소개비 · 소개코드(발급일 · 귀속 90일) · 서명 시각을 함께 냅니다. 당사자만 봅니다(assertParty). */
    const [x] = await this.db.query<any>(
      `SELECT d.agreed_fee AS fee, d.attributed_code AS code, d.attributed_at AS "attributedAt",
              rc.issued_at AS "codeIssuedAt", rc.expires_at AS "codeExpiresAt",
              coalesce(l.title, rq.title, '소개 건') AS title,
              ${PARTY_SQL('ab', 'bb')} AS buyer, ${PARTY_SQL('asl', 'sb')} AS seller
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN referral_codes rc ON rc.code = d.attributed_code
         JOIN accounts ab ON ab.id = d.buyer_account_id
         LEFT JOIN businesses bb ON bb.account_id = ab.id AND bb.verified_at IS NOT NULL
         JOIN accounts asl ON asl.id = d.seller_account_id
         LEFT JOIN businesses sb ON sb.account_id = asl.id AND sb.verified_at IS NOT NULL
        WHERE d.id = $1`, [dealId]);
    const mySide = c.buyer_account_id === me ? 'BUYER' : 'SELLER';
    return {
      id: c.id, state: c.state, terms: c.terms,
      templateCode: c.template_code,      // v10.27 (G-130) — 「양식 전문 보기」가 여는 양식
      buyerAgreed: !!c.agreed_by_buyer_at, sellerAgreed: !!c.agreed_by_seller_at,
      buyerSigned: !!c.signed_by_buyer_at, sellerSigned: !!c.signed_by_seller_at,
      buyerSignedAt: c.signed_by_buyer_at, sellerSignedAt: c.signed_by_seller_at,
      buyerFulfilled: !!c.fulfilled_by_buyer_at, sellerFulfilled: !!c.fulfilled_by_seller_at,
      stalled: Date.now() - new Date(c.updated_at).getTime() > 3 * 864e5,
      mySide, title: x?.title ?? null,
      parties: { buyer: x?.buyer ?? null, seller: x?.seller ?? null },
      fee: x?.fee != null ? Number(x.fee) : null,
      code: x?.code ? { code: x.code, issuedAt: x.codeIssuedAt ?? x.attributedAt, expiresAt: x.codeExpiresAt ?? null } : null,
      esign: { stub: !!c.esign_stub, docId: c.esign_doc_id ? true : false },
      /* 임시 저장은 저장한 사람에게만 보입니다 */
      draft: c.draft_by === me ? { terms: c.draft_terms, savedAt: c.draft_at } : null,
      nudgedAt: c.nudged_at,
    };
  }

  /** v10.31 (시안 「임시 저장」) — 조건을 보내지 않고 내 쪽에만 남깁니다(상대의 합의에 영향 없음). 서명 뒤에는 저장할 것이 없습니다. */
  async saveContractDraft(dealId: string, terms: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    if (['SIGNED', 'FULFILLED', 'CANCELLED'].includes(c.state))
      throw new StateConflict('ALREADY_SIGNED', '서명했거나 끝난 계약은 조건을 저장할 수 없습니다.');
    const [row] = await this.db.query(
      `UPDATE deal_contracts SET draft_terms = $2, draft_by = $3, draft_at = now()
        WHERE id = $1 RETURNING draft_at AS "savedAt"`, [c.id, JSON.stringify(terms ?? {}), me]);
    return { ...row, note: '임시 저장했습니다. 상대에게는 보내지 않았습니다 — 「서명 요청 보내기」를 누르면 보냅니다.' };
  }

  /** v10.31 (시안 계약 진행 카드 「확인 요청」) — 상대 차례인 계약에 상대에게 알림을 한 번 더 보냅니다. 하루 한 번. */
  async nudgeContract(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    const side = this.sideOf(c, me);
    if (['FULFILLED', 'CANCELLED'].includes(c.state))
      throw new StateConflict('CONTRACT_CLOSED', '끝났거나 파기된 계약입니다.');
    const b = side === 'buyer';
    const my = { agreed: b ? c.agreed_by_buyer_at : c.agreed_by_seller_at, signed: b ? c.signed_by_buyer_at : c.signed_by_seller_at, done: b ? c.fulfilled_by_buyer_at : c.fulfilled_by_seller_at };
    const th = { agreed: b ? c.agreed_by_seller_at : c.agreed_by_buyer_at, signed: b ? c.signed_by_seller_at : c.signed_by_buyer_at, done: b ? c.fulfilled_by_seller_at : c.fulfilled_by_buyer_at };
    const theirTurn = (c.state === 'SENT' && my.agreed && !th.agreed) || (c.state === 'AGREED' && my.signed && !th.signed)
      || (c.state === 'SIGNED' && my.done && !th.done) || (c.state === 'COUNTER' && c.last_actor_id === me);
    if (!theirTurn) throw new StateConflict('NOT_THEIR_TURN', '지금은 회원님 차례입니다 — 확인 요청은 상대 차례일 때 보냅니다.');
    if (c.nudged_at && Date.now() - new Date(c.nudged_at).getTime() < 864e5)
      throw new StateConflict('NUDGED_TODAY', '확인 요청은 하루 한 번 보낼 수 있습니다. 내일 다시 보내 주십시오.');
    const other = b ? c.seller_account_id : c.buyer_account_id;
    const [info] = await this.db.query<{ title: string; me_name: string }>(
      `SELECT coalesce(l.title, rq.title, '소개 건') AS title,
              coalesce((SELECT company_name FROM businesses WHERE account_id = $2 AND verified_at IS NOT NULL),
                       left(btrim((SELECT name FROM accounts WHERE id = $2)), 1) || '○○') AS me_name
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests rq ON rq.id = d.request_id
        WHERE d.id = $1`, [dealId, me]);
    await this.db.query(`UPDATE deal_contracts SET nudged_at = now(), nudged_by = $2 WHERE id = $1`, [c.id, me]);
    await this.db.query(`SELECT fn_notify($1, 'CONTRACT_NUDGE', $2::jsonb, $3)`,
      [other, JSON.stringify({ counterpart: info?.me_name ?? '상대방', title: info?.title ?? '소개 건' }), `/my/contracts/${dealId}`]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$3,'확인 요청 보냄')`, [c.id, me, c.state]);
    return { nudgedAt: new Date().toISOString(), note: '상대방에게 확인 요청을 보냈습니다.' };
  }

  /** 조건 합의. 양측이 각각 눌러야 AGREED 로 넘어갑니다. */
  async agreeContract(dealId: string, terms: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state === 'SIGNED' || c.state === 'FULFILLED')
      throw new StateConflict('ALREADY_SIGNED', '서명한 계약은 조건을 바꿀 수 없습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'agreed_by_buyer_at' : 'agreed_by_seller_at';
    const other = side === 'buyer' ? c.agreed_by_seller_at : c.agreed_by_buyer_at;

    /* v10.31 (시안 제2조 경고 · A-09) — 용역이면서 판매 쪽(용역을 하는 쪽)이 인증된 사업자가 아니면 막습니다 — 유료직업소개사업 등록 의무에 걸릴 수 있습니다 */
    if (terms?.kind === 'SERVICE') {
      const [sb] = await this.db.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM businesses WHERE account_id = $1 AND verified_at IS NOT NULL) AS ok`, [c.seller_account_id]);
      if (!sb?.ok) throw new PolicyViolation('SERVICE_NEEDS_BUSINESS',
        '용역 계약은 용역을 하는 쪽이 사업자 인증을 마쳐야 합니다(유료직업소개사업 등록 의무 · A-09). 물품이면 「물품」을 고르십시오.');
    }

    /* ★ 조건이 바뀌면 상대의 합의는 무효입니다.
     *   안 그러면 한쪽이 몰래 금액을 바꿔도 상대 동의가 남아 있게 됩니다. */
    /* DB 에서 온 것은 객체, 들어온 것도 객체 — 키 순서가 달라도
     * 같은 조건이면 같다고 봐야 합니다. 정렬해서 비교합니다. */
    const norm = (o: any) => o == null ? 'null'
      : JSON.stringify(Object.keys(o).sort().reduce((a: any, k) => (a[k] = o[k], a), {}));
    const changed = norm(c.terms) !== norm(terms);
    const bothNow = changed ? false : !!other;

    await this.db.query(
      `UPDATE deal_contracts
          SET terms = $2, ${col} = now(), last_actor_id = $3,
              draft_terms = CASE WHEN draft_by = $3 THEN NULL ELSE draft_terms END,
              draft_by = CASE WHEN draft_by = $3 THEN NULL ELSE draft_by END,
              ${changed ? (side === 'buyer' ? 'agreed_by_seller_at = NULL,' : 'agreed_by_buyer_at = NULL,') : ''}
              state = $4
        WHERE id = $1`,
      /* ★ 객체를 그대로 넘기면 pg 가 [object Object] 로 보내고
       *   jsonb 컬럼에 NULL 이 들어갑니다 — 그러면 "합의 조건이 비어
       *   있습니다" 로 막혀 **두 번째 합의가 영영 안 됩니다.**
       *   문자열로 직렬화해서 넘깁니다. */
      [c.id, JSON.stringify(terms ?? null), me, bothNow ? 'AGREED' : 'SENT']);

    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, terms, memo)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.id, me, c.state, bothNow ? 'AGREED' : 'SENT', JSON.stringify(terms ?? null),
       changed ? '조건 변경 — 상대 합의를 다시 받습니다' : '조건 합의']);

    return { state: bothNow ? 'AGREED' : 'SENT', waitingOther: !bothNow };
  }

  /** 수정 요청. 무엇을 고쳐야 하는지 남아야 상대가 움직일 수 있습니다. */
  async counterContract(dealId: string, memo: string, terms?: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    if (c.state === 'SIGNED' || c.state === 'FULFILLED')
      throw new StateConflict('ALREADY_SIGNED', '서명한 계약은 고칠 수 없습니다.');

    await this.db.query(
      `UPDATE deal_contracts
          SET state='COUNTER', agreed_by_buyer_at=NULL, agreed_by_seller_at=NULL,
              terms = coalesce($2, terms), last_actor_id=$3
        WHERE id=$1`, [c.id, terms ? JSON.stringify(terms) : null, me]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, terms, memo)
       VALUES ($1,$2,$3,'COUNTER',$4,$5)`,
      [c.id, me, c.state, terms ? JSON.stringify(terms) : null, memo]);
    return { state: 'COUNTER' };
  }

  /** 서명. 합의(AGREED) 뒤에만, 양측이 각각. */
  async signContract2(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state !== 'AGREED' && c.state !== 'SIGNED')
      throw new StateConflict('NOT_AGREED', '양측이 조건에 합의해야 서명할 수 있습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'signed_by_buyer_at' : 'signed_by_seller_at';
    const other = side === 'buyer' ? c.signed_by_seller_at : c.signed_by_buyer_at;
    const both = !!other;

    await this.db.query(
      `UPDATE deal_contracts SET ${col}=now(), last_actor_id=$2, state=$3 WHERE id=$1`,
      [c.id, me, both ? 'SIGNED' : 'AGREED']);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.id, me, c.state, both ? 'SIGNED' : 'AGREED', both ? '양측 서명 완료' : '한쪽 서명']);
    return { state: both ? 'SIGNED' : 'AGREED', waitingOther: !both };
  }

  /** 이행 확인. 양측이 확인하면 거래가 성사로 올라갑니다(트리거). */
  async fulfilContract(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state !== 'SIGNED')
      throw new StateConflict('NOT_SIGNED', '서명이 끝나야 이행을 확인할 수 있습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'fulfilled_by_buyer_at' : 'fulfilled_by_seller_at';
    const other = side === 'buyer' ? c.fulfilled_by_seller_at : c.fulfilled_by_buyer_at;
    const both = !!other;

    await this.db.query(
      `UPDATE deal_contracts SET ${col}=now(), last_actor_id=$2, state=$3 WHERE id=$1`,
      [c.id, me, both ? 'FULFILLED' : 'SIGNED']);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.id, me, c.state, both ? 'FULFILLED' : 'SIGNED',
       both ? '양측 이행 확인 — 성사 확정' : '한쪽 이행 확인']);

    /* ★ 소개비는 여기서 공제하지 않습니다(INV-9R).
     *   성사가 확정되면 지급 대상이 될 뿐이고, 대금은 당사자끼리 직접 주고받습니다. */
    return { state: both ? 'FULFILLED' : 'SIGNED', waitingOther: !both };
  }

  async cancelContract(dealId: string, reason: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    await this.db.query(
      `UPDATE deal_contracts SET state='CANCELLED', cancel_reason=$2,
              cancelled_at=now(), last_actor_id=$3 WHERE id=$1`, [c.id, reason, me]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,'CANCELLED',$4)`, [c.id, me, c.state, reason]);
    return { state: 'CANCELLED' };
  }

  /** 계약 이력. 분쟁에서 "누가 언제 무엇을 했는가"의 근거입니다. */
  async contractHistory(dealId: string) {
    await this.assertParty(dealId);
    const c = await this.contractOf(dealId);
    return this.db.query(
      `SELECT r.from_state AS "fromState", r.to_state AS "toState", r.memo,
              r.terms, r.created_at AS "createdAt", a.name AS actor
         FROM contract_revisions r JOIN accounts a ON a.id = r.actor_id
        WHERE r.contract_id = $1 ORDER BY r.created_at`, [c.id]);
  }
  /* ── 전자계약 ─────────────────────────────────────────────────── */

  contractTemplates() {
    return this.db.query(
      `SELECT code, name, version, scope, effective_from AS "effectiveFrom",
              invariants, note
         FROM contract_templates WHERE is_active
        ORDER BY scope, code`);
  }

  async contractTemplate(code: string) {
    const [t] = await this.db.query<any>(
      `SELECT code, name, version, scope, body, invariants,
              effective_from AS "effectiveFrom"
         FROM contract_templates WHERE code = $1 AND is_active`, [code]);
    if (!t) throw new StateConflict('NOT_FOUND', '없는 양식입니다.');
    return t;
  }

  /**
   * 전자계약 서명 요청.
   *
   * **서명 시각과 서명자를 제공자가 증명합니다.** 우리가 직접
   * 타임스탬프를 찍으면 우리가 만든 기록이라 분쟁에서 약합니다.
   */
  async requestESign(dealId: string) {
    const me = RequestCtx.actorId()!;
    const [c] = await this.db.query<any>(
      `SELECT c.id, c.template_code, c.state, c.esign_doc_id,
              d.buyer_account_id, d.seller_account_id
         FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
        WHERE c.deal_id = $1`, [dealId]);
    if (!c) throw new StateConflict('NOT_FOUND', '발급된 계약서가 없습니다.');
    if (c.buyer_account_id !== me && c.seller_account_id !== me) {
      throw new PolicyViolation('NOT_PARTY', '이 계약의 당사자가 아닙니다.');
    }
    if (c.esign_doc_id) {
      return { docId: c.esign_doc_id, note: '이미 서명 요청이 나갔습니다.' };
    }

    const [tpl] = await this.db.query<any>(
      `SELECT body FROM contract_templates WHERE code = $1`, [c.template_code]);
    if (!tpl) throw new StateConflict('NO_TEMPLATE', '표준 양식이 아닙니다.');

    const provider = resolveESignProvider();
    const res = await provider.request({
      templateCode: c.template_code, body: tpl.body,
      signers: [{ name: '매수자' }, { name: '매도자' }] });
    if (!res.sent) {
      throw new PolicyViolation('ESIGN_FAILED',
        res.detail ?? '서명 요청을 보내지 못했습니다.');
    }

    await this.db.query(
      `UPDATE deal_contracts SET esign_doc_id = $2, esign_stub = $3
        WHERE id = $1`, [c.id, res.docId ?? null, res.stub]);

    return { docId: res.docId, signUrl: res.signUrl, stub: res.stub,
      note: res.stub
        ? '연동 전이라 실제 서명 요청이 나가지 않았습니다 — 법적 효력이 없습니다.'
        : '서명 요청을 보냈습니다. 양측이 서명하시면 체결됩니다.' };
  }

  async esignStatus(dealId: string) {
    await this.assertParty(dealId);
    const [c] = await this.db.query<any>(
      `SELECT esign_doc_id, esign_stub, state FROM deal_contracts
        WHERE deal_id = $1`, [dealId]);
    if (!c) throw new StateConflict('NOT_FOUND', '발급된 계약서가 없습니다.');
    if (!c.esign_doc_id) {
      return { state: 'NOT_REQUESTED', note: '아직 서명 요청이 나가지 않았습니다.' };
    }

    const provider = resolveESignProvider();
    const res = await provider.status(c.esign_doc_id);
    return { ...res, contractState: c.state,
      note: res.stub
        ? '연동 전이라 실제로 서명되지 않았습니다 — 법적 효력이 없습니다.'
        : undefined };
  }

}

/** v10.31 — 계약서 제1조 당사자 칸(가입 정보 자동 기입). 연락처는 뒤 4자리만, 사업자등록번호는 끝 3자리를 가립니다. */
function PARTY_SQL(a: string, b: string) {
  return `jsonb_build_object(
    'company', coalesce(${b}.company_name, ${a}.name || ' (개인)'),
    'ceo', coalesce(${b}.ceo_name, ${a}.name),
    'bizRegNo', CASE WHEN ${b}.biz_reg_no ~ '^[0-9]{10}$'
                     THEN substr(${b}.biz_reg_no,1,3) || '-' || substr(${b}.biz_reg_no,4,2) || '-' || substr(${b}.biz_reg_no,6,2) || 'xxx' END,
    'phone', CASE WHEN length(regexp_replace(coalesce(${a}.phone,''), '[^0-9]', '', 'g')) >= 8
                  THEN left(regexp_replace(${a}.phone, '[^0-9]', '', 'g'), 3) || '-****-' || right(regexp_replace(${a}.phone, '[^0-9]', '', 'g'), 4) END,
    'business', ${b}.id IS NOT NULL,
    'identityVerified', ${a}.identity_verified_at IS NOT NULL)`;
}
