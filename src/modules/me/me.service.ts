import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

/**
 * 마이페이지 조회.
 *
 * 상태 라벨을 함께 내려줍니다 — 프런트가 문구를 하드코딩하면
 * "노출 중"을 "게시 중"으로 바꾸는 데 배포가 필요해집니다.
 *
 * v10.96 (리팩토링) — 내 매물 · 거래 · 대화 · 계약 · 관심은 me-activity.service.ts, 정산은 me-money.service.ts, 알림 · 문의 · 분쟁은 me-notify.service.ts 로 나눴습니다.
 */
@Injectable()
export class MeService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }
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
