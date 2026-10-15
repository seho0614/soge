import { inquiryNo } from '../public/public.service';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { clampLimit } from '../../core/pagination';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/**
 * 마이페이지 조회.
 *
 * 상태 라벨을 함께 내려줍니다 — 프런트가 문구를 하드코딩하면
 * "노출 중"을 "게시 중"으로 바꾸는 데 배포가 필요해집니다.
 */
@Injectable()
export class MeService {
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

  /** 정산 · 지급 내역.
   *  v10.31 (시안 mypay · mystl) — 소개 건 이름 · 소개코드 · 거래금액(계약 조건의 금액) · 부가세(사업자 수령만 · 소개비의 10% 별도 청구 — 표시 계산) ·
   *  세금계산서 발행 표시를 함께 냅니다. 소개비에서 떼는 금액은 없습니다(INV-9). */
  settlements(onlyHistory = false) {
    return this.db.query(
      `SELECT s.id, s.deal_id AS "dealId", s.amount, s.status,
              coalesce(sl.label, s.status) AS "statusLabel",
              s.requested_at AS "requestedAt", s.paid_at AS "paidAt",
              (s.held_by_dispute_id IS NOT NULL) AS "heldByDispute",
              CASE WHEN s.payee_business_id IS NULL THEN 'PERSON' ELSE 'BUSINESS' END AS payee,
              coalesce(l.title, rq.title, '소개 건') AS title, d.attributed_code AS "attributedCode", d.tier,
              (ct.terms->>'amount')::numeric AS "dealAmount",
              CASE WHEN s.payee_business_id IS NULL THEN NULL ELSE round(s.amount * 0.1) END AS vat,
              s.tax_invoice_issued_at AS "taxInvoiceIssuedAt", s.tax_invoice_no AS "taxInvoiceNo"
         FROM settlements s
         JOIN deals d ON d.id = s.deal_id
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN LATERAL (SELECT terms FROM deal_contracts c WHERE c.deal_id = d.id AND c.cancelled_at IS NULL
                             ORDER BY c.issued_at DESC LIMIT 1) ct ON true
         LEFT JOIN code_labels sl ON sl.domain='settlement.status' AND sl.code=s.status
        WHERE s.payee_account_id = $1
          AND ($2 = false OR s.status IN ('PAID','REJECTED'))
        ORDER BY s.requested_at DESC LIMIT 50`,
      [this.me, onlyHistory]);
  }

  /** v10.28 — 내가 소개자인 성사 확정 거래 중 정산 줄이 없는 것(소개비 약정이 있는 것만).
   *  v10.31 (시안 mystl 계산표) — 거래금액 · 소개코드 · tier · 상대(상호만) · 부가세(사업자 수령일 때만 · 표시 계산) · 받는 방식(payeeAs)을 함께.
   *  받는 방식: 사업자 인증이 그 거래의 성사보다 먼저면 BUSINESS, 아니면 PERSON(소급 안 함 · D060 ⑦). */
  settlementsDue() {
    return this.db.query(
      `SELECT d.id AS "dealId", d.agreed_fee AS amount, d.confirmed_at AS "confirmedAt",
              coalesce(l.title, rq.title, '소개 건') AS title, d.attributed_code AS "attributedCode", d.tier,
              (ct.terms->>'amount')::numeric AS "dealAmount",
              coalesce(cb.company_name, '상대방') AS counterpart,
              CASE WHEN b.verified_at IS NOT NULL AND b.verified_at <= d.confirmed_at THEN 'BUSINESS' ELSE 'PERSON' END AS "payeeAs",
              CASE WHEN b.verified_at IS NOT NULL AND b.verified_at <= d.confirmed_at THEN round(d.agreed_fee * 0.1) END AS vat
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN businesses b ON b.account_id = d.introducer_account_id AND b.kind = 'BUSINESS'
         LEFT JOIN businesses cb ON cb.account_id = d.buyer_account_id AND cb.verified_at IS NOT NULL
         LEFT JOIN LATERAL (SELECT terms FROM deal_contracts c WHERE c.deal_id = d.id AND c.cancelled_at IS NULL
                             ORDER BY c.issued_at DESC LIMIT 1) ct ON true
        WHERE d.introducer_account_id = $1 AND d.status = 'CONFIRMED' AND d.agreed_fee IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM settlements s WHERE s.deal_id = d.id)
        ORDER BY d.confirmed_at DESC NULLS LAST LIMIT 50`, [this.me]);
  }

  /** v10.31 (시안 mypay 「미발행」) — 세금계산서 발행 표시. 세금계산서는 소개자가 직접 발행합니다(회사가 대신 발행하지 않음).
   *  사업자로 받은 · 지급 완료된 · 내 정산만. 한 번 표시하면 고치지 않습니다(번호를 잘못 적었으면 고객센터). */
  async markTaxInvoice(id: string, no?: string) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) throw new PolicyViolation('BAD_ID', '정산 번호가 올바르지 않습니다.');
    const n = no?.trim() || null;
    if (n && n.length > 40) throw new PolicyViolation('BAD_NO', '승인번호는 40자 안으로 적어 주십시오.');
    const [s] = await this.db.query<{ status: string; biz: string | null; issued: string | null }>(
      `SELECT status, payee_business_id AS biz, tax_invoice_issued_at AS issued
         FROM settlements WHERE id = $1 AND payee_account_id = $2`, [id, this.me]);
    if (!s) throw new NotFound('정산을 찾을 수 없습니다.');
    if (!s.biz) throw new StateConflict('NOT_BUSINESS', '개인으로 받은 소개비는 세금계산서를 발행하지 않습니다.');
    if (s.status !== 'PAID') throw new StateConflict('NOT_PAID', '지급이 끝난 정산만 발행을 표시할 수 있습니다.');
    if (s.issued) throw new StateConflict('ALREADY_ISSUED', '이미 발행으로 표시했습니다.');
    const [row] = await this.db.query(
      `UPDATE settlements SET tax_invoice_issued_at = now(), tax_invoice_no = $3
        WHERE id = $1 AND payee_account_id = $2 AND tax_invoice_issued_at IS NULL
      RETURNING id, tax_invoice_issued_at AS "taxInvoiceIssuedAt", tax_invoice_no AS "taxInvoiceNo"`, [id, this.me, n]);
    return { ...row, note: '세금계산서 발행으로 표시했습니다. 세금계산서는 소개자가 직접 발행합니다.' };
  }

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

  notifications(unreadOnly = false, limit?: number) {
    return this.db.query(
      /* v10.31 — 알림 카드 색(tone · warn · ok · info)을 알림 종류 정책에서 */
      `SELECT n.id, n.event_code AS "eventCode", n.title, n.body, n.link_url AS "linkUrl",
              n.read_at AS "readAt", n.created_at AS "createdAt", coalesce(p.tone, 'info') AS tone
         FROM notifications n
         LEFT JOIN notification_event_policies p ON p.event_code = n.event_code
        WHERE n.account_id = $1 AND ($2 = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC LIMIT $3`,
      [this.me, unreadOnly, clampLimit(limit ?? 50)]);
  }

  async markRead() {
    const rows = await this.db.query(
      `UPDATE notifications SET read_at = now()
        WHERE account_id = $1 AND read_at IS NULL RETURNING id`, [this.me]);
    return { updated: rows.length };
  }

  /** v10.31 (시안 myntf 「수신 설정」) — 알림 종류별 인앱 · 이메일 · 수신거부 가능 여부.
   *  돈 · 계약이 걸린 알림은 수신거부할 수 없습니다(정책 optout_allowed=false · DB 트리거 fn_assert_optout_allowed 가 막음).
   *  이메일은 도메인 인증(SPF · DKIM) 전이라 아직 보내지 않습니다 — emailReady=false. */
  async notificationPrefs() {
    const rows = await this.db.query(
      `SELECT p.event_code AS "eventCode", p.name, p.optout_allowed AS "optoutAllowed", p.legal_basis AS reason,
              coalesce(ia.enabled, true) AS inapp, coalesce(em.enabled, true) AS email
         FROM notification_event_policies p
         LEFT JOIN notification_preferences ia ON ia.account_id = $1 AND ia.event_code = p.event_code AND ia.channel = 'INAPP'
         LEFT JOIN notification_preferences em ON em.account_id = $1 AND em.event_code = p.event_code AND em.channel = 'EMAIL'
        ORDER BY p.optout_allowed, p.name`, [this.me]);
    const [mail] = await this.db.query<{ ready: boolean }>(
      `SELECT coalesce((SELECT ready FROM v_notify_channels WHERE channel = 'EMAIL'), false) AS ready`);
    return { emailReady: !!mail?.ready, items: rows };
  }

  async setNotificationPref(eventCode: string, channel: string, enabled: boolean) {
    if (!['INAPP', 'EMAIL'].includes(channel)) throw new PolicyViolation('BAD_CHANNEL', '알 수 없는 받는 방법입니다.');
    const [p] = await this.db.query<{ name: string; optout: boolean }>(
      `SELECT name, optout_allowed AS optout FROM notification_event_policies WHERE event_code = $1`, [eventCode]);
    if (!p) throw new PolicyViolation('BAD_EVENT', '알 수 없는 알림 종류입니다.');
    if (!enabled && !p.optout) {
      throw new StateConflict('OPTOUT_FORBIDDEN', `「${p.name}」 알림은 수신거부할 수 없습니다 — 못 받으면 손해를 보실 수 있는 안내입니다.`);
    }
    await this.db.query(
      `INSERT INTO notification_preferences (account_id, event_code, channel, enabled, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (account_id, event_code, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [this.me, eventCode, channel, enabled]);
    return { eventCode, channel, enabled, note: enabled ? '받도록 했습니다.' : '받지 않도록 했습니다.' };
  }

  inquiries() {
    return this.db.query(
      /* v10.31 — 시안 「내 문의 내역」 표(문의번호 · 제목 · 응대 · 상태 · 접수일 · 최근 답변) */
      `SELECT i.id, i.category, cl.label AS "categoryLabel", i.title, i.status,
              coalesce(sl.label, i.status) AS "statusLabel", i.answer,
              i.created_at AS "createdAt", i.answered_at AS "answeredAt", i.channel
         FROM inquiries i
         LEFT JOIN code_labels sl ON sl.domain='inquiry.status' AND sl.code=i.status
         LEFT JOIN code_labels cl ON cl.domain='inquiry.category' AND cl.code=i.category
        WHERE i.account_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [this.me])
      .then((rows) => (rows as Array<{ id: string; createdAt: Date }>).map((r) => ({ ...r, no: inquiryNo(r.id, r.createdAt) })));
  }

  /** 내 분쟁 — 내가 접수한 것만(raised_by = 나). v10.32 — 분쟁 접수 · 처리 현황 표(시안 dspu: 접수 번호 · 거래 · 유형 · 상태 · 접수)에
   *  거래 이름(매물 · 요청 제목)과 유형 글자(code_labels dispute.reason)를 함께 내립니다. 다른 사람의 분쟁은 나가지 않습니다. */
  disputes() {
    return this.db.query(
      `SELECT d.id, d.deal_id AS "dealId", d.reason_code AS "reasonCode",
              coalesce(rl.label, d.reason_code) AS "reasonLabel",
              coalesce(l.title, rq.title) AS "dealTitle",
              d.description, d.status, coalesce(sl.label, d.status) AS "statusLabel",
              d.resolution, d.opened_at AS "openedAt", d.closed_at AS "closedAt",
              (SELECT count(*)::int FROM dispute_messages m WHERE m.dispute_id = d.id AND m.attachment_key IS NOT NULL) AS "evidenceCount"
         FROM disputes d
         JOIN deals dl ON dl.id = d.deal_id
         LEFT JOIN listings l ON l.id = dl.listing_id
         LEFT JOIN requests rq ON rq.id = dl.request_id
         LEFT JOIN code_labels sl ON sl.domain='dispute.status' AND sl.code=d.status
         LEFT JOIN code_labels rl ON rl.domain='dispute.reason' AND rl.code=d.reason_code
        WHERE d.raised_by = $1 ORDER BY d.opened_at DESC LIMIT 50`, [this.me]);
  }

  /** 구독 현황. 한도 소진을 함께 보여 줘야 업그레이드 판단이 됩니다 */
  async subscription() {
    const [row] = await this.db.query(
      `SELECT s.plan_code AS "planCode", p.name AS "planName", s.status,
              coalesce(sl.label, s.status) AS "statusLabel",
              s.current_period_end AS "currentPeriodEnd",
              s.request_views_used AS "requestViewsUsed",
              p.request_views_per_month AS "requestViewsPerMonth",
              p.included_codes AS "includedCodes", p.listing_slots AS "listingSlots",
              s.is_promo AS "isPromo", s.promo_ends_at AS "promoEndsAt",
              (SELECT count(*)::int FROM referral_codes rc
                WHERE rc.subscription_id = s.id AND rc.revoked_at IS NULL) AS "codesIssued",
              (SELECT count(*)::int FROM listings l
                WHERE l.owner_account_id = s.account_id AND l.status='PUBLISHED')
                AS "publishedListings"
         FROM subscriptions s
         JOIN subscription_plans p ON p.code = s.plan_code
         LEFT JOIN code_labels sl ON sl.domain='subscription.status' AND sl.code=s.status
        WHERE s.account_id = $1 AND s.status IN ('ACTIVE','PAST_DUE')
        LIMIT 1`, [this.me]);
    return row ?? {
      planCode: null, planName: null, status: null, statusLabel: null,
      currentPeriodEnd: null, codesIssued: 0, includedCodes: null,
      requestViewsUsed: 0, requestViewsPerMonth: null,
      publishedListings: 0, listingSlots: null, isPromo: false, promoEndsAt: null,
    };
  }

  async summary() {
    const [n] = await this.db.query<{ unread: string; listings: string; deals: string; name: string | null; company: string | null; email: string | null }>(
      `SELECT
         /* v10.31 — 머리줄 「👤 이름」(시안 「👤 소개하니」) · 문의 화면 「답변받을 이메일」 — 본인 것만 */
         (SELECT name FROM accounts WHERE id=$1) AS name,
         (SELECT company_name FROM businesses WHERE account_id=$1 AND verified_at IS NOT NULL LIMIT 1) AS company,
         (SELECT email::text FROM accounts WHERE id=$1) AS email,
         (SELECT count(*) FROM notifications WHERE account_id=$1 AND read_at IS NULL) AS unread,
         (SELECT count(*) FROM listings WHERE owner_account_id=$1 AND status='PUBLISHED') AS listings,
         (SELECT count(*) FROM deals
           WHERE $1 IN (buyer_account_id, seller_account_id, introducer_account_id)
             AND status NOT IN ('SETTLED','CANCELLED')) AS deals`, [this.me]);
    return {
      unreadNotifications: Number(n.unread),
      publishedListings: Number(n.listings),
      openDeals: Number(n.deals),
      displayName: n.company ?? n.name ?? null,
      email: n.email ?? null,
    };
  }

  /** 나의공간 첫 화면 (v10.27 · G-195 — 시안 scMy).
   *  프로필 한 줄 · 요약 4칸(진행 중 소개 · 성사 · 정산 대기 · 누적 수익) · 바로가기 숫자를 한 번에 냅니다.
   *  전에는 첫 화면이 메뉴 단추뿐이라 「지금 무엇이 진행 중인지」를 보려면 메뉴를 하나씩 열어야 했습니다.
   *  숫자는 모두 본인 것만 셉니다. 누적 수익은 지급 완료(PAID)된 정산 합계입니다(공제 없음 · INV-9). */
  async home() {
    const [r] = await this.db.query<any>(
      `SELECT a.name, a.created_at AS "since", a.identity_verified_at AS "identityVerifiedAt",
              b.company_name AS "companyName", b.biz_reg_no AS "bizRegNo", b.verified_at AS "businessVerifiedAt",
              (SELECT count(*)::int FROM deals d WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
                  AND d.status NOT IN ('CONFIRMED','SETTLED','CANCELLED')) AS "openDeals",
              (SELECT count(*)::int FROM deals d WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
                  AND d.status IN ('CONFIRMED','SETTLED')) AS "closedDeals",
              (SELECT count(*)::int FROM deals d WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) AS "allDeals",
              (SELECT count(*)::int FROM settlements s WHERE s.payee_account_id = $1 AND s.status IN ('REQUESTED','APPROVED','HELD')) AS "settlePending",
              (SELECT coalesce(sum(amount),0)::bigint FROM settlements s WHERE s.payee_account_id = $1 AND s.status = 'PAID') AS "earned",
              /* v10.31 — 메뉴 숫자 = 내 등록 리스팅 목록의 건수(목록은 내린 것도 「마감」 탭에 보여 줌) */
              (SELECT count(*)::int FROM listings l WHERE l.owner_account_id = $1) AS "listings",
              (SELECT count(*)::int FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
                WHERE $1 IN (d.buyer_account_id, d.seller_account_id) AND c.cancelled_at IS NULL
                  AND c.fulfilled_by_buyer_at IS NULL) AS "contracts",
              (SELECT count(*)::int FROM conversations c WHERE $1 IN (c.initiator_id, c.counterpart_id) AND c.status <> 'CLOSED') AS "conversations",
              (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
                WHERE $1 IN (c.initiator_id, c.counterpart_id) AND m.sender_id <> $1 AND m.read_at IS NULL) AS "unreadMessages",
              (SELECT count(*)::int FROM favorites f WHERE f.account_id = $1) AS "favorites",
              (SELECT count(*)::int FROM notifications n WHERE n.account_id = $1 AND n.read_at IS NULL) AS "unreadNotifications"
         FROM accounts a
         LEFT JOIN businesses b ON b.account_id = a.id AND b.kind = 'BUSINESS'
        WHERE a.id = $1`, [this.me]);
    const sub = await this.subscription();
    /* v10.31 (시안 프로필 카드 「거래신용 812 · 활동지역」)
     *   거래신용 = fn_trust_score(인증 · 초대 동의율 · 성사 · 거래 후기 · 인정된 신고 · 0~99)를 ×10 한 정수(시안 「812」 눈금).
     *   활동지역 = 소개자 프로필의 지역 → 없으면 내 매물의 등록 지역(많은 순 2곳). 둘 다 없으면 빈 칸. */
    const [t] = await this.db.query<{ score: string; sample: number }>(
      `SELECT score, sample FROM fn_trust_score($1)`, [this.me]);
    const regions = await this.activityRegions();
    return {
      ...r, earned: Number(r?.earned ?? 0), planCode: sub?.planCode ?? null, planName: sub?.planName ?? null,
      trustScore: t ? Number(t.score) : null,
      trustCredit: t ? Math.round(Number(t.score) * 10) : null,
      trustSample: t?.sample ?? 0,
      regions: regions.names, regionsBasis: regions.basis,
    };
  }

  /** 활동지역 — 소개자 프로필 지역(코드 → 이름) 우선, 없으면 내 매물 등록 지역 많은 순 2곳 */
  private async activityRegions(): Promise<{ names: string[]; basis: 'PROFILE' | 'LISTINGS' | null }> {
    const prof = await this.db.query<{ name: string }>(
      `SELECT x.c AS name FROM introducer_profiles p, unnest(p.regions) WITH ORDINALITY AS x(c, i)
        WHERE p.account_id = $1 ORDER BY x.i`, [this.me]);
    if (prof.length) return { names: prof.map((x) => x.name), basis: 'PROFILE' };
    const lst = await this.db.query<{ name: string }>(
      `SELECT r.sido || coalesce(' ' || r.sigungu, '') AS name
         FROM listing_regions lr JOIN listings l ON l.id = lr.listing_id
         JOIN regions r ON r.code = lr.region_code
        WHERE l.owner_account_id = $1
        GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 2`, [this.me]);
    return lst.length ? { names: lst.map((x) => x.name), basis: 'LISTINGS' } : { names: [], basis: null };
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

  async profile() {
    const [acc] = await this.db.query(
      `SELECT a.id, a.email, a.name, a.phone, a.job_title AS "jobTitle",
              a.account_type AS "accountType", a.status,
              a.identity_verified_at AS "identityVerifiedAt",
              a.created_at AS "createdAt",
              a.earnings_public AS "earningsPublic"
         FROM accounts a WHERE a.id = $1`, [this.me]);

    const [biz] = await this.db.query(
      `SELECT b.id, b.biz_reg_no AS "bizRegNo", b.company_name AS "companyName",
              b.ceo_name AS "ceoName", b.biz_type AS "bizType", b.biz_item AS "bizItem",
              b.address, b.verified_at AS "verifiedAt",
              b.nts_status AS "ntsStatus", b.nts_env AS "ntsEnv", b.corp_reg_no IS NOT NULL AS "isCorp",
              b.reject_reason AS "rejectReason", b.created_at AS "createdAt"
         FROM businesses b WHERE b.account_id = $1 AND b.kind = 'BUSINESS'`, [this.me]);

    /* ★ 무엇을 고칠 수 있는지 **화면이 묻지 않아도 알려 줍니다.**
     *   안 그러면 고치려다 거절당하고 나서야 압니다. */
    return {
      account: acc ?? null,
      business: biz ?? null,
      editable: {
        name: true,
        phone: true,
        email: false,            /* 로그인 수단 — 별도 절차 */
        business: !!biz && !biz.verifiedAt,
        bizRegNo: false,         /* 바꾸는 것은 다른 사업자가 되는 것 */
      },
      note: acc?.identityVerifiedAt
        ? '본인인증을 마치셨습니다. 이름을 바꾸시면 다시 인증해야 합니다.'
        : null,
    };
  }

  async updateProfile(dto: { name: string; phone?: string; earningsPublic?: boolean }) {
    /* 20261002 — 본인인증은 **이름**을 확인한 것입니다. 안내문은 "다시 인증해야 합니다" 인데
     * 실제로는 인증을 유지해, 인증된 이름과 다른 이름으로 거래 확정·정산 계좌 등록이 가능했습니다.
     * 이름이 바뀌면 인증을 풉니다(IS DISTINCT FROM — 같은 이름으로 저장하면 유지). */
    const [row] = await this.db.query<{ id: string; name: string; phone: string; earningsPublic: boolean; reset: boolean }>(
      `WITH o AS (SELECT name AS old_name, identity_verified_at FROM accounts WHERE id = $1)
       UPDATE accounts a
          SET name = $2, phone = coalesce($3, a.phone), updated_at = now(),
              /* v10.21 (D023) — 누적수익 공개 여부. 보내지 않으면(null) 지금 값을 그대로 둡니다. */
              earnings_public = coalesce($4::boolean, a.earnings_public),
              identity_verified_at = CASE WHEN o.old_name IS DISTINCT FROM $2 THEN NULL
                                          ELSE a.identity_verified_at END
         FROM o
        WHERE a.id = $1
      RETURNING a.id, a.name, a.phone, a.earnings_public AS "earningsPublic",
                (o.identity_verified_at IS NOT NULL AND o.old_name IS DISTINCT FROM $2) AS reset`,
      [this.me, dto.name, dto.phone ?? null, dto.earningsPublic ?? null]);
    const { reset, ...out } = row;
    return {
      ...out, identityReset: reset,
      note: reset ? '수정했습니다. 이름이 바뀌어 본인인증을 다시 하셔야 합니다.' : '수정했습니다.',
    };
  }

  async updateBusiness(dto: {
    companyName?: string; ceoName?: string;
    bizType?: string; bizItem?: string; address?: string;
  }) {
    const [biz] = await this.db.query(
      `SELECT id, verified_at FROM businesses WHERE account_id = $1 AND kind = 'BUSINESS'`, [this.me]);

    if (!biz) {
      return { ok: false, note: '등록된 사업자 정보가 없습니다. 먼저 사업자 인증을 하십시오.' };
    }
    /* ★ 국세청 확인이 끝난 뒤 바꾸면 **확인한 내용과 달라집니다.**
     *   그러면 그 확인이 무의미해지므로 막습니다. */
    if (biz.verified_at) {
      return {
        ok: false,
        note: '인증이 끝난 사업자 정보는 고칠 수 없습니다. 바뀐 내용이 있으면 다시 인증하십시오.',
      };
    }
    const [row] = await this.db.query(
      `UPDATE businesses SET
          company_name = coalesce($2, company_name),
          ceo_name     = coalesce($3, ceo_name),
          biz_type     = coalesce($4, biz_type),
          biz_item     = coalesce($5, biz_item),
          address      = coalesce($6, address),
          updated_at   = now()
        WHERE account_id = $1 AND kind = 'BUSINESS'
      RETURNING id, company_name AS "companyName", ceo_name AS "ceoName",
                biz_type AS "bizType", biz_item AS "bizItem", address`,
      [this.me, dto.companyName ?? null, dto.ceoName ?? null,
       dto.bizType ?? null, dto.bizItem ?? null, dto.address ?? null]);
    return { ok: true, ...row, note: '수정했습니다. 사업자 인증을 다시 받으셔야 합니다.' };
  }
}

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
