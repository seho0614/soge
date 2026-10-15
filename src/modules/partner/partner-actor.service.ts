import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/** 대표 · 합류한 직원 계정이 보는 「내 파트너」 한 줄 */
export interface MemberPartner {
  id: string;
  grade: string;
  status: string;
  unpaidCap: string | number;
  company: string;
  bizRegNo: string | null;
  rejectReason: string | null;
  businessId: string;
  ownerId: string;
  approvedAt: Date | null;
  isOwner: boolean;
  /** 대표이거나 정산 권한이 있는 직원 — 충전 · 환불 등 돈을 움직일 수 있음 */
  canMoney: boolean;
}

/** 파트너센터에서 이 계정이 쓰는 사업자 줄 또는 개인 활동 정보(D096) */
export interface Actor {
  id: string;
  /** 활동 자격 — 사업자 = 사업자 인증 · 개인 = 본인인증(fn_actor_ok) */
  ok: boolean;
  /** 개인 활동 정보(businesses.kind = 'PERSON')인지 */
  personal: boolean;
}

/**
 * v10.39 (리팩토링) — 「내 파트너 · 내 신청 줄 찾기」 한 곳.
 *
 * 전에는 같은 조회가 서비스 7곳(파트너 · 파트너센터 · 리드 이용료 · 노출 · 제휴 · 축 입점 · 소개창업 회신)에
 * 12번 따로 적혀 있어, v10.38(계정 기준)처럼 규칙이 바뀌면 여러 곳을 같이 고쳐야 했습니다.
 * 동작은 그대로입니다 — 각 자리가 쓰던 조건(직원 포함 여부 · 정렬 · 활동 중만)을 메서드로 나눴습니다.
 */
@Injectable()
export class PartnerActorService {
  constructor(private readonly db: DatabaseService) {}

  /** 대표 계정 또는 합류한 직원 계정(빠지지 않은)의 파트너. 대표 것이 먼저. 없으면 null */
  async forMember(accountId: string): Promise<MemberPartner | null> {
    const [p] = await this.db.query<MemberPartner>(
      `SELECT p.id, p.grade, p.status, p.unpaid_cap AS "unpaidCap",
              b.company_name AS "company", b.biz_reg_no AS "bizRegNo",
              CASE WHEN p.status = 'REJECTED' THEN p.suspended_reason END AS "rejectReason",
              p.business_id AS "businessId", b.account_id AS "ownerId", p.approved_at AS "approvedAt",
              (b.account_id = $1) AS "isOwner",
              (b.account_id = $1 OR coalesce(m.can_settle, false)) AS "canMoney"
         FROM partners p JOIN businesses b ON b.id = p.business_id
         LEFT JOIN business_members m ON m.business_id = b.id AND m.account_id = $1
                                     AND m.joined_at IS NOT NULL AND m.removed_at IS NULL
        WHERE b.account_id = $1 OR m.account_id IS NOT NULL
        ORDER BY (b.account_id = $1) DESC LIMIT 1`, [accountId]);
    return p ?? null;
  }

  /** 대표 계정 본인의 파트너 번호(직원 제외 · 최근 승인 먼저). activeOnly 면 활동 중(ACTIVE)만. 없으면 null */
  async ownedId(accountId: string, activeOnly = false): Promise<string | null> {
    const [p] = await this.db.query<{ id: string }>(
      `SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id
        WHERE b.account_id = $1 AND (NOT $2::boolean OR p.status = 'ACTIVE')
        ORDER BY p.approved_at DESC NULLS LAST LIMIT 1`, [accountId, activeOnly]);
    return p?.id ?? null;
  }

  /**
   * 파트너센터 신청(입점 · 축 · 공인중개사 · 인력대행 회신)이 붙는 줄 — DB fn_actor_business(D096).
   * create 이면 본인인증 계정에 개인 활동 정보가 없을 때 만듭니다(읽기는 만들지 않음). 없으면 null.
   */
  async actor(accountId: string, create: boolean): Promise<Actor | null> {
    const [a] = await this.db.query<{ id: string | null; ok: boolean; personal: boolean }>(
      `SELECT x.id, fn_actor_ok(x.id) AS ok, coalesce(b.kind = 'PERSON', false) AS personal
         FROM (SELECT fn_actor_business($1, $2) AS id) x LEFT JOIN businesses b ON b.id = x.id`, [accountId, create]);
    return a?.id ? { id: a.id, ok: a.ok, personal: a.personal } : null;
  }
}
