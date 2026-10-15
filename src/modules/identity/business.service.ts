import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { ReviewRepository } from '../review/review.repository';
import { NTS_API_BASE_DEFAULT, ntsStatusUrl, resolveBizStatusProvider } from './verification.provider';

/**
 * 개인 → 사업자 승격.
 *
 * 탈퇴 후 재가입이 아니라 같은 계정의 승격입니다.
 * 재가입으로 처리하면 귀속 기록(INV-2)이 끊깁니다.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reviews: ReviewRepository,
  ) {}

  async apply(accountId: string, input: {
    bizRegNo: string; companyName: string; ceoName: string; address?: string;
    // 구조화 주소(Daum 우편번호). 지역 매칭은 시·군·구로 합니다.
    zipcode?: string; addressRoad?: string; addressJibun?: string;
    sido?: string; sigungu?: string; addressDetail?: string;
    type?: 'SOLE' | 'CORP'; corpRegNo?: string; bizType?: string; bizItem?: string;
  }) {
    /* v10.31 — 시안 가입 2단계: 하이픈을 지운 10자리 · 법인은 법인등록번호 13자리 필수 */
    const bizRegNo = normBizRegNo(input.bizRegNo);
    const corpRegNo = input.corpRegNo ? input.corpRegNo.replace(/[^0-9]/g, '') : null;
    if (input.type === 'CORP' && !corpRegNo) {
      throw new PolicyViolation('CORP_REG_NO_REQUIRED', '법인 사업자는 법인등록번호 13자리가 필요합니다.');
    }
    if (corpRegNo !== null && corpRegNo.length !== 13) {
      throw new PolicyViolation('CORP_REG_NO_FORMAT', '법인등록번호는 13자리 숫자입니다.');
    }
    /* v10.31 — 시안 가입 1단계 「개인 사업자: 대표자는 가입자 본인이어야 합니다」 */
    if (input.type === 'SOLE') {
      const [acc] = await this.db.query<{ name: string }>(`SELECT name FROM accounts WHERE id = $1`, [accountId]);
      const norm = (x: string) => String(x ?? '').replace(/\s+/g, '');
      if (!acc || norm(acc.name) !== norm(input.ceoName)) {
        throw new PolicyViolation('SOLE_CEO_MISMATCH', '개인 사업자는 대표자가 가입자 본인이어야 합니다(담당자명과 대표자명이 같아야 합니다).');
      }
    }
    return this.db.transaction(async () => {
      const [dup] = await this.db.query<{ id: string }>(
        `SELECT id FROM businesses WHERE biz_reg_no = $1`, [bizRegNo],
      );
      if (dup) {
        throw new StateConflict('BIZ_REG_NO_TAKEN', '이미 등록된 사업자등록번호입니다.');
      }

      const [biz] = await this.db.query<{ id: string }>(
        `INSERT INTO businesses (account_id, biz_reg_no, company_name, ceo_name, address,
                                 zipcode, address_road, address_jibun, sido, sigungu, address_detail,
                                 corp_reg_no, biz_type, biz_item)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [accountId, bizRegNo, input.companyName, input.ceoName,
         // 옛 자유 입력 칸은 도로명으로 채웁니다. 화면 하나만 남기기 위해서입니다.
         input.addressRoad ?? input.address ?? null,
         input.zipcode ?? null, input.addressRoad ?? null, input.addressJibun ?? null,
         input.sido ?? null, input.sigungu ?? null, input.addressDetail ?? null,
         corpRegNo, input.bizType?.trim() || null, input.bizItem?.trim() || null],
      );

      await this.db.query(
        `INSERT INTO business_members (business_id, account_id, member_role, can_settle, joined_at)
         VALUES ($1,$2,'OWNER',true,now())`,
        [biz.id, accountId],
      );

      // 국세청 사업자등록 상태를 조회해 검수자에게 넘깁니다.
      //
      // 자동 승인하지 않습니다. 국세청이 '계속사업자'라고 답해도
      // 상호·대표자가 신청 내용과 같은지는 사람이 봐야 합니다(INV-7 · A-15 예외).
      //
      // 조회 실패는 신청 실패가 아닙니다. 국세청 장애 때문에
      // 사업자 신청 자체가 막히면 안 되므로, 결과만 비워 두고 진행합니다.
      let nts: { status: string; stub: boolean; detail?: string } | null = null;
      try {
        nts = await resolveBizStatusProvider().check(bizRegNo);
        /* ★ 20261001 — 어느 단계의 조회인지 남깁니다(D005).
         *   안심소개 기존 회원 일괄 이관은 국세청 **실연동(LIVE)** 결과만 근거로 씁니다.
         *   모의(STUB) · 시험(TEST) 기록은 실연동 후 scripts/nts-recheck.ts 로 다시 조회합니다. */
        await this.db.query(
          `UPDATE businesses
              SET nts_status = $2, nts_checked_at = now(), nts_detail = $3,
                  nts_env = CASE WHEN $4::boolean THEN 'STUB'
                                 WHEN $5::boolean AND (SELECT status FROM integrations WHERE code = 'NTS') = 'LIVE' THEN 'LIVE'
                                 ELSE 'TEST' END
            WHERE id = $1`,
          /* D008 — 기준 주소(NTS_API_BASE)가 공식이 아니면(가짜 서버 · 프록시) LIVE 로 찍지 않습니다 */
          [biz.id, nts.status, nts.detail ?? null, nts.stub, ntsStatusUrl() === ntsStatusUrl(NTS_API_BASE_DEFAULT)]);
      } catch {
        // 여기서 던지면 신청이 롤백됩니다. 조회는 부가 정보일 뿐입니다.
      }
      /* v10.31 — 시안 가입 2단계 「휴업 · 폐업 사업자는 가입할 수 없습니다」: 국세청이 휴업 · 폐업이라 답하면 신청을 받지 않습니다(롤백).
       *   조회 장애(UNKNOWN · 실패)는 전과 같이 막지 않습니다. */
      if (nts && (nts.status === 'CLOSED' || nts.status === 'SUSPENDED')) {
        throw new PolicyViolation('BIZ_CLOSED', `휴업 · 폐업 사업자는 가입할 수 없습니다${nts.detail ? ` (국세청: ${nts.detail})` : ''}.`);
      }

      // 승인은 검수 큐를 탑니다 (B3 와 같은 큐)
      const reviewId = await this.reviews.enqueue({
        targetType: 'BUSINESS', targetId: biz.id, submittedBy: accountId,
      });

      return {
        businessId: biz.id, reviewId, status: 'IN_REVIEW',
        // stub: true 면 화면에 "모의 조회" 라고 표시하십시오.
        // 실동작처럼 보이는 스텁이 시연 리스크였습니다.
        ntsStatus: nts?.status ?? null,
        ntsStub: nts?.stub ?? null,
        ntsDetail: nts?.detail ?? null,
      };
    });
  }

  /**
   * v10.31 — 가입 2단계 「인증하기」: 계정을 만들기 전에 국세청 상태와 중복 가입을 봅니다(시안 jvb).
   * 국세청 상태조회는 상태만 돌려줍니다 — 시안처럼 상호 · 대표자 · 개업일을 **자동으로 채우지 않습니다**
   * (지어낸 값이 됩니다). 상호 · 대표자는 가입자가 적고, 승인 때 사람이 대조합니다.
   */
  async check(raw: string) {
    const bizRegNo = normBizRegNo(raw);
    const [dup] = await this.db.query<{ id: string }>(`SELECT id FROM businesses WHERE biz_reg_no = $1`, [bizRegNo]);
    let r: { status: string; stub: boolean; detail?: string } = { status: 'UNKNOWN', stub: false };
    try { r = await resolveBizStatusProvider().check(bizRegNo); } catch { /* 조회 장애 — UNKNOWN */ }
    const taken = !!dup;
    /* 조회 장애(UNKNOWN)는 막지 않습니다 — 신청(apply)과 같은 기준. 휴업 · 폐업만 막습니다 */
    const ok = !taken && r.status !== 'CLOSED' && r.status !== 'SUSPENDED';
    return { bizRegNo, status: r.status, stub: r.stub, detail: r.detail ?? null, taken, ok };
  }

  /**
   * 승인 시 account_type 을 함께 승격합니다.
   * verified_at 이 곧 소개비 수령 자격의 기준일입니다 (INV-10).
   */
  async onApproved(businessId: string, approverId: string) {
    return this.db.transaction(async () => {
      const [biz] = await this.db.query<{ account_id: string }>(
        `UPDATE businesses SET verified_at = now(), verified_by = $2
          WHERE id = $1 AND verified_at IS NULL
        RETURNING account_id`,
        [businessId, approverId],
      );
      if (!biz) throw new StateConflict('ALREADY_VERIFIED', '이미 승인된 사업자입니다.');

      await this.db.query(
        `UPDATE accounts SET account_type = 'BUSINESS' WHERE id = $1`, [biz.account_id],
      );
      await this.db.query(
        `INSERT INTO account_roles (account_id, role, granted_by)
         VALUES ($1,'BIZ_OWNER',$2) ON CONFLICT DO NOTHING`,
        [biz.account_id, approverId],
      );
      return { accountId: biz.account_id };
    });
  }
}

/** 하이픈 · 공백을 지운 10자리 — 아니면 422 BIZ_REG_NO_FORMAT */
export function normBizRegNo(raw: string): string {
  const d = String(raw ?? '').replace(/[^0-9]/g, '');
  if (d.length !== 10) throw new PolicyViolation('BIZ_REG_NO_FORMAT', '사업자등록번호는 10자리 숫자입니다.');
  return d;
}
