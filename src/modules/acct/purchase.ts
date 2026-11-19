import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Line, Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.392 (D245 · docs/529) 매입 관리
 *   매입 세금계산서 · 카드 · 현금영수증 · 간이영수증(공제 안 됨)을 운영 화면에서 넣고(SUPER · PAYOUT),
 *   전표(PURCHASE)는 정기 작업 acct_journal 이 만듭니다 — 차변 비용(또는 자산) 공급가 · 부가세대급금(공제일 때) / 대변 보통예금 · 미지급금 · 미지급금(법인카드).
 *   불공제(간이영수증 · 기업업무추진비 · 직접 고른 불공제)는 부가세까지 비용(또는 자산)에 넣습니다.
 *   넣은 줄은 금액 · 날짜를 고치지 않습니다(DB 가 막음) — 틀리면 「취소」(사유) 뒤 다시 넣음 → 반대 전표(PURCHASE_CANCEL).
 *   증빙 파일은 POST /files(ACCT_EVIDENCE · JPG · PNG · PDF · 10MB) 로 올린 id 를 5개까지 붙입니다.
 *   신고 자료 매입 쪽 — purchaseVat(분기): 공제 · 불공제 · 종류별 · 세금계산서 공급자(사업자번호)별 합계.
 *   공제 여부 · 계정 고르기는 초안 — 세무사 확인.
 * ------------------------------------------------------------------- */

export const PURCHASE_KINDS = ['TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE'] as const;
export type PurchaseKind = typeof PURCHASE_KINDS[number];
export const PURCHASE_KIND_KO: Record<PurchaseKind, string> = { TAX_INVOICE: '매입 세금계산서', CARD: '카드', CASH: '현금영수증', SIMPLE: '간이영수증' };
export const PAY_ROLES = ['CASH', 'AP', 'CARD_AP'] as const;
export const PAY_KO: Record<string, string> = { CASH: '보통예금(바로 냄)', AP: '미지급금(나중에 냄)', CARD_AP: '미지급금(법인카드)' };
/** 계정 고르기에서 빼는 것 — 돈 · 받을 돈 · 부가세 계정 */
const NOT_COST = ['CASH', 'PG_RECV', 'AR', 'VAT_IN'];
export const PURCHASE_MAX_FILES = 5;

const n = (v: unknown) => Number(v ?? 0);
/** 'YYYY-n' → [시작, 끝) — acct-reports 의 quarterRange 와 같음(그 파일은 journal 을 읽어 돌아 읽기가 생기므로 따로 둠) */
function quarterRange(q?: string) {
  let y: number, k: number;
  const m = /^(\d{4})-([1-4])$/.exec(q ?? '');
  if (m) { y = Number(m[1]); k = Number(m[2]); }
  else if (q) return null;
  else { const d = new Date(Date.now() + 9 * 3600e3); y = d.getUTCFullYear(); k = Math.floor(d.getUTCMonth() / 3) + 1; }
  const from = `${y}-${String(k * 3 - 2).padStart(2, '0')}-01`;
  const to = k === 4 ? `${y + 1}-01-01` : `${y}-${String(k * 3 + 1).padStart(2, '0')}-01`;
  return { q: `${y}-${k}`, from, to };
}
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export interface PurchaseInput {
  kind: string; issuedOn: string; supplierName: string; supplierBizNo?: string; item: string;
  supply: number; vat?: number; deductible?: boolean; accountRole: string; payRole: string; memo?: string; attachments?: string[]; force?: boolean;
  requisitionId?: string;   // v10.417 (D251) 붙일 품의(승인 · 쓰는 중) — 한도는 DB 가 지킴(REQ_OVER)
}

/** 입력 검사(DB 도 다시 봄) — 고친 값 돌려줌 */
async function check(db: DatabaseService, b: PurchaseInput) {
  if (!(PURCHASE_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('PURCHASE_KIND', '매입 종류를 고르십시오.');
  const kind = b.kind as PurchaseKind;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.issuedOn ?? '') || Number.isNaN(Date.parse(b.issuedOn))) throw new PolicyViolation('PURCHASE_DATE', '발행일(YYYY-MM-DD)을 넣으십시오.');
  if (b.issuedOn > kstToday()) throw new PolicyViolation('PURCHASE_DATE', '앞날 발행일은 넣지 않습니다.');
  const supplier = (b.supplierName ?? '').replace(/\s+/g, ' ').trim();
  if (supplier.length < 1 || supplier.length > 120) throw new PolicyViolation('PURCHASE_SUPPLIER', '공급자 이름은 1 ~ 120자입니다.');
  const bizNo = (b.supplierBizNo ?? '').replace(/[^0-9]/g, '');
  if (bizNo && bizNo.length !== 10) throw new PolicyViolation('PURCHASE_BIZNO', '사업자등록번호는 숫자 10자리입니다.');
  if (kind === 'TAX_INVOICE' && !bizNo) throw new PolicyViolation('PURCHASE_BIZNO', '매입 세금계산서는 공급자 사업자등록번호가 있어야 합니다.');
  const item = (b.item ?? '').trim();
  if (item.length < 1 || item.length > 120) throw new PolicyViolation('PURCHASE_ITEM', '품목은 1 ~ 120자입니다.');
  const supply = Math.round(n(b.supply)), vat = kind === 'SIMPLE' ? 0 : Math.round(n(b.vat));
  if (!Number.isFinite(supply) || supply <= 0 || supply > 10_000_000_000) throw new PolicyViolation('PURCHASE_AMOUNT', '공급가는 1원 ~ 100억 원입니다.');
  if (!Number.isFinite(vat) || vat < 0 || vat > supply) throw new PolicyViolation('PURCHASE_AMOUNT', '부가세는 0원 ~ 공급가입니다.');
  if (kind === 'SIMPLE' && n(b.vat) > 0) throw new PolicyViolation('PURCHASE_SIMPLE_VAT', '간이영수증은 부가세를 따로 적지 않습니다(합계를 공급가에).');
  const [acc] = await db.query<{ role: string; kind: string; name: string }>(`SELECT role, kind, name FROM acct_accounts WHERE role = $1`, [b.accountRole]);
  if (!acc || !['EXPENSE', 'ASSET'].includes(acc.kind) || NOT_COST.includes(acc.role)) throw new PolicyViolation('PURCHASE_ACCOUNT', '비용 또는 자산 계정을 고르십시오.');
  if (!(PAY_ROLES as readonly string[]).includes(b.payRole)) throw new PolicyViolation('PURCHASE_PAY', '낸 방법(보통예금 · 미지급금 · 법인카드)을 고르십시오.');
  if (kind === 'CARD' && b.payRole === 'AP') throw new PolicyViolation('PURCHASE_PAY', '카드 매입은 보통예금 또는 법인카드로 고르십시오.');
  /* 공제 — 간이영수증 · 기업업무추진비 · 부가세 0 은 언제나 불공제 */
  const deductible = kind !== 'SIMPLE' && acc.role !== 'EXP_ENTERTAIN' && vat > 0 && b.deductible !== false;
  const memo = (b.memo ?? '').trim().slice(0, 200) || null;
  const files = [...new Set((b.attachments ?? []).map(String))];
  if (files.length > PURCHASE_MAX_FILES) throw new PolicyViolation('PURCHASE_FILES', `증빙 파일은 ${PURCHASE_MAX_FILES}개까지입니다.`);
  if (files.some((f) => !/^[0-9a-f-]{36}$/i.test(f))) throw new PolicyViolation('PURCHASE_FILES', '증빙 파일 번호가 맞지 않습니다.');
  if (files.length) {
    const ok = await db.query<{ id: string }>(`SELECT id::text AS id FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'ACCT_EVIDENCE' AND status = 'READY'`, [files]);
    if (ok.length !== files.length) throw new PolicyViolation('PURCHASE_FILES', '올리기를 마친 증빙 파일(ACCT_EVIDENCE)만 붙일 수 있습니다.');
  }
  return { kind, issuedOn: b.issuedOn, supplier, bizNo: bizNo || null, item, supply, vat, deductible, accountRole: acc.role, accountName: acc.name, payRole: b.payRole, memo, files };
}

/** POST /admin/acct/purchases — 같은 공급자 · 날짜 · 합계가 이미 있으면 409(force 로 넣음) */
export async function addPurchase(db: DatabaseService, b: PurchaseInput, actor: string | null) {
  const v = await check(db, b);
  if (!b.force) {
    const [dup] = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM acct_purchases
        WHERE state = 'ACTIVE' AND kind = $1 AND issued_on = $2::date AND total = $3::bigint
          AND (CASE WHEN $4::text IS NOT NULL THEN supplier_biz_no = $4 ELSE supplier_name = $5 END) LIMIT 1`,
      [v.kind, v.issuedOn, v.supply + v.vat, v.bizNo, v.supplier]);
    if (dup) throw new StateConflict('PURCHASE_DUP', `같은 공급자 · 날짜 · 합계 매입(${dup.id}번)이 이미 있습니다 — 다른 건이면 「그래도 넣기」.`);
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_purchases (kind, issued_on, supplier_name, supplier_biz_no, item, supply, vat, total, deductible, account_role, pay_role, memo, attachments, created_by, requisition_id)
     VALUES ($1, $2::date, $3, $4, $5, $6::bigint, $7::bigint, $6::bigint + $7::bigint, $8, $9, $10, $11, $12::uuid[], $13, $14::bigint) RETURNING id::text AS id`,
    [v.kind, v.issuedOn, v.supplier, v.bizNo, v.item, v.supply, v.vat, v.deductible, v.accountRole, v.payRole, v.memo, v.files, actor,
     /^\d{1,18}$/.test(b.requisitionId ?? '') ? b.requisitionId : null]);
  return { ok: true, id: r!.id, deductible: v.deductible, total: v.supply + v.vat,
           note: '매입을 넣었습니다 — 전표는 정기 작업(매시간) 또는 「지금 전표 만들기」.' };
}

/** POST /admin/acct/purchases/{id}/cancel — 사유 · 전표가 있으면 반대 전표가 따라옴 */
export async function cancelPurchase(db: DatabaseService, id: string, reason: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 매입입니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('PURCHASE_REASON', '취소 사유는 2 ~ 200자입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM acct_purchases WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 매입입니다.');
  if (cur.state !== 'ACTIVE') throw new StateConflict('PURCHASE_STATE', '이미 취소한 매입입니다.');
  await db.query(`UPDATE acct_purchases SET state = 'CANCELED', cancel_reason = $2, canceled_by = $3, canceled_at = now() WHERE id = $1::bigint AND state = 'ACTIVE'`, [id, t, actor]);
  return { ok: true, id, note: '매입을 취소했습니다 — 전표가 있었으면 다음 전표 만들기 때 반대 전표가 생깁니다. 바른 값으로 다시 넣으십시오.' };
}

/** GET /admin/acct/purchases?ym= — 그 달(발행일) 매입 · 합계 · 고를 계정 */
export async function listPurchases(db: DatabaseService, ym: string) {
  const items = await db.query(
    `SELECT p.id::text AS id, p.kind, p.issued_on::text AS "issuedOn", p.supplier_name AS "supplierName", p.supplier_biz_no AS "supplierBizNo", p.item,
            p.supply::bigint AS supply, p.vat::bigint AS vat, p.total::bigint AS total, p.deductible, p.account_role AS "accountRole", a.name AS "accountName",
            p.pay_role AS "payRole", p.memo, p.state, p.cancel_reason AS "cancelReason", p.canceled_at AS "canceledAt", p.created_at AS "createdAt",
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'PURCHASE' AND e.source_key = p.id::text) AS "entryId",
            (SELECT coalesce(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'contentType', f.content_type, 'size', f.size_bytes) ORDER BY x.i), '[]'::json)
               FROM unnest(p.attachments) WITH ORDINALITY x(fid, i) JOIN files f ON f.id = x.fid) AS files
       FROM acct_purchases p JOIN acct_accounts a ON a.role = p.account_role
      WHERE to_char(p.issued_on, 'YYYY-MM') = $1 ORDER BY p.issued_on DESC, p.id DESC LIMIT 500`, [ym]);
  const act = items.filter((x: any) => x.state === 'ACTIVE');
  const total = act.reduce((a: any, x: any) => ({ supply: a.supply + n(x.supply), vat: a.vat + n(x.vat), deductVat: a.deductVat + (x.deductible ? n(x.vat) : 0), total: a.total + n(x.total) }),
    { supply: 0, vat: 0, deductVat: 0, total: 0 });
  const accounts = await db.query(
    `SELECT role, name, kind, ext_code AS "extCode" FROM acct_accounts WHERE kind IN ('EXPENSE', 'ASSET') AND role <> ALL($1::text[]) ORDER BY kind DESC, sort, role`, [NOT_COST]);
  return { ym, items, count: { active: act.length, canceled: items.length - act.length }, total, accounts, kinds: PURCHASE_KIND_KO, pays: PAY_KO, maxFiles: PURCHASE_MAX_FILES,
           note: '간이영수증 · 기업업무추진비는 부가세 공제가 안 됩니다(부가세까지 비용). 3만 원 넘는 지출은 적격증빙(세금계산서 · 카드 · 현금영수증)을 받으십시오. 공제 · 계정은 세무사 확인.' };
}

/** 신고 자료 매입 쪽(분기 'YYYY-n') — 취소하지 않은 매입(발행일 기준) */
export async function purchaseVat(db: DatabaseService, q?: string) {
  const r = quarterRange(q);
  if (!r) return { ok: false as const, q: q ?? '', byKind: [], bySupplier: [], total: { supply: 0, vat: 0, deductVat: 0, nonDeductVat: 0, count: 0 } };
  const byKind = (await db.query<{ kind: string; deductible: boolean; n: number; supply: string; vat: string }>(
    `SELECT kind, deductible, count(*)::int AS n, sum(supply)::text AS supply, sum(vat)::text AS vat
       FROM acct_purchases WHERE state = 'ACTIVE' AND issued_on >= $1::date AND issued_on < $2::date
      GROUP BY kind, deductible ORDER BY kind, deductible DESC`, [r.from, r.to]))
    .map((x) => ({ kind: x.kind, kindKo: PURCHASE_KIND_KO[x.kind as PurchaseKind] ?? x.kind, deductible: x.deductible, count: n(x.n), supply: n(x.supply), vat: n(x.vat) }));
  const bySupplier = (await db.query<{ biz: string; name: string; n: number; supply: string; vat: string }>(
    `SELECT supplier_biz_no AS biz, min(supplier_name) AS name, count(*)::int AS n, sum(supply)::text AS supply, sum(vat)::text AS vat
       FROM acct_purchases WHERE state = 'ACTIVE' AND kind = 'TAX_INVOICE' AND issued_on >= $1::date AND issued_on < $2::date
      GROUP BY supplier_biz_no ORDER BY sum(supply) DESC LIMIT 300`, [r.from, r.to]))
    .map((x) => ({ bizNo: x.biz, name: x.name, count: n(x.n), supply: n(x.supply), vat: n(x.vat) }));
  const total = byKind.reduce((a, x) => ({ supply: a.supply + x.supply, vat: a.vat + x.vat, deductVat: a.deductVat + (x.deductible ? x.vat : 0),
    nonDeductVat: a.nonDeductVat + (x.deductible ? 0 : x.vat), count: a.count + x.count }), { supply: 0, vat: 0, deductVat: 0, nonDeductVat: 0, count: 0 });
  return { ok: true as const, q: r.q, from: r.from, to: r.to, byKind, bySupplier, total,
           note: '매입 관리에 넣은 것만 셈(발행일 기준 · 취소 뺌). 신고서 칸(세금계산서 수취분 · 신용카드 매출전표 등 수령명세 · 불공제)과 맞추는 것은 세무사 확인.' };
}

/* ── 전표(정기 작업 acct_journal 이 SOURCES 끝에 붙여 돎) ── */
const dr = (role: string, v: number): Line => ({ role, debit: v, credit: 0 }) as Line;
const cr = (role: string, v: number): Line => ({ role, debit: 0, credit: v }) as Line;
const EV: Record<string, 'TAX_INVOICE' | 'CARD' | 'CASH' | 'SIMPLE'> = { TAX_INVOICE: 'TAX_INVOICE', CARD: 'CARD', CASH: 'CASH', SIMPLE: 'SIMPLE' };

/** 매입 한 건 → 줄 — 공제면 공급가 + 부가세대급금, 불공제면 합계를 비용(자산)에 */
export function purchaseLines(r: { supply: unknown; vat: unknown; deductible: unknown; account_role: unknown; pay_role: unknown }): Line[] {
  const supply = n(r.supply), vat = n(r.vat), ded = r.deductible === true || r.deductible === 't';
  return ded && vat > 0
    ? [dr(String(r.account_role), supply), dr('VAT_IN', vat), cr(String(r.pay_role), supply + vat)]
    : [dr(String(r.account_role), supply + vat), cr(String(r.pay_role), supply + vat)];
}

const PSEL = `p.id::text AS key, p.supplier_name AS party, p.kind, p.item, p.supply::bigint AS supply, p.vat::bigint AS vat, p.deductible, p.account_role, p.pay_role`;
export const PURCHASE_SOURCES: Source[] = [
  {
    name: 'PURCHASE', label: '매입(비용 · 자산)',
    sql: `SELECT ${PSEL}, (p.issued_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at
            FROM acct_purchases p
           WHERE p.state = 'ACTIVE' AND (p.issued_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PURCHASE' AND e.source_key = p.id::text)
           ORDER BY p.issued_on, p.id LIMIT 500`,
    build: (r) => ({ memo: `매입 ${r.item ?? ''}`.trim(), evidence: EV[String(r.kind)] ?? 'NONE', lines: purchaseLines(r as never) }) as never,
  },
  {
    name: 'PURCHASE_CANCEL', label: '매입 취소',
    sql: `SELECT ${PSEL}, p.canceled_at AS at
            FROM acct_purchases p
           WHERE p.state = 'CANCELED' AND p.canceled_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PURCHASE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PURCHASE_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.canceled_at LIMIT 500`,
    build: (r) => ({ memo: `매입 취소 ${r.item ?? ''}`.trim(), evidence: EV[String(r.kind)] ?? 'NONE',
      lines: purchaseLines(r as never).map((l) => ({ role: l.role, debit: l.credit, credit: l.debit })) }) as never,
  },
];
