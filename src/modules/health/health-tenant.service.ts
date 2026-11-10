import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { ORDER_OPEN_SQL } from './health-policy';
import { resolveSubmerchantProvider } from './submerchant.provider';

/* ---------------------------------------------------------------------
 * v10.165 (D155 · docs/256) — 소개몰 입점 1단계: 입점 신청 · 서류 · 운영 심사
 *
 *   켜짐   설정 mall.tenant_apply(신청 받기 · v10.223 에서 mall.tenant 에서 나눔 · 처음 off) — 입점 약관(HLT_SELLER) 게시 뒤 SUPER 가 켬
 *   누구   본인확인을 마친 회원이면 개인 · 사업자 모두(P2P · 「사업자만」 제한 없음) — 사업자면 사업자등록번호
 *   동의   지금 시행 중인 입점 약관(HLT_SELLER · v_terms_current)에 동의한 회원만
 *   심사   PENDING → 운영 승인 ACTIVE / 반려 REJECTED(사유 · 신청자에게 보임 · 고쳐서 다시 신청)
 *   돈     판매대금은 판매자에게 직접 귀속(결제대행사 하위가맹점 · decisions/mall-return-refund #15) — 이 판은 돈을 다루지 않음
 * ------------------------------------------------------------------- */
export const SELLER_LICENSE_KINDS = ['BIZ_REG', 'ECOM_REG', 'FOOD_SALE', 'HEALTH_FUNC', 'MED_DEVICE', 'COSMETIC', 'BRAND_RIGHT'] as const;

/** v10.229 (docs/367) — 입점 열기 준비 점검 한 줄 · ok 준비됨 · todo 막힘(대표 · 법무 · 외부 차례 — 오픈 전에는 정상) · info 값만 */
export type TenantReadyRow = { key: string; group: 'apply' | 'sale'; label: string; state: 'ok' | 'todo' | 'info'; now: string };
const HOLE = /〔[^〕]*〕/g;

export interface SellerApply {
  type: string; name: string; personal: boolean; bizRegNo?: string | null; ceoName: string;
  ecomRegNo?: string | null; csTel: string; returnAddr: string; addr?: string | null;
  licenses?: Array<{ kind: string; licenseNo: string; issuedAt?: string | null; expiresAt?: string | null }>;
}

@Injectable()
export class HealthTenantService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  /** v10.223 (D193) — 신청 받기는 mall.tenant_apply · 입점 판매 열기는 mall.tenant(DB 판매 문 fn_hlt_tenant_sale_guard)로 나눔 */
  private async on() {
    const [r] = await this.db.query<{ is_on: boolean }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant_apply'), 'off') = 'on' AS is_on`);
    return !!r?.is_on;
  }

  /** 공개 — 켜짐 (사용자 웹이 「입점 신청」 단추를 보일지) · 입점 판매 열림 */
  async config() {
    const [r] = await this.db.query<{ sale: boolean }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant'), 'off') = 'on' AS sale`);
    return { enabled: await this.on(), saleOpen: !!r?.sale };
  }

  /** v10.170 (D159) — 공개 · 소개몰 「주문 받기」(사용자 웹이 주문 단추를 보일지) */
  async orderConfig() {
    const [r] = await this.db.query<{ open: boolean }>(ORDER_OPEN_SQL);
    return { open: !!r?.open };
  }

  private async consented() {
    const [c] = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM v_terms_current t
                        JOIN v_term_consent_current g ON g.term_code = t.code AND g.term_version = t.version
                       WHERE t.code = 'HLT_SELLER' AND g.account_id = $1 AND g.agreed) AS ok`, [this.me]);
    return !!c?.ok;
  }

  private sellerRow(where: string, args: unknown[]) {
    return this.db.query(
      `SELECT s.id, s.code, s.name, s.type, s.status, s.personal,
              s.biz_reg_no AS "bizRegNo", s.ceo_name AS "ceoName", s.ecom_reg_no AS "ecomRegNo",
              s.cs_tel AS "csTel", s.return_addr AS "returnAddr", s.addr,
              s.commission_rate AS "commissionRate",
              (coalesce(btrim(s.submerchant_id), '') <> '') AS "payable",
              s.applied_at AS "appliedAt", s.reviewed_at AS "reviewedAt", s.reject_reason AS "rejectReason",
              s.status_reason AS "statusReason", s.status_at AS "statusAt",   -- v10.223 (D193) 정지 · 제한 · 폐점 사유
              coalesce((SELECT json_agg(json_build_object(
                         'kind', l.kind, 'licenseNo', l.license_no, 'issuedAt', l.issued_at, 'expiresAt', l.expires_at,
                         'verified', l.verified_at IS NOT NULL) ORDER BY l.kind, l.created_at)
                          FROM hlt_seller_licenses l WHERE l.seller_id = s.id), '[]'::json) AS licenses
         FROM hlt_sellers s WHERE ${where}`, args);
  }

  /** 내 입점 — 켜짐 · 본인확인 · 약관 동의 · 신청 상태 */
  async mine() {
    const [a] = await this.db.query<{ iv: boolean }>(
      `SELECT identity_verified_at IS NOT NULL AS iv FROM accounts WHERE id = $1`, [this.me]);
    const [s] = await this.sellerRow(`s.account_id = $1 AND s.type IN ('TENANT', 'BRAND')`, [this.me]);
    return { enabled: await this.on(), identityVerified: !!a?.iv, consent: await this.consented(), seller: s ?? null };
  }

  /** 입점 신청 — 처음이거나 심사 중 · 반려면 고쳐서 다시(서류는 새로 받은 것으로 바꿈) */
  async apply(d: SellerApply) {
    if (!(await this.on())) throw new PolicyViolation('TENANT_OFF', '소개몰 입점 신청이 아직 열리지 않았습니다.');
    const m = await this.mine();
    if (!m.identityVerified) throw new PolicyViolation('IDENTITY_REQUIRED', '본인확인을 마친 뒤 입점을 신청할 수 있습니다.');
    const cur = m.seller as { id: string; status: string } | null;
    if (cur && ['ACTIVE', 'PAUSED'].includes(cur.status)) {
      throw new StateConflict('SELLER_EXISTS', '이미 입점한 판매자입니다 — 정보 변경은 판매자센터에서 합니다.');
    }
    if (cur?.status === 'BLOCKED') throw new StateConflict('SELLER_BLOCKED', '이용이 제한된 판매자는 다시 신청할 수 없습니다 — 고객센터로 문의해 주십시오.');
    if (!m.consent) throw new PolicyViolation('TENANT_CONSENT_REQUIRED', '소개몰 입점(판매자) 이용약관에 동의한 뒤 신청할 수 있습니다.');
    const biz = d.personal ? null : (d.bizRegNo ?? '').trim();
    if (!d.personal && !biz) throw new PolicyViolation('BIZ_REG_REQUIRED', '사업자 판매자는 사업자등록번호를 적어 주십시오.');
    const lic = d.licenses ?? [];
    if (d.type === 'BRAND' && !lic.some((l) => l.kind === 'BRAND_RIGHT')) {
      throw new PolicyViolation('BRAND_PROOF_REQUIRED', '브랜드 직영관은 브랜드 권리 증빙을 함께 내야 합니다.');
    }

    return this.db.transaction(async () => {
      let id = cur?.id;
      const vals = [d.type, d.name.trim(), d.personal, biz, d.ceoName.trim(), d.ecomRegNo?.trim() || null,
        d.csTel.trim(), d.returnAddr.trim(), d.addr?.trim() || null];
      if (id) {
        await this.db.query(
          `UPDATE hlt_sellers SET type = $2, name = $3, personal = $4, biz_reg_no = $5, ceo_name = $6, ecom_reg_no = $7,
                  cs_tel = $8, return_addr = $9, addr = $10, status = 'PENDING', applied_at = now(),
                  reject_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, status_reason = NULL, updated_at = now()
            WHERE id = $1`, [id, ...vals]);
        await this.db.query(`DELETE FROM hlt_seller_licenses WHERE seller_id = $1`, [id]);
      } else {
        const [r] = await this.db.query<{ id: string }>(
          `INSERT INTO hlt_sellers (code, account_id, type, name, personal, biz_reg_no, ceo_name, ecom_reg_no, cs_tel, return_addr, addr,
                                    status, applied_at)
           VALUES ('TN-' || lpad(nextval('hlt_seller_code_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', now())
           RETURNING id`, [this.me, ...vals]);
        id = r!.id;
      }
      for (const l of lic) {
        await this.db.query(
          `INSERT INTO hlt_seller_licenses (seller_id, kind, license_no, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
          [id, l.kind, l.licenseNo.trim(), l.issuedAt || null, l.expiresAt || null]);
      }
      return this.mine();
    });
  }

  /* ── 운영 ─────────────────────────────────────────────────────────── */

  /** 입점 신청 — 심사 대기(오래된 것부터) · 최근 반려 30건 */
  async applications() {
    const rows = await this.sellerRow(
      `s.type IN ('TENANT', 'BRAND') AND (s.status = 'PENDING' OR (s.status = 'REJECTED' AND s.reviewed_at > now() - interval '90 days'))
       ORDER BY (s.status = 'PENDING') DESC, s.applied_at`, []);
    const ids = rows.map((r: any) => r.id);
    const who = ids.length ? await this.db.query<{ id: string; accountName: string; accountEmail: string; identityVerified: boolean }>(
      `SELECT s.id, a.name AS "accountName", a.email AS "accountEmail", a.identity_verified_at IS NOT NULL AS "identityVerified"
         FROM hlt_sellers s JOIN accounts a ON a.id = s.account_id WHERE s.id = ANY($1::uuid[])`, [ids]) : [];
    const by = new Map(who.map((w) => [w.id, w]));
    return rows.slice(0, 200).map((r: any) => ({ ...r, ...(by.get(r.id) ?? {}) }));
  }

  /** v10.222 (D192) — 입점 심사 결과를 신청자에게 알림(사이트 안 · 메일은 notify_dispatch 가) */
  private async notifySeller(id: string, code: string, title: string, body: string, link: string) {
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT account_id, $2, $3, $4, $5 FROM hlt_sellers WHERE id = $1`, [id, code, title, body, link]);
  }

  private async pending(id: string) {
    const [s] = await this.db.query<{ status: string; type: string }>(
      `SELECT status, type FROM hlt_sellers WHERE id = $1 FOR UPDATE`, [id]);
    if (!s || !['TENANT', 'BRAND'].includes(s.type)) throw new NotFound('입점 신청을 찾을 수 없습니다.');
    if (s.status !== 'PENDING') throw new StateConflict('NOT_PENDING', '심사 대기 중인 신청이 아닙니다.');
  }

  /** 입점 승인 — 서류를 확인한 것으로 남김 · 수수료율은 비우면 갈래 기본값(fn_hlt_rate_for) */
  async approve(id: string, commissionRate?: number | null) {
    return this.db.transaction(async () => {
      await this.pending(id);
      await this.db.query(
        `UPDATE hlt_sellers SET status = 'ACTIVE', reviewed_by = $2, reviewed_at = now(), reject_reason = NULL,
                commission_rate = $3, updated_at = now() WHERE id = $1`,
        [id, this.me, commissionRate ?? null]);
      await this.db.query(
        `UPDATE hlt_seller_licenses SET verified_by = $2, verified_at = now() WHERE seller_id = $1 AND verified_at IS NULL`, [id, this.me]);
      await this.notifySeller(id, 'SELLER_APPROVED', '소개몰 입점이 승인되었습니다',
        '판매자센터에서 배송 · 상품을 등록할 수 있습니다.', '/health/seller/center');
      return { ok: true, status: 'ACTIVE' };
    });
  }

  /** 입점 반려 — 사유는 신청자에게 그대로 보임 */
  async reject(id: string, reason: string) {
    const why = (reason ?? '').trim();
    if (why.length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오 — 신청자에게 그대로 보입니다.');
    return this.db.transaction(async () => {
      await this.pending(id);
      await this.db.query(
        `UPDATE hlt_sellers SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), reject_reason = $3, updated_at = now()
          WHERE id = $1`, [id, this.me, why]);
      await this.notifySeller(id, 'SELLER_REJECTED', '소개몰 입점 신청이 반려되었습니다',
        `사유: ${why} — 고쳐서 다시 신청하실 수 있습니다.`, '/health/seller');
      return { ok: true, status: 'REJECTED' };
    });
  }

  /**
   * v10.229 (docs/367) — 운영 「소개몰 판매자」 탭 맨 위 입점 열기 준비 점검(읽기만 · 스위치를 막는 규칙은 그대로 — 약관 먼저 하나)
   *   신청 받기(mall.tenant_apply): 입점 약관(HLT_SELLER)이 지금 판인지 · 초안 빈칸
   *   판매 열기(mall.tenant): 결제 실연동(결제 키 · 간주 모드 꺼짐) · 하위가맹점 · 지급대행 연동 · 주문 받기 · 승인 판매자 · 하위가맹점 번호 · 업종 정정신고(대표 확인)
   */
  async readiness() {
    const [r] = await this.db.query<{ apply: string; sale: string; order: boolean; assume: boolean; cur: string | null;
      drafts: Array<{ version: string; body: string }> | null; active: number; withSub: number; pending: number }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant_apply'), 'off') AS apply,
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant'), 'off') AS sale,
              (${ORDER_OPEN_SQL}) AS "order",
              coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'off') = 'on' AS assume,
              (SELECT version FROM v_terms_current WHERE code = 'HLT_SELLER' LIMIT 1) AS cur,
              (SELECT json_agg(json_build_object('version', version, 'body', coalesce(body, '')) ORDER BY version DESC)
                 FROM terms WHERE code = 'HLT_SELLER' AND status IN ('DRAFT', 'LEGAL_REVIEW')) AS drafts,
              (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE') AS active,
              (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND submerchant_id IS NOT NULL
                  AND submerchant_id NOT LIKE 'STUB-%') AS "withSub",
              (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'PENDING') AS pending`);
    const draft = r?.drafts?.[0];
    const holes = draft ? [...new Set(draft.body.match(HOLE) ?? [])].filter((h) => h !== '〔시행일〕').length : 0;
    const termsOk = !!r?.cur;
    const payKey = !!process.env.TOSS_SECRET_KEY;
    const payOk = payKey && !r?.assume;
    const sub = resolveSubmerchantProvider(!!r?.assume);
    const subOk = !!sub && !sub.stub;
    const rows: TenantReadyRow[] = [
      { key: 'terms', group: 'apply', label: '입점 약관(HLT_SELLER)', state: termsOk ? 'ok' : 'todo',
        now: termsOk ? `${r?.cur} 지금 판 — 신청자가 동의할 수 있음`
          : draft ? `${draft.version} 초안 · 빈칸 ${holes}곳 — 법무 확인 · 빈칸 채운 뒤 약관 화면에서 게시` : '약관 없음 — 약관 화면에서 만들고 게시' },
      { key: 'apply-switch', group: 'apply', label: '신청 받기 스위치', state: 'info',
        now: `${r?.apply === 'on' ? '켜짐' : '꺼짐'} · 심사 기다림 ${r?.pending ?? 0}건` },
      { key: 'payment', group: 'sale', label: '결제 실연동', state: payOk ? 'ok' : 'todo',
        now: payOk ? '결제대행사 키 있음 · 간주 모드 꺼짐'
          : `${payKey ? '결제대행사 키 있음' : '결제대행사 키 없음(시험 결제)'} · 간주 모드 ${r?.assume ? '켜짐 — 끄려면 외부 연동 마친 뒤' : '꺼짐'}` },
      { key: 'submerchant', group: 'sale', label: '하위가맹점 · 지급대행 연동', state: subOk ? 'ok' : 'todo',
        now: subOk ? `${sub!.name} 연동됨` : sub?.stub ? '시험 공급자(간주 모드) — 돈은 움직이지 않음 · 결제대행사 계약 뒤 연동 개발' : '연동 전 — 결제대행사 하위가맹점 · 지급대행 계약 뒤 연동 개발' },
      { key: 'order', group: 'sale', label: '주문 받기', state: r?.order ? 'ok' : 'todo',
        now: r?.order ? '켜짐' : '꺼짐 — 결제 실연동 뒤 「주문 받기 켜기」(SUPER)' },
      { key: 'sellers', group: 'sale', label: '승인된 판매자', state: (r?.active ?? 0) > 0 ? 'ok' : 'todo',
        now: `${r?.active ?? 0}명 · 하위가맹점 번호 있음 ${r?.withSub ?? 0}명(시험 번호 뺌)` },
      { key: 'biz-report', group: 'sale', label: '업종 정정신고(통신판매중개)', state: 'todo',
        now: '대표 확인 — 기록할 곳이 없어 늘 확인 줄로 보임' },
      { key: 'sale-switch', group: 'sale', label: '판매 열기 스위치', state: 'info', now: r?.sale === 'on' ? '켜짐' : '꺼짐' },
    ];
    const ready = (g: 'apply' | 'sale') => rows.filter((x) => (g === 'apply' ? x.group === 'apply' : true) && x.state === 'todo' && x.key !== 'biz-report').length === 0;
    return { applyReady: ready('apply'), saleReady: ready('sale'), applyOn: r?.apply === 'on', saleOn: r?.sale === 'on', rows };
  }

}
