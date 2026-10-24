import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { clampLimit } from '../../core/pagination';

/** v10.31 — 계약 카드의 「나 ↔ 상대」 각자 상태 · 다음 할 일 · 확인 요청 가능 여부(시안 myctr: 요청함 ↔ 미확인 · 서명 완료 ↔ 미서명 …) */
export function contractSides(x: {
  state: string; myPart: string; buyerAgreed: boolean; sellerAgreed: boolean; buyerSigned: boolean; sellerSigned: boolean;
  buyerFulfilled?: boolean; sellerFulfilled?: boolean; nudgedAt?: string | Date | null; lastActorMe?: boolean | null;
}) {
  const b = x.myPart === 'BUYER';
  const my = { agreed: b ? x.buyerAgreed : x.sellerAgreed, signed: b ? x.buyerSigned : x.sellerSigned, done: !!(b ? x.buyerFulfilled : x.sellerFulfilled) };
  const th = { agreed: b ? x.sellerAgreed : x.buyerAgreed, signed: b ? x.sellerSigned : x.buyerSigned, done: !!(b ? x.sellerFulfilled : x.buyerFulfilled) };
  const word = (p: typeof my, state: string, me: boolean) =>
    state === 'CANCELLED' ? '파기'
      : state === 'FULFILLED' || p.done ? '이행 확인'
      : p.signed ? '서명 완료'
      : state === 'SIGNED' ? '이행 확인 전'
      : state === 'AGREED' ? (p.agreed ? '미서명' : '미확인')
      : state === 'COUNTER' ? (me === !!x.lastActorMe ? '수정 요청' : '검토 중')
      : p.agreed ? '요청함' : (state === 'DRAFT' ? '작성 중' : '미확인');
  const mine = word(my, x.state, true), theirs = word(th, x.state, false);
  /* 상대 차례 — 내가 할 것은 끝났고 상대가 남은 단계 */
  const theirTurn = (x.state === 'SENT' && my.agreed && !th.agreed) || (x.state === 'AGREED' && my.signed && !th.signed)
    || (x.state === 'SIGNED' && my.done && !th.done) || (x.state === 'COUNTER' && !!x.lastActorMe);
  const next = x.state === 'FULFILLED' ? '양측이 이행을 확인했습니다. 성사로 확정되어 정산 대상입니다.'
    : x.state === 'CANCELLED' ? '파기된 계약입니다. 기록으로 남습니다.'
    : theirTurn ? '상대방 차례입니다. 3일 넘게 멈추면 알림이 갑니다 — 「확인 요청」으로 먼저 알릴 수 있습니다.'
    : x.state === 'DRAFT' || (x.state === 'SENT' && !my.agreed) ? '계약 조건을 확인하고 보내 주십시오.'
    : x.state === 'COUNTER' ? '상대가 수정을 요청했습니다. 대화에서 조율한 뒤 조건을 다시 보내 주십시오.'
    : x.state === 'AGREED' ? '양측이 조건에 합의했습니다. 서명해 주십시오.'
    : x.state === 'SIGNED' ? '서명이 끝났습니다. 이행을 마치면 「이행 확인」을 눌러 주십시오.'
    : '진행 상황을 확인해 주십시오.';
  const nudgedRecently = !!x.nudgedAt && Date.now() - new Date(x.nudgedAt).getTime() < 864e5;
  return { mine, theirs, nextAction: next, canNudge: theirTurn && !nudgedRecently };
}

/**
 * 마이페이지 — 내 매물 · 거래 · 대화 · 계약 · 관심 (v10.96 · me.service.ts 에서 함수 본문을 그대로 옮김).
 */
@Injectable()
export class MeActivityService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }
  /** 내 등록 리스팅.
   *  v10.31 (시안 mylst) — 행마다 조회 · 관심 · 문의 숫자, 업종 · 등급 칩, 반려 「고치는 법」, 고친 날을 함께 냅니다.
   *  문의 수 = 이 매물로 시작된 1:1 대화 수(실제 대화 · 지어낸 값 없음). 등급 = 업종 등급(G1 골든 · G2 실버 · G3 브론즈). */
  listings(limit?: number) {
    return this.db.query(
      `SELECT l.id, l.title, l.status, coalesce(sl.label, l.status) AS "statusLabel",
              l.gwan_code AS "gwanCode", l.desired_fee AS "desiredFee", l.version,
              l.published_at AS "publishedAt", l.created_at AS "createdAt", l.updated_at AS "updatedAt",
              l.view_count AS "viewCount", l.like_count AS "likeCount",
              (SELECT count(*)::int FROM conversations c WHERE c.target_type = 'LISTING' AND c.target_id = l.id) AS "inquiryCount",
              cat.name AS "categoryName", l.grade_code AS "gradeCode",
              CASE l.grade_code WHEN 'G1' THEN '골든' WHEN 'G2' THEN '실버' WHEN 'G3' THEN '브론즈' END AS "gradeLabel",
              ri.status AS "reviewStatus", rc.label AS "rejectReasonLabel", ri.reject_reason_code AS "rejectReasonCode",
              rc.fix_guide AS "rejectFixGuide",
              ri.sla_due_at AS "slaDueAt"
         FROM listings l
         LEFT JOIN categories cat ON cat.id = l.category_id
         LEFT JOIN code_labels sl ON sl.domain='listing.status' AND sl.code=l.status
         LEFT JOIN LATERAL (
           SELECT status, reject_reason_code, sla_due_at FROM review_items
            WHERE target_type='LISTING' AND target_id=l.id
            ORDER BY submitted_at DESC LIMIT 1) ri ON true
         LEFT JOIN review_reason_codes rc ON rc.code = ri.reject_reason_code
        WHERE l.owner_account_id = $1
        ORDER BY l.updated_at DESC LIMIT $2`,
      [this.me, clampLimit(limit)]);
  }

  /** 내가 당사자이거나 소개자인 거래 전부.
   *  v10.27(G-193) — 다음 단계로 가는 단추를 그리려고 「내가 확정했는지 · 대금 신고가 있는지 ·
   *  후기를 썼는지」를 함께 내립니다. 전에는 /my/deals 에서 확정 · 대금 · 후기 화면으로 갈 길이 없었습니다. */
  deals(limit?: number) {
    return this.db.query(
      `SELECT d.id, coalesce(l.title, rq.title) AS title, d.status, coalesce(sl.label, d.status) AS "statusLabel",
              d.agreed_fee AS "agreedFee", d.created_at AS "createdAt",
              d.confirmed_at AS "confirmedAt", d.attributed_code AS "attributedCode",
              d.listing_id AS "listingId", d.conversation_id AS "conversationId",
              CASE WHEN d.introducer_account_id = $1 THEN 'INTRODUCER'
                   WHEN d.buyer_account_id = $1 THEN 'BUYER' ELSE 'SELLER' END AS "myPart",
              EXISTS (SELECT 1 FROM deal_confirmations dc
                       WHERE dc.deal_id = d.id
                         AND dc.party = CASE WHEN d.buyer_account_id = $1 THEN 'BUYER'
                                             WHEN d.seller_account_id = $1 THEN 'SELLER' END) AS "iConfirmed",
              EXISTS (SELECT 1 FROM deal_payment_records pr WHERE pr.deal_id = d.id) AS "paymentReported",
              EXISTS (SELECT 1 FROM deal_reviews rv
                       WHERE rv.deal_id = d.id AND rv.author_id = $1) AS "iReviewed"
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN code_labels sl ON sl.domain='deal.status' AND sl.code=d.status
        WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
        ORDER BY d.created_at DESC LIMIT $2`,
      [this.me, clampLimit(limit)]);
  }

  /** 받은 문의 · 보낸 문의 (v10.27 · G-193).
   *
   *  전에는 문의를 보내기만 하고 **판매자가 받은 문의를 볼 곳이 없었습니다.**
   *  상대 이름은 첫 글자만 내립니다(김○○) — 거래 전에는 실명을 보일 이유가 없습니다.
   *  안 읽은 수는 「상대가 보낸 것 중 read_at 이 빈 것」입니다. */
  conversations(q: { role?: string; listingId?: string; id?: string; limit?: number }) {
    const role = q.role === 'SENT' || q.role === 'RECEIVED' ? q.role : null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const listingId = q.listingId && uuid.test(q.listingId) ? q.listingId : null;
    const id = q.id && uuid.test(q.id) ? q.id : null;
    return this.db.query(
      `SELECT c.id, c.target_type AS "targetType", c.target_id AS "targetId", c.status,
              CASE WHEN c.initiator_id = $1 THEN 'SENT' ELSE 'RECEIVED' END AS role,
              coalesce(l.title, rq.title) AS title, coalesce(l.gwan_code, rq.gwan_code) AS "gwanCode",
              coalesce(l.status, rq.status) AS "targetStatus",
              coalesce(left(btrim(a.name), 1), '회') || '○○' AS "counterpartName",
              lm.body AS "lastBody", lm.created_at AS "lastAt", (lm.sender_id = $1) AS "lastMine",
              (SELECT count(*)::int FROM messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread,
              d.id AS "dealId", d.status AS "dealStatus", c.created_at AS "createdAt"
         FROM conversations c
         JOIN accounts a ON a.id = CASE WHEN c.initiator_id = $1 THEN c.counterpart_id ELSE c.initiator_id END
         LEFT JOIN listings l ON c.target_type = 'LISTING' AND l.id = c.target_id
         LEFT JOIN requests rq ON c.target_type = 'REQUEST' AND rq.id = c.target_id
         LEFT JOIN LATERAL (SELECT body, created_at, sender_id FROM messages
                             WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) lm ON true
         LEFT JOIN LATERAL (SELECT id, status FROM deals
                             WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) d ON true
        WHERE $1 IN (c.initiator_id, c.counterpart_id)
          AND ($2::text IS NULL OR (CASE WHEN c.initiator_id = $1 THEN 'SENT' ELSE 'RECEIVED' END) = $2)
          AND ($3::uuid IS NULL OR (c.target_type = 'LISTING' AND c.target_id = $3))
          AND ($4::uuid IS NULL OR c.id = $4)
        ORDER BY coalesce(c.last_message_at, c.created_at) DESC LIMIT $5`,
      [this.me, role, listingId, id, clampLimit(q.limit)]);
  }

  /** 내 계약 목록. 매수·매도 어느 쪽이든 내가 당사자인 건을 모읍니다.
   *  v10.31 (시안 myctr 카드) — 내 쪽(myPart) · 소개코드 · 「나 ↔ 상대」 칸의 각자 상태(mine · theirs) · 다음 할 일(nextAction) ·
   *  「확인 요청」 가능 여부(canNudge — 진행 중 · 상대 차례 · 하루 한 번)를 함께 냅니다. */
  async contracts() {
    const me = RequestCtx.actorId()!;
    const rows = await this.db.query<any>(
      `SELECT c.deal_id AS "dealId", c.id AS "contractId",
              d.listing_id AS "listingId",   -- 20260930 · '대화로 조율' 이 매물 문의 화면(/chat/{매물})으로 가도록
              coalesce(l.title, r.title, '소개 건') AS title,
              coalesce(ab.name, asl.name, '상대방') AS counterpart,
              c.state,
              CASE c.state
                WHEN 'DRAFT'     THEN '작성 중'
                WHEN 'SENT'      THEN '상대 확인 대기'
                WHEN 'COUNTER'   THEN '수정 요청됨'
                WHEN 'AGREED'    THEN '서명 대기'
                WHEN 'SIGNED'    THEN '이행 대기'
                WHEN 'FULFILLED' THEN '계약 완료'
                ELSE '파기'
              END AS "stateLabel",
              CASE WHEN d.buyer_account_id = $1 THEN 'BUYER' ELSE 'SELLER' END AS "myPart",
              d.attributed_code AS "attributedCode",
              (c.agreed_by_buyer_at  IS NOT NULL) AS "buyerAgreed",
              (c.agreed_by_seller_at IS NOT NULL) AS "sellerAgreed",
              (c.signed_by_buyer_at  IS NOT NULL) AS "buyerSigned",
              (c.signed_by_seller_at IS NOT NULL) AS "sellerSigned",
              (c.fulfilled_by_buyer_at  IS NOT NULL) AS "buyerFulfilled",
              (c.fulfilled_by_seller_at IS NOT NULL) AS "sellerFulfilled",
              d.agreed_fee AS fee,
              (now() - c.updated_at) > interval '3 days' AS stalled,
              c.updated_at AS "updatedAt", c.issued_at AS "issuedAt",
              c.nudged_at AS "nudgedAt", c.last_actor_id = $1 AS "lastActorMe"
         FROM deal_contracts c
         JOIN deals d ON d.id = c.deal_id
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests r ON r.id = d.request_id
         LEFT JOIN accounts ab  ON ab.id  = d.buyer_account_id  AND d.seller_account_id = $1
         LEFT JOIN accounts asl ON asl.id = d.seller_account_id AND d.buyer_account_id  = $1
        WHERE d.buyer_account_id = $1 OR d.seller_account_id = $1
        ORDER BY c.updated_at DESC`, [me]);
    return rows.map((x) => ({ ...x, ...contractSides(x) }));
  }

  /* ── 프로필 · 사업자 정보 ─────────────────────────────────────── */

  favorites(limit?: number) {
    return this.db.query(
      `SELECT l.id, l.gwan_code AS "gwanCode", cat.name AS "categoryName", l.title,
              l.desired_fee AS "desiredFee", fb.label AS "feeBearerLabel",
              l.published_at AS "publishedAt", l.like_count AS "likeCount",
              l.is_priority_exposed AS "isAd", l.priority_label AS "adLabel",
              true AS liked,
              jsonb_build_object('companyName', coalesce(b.company_name,'개인'),
                'verified', (b.verified_at IS NOT NULL),
                'confirmedDeals', coalesce(st.confirmed_deals,0)) AS owner,
              '[]'::jsonb AS badges
         FROM favorites f
         JOIN listings l ON l.id = f.target_id AND l.status = 'PUBLISHED'
         JOIN categories cat ON cat.id = l.category_id
         LEFT JOIN businesses b ON b.account_id = l.owner_account_id AND b.verified_at IS NOT NULL
         LEFT JOIN v_introducer_stats st ON st.account_id = l.owner_account_id
         LEFT JOIN code_labels fb ON fb.domain='fee.bearer' AND fb.code = l.fee_bearer
        WHERE f.account_id = $1 AND f.target_type='LISTING'
        ORDER BY f.created_at DESC LIMIT $2`,
      [this.me, clampLimit(limit)]);
  }
}
