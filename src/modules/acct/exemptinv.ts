import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { assumeOn } from '../../common/integration/switches';

/* ---------------------------------------------------------------------
 * v10.477 (D266 · docs/615) 전자계산서(면세) 발행 — 대표 11/20 「㊱」
 *   면세 재화 · 용역(거래명세서 품목 tax_type EXEMPT)은 세금계산서가 아니라 「계산서」를 발행합니다(부가세 0 · 일반 원칙 · 세무사 확인).
 *   구조는 ㉒ 세금계산서 그대로 — 표 acct_tax_invoices 에 종류 EXEMPT · 발행은 EtaxService('exempt' 종류 · etax.http 가 taxType EXEMPT 로 보냄)
 *     assume.etax on(지금) → 「간주 발행」(승인번호 없음 · 번호 「간주-문서번호」) · off + 업체 연동 → 전송
 *   스위치 acct.exempt_invoice(처음 off) — off 면 요청 · 발행을 받지 않고 거래명세서 세금계산서는 전과 같이(면세 품목도 한 장)
 *                                         on 이면 거래명세서 세금계산서는 과세 · 영세 품목만(taxableShare) · 면세 품목은 여기서 전자계산서 한 장
 *   근거마다 하나(취소한 요청만 새로) · 금액 · 공급받는 자는 요청 때 고정(DB 가드 그대로) · 지우지 않음
 *   매출처별 계산서 합계(발행한 달 · 공급받는 자별) — 계산서합계표 제출 자료(세무사 확인)
 * ------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const n = (v: unknown) => Number(v ?? 0);
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const bizFmt = (b: string | null | undefined) => (/^\d{10}$/.test(b ?? '') ? `${b!.slice(0, 3)}-${b!.slice(3, 5)}-${b!.slice(5)}` : null);

export async function exemptOn(db: DatabaseService) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.exempt_invoice'`);
  return (r?.value ?? 'off') === 'on';
}

/** 거래명세서 세금계산서 금액 — 스위치 on 이면 면세 품목을 뺀 과세 · 영세 몫만(면세는 전자계산서로) · off 면 그대로 */
export async function taxableShare(db: DatabaseService, docId: string, d: { supply: unknown; vat: unknown }) {
  if (!(await exemptOn(db))) return { supply: n(d.supply), vat: n(d.vat), exempt: 0, split: false };
  const [s] = await db.query<{ tx_supply: string; tx_vat: string; ex_supply: string }>(
    `SELECT coalesce(sum(supply) FILTER (WHERE tax_type <> 'EXEMPT'), 0)::text AS tx_supply, coalesce(sum(vat) FILTER (WHERE tax_type <> 'EXEMPT'), 0)::text AS tx_vat,
            coalesce(sum(supply) FILTER (WHERE tax_type = 'EXEMPT'), 0)::text AS ex_supply
       FROM acct_sales_doc_lines WHERE doc_id::text = $1`, [docId]);
  if (n(s?.ex_supply) > 0 && n(s?.tx_supply) <= 0) {
    throw new PolicyViolation('ACCT_DOC_EXEMPT_ONLY', '면세 품목만 있는 거래명세서입니다 — 회계 › 전자계산서(면세)에서 계산서를 요청하십시오.');
  }
  return { supply: n(s?.tx_supply), vat: n(s?.tx_vat), exempt: n(s?.ex_supply), split: n(s?.ex_supply) > 0 };
}

/** GET /admin/acct/exempt-invoices?ym= — 요청할 거래명세서 · 그 달 요청 · 발행 · 매출처별 합계 */
export async function listExempt(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM.test(ymIn) ? ymIn : kstYm();
  const on = await exemptOn(db);
  const assume = await assumeOn(db, 'etax', true);
  const candidates = await db.query<any>(
    `SELECT d.id::text AS id, d.doc_no AS "docNo", d.title, p.name AS party, p.biz_no AS "bizNo", (d.accepted_at AT TIME ZONE 'Asia/Seoul')::date::text AS "acceptedOn",
            x.ex::bigint AS "exemptSupply", d.supply::bigint AS supply, d.tax_invoice_no AS "taxInvoiceNo"
       FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id
       JOIN LATERAL (SELECT sum(l.supply) AS ex FROM acct_sales_doc_lines l WHERE l.doc_id = d.id AND l.tax_type = 'EXEMPT') x ON x.ex > 0
      WHERE d.kind = 'STATEMENT' AND d.state = 'ACCEPTED' AND d.superseded_by IS NULL
        AND (d.exempt_invoice_id IS NULL OR EXISTS (SELECT 1 FROM acct_tax_invoices t WHERE t.id = d.exempt_invoice_id AND t.state = 'CANCELED'))
      ORDER BY d.accepted_at DESC LIMIT 300`);
  const items = await db.query<any>(
    `SELECT t.id::text AS id, t.source_id::text AS "docId", d.doc_no AS "docNo", t.state, t.supply::bigint AS supply, t.total::bigint AS total, t.buyer_name AS buyer,
            t.buyer_biz_no AS "buyerBizNo", t.item, t.invoice_no AS "invoiceNo", t.issued_on::text AS "issuedOn", t.etax_status AS "etaxStatus", t.etax_mode AS "etaxMode",
            t.etax_error AS "etaxError", t.cancel_reason AS "cancelReason", t.created_at AS "createdAt"
       FROM acct_tax_invoices t LEFT JOIN acct_sales_docs d ON d.id = t.source_id
      WHERE t.kind = 'EXEMPT' AND (to_char(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1 OR to_char(t.issued_on, 'YYYY-MM') = $1 OR t.state = 'REQUESTED')
      ORDER BY t.created_at DESC LIMIT 500`, [ym]);
  const byBuyer = await db.query<any>(
    `SELECT coalesce(t.buyer_biz_no, '(사업자번호 없음)') AS "bizNo", min(t.buyer_name) AS buyer, count(*)::int AS count, sum(t.supply)::bigint AS supply
       FROM acct_tax_invoices t WHERE t.kind = 'EXEMPT' AND t.state = 'ISSUED' AND to_char(t.issued_on, 'YYYY-MM') = $1
      GROUP BY 1 ORDER BY 4 DESC`, [ym]);
  const issued = items.filter((x: any) => x.state === 'ISSUED' && String(x.issuedOn ?? '').startsWith(ym));
  return {
    ym, on, assume, candidates: candidates.map((c: any) => ({ ...c, exemptSupply: n(c.exemptSupply), supply: n(c.supply), hasBizNo: /^\d{10}$/.test(c.bizNo ?? '') })),
    items: items.map((x: any) => ({ ...x, supply: n(x.supply), total: n(x.total), assumed: x.etaxStatus === 'ASSUMED' })),
    byBuyer: byBuyer.map((b: any) => ({ ...b, supply: n(b.supply) })),
    totals: { issuedCount: issued.length, issuedSupply: issued.reduce((a: number, x: any) => a + n(x.supply), 0), requested: items.filter((x: any) => x.state === 'REQUESTED').length },
    note: (on ? '' : '전자계산서 발행이 꺼져 있습니다(acct.exempt_invoice · 정책 › 전체 설정 · SUPER) — 켜기 전에는 거래명세서 세금계산서가 면세 품목까지 한 장으로 나갑니다. ')
      + (assume ? '지금은 간주 모드(assume.etax on)라 국세청에 보내지 않고 「간주-문서번호」로만 남깁니다(승인번호 없음). ' : '')
      + '면세 품목은 부가세 0 인 계산서로 따로 발행합니다 · 매출처별 합계는 계산서합계표 자료입니다(일반 원칙 · 세무사 확인).',
  };
}

/** POST /admin/acct/exempt-invoices { docId } — 확정한 거래명세서의 면세 품목 전자계산서 요청 */
export async function requestExempt(db: DatabaseService, docId: string, actor: string | null) {
  if (!(await exemptOn(db))) throw new PolicyViolation('EXEMPT_OFF', '전자계산서 발행이 꺼져 있습니다(acct.exempt_invoice) — SUPER 가 정책 › 전체 설정에서 켭니다.');
  if (!UUID.test(docId ?? '')) throw new NotFound('없는 문서입니다.');
  const [d] = await db.query<{ kind: string; state: string; superseded_by: string | null; doc_no: string; title: string; party: string; biz_no: string | null; exempt_invoice_id: string | null; inv_state: string | null; ex: string }>(
    `SELECT d.kind, d.state, d.superseded_by::text AS superseded_by, d.doc_no, d.title, p.name AS party, p.biz_no, d.exempt_invoice_id::text AS exempt_invoice_id,
            (SELECT t.state FROM acct_tax_invoices t WHERE t.id = d.exempt_invoice_id) AS inv_state,
            (SELECT coalesce(sum(l.supply), 0) FROM acct_sales_doc_lines l WHERE l.doc_id = d.id AND l.tax_type = 'EXEMPT')::text AS ex
       FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id WHERE d.id::text = $1`, [docId]);
  if (!d) throw new NotFound('없는 문서입니다.');
  if (d.kind !== 'STATEMENT' || d.state !== 'ACCEPTED' || d.superseded_by) throw new StateConflict('ACCT_DOC_STATE', '확정한 거래명세서(마지막 판)만 전자계산서를 요청합니다.');
  if (d.exempt_invoice_id && d.inv_state !== 'CANCELED') throw new StateConflict('EXEMPT_DUP', '이미 전자계산서를 요청했습니다.');
  const supply = n(d.ex);
  if (supply <= 0) throw new PolicyViolation('EXEMPT_NONE', '면세 품목이 없는 거래명세서입니다 — 세금계산서로 요청하십시오.');
  const biz = bizFmt(d.biz_no);
  return db.transaction(async () => {
    const [t] = await db.query<{ id: string }>(
      `INSERT INTO acct_tax_invoices (kind, source_id, supply, vat, total, buyer_name, buyer_biz_no, item, requested_by)
       VALUES ('EXEMPT', $1::uuid, $2::bigint, 0, $2::bigint, $3, $4, $5, $6) RETURNING id::text AS id`,
      [docId, supply, String(d.party).slice(0, 120), biz, `${d.doc_no} ${d.title} (면세)`.slice(0, 100), actor]);
    await db.query(`UPDATE acct_sales_docs SET exempt_invoice_id = $2::uuid WHERE id::text = $1`, [docId, t!.id]);
    return { ok: true, id: t!.id, docId, supply,
             note: biz ? `전자계산서(면세 ${supply.toLocaleString('ko-KR')}원)를 요청했습니다 — 「발행」을 누르면 보냅니다(간주 모드면 간주 발행).`
                       : '전자계산서를 요청했습니다 — 거래처 사업자번호가 없어 개인에게는 계산서 대신 영수증으로 갈음합니다(발행은 막힘).' };
  });
}

/** POST /admin/acct/exempt-invoices/{id}/cancel — 아직 보내지 않은 요청만 취소(보낸 뒤는 수정 발행 · 회계 › 신고 자료) */
export async function cancelExempt(db: DatabaseService, id: string, reason: string) {
  if (!UUID.test(id ?? '')) throw new NotFound('없는 전자계산서입니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(
    `UPDATE acct_tax_invoices SET state = 'CANCELED', cancel_reason = $2 WHERE id::text = $1 AND kind = 'EXEMPT' AND state = 'REQUESTED' AND etax_status IS NULL RETURNING id`, [id, t]);
  if (!r.length) {
    const [x] = await db.query<{ state: string }>(`SELECT state FROM acct_tax_invoices WHERE id::text = $1 AND kind = 'EXEMPT'`, [id]);
    if (!x) throw new NotFound('없는 전자계산서입니다.');
    throw new StateConflict('EXEMPT_STATE', '보내기 전 요청만 취소합니다(보낸 것은 수정 발행).');
  }
  return { ok: true, id, note: '전자계산서 요청을 취소했습니다 — 같은 거래명세서로 다시 요청할 수 있습니다.' };
}
