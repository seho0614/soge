import { Controller, Get, Injectable, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { Roles } from '../../core/auth';
import { ErrorDto } from '../../common/dto/common.dto';
import { publicAuthor } from '../community/community.service';

/**
 * v10.31 (w1) — 거래 구간 화면(SB-HOM-DEL-010 · 020 · 030 · RVW-010)의 시안 머리: 3단계 띠 + 거래 정보 표
 *   (대상 · 소개자 · 소개코드 · 거래 당사자 · 거래금액 · 소개비 · 부담) + 확인 현황 · 대금 신고 현황.
 *   GET /api/v1/deals/{id}/summary — **거래 당사자(구매 · 판매)와 소개자만**. 운영은 BO 에서 봅니다.
 *   이름 표기: 사업자 인증이 된 쪽은 회사명, 아니면 이름 첫 글자(김OO). 연락처는 싣지 않습니다.
 *   거래금액은 계약서에 양측이 합의한 금액(terms.amount)만 — 없으면 null(지어내지 않음).
 */
@Injectable()
export class DealSummaryService {
  constructor(private readonly db: DatabaseService) {}

  async summary(id: string) {
    const me = RequestCtx.actorId();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('거래를 찾을 수 없습니다.');
    const [d] = await this.db.query<any>(
      `SELECT d.id, d.status, (SELECT label FROM code_labels WHERE domain='deal.status' AND code=d.status) AS "statusLabel",
              d.buyer_account_id AS buyer, d.seller_account_id AS seller, d.introducer_account_id AS introducer,
              d.attributed_code AS "refCode", d.tier, d.agreed_fee AS "agreedFee", d.confirmed_at AS "confirmedAt",
              d.confirm_mode AS "confirmMode", d.created_at AS "createdAt",
              coalesce(l.title, r.title) AS title, CASE WHEN d.listing_id IS NOT NULL THEN 'LISTING' WHEN d.request_id IS NOT NULL THEN 'REQUEST' END AS "targetType",
              coalesce(d.listing_id, d.request_id) AS "targetId", coalesce(l.gwan_code, r.gwan_code) AS "gwanCode",
              (SELECT label FROM code_labels WHERE domain='fee.bearer' AND code=l.fee_bearer) AS "feeBearerLabel",
              bb.company_name AS "_buyerCo", ba.name AS "_buyerName", sb.company_name AS "_sellerCo", sa.name AS "_sellerName",
              ia.name AS "_introName"
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests r ON r.id = d.request_id
         JOIN accounts ba ON ba.id = d.buyer_account_id
         JOIN accounts sa ON sa.id = d.seller_account_id
         LEFT JOIN accounts ia ON ia.id = d.introducer_account_id
         LEFT JOIN businesses bb ON bb.account_id = d.buyer_account_id AND bb.verified_at IS NOT NULL
         LEFT JOIN businesses sb ON sb.account_id = d.seller_account_id AND sb.verified_at IS NOT NULL
        WHERE d.id = $1`, [id]);
    if (!d) throw new NotFound('거래를 찾을 수 없습니다.');
    const role = d.buyer === me ? 'BUYER' : d.seller === me ? 'SELLER' : d.introducer === me ? 'INTRODUCER' : null;
    if (!role) throw new Forbidden('NOT_PARTY', '거래 당사자만 볼 수 있습니다.');

    const [c] = await this.db.query<any>(
      `SELECT state, issued_at AS "issuedAt", terms, signed_by_buyer_at AS "signedBuyerAt", signed_by_seller_at AS "signedSellerAt",
              agreed_by_buyer_at AS "agreedBuyerAt", agreed_by_seller_at AS "agreedSellerAt", document_key IS NOT NULL AS "hasDocument"
         FROM deal_contracts WHERE deal_id = $1 ORDER BY issued_at DESC LIMIT 1`, [id]);
    const confirms = await this.db.query<any>(
      `SELECT party, confirmed_at AS "confirmedAt", is_auto AS "isAuto" FROM deal_confirmations WHERE deal_id = $1 ORDER BY confirmed_at`, [id]);
    const pays = await this.db.query<any>(
      `SELECT p.method, p.reported_at AS "reportedAt",
              CASE WHEN p.reported_by = $2 THEN 'BUYER' WHEN p.reported_by = $3 THEN 'SELLER' ELSE 'OTHER' END AS party
         FROM deal_payment_records p WHERE p.deal_id = $1 ORDER BY p.reported_at`, [id, d.buyer, d.seller]);
    const [rv] = await this.db.query<any>(
      `SELECT rating, body, tags, created_at AS "createdAt" FROM deal_reviews WHERE deal_id = $1 AND author_id = $2`, [id, me]);

    const who = (co: string | null, name: string | null) => co ?? publicAuthor(name);
    const amount = c?.terms && Number.isFinite(Number(c.terms.amount)) ? Number(c.terms.amount) : null;
    /* 단계: 0 계약서 · 1 결제/대금 · 2 성사 확정 */
    const step = ['CONFIRMED', 'SETTLED'].includes(d.status) ? 2 : d.status === 'PAYMENT_REPORTED' ? 2 : d.status === 'CONTRACTED' ? 1 : 0;
    return {
      id: d.id, status: d.status, statusLabel: d.statusLabel, step, myRole: role,
      title: d.title, targetType: d.targetType, targetId: d.targetId, gwanCode: d.gwanCode,
      introducer: d.introducer ? publicAuthor(d._introName) : null,
      refCode: d.refCode, tier: d.tier,
      buyer: who(d._buyerCo, d._buyerName), seller: who(d._sellerCo, d._sellerName),
      amount, agreedFee: d.agreedFee != null ? Number(d.agreedFee) : null, feeBearerLabel: d.feeBearerLabel,
      dueDate: c?.terms?.dueDate ?? null, special: c?.terms?.special ?? null,
      contract: c ? { state: c.state, issuedAt: c.issuedAt, signedBuyerAt: c.signedBuyerAt, signedSellerAt: c.signedSellerAt,
                      agreedBuyerAt: c.agreedBuyerAt, agreedSellerAt: c.agreedSellerAt, hasDocument: c.hasDocument } : null,
      confirmations: confirms, payments: pays,
      confirmedAt: d.confirmedAt, confirmMode: d.confirmMode, createdAt: d.createdAt,
      myReview: rv ?? null,
    };
  }
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1/deals')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
export class DealSummaryController {
  constructor(private readonly svc: DealSummaryService) {}

  @Get(':id/summary')
  @ApiOperation({
    summary: '거래 정보(시안 거래 구간 머리)',
    description: '3단계(계약서 · 결제/대금 · 성사 확정) 위치 · 대상 · 소개자(첫 글자) · 소개코드 · 당사자 · 거래금액(계약서 합의 금액) · 소개비 · 부담 · 확인 · 대금 신고 · 내 후기. 거래 당사자와 소개자만.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'NOT_PARTY', type: ErrorDto })
  summary(@Param('id') id: string) { return this.svc.summary(id); }
}
