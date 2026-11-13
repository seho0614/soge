import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * 지급 데스크 (2026-10-01 결정 Q1).
 *
 * 플랫폼이 실제로 돈을 내보내는 곳은 두 군데입니다.
 *   PARTNER  제휴 파트너 수수료 (partner_settlements)
 *   HEALTH   소개몰 판매자 정산 (hlt_settlements)
 *   POINT    회원 포인트 출금 (point_cashouts · v10.219 · D190) — 회원이 신청(REQUESTED)하면 운영이 확정 · 반려
 * 소개비는 당사자 직접 지급이라 여기 없습니다(INV-11).
 *
 * 흐름   DRAFT(포인트는 REQUESTED) ──확정(ADMIN)──► CONFIRMED ──지급(PAYOUT)──► PAID
 * 확정한 사람과 지급한 사람이 같으면 DB 가 막습니다(C997 fn_payout_two_person).
 */
const TBL = {
  PARTNER: { table: 'partner_settlements', col: 'state' },
  HEALTH:  { table: 'hlt_settlements',     col: 'status' },
  POINT:   { table: 'point_cashouts',      col: 'status' },
} as const;
/** 확정할 수 있는 상태 — 정산은 DRAFT · 포인트 출금은 회원 신청(REQUESTED) */
const FROM: Record<Kind, string> = { PARTNER: 'DRAFT', HEALTH: 'DRAFT', POINT: 'REQUESTED' };
type Kind = keyof typeof TBL;

@Injectable()
export class PayoutService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  private kindOf(k: string): Kind {
    const u = k.toUpperCase();
    if (u !== 'PARTNER' && u !== 'HEALTH' && u !== 'POINT') throw new NotFound('없는 지급 종류입니다 (partner · health · point).');
    return u;
  }

  async desk() {
    const queue = await this.db.query(
      `SELECT kind, id, sub, payee, period_from AS "from", period_to AS "to",
              amount::bigint AS amount, status, confirmed_at AS "confirmedAt",
              ready, blocker, bank_name AS "bankName", account_last4 AS "last4",
              holder_name AS "holder"
         FROM v_payout_queue ORDER BY ready DESC, confirmed_at NULLS LAST, payee`);
    const drafts = await this.db.query(
      `SELECT 'PARTNER' AS kind, s.id, s.track AS sub, b.company_name AS payee,
              s.period_from AS "from", s.period_to AS "to", s.net_amount::bigint AS amount
         FROM partner_settlements s JOIN partners p ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
        WHERE s.state = 'DRAFT'
       UNION ALL
       SELECT 'HEALTH', h.id, sl.type, sl.name, h.period_from, h.period_to, h.net_amount::bigint
         FROM hlt_settlements h JOIN hlt_sellers sl ON sl.id = h.seller_id
        WHERE h.status = 'DRAFT'
       UNION ALL
       SELECT 'POINT', c.id, 'MEMBER', a.name, (c.requested_at AT TIME ZONE 'Asia/Seoul')::date, NULL::date, c.net_amount::bigint
         FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
        WHERE c.status = 'REQUESTED'
        ORDER BY 5 DESC, 4`);
    const paid = await this.db.query(
      `SELECT 'PARTNER' AS kind, s.id, b.company_name AS payee, s.net_amount::bigint AS amount,
              s.paid_at AS "paidAt", s.paid_ref AS ref, pa.name AS "paidBy"
         FROM partner_settlements s JOIN partners p ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
         LEFT JOIN accounts pa ON pa.id = s.paid_by
        WHERE s.state = 'PAID'
       UNION ALL
       SELECT 'HEALTH', h.id, sl.name, h.net_amount::bigint, h.paid_at, h.paid_ref, pa.name
         FROM hlt_settlements h JOIN hlt_sellers sl ON sl.id = h.seller_id
         LEFT JOIN accounts pa ON pa.id = h.paid_by
        WHERE h.status = 'PAID'
       UNION ALL
       SELECT 'POINT', c.id, a.name, c.net_amount::bigint, c.paid_at, c.paid_ref, pa.name
         FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
         LEFT JOIN accounts pa ON pa.id = c.paid_by
        WHERE c.status = 'PAID'
        ORDER BY 5 DESC NULLS LAST LIMIT 50`);
    /* v10.219 (D190) — 포인트 출금 기준(최소 · 원천징수율 · 비어 있으면 신청 막힘) — 바꾸기는 SUPER(운영 설정 point.cashout_*) */
    const [pointSetting] = await this.db.query<{ min: number; taxRate: string | null; taxIdOn: boolean }>(
      `SELECT coalesce(nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_min'), '')::int, 10000) AS min,
              nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '') AS "taxRate",
              coalesce((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_id'), 'off') = 'on' AS "taxIdOn"`);
    const readyAmt = (queue as Array<{ ready: boolean; amount: number }>)
      .filter((q) => q.ready).reduce((a, q) => a + Number(q.amount), 0);
    return {
      queue, drafts, paid, pointSetting,
      summary: { waiting: queue.length, ready: (queue as Array<{ ready: boolean }>).filter((q) => q.ready).length,
                 readyAmount: readyAmt, drafts: drafts.length },
      note: '확정은 운영(ADMIN), 지급은 지급 담당(PAYOUT)이 합니다. 같은 사람이 둘 다 할 수 없습니다.',
    };
  }

  /* ---------------------------------------------------------------------
   * v10.262 (docs/395) — 포인트 출금 준비 점검(읽기만 · 막지 않음)
   *   원천징수율(비면 신청 막힘) · 최소 금액 · 확정(ADMIN · SUPER)과 지급(PAYOUT · SUPER)을 서로 다른 사람이 할 수 있는지(DB 2인 원칙) ·
   *   주민등록번호 받기 · 처리방침에 출금 주민등록번호 줄(「출금」과 「주민등록번호」가 함께 있는지) · 처리 중 신청 수.
   * ------------------------------------------------------------------- */
  async pointReadiness() {
    const [st] = await this.db.query<{ min: number; rate: string | null; taxid: boolean; priv: boolean | null; req: number; conf: number }>(
      `SELECT coalesce(nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_min'), '')::int, 10000) AS min,
              nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '') AS rate,
              coalesce((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_id'), 'off') = 'on' AS taxid,
              (SELECT body LIKE '%출금%' AND body LIKE '%주민등록번호%' FROM v_terms_current WHERE code = 'PRIVACY') AS priv,
              (SELECT count(*)::int FROM point_cashouts WHERE status = 'REQUESTED') AS req,
              (SELECT count(*)::int FROM point_cashouts WHERE status = 'CONFIRMED') AS conf`);
    const people = await this.db.query<{ id: string; roles: string[] }>(
      `SELECT a.id, array_agg(r.role) AS roles FROM accounts a JOIN account_roles r ON r.account_id = a.id
        WHERE a.status = 'ACTIVE' AND r.role IN ('ADMIN', 'SUPER', 'PAYOUT') GROUP BY a.id`);
    const confirmers = people.filter((p) => p.roles.includes('ADMIN') || p.roles.includes('SUPER'));
    const payers = people.filter((p) => p.roles.includes('PAYOUT') || p.roles.includes('SUPER'));
    const twoPeople = confirmers.some((c) => payers.some((p) => p.id !== c.id));
    type Lv = 'OK' | 'WARN' | 'NO';
    const items: Array<{ key: string; level: Lv; value: string; hint: string }> = [
      { key: 'TAX_RATE', level: st?.rate ? 'OK' : 'NO', value: st?.rate ? `${st.rate}%` : '비어 있음',
        hint: st?.rate ? '신청 때 이 비율로 원천징수(신청한 뒤 바꿔도 그 신청은 그대로)' : '원천징수율이 비어 있어 회원이 출금을 신청할 수 없습니다 — 아래 「출금 기준」에서 SUPER 가 넣음' },
      { key: 'MIN', level: 'OK', value: `${(st?.min ?? 10000).toLocaleString('ko-KR')}점`, hint: '이보다 적으면 신청 못 함' },
      { key: 'TWO_PEOPLE', level: twoPeople ? 'OK' : 'NO', value: `확정할 수 있는 사람 ${confirmers.length} · 지급할 수 있는 사람 ${payers.length}`,
        hint: twoPeople ? '확정한 사람과 다른 사람이 지급할 수 있습니다(DB 2인 원칙)' : '확정과 지급을 서로 다른 사람이 해야 합니다 — 지급 담당(PAYOUT) 역할을 다른 운영자에게 주십시오' },
      { key: 'TAX_ID', level: st?.taxid ? 'OK' : 'WARN', value: st?.taxid ? '켜짐' : '꺼짐',
        hint: st?.taxid ? '등록하지 않은 회원은 출금 신청을 못 함(신고 자료에 주민등록번호)' : '주민등록번호를 받지 않음 — 지급 신고에 필요하면 처리방침 줄 게시 뒤 켬(docs/393)' },
      { key: 'PRIVACY', level: st?.priv ? 'OK' : st?.taxid ? 'NO' : 'WARN', value: st?.priv ? '있음' : '없음',
        hint: st?.priv ? '처리방침에 출금 주민등록번호 줄이 있습니다' : st?.taxid ? '주민등록번호 받기가 켜져 있는데 처리방침에 줄이 없습니다 — 끄거나 처리방침 1.1 을 게시하십시오' : '처리방침 1.1(docs/393) 게시 전 — 주민등록번호 받기를 켜기 전에 필요' },
    ];
    return {
      ready: !items.some((x) => x.level === 'NO'),
      counts: { ok: items.filter((x) => x.level === 'OK').length, warn: items.filter((x) => x.level === 'WARN').length, no: items.filter((x) => x.level === 'NO').length },
      items, open: { requested: st?.req ?? 0, confirmed: st?.conf ?? 0 },
    };
  }

  async confirm(kind: string, id: string) {
    const k = this.kindOf(kind);
    const { table, col } = TBL[k];
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ${table} SET ${col} = 'CONFIRMED', confirmed_by = $2
        WHERE id = $1 AND ${col} = $3 RETURNING id`, [id, this.me, FROM[k]]);
    if (!rows.length) throw new PolicyViolation('NOT_DRAFT', k === 'POINT'
      ? '확정할 수 있는 출금 신청이 아닙니다 (신청 상태만).' : '확정할 수 있는 정산이 아닙니다 (DRAFT 만).');
    return { ok: true, id, status: 'CONFIRMED', note: '확정했습니다. 지급은 지급 담당이 합니다.' };
  }

  async pay(kind: string, id: string, ref: string, memo?: string) {
    const k = this.kindOf(kind);
    const { table, col } = TBL[k];
    if (!ref?.trim()) throw new PolicyViolation('REF_REQUIRED', '이체 참조(은행 거래번호 등)를 적어 주십시오.');
    const memoSql = k === 'HEALTH' ? ', memo = coalesce($4, memo)' : '';
    const params = k === 'HEALTH' ? [id, this.me, ref.trim(), memo ?? null] : [id, this.me, ref.trim()];
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ${table} SET ${col} = 'PAID', paid_by = $2, paid_ref = $3 ${memoSql}
        WHERE id = $1 AND ${col} = 'CONFIRMED' RETURNING id`, params);
    if (!rows.length) throw new PolicyViolation('NOT_CONFIRMED', '지급할 수 있는 정산이 아닙니다 (확정된 것만).');
    return { ok: true, id, status: 'PAID', ref: ref.trim(), note: '지급을 기록했습니다. 되돌릴 수 없습니다 — 틀렸으면 다음 회차에서 조정하십시오.' };
  }

  /** v10.219 (D190) — 포인트 출금 반려(신청 · 확정 상태) · 사유 필수 · 반려한 포인트는 다시 출금할 수 있는 잔액으로 돌아감 */
  async reject(kind: string, id: string, reason: string) {
    if (this.kindOf(kind) !== 'POINT') throw new PolicyViolation('REJECT_POINT_ONLY', '반려는 포인트 출금만 할 수 있습니다.');
    if ((reason ?? '').trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 2자 이상 적어 주십시오.');
    const rows = await this.db.query<{ id: string }>(
      `UPDATE point_cashouts SET status = 'REJECTED', closed_by = $2, closed_reason = $3
        WHERE id = $1 AND status IN ('REQUESTED', 'CONFIRMED') RETURNING id`, [id, this.me, reason.trim()]);
    if (!rows.length) throw new PolicyViolation('NOT_OPEN', '반려할 수 있는 출금 신청이 아닙니다 (신청 · 확정 상태만).');
    return { ok: true, id, status: 'REJECTED', note: '반려했습니다. 포인트는 회원의 출금 가능 잔액으로 돌아갑니다.' };
  }

  /**
   * v10.219 (D190) — 포인트 출금 신고 자료(그달 한국 시각에 지급된 것) · CSV(엑셀용 BOM) · 소득세 · 지방소득세 따로 · 주민등록번호(등록된 경우).
   * ★ 주민등록번호 원문이 들어 있어 @Audit(응답 전체를 남김)을 쓰지 않음 — 감사 기록에는 달 · 건수만,
   *   개인정보 접속기록(audit.pii_access_logs)에 받는 사람마다 EXPORT 한 줄(월 점검 「내려받기」에 잡힘).
   */
  async pointReport(month: string) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new PolicyViolation('REPORT_MONTH', '달은 YYYY-MM 으로 적어 주십시오.');
    }
    const rows = await this.db.query<{
      accountId: string; paidAt: string; name: string; email: string; taxId: string | null; points: number; taxRate: string;
      incomeTax: number; localTax: number; withholding: number; netAmount: number; bankName: string; last4: string | null; ref: string | null;
    }>(
      `SELECT c.account_id AS "accountId", to_char(c.paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "paidAt", a.name, a.email,
              CASE WHEN t.tax_id_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.tax_id_enc, fn_enc_key()) END AS "taxId",
              c.points, c.tax_rate::text AS "taxRate", c.income_tax AS "incomeTax", c.local_tax AS "localTax", c.withholding,
              c.net_amount AS "netAmount", c.bank_name AS "bankName", c.account_last4 AS last4, c.paid_ref AS ref
         FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
         LEFT JOIN account_tax_ids t ON t.account_id = c.account_id
        WHERE c.status = 'PAID'
          AND (c.paid_at AT TIME ZONE 'Asia/Seoul') >= $1::date AND (c.paid_at AT TIME ZONE 'Asia/Seoul') < $1::date + interval '1 month'
        ORDER BY c.paid_at, a.name`, [`${month}-01`]);
    const sum = (k: 'points' | 'incomeTax' | 'localTax' | 'withholding' | 'netAmount') => rows.reduce((a, r) => a + Number(r[k]), 0);
    const total = { count: rows.length, points: sum('points'), incomeTax: sum('incomeTax'), localTax: sum('localTax'),
                    withholding: sum('withholding'), netAmount: sum('netAmount'), missingTaxId: rows.filter((r) => !r.taxId).length };
    const q = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['지급일', '이름', '이메일', '주민등록번호', '지급액', '원천징수율(%)', '소득세', '지방소득세', '원천징수 합계', '실지급액', '은행', '계좌 뒤 4자리', '이체 참조'];
    const lines = rows.map((r) => [r.paidAt, r.name, r.email, r.taxId ?? '', r.points, r.taxRate, r.incomeTax, r.localTax, r.withholding, r.netAmount, r.bankName, r.last4 ?? '', r.ref ?? ''].map(q).join(','));
    lines.push(['합계', `${total.count}건`, '', '', total.points, '', total.incomeTax, total.localTax, total.withholding, total.netAmount, '', '', ''].map(q).join(','));
    const csv = '\uFEFF' + [head.join(','), ...lines].join('\r\n') + '\r\n';
    await this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, 'PAYOUT_TAX_REPORT', 'POINT_CASHOUT', NULL, $3::jsonb, $4, $5)`,
      [this.me, RequestCtx.get()?.actorRole ?? null, JSON.stringify({ month, ...total }), RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
    for (const id of [...new Set(rows.map((r) => r.accountId))]) {
      await this.db.query(
        `INSERT INTO audit.pii_access_logs (actor_account_id, access_type, reason, ip, target_account_id, target_type)
         VALUES ($1, 'EXPORT', $2, $3, $4, 'ACCOUNT')`,
        [this.me, `포인트 출금 신고 자료 ${month}`, RequestCtx.get()?.ip ?? null, id]);
    }
    return { month, total, filename: `point-withholding-${month}.csv`, csv,
      note: total.missingTaxId ? `주민등록번호가 없는 지급이 ${total.missingTaxId}건 있습니다 — 신고 전에 따로 받아 채워 주십시오.` : `${month} 지급 ${total.count}건을 내려받았습니다.` };
  }
}
