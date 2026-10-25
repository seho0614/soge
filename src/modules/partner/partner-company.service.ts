import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { normSido } from '../../common/region';

/**
 * 파트너센터 — 회사 · 계정: 사업자 정보 변경 요청 · 직원 계정(초대 · 내보내기 · 합류) · 회사 관리(브랜드 · 소재) (CTR-610).
 *
 * v10.108 (리팩토링 4차 · docs/168) — partner-center.service.ts 에서 함수 본문을 그대로 옮겼습니다(mine() · uuid() 는 두 곳에 원본 그대로).
 */
@Injectable()
export class PartnerCompanyService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const { id, grade, status, businessId, ownerId, company, isOwner } = p;   // 이 자리가 쓰던 칸 그대로
    return { id, grade, status, businessId, ownerId, company, isOwner };
  }
  private async owner() {
    const p = await this.mine();
    if (!p.isOwner) throw new Forbidden('OWNER_ONLY', '대표 계정만 할 수 있습니다.');
    return p;
  }
  private uuid(id: string, what = '대상') {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
  }

  /* ══ 회사 · 계정 ═══════════════════════════════════════════════════════ */

  async company() {
    const p = await this.mine();
    const [b] = await this.db.query<any>(
      `SELECT b.company_name AS company, b.biz_reg_no AS "bizRegNo", b.ceo_name AS "ceoName",
              b.biz_type AS "bizType", b.biz_item AS "bizItem",
              /* 주소는 시 · 군 · 구까지만 보여 줍니다(시안 「서울 송파구 ***」) */
              concat_ws(' ', b.sido, b.sigungu) AS "addressShort", (b.address IS NOT NULL OR b.address_road IS NOT NULL) AS "hasAddress",
              b.verified_at AS "verifiedAt", b.nts_status AS "ntsStatus", b.nts_env AS "ntsEnv", b.created_at AS "createdAt",
              p.grade, p.status, p.approved_at AS "approvedAt"
         FROM businesses b JOIN partners p ON p.business_id = b.id WHERE p.id = $1`, [p.id]);
    const changes = await this.db.query<any>(
      `SELECT id, field, after_value AS "afterValue", reason, state, decision_reason AS "decisionReason",
              created_at AS "createdAt", decided_at AS "decidedAt"
         FROM business_change_requests WHERE business_id = $1 ORDER BY created_at DESC LIMIT 20`, [p.businessId]);
    const staff = await this.db.query<any>(
      `SELECT 'OWNER' AS role, a.id AS "accountId", a.email::text AS email, a.name, true AS joined, true AS "canSettle", NULL::timestamptz AS "invitedAt"
         FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.id = $1
       UNION ALL
       SELECT m.member_role, a.id, a.email::text, a.name, (m.joined_at IS NOT NULL), m.can_settle, m.invited_at
         FROM business_members m JOIN accounts a ON a.id = m.account_id
        WHERE m.business_id = $1 AND m.member_role = 'STAFF' AND m.removed_at IS NULL`, [p.businessId]);
    staff.sort((a, b) => (a.role === 'OWNER' ? -1 : b.role === 'OWNER' ? 1 : String(a.invitedAt).localeCompare(String(b.invitedAt))));
    const terms = await this.db.query<any>(
      `SELECT t.code, t.title, t.is_required AS required, t.status, a.agreed, a.agreed_at AS "agreedAt", a.term_version AS version
         FROM terms t
         LEFT JOIN LATERAL (SELECT agreed, agreed_at, term_version FROM term_agreements x
                             WHERE x.account_id = $1 AND x.term_code = t.code ORDER BY agreed_at DESC NULLS LAST LIMIT 1) a ON true
        WHERE (t.status = 'PUBLISHED' AND NOT t.is_notice) OR (t.code = 'PARTNER' AND t.status <> 'ARCHIVED')
        ORDER BY t.display_order, t.code`, [p.ownerId]);
    const [brand] = await this.db.query<any>(
      `SELECT brand_name AS "brandName", logo_file_id AS "logoFileId", intro, updated_at AS "updatedAt"
         FROM partner_brands WHERE partner_id = $1`, [p.id]);
    const sites = await this.db.query<any>(
      `SELECT id, name, sido, sigungu, created_at AS "createdAt" FROM partner_brand_sites WHERE partner_id = $1 ORDER BY created_at`, [p.id]);
    /* 개인정보: 대표가 아닌 직원에게는 다른 직원의 이메일을 가립니다 */
    const mask = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_m, a, b2, c) => a + '*'.repeat(Math.min(6, b2.length)) + c);
    return {
      info: b, isOwner: p.isOwner,
      changes,
      staff: staff.map((s) => ({ ...s, email: p.isOwner || s.accountId === this.me ? s.email : mask(String(s.email)),
        name: s.name ? (p.isOwner || s.accountId === this.me ? s.name : String(s.name).slice(0, 1) + '**') : null })),
      terms,
      brand: brand ?? null, sites,
      notes: {
        info: '국세청 진위확인 · 휴폐업 조회가 연동 전이면 「간주」로 표시됩니다 — 판단 근거로 쓰지 마십시오. 변경은 요청으로 접수되고 승인은 본사가 합니다.',
        staff: '직원은 이미 가입한 회원을 이메일로 초대하고, 그 회원이 받아들이면 합류합니다(초대 메일 발송은 아직 없습니다 — 직접 알려 주십시오).',
        brand: '소재는 서비스 노출 단위가 아니라 신뢰 표시 단위입니다.',
      },
    };
  }

  async requestChange(dto: { field: string; afterValue: string; reason: string }) {
    const p = await this.owner();
    const FIELDS = ['COMPANY_NAME', 'CEO_NAME', 'ADDRESS', 'BIZ_TYPE', 'BIZ_ITEM'];
    if (!FIELDS.includes(dto.field)) throw new PolicyViolation('BAD_FIELD', `변경 항목은 ${FIELDS.join(' · ')} 중 하나입니다(사업자등록번호는 바꿀 수 없습니다).`);
    const col: Record<string, string> = { COMPANY_NAME: 'company_name', CEO_NAME: 'ceo_name', ADDRESS: 'address', BIZ_TYPE: 'biz_type', BIZ_ITEM: 'biz_item' };
    const [cur] = await this.db.query<any>(`SELECT ${col[dto.field]} AS v FROM businesses WHERE id = $1`, [p.businessId]);
    const [open] = await this.db.query(`SELECT 1 FROM business_change_requests WHERE business_id = $1 AND field = $2 AND state = 'REQUESTED'`, [p.businessId, dto.field]);
    if (open) throw new StateConflict('ALREADY_REQUESTED', '같은 항목의 변경 요청이 처리 중입니다.');
    const [r] = await this.db.query<any>(
      `INSERT INTO business_change_requests(business_id, field, before_value, after_value, reason, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, state, created_at AS "createdAt"`,
      [p.businessId, dto.field, cur?.v ?? null, dto.afterValue?.trim(), dto.reason?.trim(), this.me]);
    return { ...r, note: '변경 요청을 접수했습니다 — 승인은 본사가 합니다. 승인되면 사업자 정보에 바로 반영됩니다.' };
  }

  async inviteStaff(dto: { email: string; canSettle?: boolean }) {
    const p = await this.owner();
    const email = String(dto.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PolicyViolation('BAD_EMAIL', '이메일 형식이 아닙니다.');
    const [a] = await this.db.query<any>(`SELECT id, status FROM accounts WHERE email = $1 AND withdrawn_at IS NULL`, [email]);
    /* 가입 여부를 응답으로 알려 주지 않으면 대표가 초대를 끝낼 수 없어 알려 주되, 이름 등 다른 정보는 내지 않습니다 */
    if (!a) throw new PolicyViolation('NO_ACCOUNT', '그 이메일로 가입한 회원이 없습니다 — 먼저 소개뱅크에 가입하도록 알려 주십시오.');
    if (a.id === p.ownerId) throw new PolicyViolation('SELF', '대표 계정은 초대하지 않습니다.');
    const [other] = await this.db.query(
      `SELECT 1 FROM business_members WHERE account_id = $1 AND business_id <> $2 AND removed_at IS NULL`, [a.id, p.businessId]);
    if (other) throw new StateConflict('OTHER_BUSINESS', '다른 사업자에 소속된 계정입니다.');
    await this.db.query(
      `INSERT INTO business_members(business_id, account_id, member_role, can_settle, invited_by)
       VALUES ($1,$2,'STAFF',$3,$4)
       ON CONFLICT (business_id, account_id) DO UPDATE SET can_settle = EXCLUDED.can_settle, invited_by = EXCLUDED.invited_by,
              invited_at = now(), joined_at = NULL, removed_at = NULL
        WHERE business_members.member_role = 'STAFF'`, [p.businessId, a.id, !!dto.canSettle, this.me]);
    return { ok: true, state: 'INVITED', note: '초대했습니다 — 그 회원이 로그인해 「파트너센터 → 회사 · 계정」에서 받아들이면 합류합니다.' };
  }

  async removeStaff(accountId: string) {
    const p = await this.owner();
    this.uuid(accountId, '직원');
    const rows = await this.db.query(
      `UPDATE business_members SET removed_at = now() WHERE business_id = $1 AND account_id = $2 AND member_role = 'STAFF' AND removed_at IS NULL RETURNING account_id`,
      [p.businessId, accountId]);
    if (!rows.length) throw new NotFound('직원이 아닙니다.');
    return { ok: true, note: '직원 계정을 뺐습니다 — 이제 파트너센터에 들어오지 못합니다.' };
  }

  /** 초대받은 회원 — 내 초대 목록 · 받아들이기 */
  async myInvites() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    return this.db.query<any>(
      `SELECT m.business_id AS "businessId", b.company_name AS company, m.invited_at AS "invitedAt", m.can_settle AS "canSettle"
         FROM business_members m JOIN businesses b ON b.id = m.business_id
        WHERE m.account_id = $1 AND m.joined_at IS NULL AND m.removed_at IS NULL AND m.member_role = 'STAFF'`, [this.me]);
  }
  async acceptInvite(businessId: string) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    this.uuid(businessId, '초대');
    const rows = await this.db.query(
      `UPDATE business_members SET joined_at = now()
        WHERE business_id = $1 AND account_id = $2 AND joined_at IS NULL AND removed_at IS NULL AND member_role = 'STAFF'
       RETURNING business_id`, [businessId, this.me]);
    if (!rows.length) throw new NotFound('받아들일 초대가 없습니다.');
    return { ok: true, note: '합류했습니다. 파트너센터를 쓰실 수 있습니다.' };
  }

  async putBrand(dto: { brandName: string; intro?: string | null; logoFileId?: string | null }) {
    const p = await this.owner();
    if (dto.logoFileId) {
      this.uuid(dto.logoFileId, '파일');
      const [f] = await this.db.query(`SELECT 1 FROM files WHERE id = $1 AND owner_account_id = $2 AND status = 'READY'`, [dto.logoFileId, this.me]);
      if (!f) throw new PolicyViolation('BAD_FILE', '올린 파일이 아니거나 아직 올리는 중입니다.');
    }
    await this.db.query(
      `INSERT INTO partner_brands(partner_id, brand_name, intro, logo_file_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (partner_id) DO UPDATE SET brand_name = EXCLUDED.brand_name, intro = EXCLUDED.intro,
              logo_file_id = coalesce(EXCLUDED.logo_file_id, partner_brands.logo_file_id), updated_at = now()`,
      [p.id, dto.brandName?.trim(), dto.intro?.trim() || null, dto.logoFileId ?? null]);
    return { ok: true };
  }
  async addSite(dto: { name: string; sido: string; sigungu?: string | null }) {
    const p = await this.owner();
    if (!dto.sido?.trim()) throw new PolicyViolation('NO_SIDO', '시 · 도를 고르십시오.');
    const [r] = await this.db.query<any>(
      `INSERT INTO partner_brand_sites(partner_id, name, sido, sigungu) VALUES ($1,$2,$3,$4)
       ON CONFLICT (partner_id, name) DO NOTHING RETURNING id`, [p.id, dto.name?.trim(), normSido(dto.sido.trim()), dto.sigungu?.trim() || null]);
    if (!r) throw new StateConflict('DUP_SITE', '같은 이름의 소재가 있습니다.');
    return { ok: true, id: r.id };
  }
  async removeSite(id: string) {
    const p = await this.owner();
    this.uuid(id, '소재');
    const rows = await this.db.query(`DELETE FROM partner_brand_sites WHERE id = $1 AND partner_id = $2 RETURNING id`, [id, p.id]);
    if (!rows.length) throw new NotFound('소재가 없습니다.');
    return { ok: true };
  }
}
