import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { normSido } from '../../common/region';

/**
 * 법률 · 세무 월 정액 노출 (D009 · 2026-10-02 법무 회신)
 *
 * 리드를 만들지 않습니다. 소비자는 업체 정보를 보고 직접 연락합니다.
 * 노출료는 기간 정액이고, 노출 순서는 날마다 섞습니다 — 돈을 더 낸 곳을 위에 두지 않습니다.
 * 입금 확인 뒤 관리자가 기간을 켭니다(전자결제 연동 전). 자격 · 입점 판정은 DB(fn_directory_guard)가 합니다.
 *
 * ★ 20261002 — 노출 기간(DATE)은 글자(YYYY-MM-DD)로 내립니다. 날짜형 그대로 내리면 UTC 시각으로 바뀌어
 *   (10월 2일 → "2026-10-01T15:00:00Z") 화면이 앞 10글자를 잘라 **하루 이른 날짜**를 보였습니다(올린 kit v10.4.7).
 *
 * v10.33 (D092 · 2026-10-11 대표 결정) — 월 노출료 **부가세 별도**(공급가액 · 부가세 10% 1원 미만 절사 · 합계) ·
 *   기간 연장 A안(업체 연장 신청 → 운영 입금 확인 → 기존 종료일 다음 날부터 · 반려는 사유) · 입금 확인마다
 *   세금계산서 발행 요청 1줄(공급자 = 운영 법인 → 공급받는 자 = 업체 · 운영이 발행 번호를 넣음).
 *   판정 · 계산은 DB 함수(fn_directory_activate · fn_directory_renew_* · 회차 이력 consult_directory_periods)가 합니다.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }

  async publicList(code: string) {
    const [c] = await this.db.query<{ id: string; code: string; name: string; consult_mode: string }>(
      `SELECT id, code, name, consult_mode FROM categories
        WHERE gwan_code = 'MAL' AND axis = 'CONSULT' AND status = 'APPROVED' AND code = $1`, [code]);
    if (!c || c.consult_mode !== 'LISTING_FEE') throw new NotFound('정액 노출형 업종이 아닙니다.');
    const entries = await this.db.query(
      `SELECT id, display_name AS "displayName", intro, contact_phone AS "contactPhone",
              website_url AS "websiteUrl", sido
         FROM v_consult_directory_public WHERE category_id = $1
        ORDER BY md5(id::text || (now() AT TIME ZONE 'Asia/Seoul')::date::text)`, [c.id]);
    return {
      category: { code: c.code, name: c.name },
      adLabel: '광고',
      note: '노출료를 낸 업체입니다. 순서는 날마다 바뀌며 추천 순위가 아닙니다. 상담 · 수임 조건은 업체와 직접 정하십시오.',
      entries,
    };
  }

  private async myPartner() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const id = await this.actors.ownedId(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!id) throw new PolicyViolation('PARTNER_REQUIRED', '입점 신청을 먼저 해 주십시오.');
    return { id };
  }

  /** v10.33 — 내 항목 + 부가세 별도 금액(최근 입금) · 열린 연장 신청 · 회차 수 */
  async mine() {
    /* 읽기는 입점(파트너) 신청 전이어도 빈 목록입니다 — 신청(POST)만 422 PARTNER_REQUIRED 로 막습니다 */
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const pid = await this.actors.ownedId(this.me);
    if (!pid) return [];
    const p = { id: pid };
    const rows = await this.db.query<any>(
      `SELECT d.id, c.code AS "categoryCode", c.name AS "categoryName", d.display_name AS "displayName",
              d.intro, d.contact_phone AS "contactPhone", d.website_url AS "websiteUrl", d.sido, d.state,
              d.monthly_fee AS "monthlyFee", d.paid_from::text AS "paidFrom", d.paid_to::text AS "paidTo", d.reason,
              d.months, d.supply_amount AS "supplyAmount", d.vat_amount AS "vatAmount", d.total_amount AS "totalAmount",
              (SELECT count(*)::int FROM consult_directory_periods x WHERE x.entry_id = d.id) AS rounds,
              (SELECT json_build_object('id', r.id, 'months', r.months, 'monthlyFee', r.monthly_fee, 'supplyAmount', r.supply_amount,
                                        'vatAmount', r.vat_amount, 'totalAmount', r.total_amount, 'requestedAt', r.requested_at,
                                        'from', (greatest(d.paid_to, (SELECT max(x.period_to) FROM consult_directory_periods x WHERE x.entry_id = d.id)) + 1)::text,
                                        'to', fn_directory_period_to(greatest(d.paid_to, (SELECT max(x.period_to) FROM consult_directory_periods x WHERE x.entry_id = d.id)) + 1, r.months)::text)
                 FROM consult_directory_renewals r WHERE r.entry_id = d.id AND r.state = 'REQUESTED') AS renewal,
              (SELECT json_build_object('state', r.state, 'reason', r.reason, 'decidedAt', r.decided_at)
                 FROM consult_directory_renewals r WHERE r.entry_id = d.id AND r.state IN ('REJECTED','CANCELED','CONFIRMED')
                ORDER BY r.decided_at DESC LIMIT 1) AS "lastRenewal"
         FROM consult_directory_entries d JOIN categories c ON c.id = d.category_id
        WHERE d.partner_id = $1 ORDER BY c.name`, [p.id]);
    return rows.map((r) => this.money(r));
  }

  /** bigint 글자 → 숫자. 금액 칸은 원 단위 정수입니다 */
  private money<T extends Record<string, any>>(r: T): T {
    const o: any = { ...r };
    for (const k of ['monthlyFee', 'supplyAmount', 'vatAmount', 'totalAmount', 'supply', 'vat', 'total']) {
      if (o[k] != null) o[k] = Number(o[k]);
    }
    if (o.renewal) o.renewal = this.money(o.renewal);
    return o;
  }

  async apply(dto: { categoryCode: string; displayName: string; intro?: string; contactPhone: string;
                     websiteUrl?: string; sido: string }) {
    const p = await this.myPartner();
    const [c] = await this.db.query<{ id: string }>(
      `SELECT id FROM categories WHERE gwan_code = 'MAL' AND axis = 'CONSULT' AND code = $1`, [dto.categoryCode]);
    if (!c) throw new PolicyViolation('DIRECTORY_CATEGORY', '업종을 확인해 주십시오.');
    /* 반려 · 종료된 항목은 다시 심사로, 심사 중 · 노출 중인 항목은 정보만 고칩니다 */
    await this.db.query(
      `INSERT INTO consult_directory_entries (partner_id, category_id, display_name, intro, contact_phone, website_url, sido)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (partner_id, category_id) DO UPDATE
          SET display_name = EXCLUDED.display_name, intro = EXCLUDED.intro, contact_phone = EXCLUDED.contact_phone,
              website_url = EXCLUDED.website_url, sido = EXCLUDED.sido,
              state = CASE WHEN consult_directory_entries.state IN ('REJECTED','ENDED') THEN 'PENDING'
                           ELSE consult_directory_entries.state END,
              reason = CASE WHEN consult_directory_entries.state IN ('REJECTED','ENDED') THEN NULL
                            ELSE consult_directory_entries.reason END`,
      [p.id, c.id, dto.displayName.trim(), dto.intro?.trim() || null, dto.contactPhone.trim(),
       dto.websiteUrl?.trim() || null, normSido(dto.sido)]);
    return this.mine();
  }

  async admList(state?: string) {
    if (state && !['PENDING', 'ACTIVE', 'RENEW_REQUESTED', 'ENDED', 'REJECTED'].includes(state)) {
      throw new PolicyViolation('BAD_STATE', '상태 값을 확인해 주십시오.');
    }
    const rows = await this.db.query<any>(
      `SELECT d.id, c.code AS "categoryCode", c.name AS "categoryName", d.display_name AS "displayName",
              d.contact_phone AS "contactPhone", d.sido, d.state, d.monthly_fee AS "monthlyFee",
              d.paid_from::text AS "paidFrom", d.paid_to::text AS "paidTo", d.payment_ref AS "paymentRef", d.reason,
              d.months, d.supply_amount AS "supplyAmount", d.vat_amount AS "vatAmount", d.total_amount AS "totalAmount",
              b.company_name AS company, b.biz_reg_no AS "bizRegNo",
              EXISTS (SELECT 1 FROM qualification_reviews q JOIN restricted_industries r
                        ON coalesce(r.qual_code, r.code) = q.category_code
                       WHERE q.business_id = b.id AND q.state = 'APPROVED'
                         AND r.code = c.restricted_code AND r.gwan_code = c.gwan_code) AS qualified,
              (SELECT count(*)::int FROM consult_directory_periods x WHERE x.entry_id = d.id) AS rounds,
              (SELECT json_build_object('id', r.id, 'months', r.months, 'monthlyFee', r.monthly_fee, 'supplyAmount', r.supply_amount,
                                        'vatAmount', r.vat_amount, 'totalAmount', r.total_amount, 'requestedAt', r.requested_at,
                                        'from', (greatest(d.paid_to, (SELECT max(x.period_to) FROM consult_directory_periods x WHERE x.entry_id = d.id)) + 1)::text,
                                        'to', fn_directory_period_to(greatest(d.paid_to, (SELECT max(x.period_to) FROM consult_directory_periods x WHERE x.entry_id = d.id)) + 1, r.months)::text)
                 FROM consult_directory_renewals r WHERE r.entry_id = d.id AND r.state = 'REQUESTED') AS renewal,
              (d.state IN ('ACTIVE','RENEW_REQUESTED') AND d.paid_to < (now() AT TIME ZONE 'Asia/Seoul')::date) AS lapsed,
              d.created_at AS "appliedAt"
         FROM consult_directory_entries d
         JOIN categories c ON c.id = d.category_id
         JOIN partners p ON p.id = d.partner_id
         JOIN businesses b ON b.id = p.business_id
        WHERE ($1::text IS NULL OR d.state = $1)
        /* 심사 대기 · 연장 신청은 오래 기다린 것부터, 나머지는 최근 처리부터 */
        ORDER BY CASE WHEN d.state = 'PENDING' THEN d.created_at END ASC NULLS LAST,
                 coalesce(d.decided_at, d.created_at) DESC
        LIMIT 200`, [state ?? null]);
    return rows.map((r) => this.money(r));
  }

  /** 월 노출료 기준 금액 (D020 — 설정 directory.monthly_fee · 운영이 등록합니다). 설정이 비면 null */
  async baseFee(): Promise<number | null> {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT fn_directory_base_fee() AS v`);
    return r?.v != null ? Number(r.v) : null;
  }

  private uuid(id: string, what = '정액 노출 항목') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
  }

  /** DB 함수가 던지는 상태 충돌(같은 일을 다시 해도 같은 결과)은 409 로 — 나머지 정책 위반은 필터가 422 로 바꿉니다 */
  private async conflictAware<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e: any) {
      const m = /^(NOT_ACTIVATABLE|DIRECTORY_RENEW_OPEN|DIRECTORY_RENEW_STATE|DIRECTORY_RENEW_NONE|DIRECTORY_NOT_FOUND):\s*(.*)$/s.exec(String(e?.message ?? ''));
      if (m) {
        if (m[1] === 'DIRECTORY_NOT_FOUND') throw new NotFound(m[2]);
        throw new StateConflict(m[1], m[2]);
      }
      throw e;
    }
  }

  /** v10.12 화면 · 시험이 읽는 한 줄(id · 상태 · 금액 · 기간) */
  private async row(id: string) {
    const [r] = await this.db.query<any>(
      `SELECT id, state, monthly_fee AS "monthlyFee", months, supply_amount AS "supplyAmount", vat_amount AS "vatAmount",
              total_amount AS "totalAmount", paid_from::text AS "paidFrom", paid_to::text AS "paidTo",
              (SELECT count(*)::int FROM consult_directory_periods x WHERE x.entry_id = d.id) AS rounds
         FROM consult_directory_entries d WHERE id = $1`, [id]);
    return r ? this.money(r) : r;
  }

  /**
   * 입금 확인 → 처음 켜기 (v10.33)
   *   기간 = 시작일부터 개월수(1~12) — 종료일은 계산합니다(fn_directory_period_to). 옛 화면처럼 종료일을 보내면
   *   개월수와 맞아야 하고(맞는 개월수가 없으면 422), 개월수가 없으면 종료일로 개월수를 찾습니다.
   *   금액 = 월 노출료(공급가액 · 비우면 기준 금액) × 개월수 + 부가세 10%. 입금 확인 1건 = 회차 1줄 = 세금계산서 발행 요청 1줄.
   *   노출 중인 항목의 기간을 늘리는 것은 이제 연장 신청 → 연장 입금 확인(A안)입니다.
   */
  async activate(id: string, dto: { monthlyFee?: number | null; paidFrom: string; paidTo?: string; months?: number; paymentRef: string }) {
    this.uuid(id);
    if (dto.monthlyFee != null && !(Number(dto.monthlyFee) > 0)) throw new PolicyViolation('DIRECTORY_FEE', '월 노출료를 0보다 크게 적어 주십시오.');
    if (!dto.paymentRef?.trim()) throw new PolicyViolation('DIRECTORY_PAYMENT', '입금 확인 근거(입금자 · 거래번호)를 적어 주십시오.');
    const from = String(dto.paidFrom ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new PolicyViolation('DIRECTORY_PERIOD', '시작일을 확인해 주십시오.');
    let months = dto.months ?? null;
    if (dto.paidTo != null && dto.paidTo !== '') {
      const to = String(dto.paidTo).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
        throw new PolicyViolation('DIRECTORY_PERIOD', '노출 기간을 확인해 주십시오 — 종료일이 시작일보다 앞설 수 없습니다.');
      }
      const [m] = await this.db.query<{ n: number | null }>(
        `SELECT min(n)::int AS n FROM generate_series(1, 12) n WHERE fn_directory_period_to($1::date, n) = $2::date`, [from, to]);
      if (m?.n == null || (months != null && months !== m.n)) {
        const [ex] = await this.db.query<{ t: string }>(`SELECT fn_directory_period_to($1::date, $2)::text AS t`, [from, months ?? 1]);
        throw new PolicyViolation('DIRECTORY_PERIOD', `노출 기간은 개월 단위입니다 — 시작일 ${from}부터 ${months ?? 1}개월이면 종료일은 ${ex.t}입니다.`);
      }
      months = m.n;
    }
    months = months ?? 1;
    const [st] = await this.db.query<{ state: string }>(`SELECT state FROM consult_directory_entries WHERE id = $1`, [id]);
    if (!st) throw new NotFound('정액 노출 항목이 없습니다.');
    if (st.state !== 'PENDING') {
      throw new StateConflict('NOT_ACTIVATABLE', st.state === 'ACTIVE' || st.state === 'RENEW_REQUESTED'
        ? '노출 중인 항목의 기간은 업체의 연장 신청 → 연장 입금 확인으로 늘립니다.'
        : '심사 중인 항목만 켤 수 있습니다.');
    }
    await this.conflictAware(() => this.db.query(`SELECT fn_directory_activate($1, $2, $3::date, $4, $5, $6) AS id`,
      [id, dto.monthlyFee ?? null, from, months, dto.paymentRef.trim(), this.me ?? null]));
    return this.row(id);
  }

  async close(id: string, kind: 'REJECTED' | 'ENDED', reason?: string) {
    this.uuid(id);
    if ((reason ?? '').trim().length < 5) {
      throw new PolicyViolation('DIRECTORY_REASON', '사유를 5자 이상 적어 주십시오 — 업체에게 그대로 보입니다.');
    }
    /* v10.33 — 연장 신청 중(RENEW_REQUESTED)도 종료할 수 있고, 열린 연장 신청은 DB 가 닫습니다(trg_dir_close_renewal) */
    const from = kind === 'REJECTED' ? ['PENDING'] : ['ACTIVE', 'RENEW_REQUESTED', 'PENDING'];
    const [r] = await this.db.query<any>(
      `UPDATE consult_directory_entries SET state = $2, reason = $3, decided_by = $4, decided_at = now()
        WHERE id = $1 AND state = ANY($5::text[]) RETURNING id, state, reason`,
      [id, kind, reason!.trim(), this.me ?? null, from]);
    if (!r) throw new StateConflict('NOT_CLOSABLE', kind === 'REJECTED' ? '심사 중인 항목만 반려할 수 있습니다.' : '노출 중인 항목만 끝낼 수 있습니다.');
    return r;
  }

  /* ── v10.33 기간 연장 A안 ─────────────────────────────────────────── */

  /** 업체 — 연장 신청(개월수). 내 항목만 · 노출 중(ACTIVE)일 때 · 금액은 지금 기준 금액(부가세 별도) */
  async renewRequest(id: string, months: number) {
    this.uuid(id);
    const p = await this.myPartner();
    const [own] = await this.db.query<{ id: string }>(
      `SELECT id FROM consult_directory_entries WHERE id = $1 AND partner_id = $2`, [id, p.id]);
    /* 남의 항목은 있는지조차 알리지 않습니다 */
    if (!own) throw new NotFound('정액 노출 항목이 없습니다.');
    await this.conflictAware(() => this.db.query(`SELECT fn_directory_renew_request($1, $2, $3) AS id`, [id, months, this.me]));
    return this.mine();
  }

  /** 운영 — 연장 입금 확인. 새 기간 = 기존 종료일 다음 날부터 · 세금계산서 발행 요청 1줄 */
  async renewConfirm(id: string, paymentRef: string) {
    this.uuid(id);
    if (!paymentRef?.trim()) throw new PolicyViolation('DIRECTORY_PAYMENT', '입금 확인 근거(입금자 · 거래번호)를 적어 주십시오.');
    await this.conflictAware(() => this.db.query(`SELECT fn_directory_renew_confirm($1, $2, $3) AS id`, [id, paymentRef.trim(), this.me ?? null]));
    const r = await this.row(id);
    await this.notifyRenew(id, '입금 확인',
      `연장 입금(합계 ${Number(r.totalAmount).toLocaleString('ko-KR')}원 · 부가세 포함)을 확인했습니다. 노출 기간이 ${r.paidTo}까지 이어집니다. 세금계산서는 파트너센터에서 발행 내역을 보실 수 있습니다.`);
    return r;
  }

  /** 운영 — 연장 반려(사유 5자 이상 · 노출은 지금 기간까지 그대로) */
  async renewReject(id: string, reason: string) {
    this.uuid(id);
    if ((reason ?? '').trim().length < 5) {
      throw new PolicyViolation('DIRECTORY_REASON', '사유를 5자 이상 적어 주십시오 — 업체에게 그대로 보입니다.');
    }
    await this.conflictAware(() => this.db.query(`SELECT fn_directory_renew_reject($1, $2, $3) AS id`, [id, reason.trim(), this.me ?? null]));
    const r = await this.row(id);
    await this.notifyRenew(id, '반려', `연장 신청을 반려했습니다 — 사유: ${reason.trim()} · 지금 노출은 ${r.paidTo}까지 그대로입니다.`);
    return { ...r, reason: reason.trim() };
  }

  private async notifyRenew(id: string, result: string, detail: string) {
    await this.db.query(
      `SELECT fn_notify(b.account_id, 'DIRECTORY_RENEW_DECIDED',
                        jsonb_build_object('name', d.display_name, 'category', c.name, 'result', $2::text, 'detail', $3::text),
                        '/partner/listings')
         FROM consult_directory_entries d JOIN categories c ON c.id = d.category_id
         JOIN partners p ON p.id = d.partner_id JOIN businesses b ON b.id = p.business_id
        WHERE d.id = $1`, [id, result, detail]).catch(() => undefined);
  }

  /** 운영 — 한 항목의 회차 이력 · 연장 신청 이력 · 세금계산서 줄 */
  async admHistory(id: string) {
    this.uuid(id);
    const [periods, renewals, invoices] = await Promise.all([
      this.db.query<any>(
        `SELECT id, seq, kind, period_from::text AS "from", period_to::text AS "to", months, monthly_fee AS "monthlyFee",
                supply_amount AS "supplyAmount", vat_amount AS "vatAmount", total_amount AS "totalAmount",
                payment_ref AS "paymentRef", confirmed_at AS "confirmedAt"
           FROM consult_directory_periods WHERE entry_id = $1 ORDER BY seq`, [id]),
      this.db.query<any>(
        `SELECT id, months, monthly_fee AS "monthlyFee", supply_amount AS "supplyAmount", vat_amount AS "vatAmount",
                total_amount AS "totalAmount", state, reason, payment_ref AS "paymentRef",
                requested_at AS "requestedAt", decided_at AS "decidedAt"
           FROM consult_directory_renewals WHERE entry_id = $1 ORDER BY requested_at DESC`, [id]),
      this.db.query<any>(
        `SELECT i.id, p.seq, i.supply, i.vat, i.total, i.state, i.invoice_no AS "invoiceNo", i.issued_on::text AS "issuedOn",
                i.etax_mode AS "etaxMode", i.etax_status AS "etaxStatus" /* v10.34 */
           FROM consult_directory_invoices i JOIN consult_directory_periods p ON p.id = i.period_id
          WHERE i.entry_id = $1 ORDER BY p.seq`, [id]),
    ]);
    return { periods: periods.map((r) => this.money(r)), renewals: renewals.map((r) => this.money(r)), invoices: invoices.map((r) => this.money(r)) };
  }

  /* ── v10.33 세금계산서(입금 확인마다 1건 · 공급자 = 운영 법인) ───────────── */

  private invoiceSelect = `
    SELECT i.id, i.state, i.supply, i.vat, i.total, i.invoice_no AS "invoiceNo", i.issued_on::text AS "issuedOn",
           i.supplier_name AS "supplierName", i.supplier_biz_no AS "supplierBizNo",
           i.buyer_name AS "buyerName", i.buyer_biz_no AS "buyerBizNo", i.created_at AS "requestedAt",
           p.seq, p.kind, p.period_from::text AS "from", p.period_to::text AS "to", p.months,
           d.display_name AS "displayName", c.name AS "categoryName",
           /* v10.34 (D093) 국세청 전송 — 발행 방식 · 전송 상태 · 승인번호(8-8-8) · 실패 사유 · 시도 · 시각 */
           i.etax_mode AS "etaxMode", i.etax_status AS "etaxStatus", (i.etax_status = 'ASSUMED') AS assumed,
           CASE WHEN i.etax_approval_no IS NOT NULL THEN substr(i.etax_approval_no,1,8)||'-'||substr(i.etax_approval_no,9,8)||'-'||substr(i.etax_approval_no,17,8) END AS "approvalNo",
           i.etax_doc_key AS "docKey", i.etax_error AS "etaxError", i.etax_attempts AS attempts, i.etax_adapter AS adapter, i.etax_sent_at AS "sentAt", i.etax_result_at AS "resultAt"
      FROM consult_directory_invoices i
      JOIN consult_directory_periods p ON p.id = i.period_id
      JOIN consult_directory_entries d ON d.id = i.entry_id
      JOIN categories c ON c.id = d.category_id`;

  /** 업체 — 내 발행 내역(번호 · 일자 · 금액) */
  async myInvoices() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    /* v10.34 — 업체에는 발행됨 · 승인번호만. 번호 칸 = 국세청 승인번호(있으면) · 손으로 넣은 번호.
       간주 발행의 내부 번호(「간주-…」)는 승인번호로 오해할 수 있어 싣지 않습니다(화면: 「전송 대기 — 연동 전」) */
    const rows = await this.db.query<any>(
      `${this.invoiceSelect}
        WHERE i.partner_id IN (SELECT p2.id FROM partners p2 JOIN businesses b ON b.id = p2.business_id WHERE b.account_id = $1)
        ORDER BY i.created_at DESC LIMIT 100`, [this.me]);
    return rows.map(({ docKey: _k, etaxError: _e, attempts: _a, adapter: _d, sentAt: _s, resultAt: _r, ...r }) => this.money({ ...r, invoiceNo: r.approvalNo ?? (r.etaxMode === 'ASSUMED' ? null : r.invoiceNo) }));
  }

  /** 운영 — 발행 요청 목록 */
  async admInvoices(state?: string) {
    if (state && !['REQUESTED', 'ISSUED'].includes(state)) throw new PolicyViolation('BAD_STATE', '상태 값을 확인해 주십시오.');
    const rows = await this.db.query<any>(
      `${this.invoiceSelect}
        WHERE ($1::text IS NULL OR i.state = $1)
        ORDER BY CASE WHEN i.state = 'REQUESTED' THEN i.created_at END ASC NULLS LAST, i.created_at DESC LIMIT 300`, [state ?? null]);
    return rows.map((r) => this.money(r));
  }

  /** 운영 — 발행 번호 · 발행일을 넣어 「발행됨」(국세청 전송 연동 전 임시 방식 · v10.34 etax_mode MANUAL — 간주 · 전송과 구분) */
  async admIssueInvoice(id: string, dto: { invoiceNo: string; issuedOn: string }) {
    this.uuid(id, '세금계산서 발행 요청');
    if (!dto.invoiceNo?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dto.issuedOn ?? '')) {
      throw new PolicyViolation('BAD_INVOICE', '발행 번호와 발행일(YYYY-MM-DD)을 넣어 주십시오.');
    }
    const [dup] = await this.db.query<{ id: string }>(`SELECT id FROM consult_directory_invoices WHERE invoice_no = $1 AND id <> $2`, [dto.invoiceNo.trim(), id]);
    if (dup) throw new StateConflict('INVOICE_NO_TAKEN', '이미 쓰인 발행 번호입니다.');
    const [r] = await this.db.query<any>(
      `UPDATE consult_directory_invoices SET state = 'ISSUED', invoice_no = $2, issued_on = $3::date, issued_by = $4, issued_at = now(), etax_mode = 'MANUAL'
        WHERE id = $1 AND state = 'REQUESTED' AND etax_status IS NULL RETURNING id, state, invoice_no AS "invoiceNo", issued_on::text AS "issuedOn", etax_mode AS "etaxMode"`,
      [id, dto.invoiceNo.trim(), dto.issuedOn, this.me ?? null]);
    if (!r) {
      /* v10.34 — 업체로 보내는 중이거나 보낸 뒤 실패한 줄에 손으로 번호를 넣으면 중복 발행이 될 수 있습니다 */
      const [e] = await this.db.query<{ etax_status: string | null }>(`SELECT etax_status FROM consult_directory_invoices WHERE id = $1 AND state = 'REQUESTED'`, [id]);
      if (e?.etax_status) throw new StateConflict('ETAX_IN_PROGRESS', '국세청 전송을 시작한 줄입니다 — 「다시 보내기」 · 「상태 조회」로 처리하십시오(손으로 번호를 넣으면 중복 발행).');
      throw new StateConflict('NOT_REQUESTED', '발행 요청 상태가 아닙니다(이미 발행됐거나 없는 줄).');
    }
    return r;
  }
}
