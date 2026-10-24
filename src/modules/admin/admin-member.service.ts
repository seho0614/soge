import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskBizNo, maskEmail, maskName, maskPhone } from '../../common/mask';


/**
 * 백오피스 — 사업자 인증 · 회원 상태 · 등록 정지 해제 · 회원 조회 (v10.96 · admin.service.ts 에서 함수 본문을 그대로 옮김).
 */
@Injectable()
export class AdminMemberService {
  constructor(private readonly db: DatabaseService) {}
  /**
   * 사업자 신청 · 회원 관리 (SB-ADM-USR-010). 미승인 건이 위로 옵니다.
   * v10.31 (10/10 시안 기준) — 시안 줄(상호 · 번호 · 사업자 128-86-***12 · 대표 김** · 요금제 · 서류)과 탭(승인 대기 · 정상 · 정지).
   *   사업자등록번호 · 대표 이름은 가려서 보냅니다(시안 표기 · 개인정보). 찾기는 서버가 원래 값으로 합니다(q).
   *   반려(rejectedAt) · 회원 상태(accountStatus) · 요금제(planCode)를 더했습니다.
   */
  async businesses(q?: string) {
    const rows = await this.db.query<any>(
      `SELECT b.id, b.account_id AS "accountId", b.biz_reg_no AS "bizRegNo", b.company_name AS "companyName",
              b.ceo_name AS "ceoName", b.nts_status AS "ntsStatus",
              b.verified_at AS "verifiedAt", a.name AS "accountName", a.status AS "accountStatus",
              b.rejected_at AS "rejectedAt", b.reject_reason AS "rejectReason",
              b.created_at AS "createdAt",
              (SELECT s.plan_code FROM subscriptions s WHERE s.account_id = b.account_id AND s.status = 'ACTIVE'
                ORDER BY s.current_period_end DESC NULLS LAST LIMIT 1) AS "planCode"
         FROM businesses b JOIN accounts a ON a.id = b.account_id
        WHERE b.kind = 'BUSINESS'   /* v10.38 (D096) — 개인 활동 정보는 사업자 신청이 아닙니다 */
          AND ($1::text IS NULL OR b.company_name ILIKE '%'||$1||'%' OR b.ceo_name ILIKE '%'||$1||'%'
               OR b.biz_reg_no LIKE '%'||regexp_replace($1,'\\D','','g')||'%' AND length(regexp_replace($1,'\\D','','g')) >= 3
               OR a.name ILIKE '%'||$1||'%')
        ORDER BY (b.verified_at IS NOT NULL OR b.rejected_at IS NOT NULL), b.created_at DESC LIMIT 200`, [q?.trim() || null]);
    return rows.map((r) => ({
      ...r,
      bizRegNo: maskBizNo(r.bizRegNo, 'mid'),
      ceoName: maskName(r.ceoName),
      accountName: maskName(r.accountName),
      no: `M-${String(r.id).slice(0, 4).toUpperCase()}`,
    }));
  }

  /**
   * v10.31 — 사업자 신청 반려(시안 「반려」). 사유를 남기고 검수 대기 건도 반려로 닫습니다.
   * 반려된 신청자는 사업자 전환 화면에서 고쳐 다시 신청할 수 있습니다(새 신청이 생기면 반려 표시는 그 줄에만 남음).
   */
  async rejectBusiness(id: string, reason: string) {
    if (!reason?.trim() || reason.trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오.');
    return this.db.transaction(async () => {
      const [b] = await this.db.query<{ account_id: string }>(
        `UPDATE businesses SET rejected_at = now(), rejected_by = $2, reject_reason = $3
          WHERE id = $1 AND kind = 'BUSINESS' AND verified_at IS NULL AND rejected_at IS NULL RETURNING account_id`,
        [id, RequestCtx.actorId(), reason.trim()]);
      if (!b) throw new StateConflict('ALREADY_DECIDED', '이미 승인했거나 반려한 신청입니다.');
      await this.db.query(
        `UPDATE review_items SET status = 'REJECTED', decision_by = $2, decided_at = now(),
                reject_reason_code = 'OTHER', reject_memo = $3
          WHERE target_type = 'BUSINESS' AND target_id = $1 AND status IN ('QUEUED','IN_PROGRESS')`,
        [id, RequestCtx.actorId(), reason.trim()]);
      await this.db.query(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url)
         VALUES ($1, 'BUSINESS_REJECTED', '사업자 신청이 반려되었습니다', $2, '/my/business')`,
        [b.account_id, `사유: ${reason.trim()} — 고쳐서 다시 신청하실 수 있습니다.`]);
      return { id, status: 'REJECTED' };
    });
  }

  /**
   * v10.31 — 회원 상태 변경(시안 회원 상세 「상태 변경」 · 회원 관리 「정지」 탭). 정상 ↔ 정지만. 사유 필수 · 기록(account_status_changes).
   * 자기 자신과 최고 관리자(SUPER)는 바꿀 수 없습니다. 정지하면 로그인이 막히고 소개코드가 멈춥니다(trg_revoke_on_status).
   */
  async setAccountStatus(id: string, status: string, reason: string) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new PolicyViolation('BAD_STATUS', '정상 또는 정지로만 바꿀 수 있습니다.');
    if (!reason?.trim() || reason.trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '상태를 바꾸는 사유를 적어 주십시오.');
    if (id === RequestCtx.actorId()) throw new PolicyViolation('SELF_CHANGE', '자기 계정의 상태는 바꿀 수 없습니다.');
    return this.db.transaction(async () => {
      const [a] = await this.db.query<{ status: string; sup: boolean }>(
        `SELECT status, EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = 'SUPER') AS sup
           FROM accounts a WHERE id = $1 FOR UPDATE`, [id]);
      if (!a) throw new StateConflict('NOT_FOUND', '없는 회원입니다.');
      if (a.sup) throw new PolicyViolation('PROTECTED_ACCOUNT', '최고 관리자 계정은 이 화면에서 바꿀 수 없습니다.');
      if (a.status === 'WITHDRAWN') throw new StateConflict('WITHDRAWN', '탈퇴한 회원입니다.');
      if (a.status === status) throw new StateConflict('SAME_STATUS', status === 'ACTIVE' ? '이미 정상입니다.' : '이미 정지된 회원입니다.');
      await this.db.query(`UPDATE accounts SET status = $2 WHERE id = $1`, [id, status]);
      await this.db.query(
        `INSERT INTO account_status_changes (account_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, a.status, status, reason.trim(), RequestCtx.actorId()]);
      return { id, from: a.status, status };
    });
  }

  /** v10.31 — 등록 일시 정지(제한업종 · 금칙 표현 반려 3회) 풀기 */
  async liftPostingSuspension(accountId: string) {
    const rows = await this.db.query(
      `UPDATE posting_suspensions SET lifted_at = now(), lifted_by = $2
        WHERE account_id = $1 AND lifted_at IS NULL AND until_at > now() RETURNING id`,
      [accountId, RequestCtx.actorId()]);
    if (!rows.length) throw new StateConflict('NOT_SUSPENDED', '풀 등록 정지가 없습니다.');
    return { accountId, lifted: rows.length };
  }

  /**
   * 사업자 승인. verified_at 이 소개비 수령 자격의 기준일입니다 (INV-10).
   * 승격이지 재가입이 아니므로 계정은 그대로 두고 타입만 바꿉니다.
   */
  async verifyBusiness(id: string) {
    return this.db.transaction(async () => {
      const [biz] = await this.db.query<{ account_id: string }>(
        `UPDATE businesses SET verified_at = now(), verified_by = $2
          WHERE id = $1 AND kind = 'BUSINESS' AND verified_at IS NULL RETURNING account_id`,
        [id, RequestCtx.actorId()]);
      if (!biz) throw new StateConflict('ALREADY_VERIFIED', '이미 승인된 사업자입니다.');

      await this.db.query(
        `UPDATE accounts SET account_type='BUSINESS' WHERE id = $1`, [biz.account_id]);
      await this.db.query(
        `INSERT INTO account_roles (account_id, role, granted_by) VALUES ($1,'BIZ_OWNER',$2)
         ON CONFLICT DO NOTHING`, [biz.account_id, RequestCtx.actorId()]);
      /* v10.26 (G-186) — 이 사업자의 검수 대기 건도 같은 거래에서 승인으로 닫습니다.
       * 전에는 「사업자 인증」에서 승인해도 검수 큐의 그 건이 대기로 남아 쌓였습니다(10/8 실측 1,191건) —
       * 검수 큐는 오래된 50건만 보여 주므로 진짜 대기 건(매물 · 요청)이 뒤로 밀렸습니다. */
      await this.db.query(
        `UPDATE review_items SET status = 'APPROVED', decision_by = $2, decided_at = now()
          WHERE target_type = 'BUSINESS' AND target_id = $1 AND status IN ('QUEUED','IN_PROGRESS')`,
        [id, RequestCtx.actorId()]);
      return { id, accountId: biz.account_id };
    });
  }

  /** v10.31 (10/10 결함 · 시안 kim****@) — 목록에는 가린 이메일 · 연락처만 보냅니다. 찾기는 원래 값으로 */
  async accounts(q?: string, limit?: number, status?: string) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const rows = await this.db.query<any>(
      `SELECT a.id, a.email, a.name, a.phone,
              a.account_type AS "accountType", a.status,
              (a.identity_verified_at IS NOT NULL) AS "identityVerified",
              b.company_name AS "companyName",
              (b.verified_at IS NOT NULL) AS "bizVerified",
              a.created_at AS "createdAt", a.last_login_at AS "lastLoginAt"
         FROM accounts a
         LEFT JOIN businesses b ON b.account_id = a.id AND b.kind = 'BUSINESS'
        WHERE a.withdrawn_at IS NULL
          AND ($3::text IS NULL OR a.status = $3)
          AND ($1::text IS NULL OR a.name ILIKE '%'||$1||'%'
                OR a.email::text ILIKE '%'||$1||'%'
                OR coalesce(a.phone,'') ILIKE '%'||$1||'%')
        ORDER BY a.created_at DESC
        LIMIT $2`, [q ?? null, n, status ?? null]);
    return rows.map((r) => ({ ...r, email: maskEmail(r.email), phone: maskPhone(r.phone) }));
  }

  /** v10.31 — 회원 관리 탭 숫자(정상 · 정지) */
  async accountCounts() {
    const [r] = await this.db.query<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS active,
              count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
         FROM accounts WHERE withdrawn_at IS NULL`);
    return { active: Number(r.active), suspended: Number(r.suspended) };
  }

  async account(id: string) {
    const [acc] = await this.db.query<any>(
      `SELECT a.id, a.email, a.name, a.phone,
              a.account_type AS "accountType", a.status,
              a.identity_verified_at AS "identityVerifiedAt",
              a.created_at AS "createdAt", a.last_login_at AS "lastLoginAt",
              a.withdrawn_at AS "withdrawnAt"
         FROM accounts a WHERE a.id = $1`, [id]);
    if (!acc) return { ok: false, note: '없는 회원입니다.' };
    /* v10.31 (10/10 결함 · 시안 kim****@ · 010-****-2280) — 상세도 가린 값만 */
    acc.email = maskEmail(acc.email); acc.phone = maskPhone(acc.phone);

    const [biz] = await this.db.query<any>(
      `SELECT b.id, b.biz_reg_no AS "bizRegNo", b.company_name AS "companyName",
              b.ceo_name AS "ceoName", b.nts_status AS "ntsStatus",
              b.verified_at AS "verifiedAt", b.reject_reason AS "rejectReason", b.rejected_at AS "rejectedAt"
         FROM businesses b WHERE b.account_id = $1 AND b.kind = 'BUSINESS'`, [id]);
    if (biz) biz.bizRegNo = maskBizNo(biz.bizRegNo);

    /* v10.31 — 상태 변경 기록 · 등록 일시 정지(시안 「상태 변경」) */
    const statusLog = await this.db.query(
      `SELECT c.from_status AS "from", c.to_status AS "to", c.reason, c.changed_at AS "at", x.name AS "by"
         FROM account_status_changes c LEFT JOIN accounts x ON x.id = c.changed_by
        WHERE c.account_id = $1 ORDER BY c.changed_at DESC LIMIT 10`, [id]);
    const [postingSuspension] = await this.db.query(
      `SELECT until_at AS "until", reason FROM posting_suspensions
        WHERE account_id = $1 AND lifted_at IS NULL AND until_at > now() ORDER BY until_at DESC LIMIT 1`, [id]);

    const roles = await this.db.query(
      `SELECT role FROM account_roles WHERE account_id = $1 ORDER BY role`, [id]);

    const listings = await this.db.query(
      `SELECT l.id, l.title, l.status, coalesce(cl.label, l.status) AS "statusLabel", l.created_at AS "createdAt"
         FROM listings l LEFT JOIN code_labels cl ON cl.domain = 'listing.status' AND cl.code = l.status
        WHERE l.owner_account_id = $1
        ORDER BY l.created_at DESC LIMIT 10`, [id]);
    const [listingCount] = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM listings WHERE owner_account_id = $1`, [id]);

    const deals = await this.db.query(
      `SELECT d.id, d.status, coalesce(cl.label, d.status) AS "statusLabel", d.created_at AS "createdAt",
              CASE WHEN d.buyer_account_id = $1 THEN '매수'
                   WHEN d.seller_account_id = $1 THEN '매도'
                   ELSE '소개' END AS side
         FROM deals d LEFT JOIN code_labels cl ON cl.domain = 'deal.status' AND cl.code = d.status
        WHERE d.buyer_account_id = $1 OR d.seller_account_id = $1
           OR d.introducer_account_id = $1
        ORDER BY d.created_at DESC LIMIT 10`, [id]);
    const [dealCount] = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM deals WHERE buyer_account_id = $1 OR seller_account_id = $1 OR introducer_account_id = $1`, [id]);

    /* ★ 이 회원이 **신고한 것과 신고당한 것**을 함께 봅니다.
     *   한쪽만 보면 "상습 신고자" 인지 "상습 피신고자" 인지 모릅니다. */
    const [rep] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM reports WHERE reporter_id = $1) AS "reported",
         (SELECT count(*) FROM reports WHERE target_type='ACCOUNT' AND target_id = $1)
           AS "reportedAgainst"`, [id]);

    return {
      ok: true,
      account: acc,
      business: biz ?? null,
      roles: roles.map((r: { role: string }) => r.role),
      listings, deals,
      listingCount: Number(listingCount?.n ?? 0), dealCount: Number(dealCount?.n ?? 0),
      statusLog, postingSuspension: postingSuspension ?? null,
      reports: rep,
      note: acc.withdrawnAt
        ? '탈퇴한 회원입니다. 보관 기간이 지나면 개인정보가 지워집니다.'
        : null,
    };
  }
}
