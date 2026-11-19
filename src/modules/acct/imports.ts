import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.411 (D249 · docs/548) 무역 1단계 · 수입 건 관리
 *   수입 한 건 = 거래처(v10.408) · 제목 · 통화 · 품목(직판 상품 옵션 · 수량 · 외화 금액).
 *   ORDERED 발주 → SHIPPED 선적(선적일 · B/L) → CUSTOMS 통관(통관일 · 환율 · 관세 · 수입 부가세 · 관세사 · 신고번호) → RECEIVED 입고(입고일 · 운임 · 기타 비용)
 *   (앞으로만 · 통관 전에만 취소 · DB 가 막음).
 *   입고 때 원가 = 물품(외화 × 환율) + 관세 + 운임 + 기타 비용 → 품목마다 물품 금액 비율로 나눠 ⑫ 재고 수불부 IN(source_key IMP-건-줄 · purchase_id 없음)
 *     → ⑫ 자동 전표 STOCK_IN(차변 상품 / 대변 미지급금)이 원가 전표를 만듦(여기서 따로 만들지 않음 — 겹치지 않게).
 *   수입 부가세 — 전표 IMPORT_VAT(통관일 · 차변 부가세대급금 / 대변 미지급금 · 증빙 수입세금계산서) · 원가에 넣지 않음.
 *   관세율 · 환율 · 비용은 사람이 넣음(관세사 통지 · 수입신고필증 보고) · 수출입 신고는 관세사 · 유니패스 연동 없음.
 * ------------------------------------------------------------------- */

export const IMPORT_STATES = ['ORDERED', 'SHIPPED', 'CUSTOMS', 'RECEIVED'] as const;
export const IMPORT_STATE_KO: Record<string, string> = { ORDERED: '발주', SHIPPED: '선적', CUSTOMS: '통관', RECEIVED: '입고', CANCELED: '취소' };
const n = (v: unknown) => Number(v ?? 0);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const money = (v: unknown) => {
  const x = Math.round(Number(v ?? 0));
  if (!Number.isFinite(x) || x < 0 || x > 10_000_000_000) throw new PolicyViolation('IMPORT_COST', '관세 · 수입 부가세 · 운임 · 기타 비용은 0원 ~ 100억 원입니다.');
  return x;
};

export interface ImportLineInput { optionId: string; qty: number; foreignAmount: number }
export interface ImportInput { partyId?: string; title: string; currency?: string; orderedOn: string; memo?: string; lines: ImportLineInput[] }

/** 품목 검사 — 직판 상품 옵션 · 겹치지 않음 · 1 ~ 50줄 */
async function checkLines(db: DatabaseService, lines: ImportLineInput[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) throw new PolicyViolation('IMPORT_LINES', '품목은 1 ~ 50줄입니다.');
  const ids = lines.map((l) => String(l.optionId ?? ''));
  if (ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new PolicyViolation('IMPORT_LINES', '상품 옵션 번호가 맞지 않습니다.');
  if (new Set(ids).size !== ids.length) throw new PolicyViolation('IMPORT_LINES', '같은 상품 옵션이 두 번 있습니다.');
  const ok = await db.query<{ id: string }>(
    `SELECT o.id::text AS id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id = ANY($1::uuid[])`, [ids]);
  if (ok.length !== ids.length) throw new PolicyViolation('IMPORT_LINES', '직판(소개몰 직접 판매) 상품 옵션만 넣을 수 있습니다.');
  return lines.map((l) => {
    const qty = Math.round(Number(l.qty)), fa = Math.round(Number(l.foreignAmount) * 100) / 100;
    if (!Number.isFinite(qty) || qty < 1 || qty > 1_000_000) throw new PolicyViolation('IMPORT_LINES', '수량은 1 ~ 1,000,000개입니다.');
    if (!Number.isFinite(fa) || fa < 0 || fa > 1_000_000_000) throw new PolicyViolation('IMPORT_LINES', '외화 금액이 맞지 않습니다.');
    return { optionId: String(l.optionId), qty, fa };
  });
}

/** POST /admin/acct/imports — 발주(SUPER · PAYOUT) */
export async function addImport(db: DatabaseService, b: ImportInput, actor: string | null) {
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('IMPORT_TITLE', '수입 건 제목은 2 ~ 100자입니다.');
  const currency = (b.currency ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new PolicyViolation('IMPORT_CURRENCY', '통화는 영문 대문자 3자(USD · EUR · JPY · CNY 등)입니다.');
  if (!isDay(b.orderedOn) || b.orderedOn > kstToday()) throw new PolicyViolation('IMPORT_DATE', '발주일(YYYY-MM-DD · 앞날 안 됨)을 넣으십시오.');
  if (b.partyId) {
    const [p] = /^\d{1,18}$/.test(b.partyId) ? await db.query(`SELECT 1 FROM acct_parties WHERE id = $1::bigint`, [b.partyId]) : [];
    if (!p) throw new PolicyViolation('IMPORT_PARTY', '없는 거래처입니다.');
  }
  const lines = await checkLines(db, b.lines);
  const id = await db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_imports (party_id, title, currency, ordered_on, memo, created_by) VALUES ($1::bigint, $2, $3, $4::date, $5, $6) RETURNING id::text AS id`,
      [b.partyId || null, title, currency, b.orderedOn, (b.memo ?? '').trim().slice(0, 200) || null, actor]);
    await db.query(
      `INSERT INTO acct_import_lines (import_id, option_id, qty, foreign_amount)
       SELECT $1::bigint, x.option_id, x.qty, x.fa FROM jsonb_to_recordset($2::jsonb) AS x(option_id uuid, qty int, fa numeric)`,
      [r!.id, JSON.stringify(lines.map((l) => ({ option_id: l.optionId, qty: l.qty, fa: l.fa })))]);
    return r!.id;
  });
  return { ok: true, id, note: '수입 건(발주)을 넣었습니다 — 선적 · 통관 · 입고 때 「다음 단계」로 넘기십시오.' };
}

export interface AdvanceInput {
  to: string; date: string; blNo?: string; fxRate?: number; duty?: number; importVat?: number; brokerName?: string; declNo?: string;
  freight?: number; otherCost?: number; lines?: ImportLineInput[];
}

/** POST /admin/acct/imports/{id}/advance — 한 단계씩(건너뛰기 가능 · 뒤로 안 됨) */
export async function advanceImport(db: DatabaseService, id: string, b: AdvanceInput, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 수입 건입니다.');
  const [cur] = await db.query<{ state: string; ordered_on: string; shipped_on: string | null; customs_on: string | null; fx: string | null; duty: string; freight: string; other: string; import_vat: string }>(
    `SELECT state, ordered_on::text AS ordered_on, shipped_on::text AS shipped_on, customs_on::text AS customs_on, fx_rate::text AS fx,
            duty::text AS duty, freight::text AS freight, other_cost::text AS other, import_vat::text AS import_vat FROM acct_imports WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 수입 건입니다.');
  if (cur.state === 'RECEIVED' || cur.state === 'CANCELED') throw new StateConflict('IMPORT_STATE', '입고 · 취소한 수입 건입니다.');
  const ord = IMPORT_STATES as readonly string[];
  if (!ord.includes(b.to) || ord.indexOf(b.to) <= ord.indexOf(cur.state)) throw new PolicyViolation('IMPORT_STATE', '다음 단계(선적 · 통관 · 입고)만 고를 수 있습니다.');
  if (!isDay(b.date) || b.date > kstToday() || b.date < cur.ordered_on) throw new PolicyViolation('IMPORT_DATE', '날짜는 발주일 뒤 · 오늘까지입니다.');

  if (b.to === 'SHIPPED') {
    if (b.lines) {   // 선적 때 실제 수량 · 금액으로 품목 바꾸기(선적 전까지 · 통관 뒤에는 DB 가 막음)
      const lines = await checkLines(db, b.lines);
      await db.transaction(async () => {
        await db.query(`DELETE FROM acct_import_lines WHERE import_id = $1::bigint`, [id]);
        await db.query(`INSERT INTO acct_import_lines (import_id, option_id, qty, foreign_amount) SELECT $1::bigint, x.option_id, x.qty, x.fa FROM jsonb_to_recordset($2::jsonb) AS x(option_id uuid, qty int, fa numeric)`,
          [id, JSON.stringify(lines.map((l) => ({ option_id: l.optionId, qty: l.qty, fa: l.fa })))]);
        await db.query(`UPDATE acct_imports SET state = 'SHIPPED', shipped_on = $2::date, bl_no = $3 WHERE id = $1::bigint`, [id, b.date, (b.blNo ?? '').trim().slice(0, 40) || null]);
      });
    } else {
      await db.query(`UPDATE acct_imports SET state = 'SHIPPED', shipped_on = $2::date, bl_no = $3 WHERE id = $1::bigint`, [id, b.date, (b.blNo ?? '').trim().slice(0, 40) || null]);
    }
    return { ok: true, id, state: 'SHIPPED', note: '선적으로 넘겼습니다.' };
  }

  if (b.to === 'CUSTOMS') {
    const fx = Number(b.fxRate);
    if (!Number.isFinite(fx) || fx <= 0 || fx > 100000) throw new PolicyViolation('IMPORT_FX', '환율(원 · 외화 1단위)을 넣으십시오(수입신고필증 과세환율).');
    const duty = money(b.duty), vat = money(b.importVat);
    await db.query(
      `UPDATE acct_imports SET state = 'CUSTOMS', customs_on = $2::date, shipped_on = coalesce(shipped_on, $2::date), fx_rate = $3::numeric, duty = $4::bigint, import_vat = $5::bigint,
              broker_name = $6, decl_no = $7 WHERE id = $1::bigint`,
      [id, b.date, Math.round(fx * 10000) / 10000, duty, vat, (b.brokerName ?? '').trim().slice(0, 60) || null, (b.declNo ?? '').trim().slice(0, 40) || null]);
    return { ok: true, id, state: 'CUSTOMS', note: vat > 0 ? '통관으로 넘겼습니다 — 수입 부가세 전표(부가세대급금)는 다음 전표 만들기 때 생깁니다.' : '통관으로 넘겼습니다.' };
  }

  /* RECEIVED — 통관을 먼저 거쳐야 함(환율 · 관세) */
  if (cur.state !== 'CUSTOMS' || !cur.fx) throw new PolicyViolation('IMPORT_STATE', '통관(환율 · 관세 · 수입 부가세)을 먼저 넣으십시오.');
  if (cur.customs_on && b.date < cur.customs_on) throw new PolicyViolation('IMPORT_DATE', '입고일은 통관일 뒤입니다.');
  const freight = money(b.freight ?? cur.freight), other = money(b.otherCost ?? cur.other);
  const lines = await db.query<{ id: string; option_id: string; qty: number; fa: string }>(
    `SELECT id::text AS id, option_id::text AS option_id, qty, foreign_amount::text AS fa FROM acct_import_lines WHERE import_id = $1::bigint ORDER BY id`, [id]);
  if (!lines.length) throw new PolicyViolation('IMPORT_LINES', '품목이 없습니다.');
  const fx = Number(cur.fx);
  const krw = lines.map((l) => Math.round(n(l.fa) * fx));
  const goods = krw.reduce((a, x) => a + x, 0);
  const extra = n(cur.duty) + freight + other;
  /* 덧붙는 비용은 물품 금액 비율로(물품 0 이면 수량 비율) · 끝 줄이 반올림 나머지 */
  const base = goods > 0 ? krw : lines.map((l) => l.qty);
  const baseSum = base.reduce((a, x) => a + x, 0) || 1;
  let left = extra;
  const landed = lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round(extra * base[i]! / baseSum);
    left -= share;
    return krw[i]! + share;
  });
  if (landed.some((x) => x <= 0)) throw new PolicyViolation('IMPORT_COST', '원가가 0원인 품목이 있습니다 — 외화 금액 · 비용을 확인하십시오.');
  await db.transaction(async () => {
    await db.query(`UPDATE acct_imports SET freight = $2::bigint, other_cost = $3::bigint WHERE id = $1::bigint`, [id, freight, other]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      await db.query(`UPDATE acct_import_lines SET landed_cost = $2::bigint WHERE id = $1::bigint`, [l.id, landed[i]]);
      await db.query(
        `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, note, created_by)
         VALUES ($1::uuid, $2::date, 'IN', $3::int, round($4::numeric / $3::int, 2), $5, $6, $7)`,
        [l.option_id, b.date, l.qty, landed[i], `IMP-${id}-${l.id}`, `수입 ${id}번 입고(물품 + 관세 + 운임 + 기타)`, actor]);
    }
    await db.query(`UPDATE acct_imports SET state = 'RECEIVED', received_on = $2::date, goods_krw = $3::bigint WHERE id = $1::bigint`, [id, b.date, goods]);
  });
  return { ok: true, id, state: 'RECEIVED', goodsKrw: goods, landedTotal: landed.reduce((a, x) => a + x, 0),
           note: '입고했습니다 — 재고 수불부에 원가로 들어갔고, 재고 전표(상품 / 미지급금)는 다음 전표 만들기 때 생깁니다.' };
}

/** POST /admin/acct/imports/{id}/cancel — 통관 전에만(사유) */
export async function cancelImport(db: DatabaseService, id: string, reason: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 수입 건입니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM acct_imports WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 수입 건입니다.');
  if (!['ORDERED', 'SHIPPED'].includes(cur.state)) throw new StateConflict('IMPORT_STATE', '통관 전 수입 건만 취소합니다.');
  await db.query(`UPDATE acct_imports SET state = 'CANCELED', cancel_note = $2 WHERE id = $1::bigint`, [id, t]);
  return { ok: true, id, note: '수입 건을 취소했습니다.' };
}

/** GET /admin/acct/imports?state= */
export async function listImports(db: DatabaseService, state?: string) {
  const items = await db.query(
    `SELECT i.id::text AS id, i.party_id::text AS "partyId", p.name AS "partyName", i.title, i.currency, i.fx_rate::float8 AS "fxRate",
            i.duty::bigint AS duty, i.import_vat::bigint AS "importVat", i.freight::bigint AS freight, i.other_cost::bigint AS "otherCost", i.goods_krw::bigint AS "goodsKrw",
            i.bl_no AS "blNo", i.broker_name AS "brokerName", i.decl_no AS "declNo", i.state, i.ordered_on::text AS "orderedOn", i.shipped_on::text AS "shippedOn",
            i.customs_on::text AS "customsOn", i.received_on::text AS "receivedOn", i.memo, i.cancel_note AS "cancelNote",
            (SELECT coalesce(sum(l.foreign_amount), 0)::float8 FROM acct_import_lines l WHERE l.import_id = i.id) AS "foreignTotal",
            (SELECT count(*)::int FROM acct_import_lines l WHERE l.import_id = i.id) AS lines,
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'IMPORT_VAT' AND e.source_key = i.id::text) AS "vatEntryId"
       FROM acct_imports i LEFT JOIN acct_parties p ON p.id = i.party_id
      WHERE ($1::text = '' OR i.state = $1) ORDER BY (i.state IN ('RECEIVED', 'CANCELED')), i.ordered_on DESC, i.id DESC LIMIT 300`,
    [Object.keys(IMPORT_STATE_KO).includes(state ?? '') ? state : '']);
  const options = await db.query(
    `SELECT o.id::text AS id, p.name || ' ' || coalesce(fn_hlt_option_label(o.months, o.tag), '') AS label
       FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      ORDER BY p.name, o.id LIMIT 500`);
  const open = (items as any[]).filter((x) => !['RECEIVED', 'CANCELED'].includes(x.state));
  return { items, options, states: IMPORT_STATE_KO, count: { open: open.length, customs: open.filter((x) => x.state === 'CUSTOMS').length },
           note: '수입 신고는 관세사가 합니다(유니패스 연동 없음). 환율 · 관세 · 수입 부가세는 수입신고필증을 보고 넣으십시오. 입고 원가는 물품 + 관세 + 운임 + 기타 비용이고, 수입 부가세는 부가세대급금(공제)입니다 — 세무사 확인.' };
}

/** GET /admin/acct/imports/{id} — 품목 · 원가 · 재고 수불 줄 */
export async function importDetail(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 수입 건입니다.');
  const [head] = await db.query(`SELECT id::text AS id, title, state, currency, fx_rate::float8 AS "fxRate" FROM acct_imports WHERE id = $1::bigint`, [id]);
  if (!head) throw new NotFound('없는 수입 건입니다.');
  const lines = await db.query(
    `SELECT l.id::text AS id, l.option_id::text AS "optionId", p.name || ' ' || coalesce(fn_hlt_option_label(o.months, o.tag), '') AS label, l.qty,
            l.foreign_amount::float8 AS "foreignAmount", l.landed_cost::bigint AS "landedCost",
            (SELECT m.id::text FROM acct_stock_moves m WHERE m.kind = 'IN' AND m.source_key = 'IMP-' || l.import_id || '-' || l.id) AS "moveId"
       FROM acct_import_lines l JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = o.product_id
      WHERE l.import_id = $1::bigint ORDER BY l.id`, [id]);
  return { import: head, lines };
}

/* ── 전표(sources.ts ALL_SOURCES 끝에 붙임) — 수입 부가세만(원가는 재고 STOCK_IN 이 만듦) ── */
export const IMPORT_SOURCES: Source[] = [
  {
    name: 'IMPORT_VAT', label: '수입 부가세(통관)',
    sql: `SELECT i.id::text AS key, (i.customs_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, i.import_vat::bigint AS amt, p.name AS party, i.title, i.decl_no AS no
            FROM acct_imports i LEFT JOIN acct_parties p ON p.id = i.party_id
           WHERE i.state IN ('CUSTOMS', 'RECEIVED') AND i.import_vat > 0 AND i.customs_on IS NOT NULL
             AND (i.customs_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'IMPORT_VAT' AND e.source_key = i.id::text)
           ORDER BY i.id LIMIT 500`,
    build: (r) => ({ memo: `수입 부가세 ${r.title ?? ''}${r.no ? ` (${r.no})` : ''}`.trim(), evidence: 'TAX_INVOICE',
      lines: [{ role: 'VAT_IN', debit: n(r.amt), credit: 0 }, { role: 'AP', debit: 0, credit: n(r.amt) }] }),
  },
];
