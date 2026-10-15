import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskEmail } from '../../common/mask';

/**
 * v10.31 (w2) — 사고예방(SB-MNY-SAF-010) 「피해 사례 게시판」 · 「안전거래 이용 안내」(B-04).
 *
 * 피해 사례: 누구나 읽고, 로그인한 회원이 씁니다. 쓴 사람은 공개하지 않고(번호 · 유형 · 제목 · 지역 · 날짜 · 조회수만),
 *   본문의 전화 · 이메일 · 계좌번호는 **저장하기 전에** 가립니다(특정인 신상이 퍼지는 것을 막음). 운영이 숨길 수 있습니다.
 * 안전거래: 대금은 당사자끼리 주고받습니다(INV-11 · 플랫폼은 받지도 보관하지도 않음). 기준 금액 이상 거래에서
 *   양측이 합의하면 그 거래에 당사자 확인 · 분쟁 지원 · 기록 보존을 겁니다(deal_safe_trades).
 */
@Injectable()
export class SafetyService {
  constructor(private readonly db: DatabaseService) {}

  static mask(text: string): string {
    return text
      .replace(/01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]')
      /* 계좌번호 꼴(숫자 10~16자리 · 하이픈 섞임) */
      .replace(/\b\d{2,6}[-\s]\d{2,6}[-\s]\d{2,7}(?:[-\s]\d{1,4})?\b/g, '[번호]')
      .replace(/\b\d{10,16}\b/g, '[번호]');
  }

  async list(q: { type?: string; page?: number; limit?: number }) {
    const lim = Math.min(Math.max(Number(q.limit) || 5, 1), 30);
    const page = Math.min(Math.max(Number(q.page) || 1, 1), 1000);
    const type = q.type && q.type !== 'ALL' ? q.type : null;
    const [rows, [cnt], types] = await Promise.all([
      this.db.query(
        `SELECT s.case_no AS no, s.type_code AS type, cl.label AS "typeLabel", s.title,
                r.sido AS region, to_char(s.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date, s.view_count AS views
           FROM safety_cases s
           LEFT JOIN code_labels cl ON cl.domain = 'safety.case_type' AND cl.code = s.type_code
           LEFT JOIN regions r ON r.code = s.region_code
          WHERE s.status = 'PUBLISHED' AND ($1::text IS NULL OR s.type_code = $1)
          ORDER BY s.case_no DESC LIMIT $2 OFFSET $3`, [type, lim, (page - 1) * lim]),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM safety_cases WHERE status = 'PUBLISHED' AND ($1::text IS NULL OR type_code = $1)`, [type]),
      this.db.query(
        `SELECT code, label, sort_order AS o FROM code_labels WHERE domain = 'safety.case_type' AND is_active ORDER BY sort_order`),
    ]);
    return { items: rows, total: cnt?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((cnt?.n ?? 0) / lim)), types };
  }

  async detail(no: number) {
    if (!Number.isInteger(no) || no < 1) throw new NotFound('사례를 찾을 수 없습니다.');
    const [row] = await this.db.query(
      `UPDATE safety_cases s SET view_count = view_count + 1
        WHERE s.case_no = $1 AND s.status = 'PUBLISHED'
      RETURNING s.case_no AS no, s.type_code AS type,
                (SELECT label FROM code_labels WHERE domain = 'safety.case_type' AND code = s.type_code) AS "typeLabel",
                s.title, s.body, (SELECT sido FROM regions WHERE code = s.region_code) AS region,
                to_char(s.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date, s.view_count AS views,
                (s.author_account_id = $2::uuid) AS mine`, [no, RequestCtx.actorId() ?? null]);
    if (!row) throw new NotFound('사례를 찾을 수 없습니다.');
    return row;
  }

  async create(dto: { type: string; title: string; body: string; regionCode?: string }) {
    const me = RequestCtx.actorId()!;
    const [row] = await this.db.query<{ case_no: string }>(
      `INSERT INTO safety_cases (type_code, title, body, region_code, author_account_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING case_no`,
      [dto.type, SafetyService.mask(dto.title.trim()), SafetyService.mask(dto.body.trim()), dto.regionCode || null, me]);
    return { no: Number(row.case_no), note: '등록했습니다. 연락처 · 이메일 · 계좌번호는 가려서 저장했습니다.' };
  }

  async hide(no: number, reason: string) {
    const [row] = await this.db.query<{ case_no: string }>(
      `UPDATE safety_cases SET status = 'HIDDEN', hidden_reason = $2, hidden_by = $3
        WHERE case_no = $1 AND status = 'PUBLISHED' RETURNING case_no`, [no, reason.trim(), RequestCtx.actorId()]);
    if (!row) throw new NotFound('공개 중인 사례가 아닙니다.');
    return { ok: true };
  }

  async adminList() {
    /* 합침(v10.31 · w6 요청) — 작성자 이메일은 서버에서도 가림(src/common/mask.ts — 운영 회원 목록과 같은 모양) */
    const rows = await this.db.query<any>(
      `SELECT s.case_no AS no, s.type_code AS type, s.title, s.status, s.hidden_reason AS "hiddenReason",
              s.view_count AS views, s.created_at AS "createdAt", a.email::text AS "authorEmail"
         FROM safety_cases s JOIN accounts a ON a.id = s.author_account_id
        ORDER BY s.case_no DESC LIMIT 200`);
    return rows.map((r: any) => ({ ...r, authorEmail: maskEmail(r.authorEmail) }));
  }

  /* ── 안전거래(B-04) ── */
  async safeTradeTerms() {
    const rows = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key IN ('safe_trade.min_amount','support.hours','footer.phone')`);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      minAmount: Number(v['safe_trade.min_amount'] ?? 50000000),
      supportHours: v['support.hours'] ?? null,
      phone: v['footer.phone'] ?? null,
      items: [
        { key: 'DIRECT', title: '대금은 당사자끼리', body: '소개뱅크는 대금을 받지도 보관하지도 않습니다. 조건과 결과만 기록합니다.' },
        { key: 'VERIFY', title: '당사자 확인 절차', body: '사업자 상태조회와 서류 검증으로 신뢰도를 높입니다.' },
        { key: 'DISPUTE', title: '분쟁 발생 시 지원', body: '분쟁 조정 절차와 기록 열람을 지원합니다.' },
        { key: 'RECORD', title: '기록 보존', body: '대화 · 계약 · 정산 기록을 분쟁 근거로 보존합니다.' },
      ],
    };
  }

  private async party(dealId: string) {
    const me = RequestCtx.actorId()!;
    const [d] = await this.db.query<{ buyer: string; seller: string; status: string; amount: string | null }>(
      `SELECT d.buyer_account_id AS buyer, d.seller_account_id AS seller, d.status,
              (SELECT nullif(x.terms->>'amount','') FROM deal_contracts x
                WHERE x.deal_id = d.id AND x.state <> 'CANCELLED' AND x.terms ? 'amount' ORDER BY x.updated_at DESC LIMIT 1) AS amount
         FROM deals d WHERE d.id = $1`, [dealId]);
    if (!d) throw new NotFound('거래를 찾을 수 없습니다.');
    const side = d.buyer === me ? 'buyer' : d.seller === me ? 'seller' : null;
    if (!side) throw new Forbidden('NOT_PARTY', '이 거래의 당사자만 볼 수 있습니다.');
    return { ...d, side };
  }

  async safeTradeState(dealId: string) {
    const d = await this.party(dealId);
    const [s] = await this.db.query(
      `SELECT amount, buyer_agreed_at AS "buyerAgreedAt", seller_agreed_at AS "sellerAgreedAt", active_at AS "activeAt"
         FROM deal_safe_trades WHERE deal_id = $1`, [dealId]);
    const t = await this.safeTradeTerms();
    return { side: d.side, contractAmount: d.amount == null ? null : Number(d.amount), minAmount: t.minAmount,
      eligible: d.amount != null && Number(d.amount) >= t.minAmount, state: s ?? null };
  }

  /** 당사자 한쪽의 합의 — 금액은 계약 조건의 합의 금액(없으면 계약 조건부터) */
  async agreeSafeTrade(dealId: string) {
    const d = await this.party(dealId);
    if (['CANCELLED', 'SETTLED'].includes(d.status)) throw new StateConflict('DEAL_CLOSED', '끝난 거래에는 걸 수 없습니다.');
    if (d.amount == null) throw new PolicyViolation('SAFE_TRADE_AMOUNT', '계약 조건의 거래 금액을 먼저 합의해 주십시오.');
    const col = d.side === 'buyer' ? 'buyer_agreed_at' : 'seller_agreed_at';
    const [row] = await this.db.query(
      `INSERT INTO deal_safe_trades (deal_id, amount, ${col}) VALUES ($1, $2, now())
       ON CONFLICT (deal_id) DO UPDATE SET ${col} = coalesce(deal_safe_trades.${col}, now()), amount = EXCLUDED.amount
       RETURNING buyer_agreed_at AS "buyerAgreedAt", seller_agreed_at AS "sellerAgreedAt", active_at AS "activeAt"`,
      [dealId, Number(d.amount)]);
    const other = d.side === 'buyer' ? d.seller : d.buyer;
    await this.db.query(`SELECT fn_notify($1, 'SAFE_TRADE_AGREE', '{}'::jsonb, $2)`, [other, `/deal/${dealId}`]).catch(() => undefined);
    return row;
  }
}
