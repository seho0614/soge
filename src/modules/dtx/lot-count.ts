import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { adjustLot } from '../qlt/lots';

/* ---------------------------------------------------------------------
 * v10.537 (D282 · docs/675) 휴대폰 재고 실사 — 대표 11/20 「(52) ③」
 *   ㊶ 로트(qlt_lots)를 휴대폰 카메라로 세는 「로트 실사 회차」 + ㉟ 자산 실사는 기존 API 를 휴대폰 화면에서 그대로 부름(이 파일은 로트만)
 *
 *   열기     남은 수량이 있는 로트(정상 · 보류 · 회수)를 줄로 — 열 때 장부 수량(expected) · 한 번에 한 회차만(DB 고유 색인)
 *   읽기     카메라(BarcodeDetector) · 리더기 · 손 입력 글자 하나로 찾음:
 *              ① 로트 QR 코드  SGB-LOT-000123 · LOT-123 · 숫자만(로트 번호 id)
 *              ② 로트 번호(lot_no) 그대로 — 같은 번호가 여러 옵션에 있으면 고르게(candidates)
 *              ③ 옵션 바코드(acct_barcodes · D256) — 그 옵션 로트가 하나면 그것 · 여럿이면 고르게
 *            기본은 한 번 읽을 때 +1(add) · 수량을 보내면(counted) 그 수로 · 처음 센 때 장부 수량(book_qty)을 함께 남김
 *            열린 뒤 등록한 로트를 읽으면 줄을 더함(added_late · expected = 그때 수량)
 *   닫기     세지 않은 줄이 남으면 422 · skipUncounted 면 그 줄은 「세지 않음」으로 남기고 닫음(차이 셈에서 빠짐)
 *   조정     닫은 회차의 차이(counted − book_qty)를 SUPER 가 줄마다 — D271 adjustLot(원가 수불부 실사 조정 한 줄 + 로트 수불) · 한 번만
 * ------------------------------------------------------------------- */

export const LOT_CODE_RE = /^(?:SGB-)?LOT-?0*(\d{1,18})$/i;
const LOT_NO_RE = /^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$/;   // D271 qlt_lots.lot_no CHECK 와 같음
const BARCODE_RE = /^[0-9A-Z-]{4,32}$/;                   // D256 acct_barcodes.code CHECK 와 같음
const idOk = (s?: string) => typeof s === 'string' && /^\d{1,18}$/.test(s);
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const n = (v: unknown) => Number(v ?? 0);

/** 로트 번호 → QR 코드 글자 */
export const lotCode = (id: string | number) => `SGB-LOT-${String(id).padStart(6, '0')}`;
/** 읽은 글자가 로트 QR 모양이면 로트 id */
export function parseLotCode(raw: string): string | null {
  const t = String(raw ?? '').trim();
  const m = /^\d{1,18}$/.test(t) ? [t, t] : LOT_CODE_RE.exec(t);
  const id = m && m[1] ? m[1].replace(/^0+/, '') : '';
  return id || null;
}

export interface CntHead { id: string; title: string; state: string; note: string | null; createdAt: string; closedAt: string | null }
async function head(db: DatabaseService, id: string, lock = false): Promise<CntHead> {
  if (!idOk(id)) throw new NotFound('없는 실사 회차입니다.');
  const [h] = await db.query<CntHead>(
    lock
      ? 'SELECT id::text AS id, title, state, note, created_at AS "createdAt", closed_at AS "closedAt" FROM qlt_lot_counts WHERE id = $1::bigint FOR UPDATE'
      : 'SELECT id::text AS id, title, state, note, created_at AS "createdAt", closed_at AS "closedAt" FROM qlt_lot_counts WHERE id = $1::bigint', [id]);
  if (!h) throw new NotFound('없는 실사 회차입니다.');
  return h;
}

/** GET /admin/qlt/lot-counts — 회차 목록(열린 것 먼저) */
export async function lotCounts(db: DatabaseService) {
  const items = await db.query<Record<string, unknown>>(
    `SELECT c.id::text AS id, c.title, c.state, c.note, c.created_at AS "createdAt", c.closed_at AS "closedAt", a.email::text AS "createdBy",
            count(l.lot_id)::int AS total, count(l.lot_id) FILTER (WHERE l.counted IS NOT NULL)::int AS counted,
            count(l.lot_id) FILTER (WHERE l.counted IS NOT NULL AND l.counted <> l.book_qty)::int AS diffs,
            count(l.lot_id) FILTER (WHERE l.adjusted_at IS NOT NULL)::int AS adjusted
       FROM qlt_lot_counts c LEFT JOIN qlt_lot_count_lines l ON l.count_id = c.id LEFT JOIN accounts a ON a.id = c.created_by
      GROUP BY c.id, a.email ORDER BY (c.state = 'OPEN') DESC, c.id DESC LIMIT 50`);
  const open = items.find((x) => x.state === 'OPEN');
  const [lt] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id WHERE l.state IN ('OK', 'HOLD', 'RECALL') AND q.qty > 0`);
  return { items, openId: open ? String(open.id) : null, lotsWithStock: n(lt?.n),
           note: '회차를 열면 남은 수량이 있는 로트가 모두 「세지 않음」으로 들어갑니다. 휴대폰으로 로트 QR · 바코드를 읽거나 손으로 넣고, 닫은 뒤 차이는 SUPER 가 조정합니다.' };
}

/** POST /admin/qlt/lot-counts — 회차 열기 */
export async function openLotCount(db: DatabaseService, b: { title?: string; note?: string }, actor: string | null) {
  const title = clean(b.title, 60);
  const note = b.note ? clean(b.note, 200) || null : null;
  if (title.length < 2) throw new PolicyViolation('QLT_CNT_TITLE', '회차 이름은 2 ~ 60자입니다.');
  return db.transaction(async () => {
    const [o] = await db.query<{ id: string }>(`SELECT id::text AS id FROM qlt_lot_counts WHERE state = 'OPEN' LIMIT 1`);
    if (o) throw new StateConflict('QLT_CNT_OPEN', `열려 있는 실사(#${o.id})가 있습니다 — 그것을 닫은 뒤 여십시오.`);
    const [c] = await db.query<{ id: string }>(
      `INSERT INTO qlt_lot_counts (title, note, created_by) VALUES ($1, $2, $3::uuid) RETURNING id::text AS id`, [title, note, actor]);
    const r = await db.query(
      `INSERT INTO qlt_lot_count_lines (count_id, lot_id, expected)
       SELECT $1::bigint, l.id, q.qty FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id
        WHERE l.state IN ('OK', 'HOLD', 'RECALL') AND q.qty > 0 ORDER BY l.id RETURNING lot_id`, [c!.id]);
    if (!r.length) throw new PolicyViolation('QLT_CNT_EMPTY', '남은 수량이 있는 로트가 없습니다(소개몰 › 로트 · 유통기한).');
    return { ok: true, id: c!.id, lots: r.length, note: `로트 실사 「${title}」를 열었습니다 — 로트 ${r.length}개.` };
  });
}

/** GET /admin/qlt/lot-counts/{id} — 회차 · 줄(코드 · 로트 번호 · 상품 · 열 때 · 센 수 · 차이 · 지금 수량) */
export async function lotCountDetail(db: DatabaseService, id: string) {
  const h = await head(db, id);
  const lines = await db.query<{ lotId: string; lotNo: string; name: string; label: string; productCode: string; expiresOn: string; lotState: string;
    expected: number; counted: number | null; bookQty: number | null; nowQty: number | null; note: string | null; countedAt: string | null; countedBy: string | null;
    addedLate: boolean; adjustedAt: string | null; barcode: string | null }>(
    `SELECT x.lot_id::text AS "lotId", l.lot_no AS "lotNo", p.name, fn_hlt_option_label(o.months, o.tag) AS label, p.code AS "productCode",
            l.expires_on::text AS "expiresOn", l.state AS "lotState", x.expected, x.counted, x.book_qty AS "bookQty", q.qty AS "nowQty", x.note,
            x.counted_at AS "countedAt", a.email::text AS "countedBy", x.added_late AS "addedLate", x.adjusted_at AS "adjustedAt", b.code AS barcode
       FROM qlt_lot_count_lines x JOIN qlt_lots l ON l.id = x.lot_id JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
       LEFT JOIN v_qlt_lot_qty q ON q.lot_id = l.id LEFT JOIN accounts a ON a.id = x.counted_by LEFT JOIN acct_barcodes b ON b.option_id = l.option_id
      WHERE x.count_id = $1::bigint ORDER BY (x.counted IS NULL) DESC, p.name, l.expires_on, l.id`, [h.id]);
  const out = lines.map((x) => ({
    ...x, code: lotCode(x.lotId), nowQty: x.nowQty == null ? null : n(x.nowQty),
    diff: x.counted == null || x.bookQty == null ? null : x.counted - x.bookQty,
  }));
  const counted = out.filter((x) => x.counted != null);
  return {
    count: h, lines: out,
    counts: { total: out.length, counted: counted.length, pending: out.length - counted.length, diffs: counted.filter((x) => x.diff !== 0).length,
              plus: counted.filter((x) => (x.diff ?? 0) > 0).length, minus: counted.filter((x) => (x.diff ?? 0) < 0).length, adjusted: out.filter((x) => x.adjustedAt).length },
    adjustable: h.state === 'CLOSED' ? counted.filter((x) => x.diff !== 0 && !x.adjustedAt).length : 0,
  };
}

export interface Cand { lotId: string; lotNo: string; name: string; label: string; expiresOn: string }
/* 고를 로트 — 이 회차에 줄이 있거나 남은 수량이 있는 끝나지 않은 로트(온전한 SQL 두 벌 · 이어 붙이기 · 끼우기 없음 — check-sql 이 통째로 PREPARE) */
const CAND_BY_LOT_NO = `SELECT l.id::text AS "lotId", l.lot_no AS "lotNo", p.name, fn_hlt_option_label(o.months, o.tag) AS label, l.expires_on::text AS "expiresOn"
       FROM qlt_lots l JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
      WHERE l.state <> 'CLOSED' AND l.lot_no = $2
        AND (EXISTS (SELECT 1 FROM qlt_lot_count_lines x WHERE x.count_id = $1::bigint AND x.lot_id = l.id)
             OR EXISTS (SELECT 1 FROM v_qlt_lot_qty q WHERE q.lot_id = l.id AND q.qty > 0))
      ORDER BY l.expires_on, l.id LIMIT 20`;
const CAND_BY_BARCODE = `SELECT l.id::text AS "lotId", l.lot_no AS "lotNo", p.name, fn_hlt_option_label(o.months, o.tag) AS label, l.expires_on::text AS "expiresOn"
       FROM qlt_lots l JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
      WHERE l.state <> 'CLOSED' AND l.option_id = (SELECT b.option_id FROM acct_barcodes b WHERE b.code = $2)
        AND (EXISTS (SELECT 1 FROM qlt_lot_count_lines x WHERE x.count_id = $1::bigint AND x.lot_id = l.id)
             OR EXISTS (SELECT 1 FROM v_qlt_lot_qty q WHERE q.lot_id = l.id AND q.qty > 0))
      ORDER BY l.expires_on, l.id LIMIT 20`;
async function candidates(db: DatabaseService, countId: string, by: 'lot_no' | 'barcode', arg: string): Promise<Cand[]> {
  return db.query<Cand>(by === 'lot_no' ? CAND_BY_LOT_NO : CAND_BY_BARCODE, [countId, arg]);
}

/** POST /admin/qlt/lot-counts/{id}/scan — 읽은 글자 → 로트 → +add(처음 1) 또는 counted 로 */
export async function scanLot(db: DatabaseService, id: string, b: { code: string; add?: number; counted?: number }, actor: string | null) {
  const raw = clean(b.code, 60);
  if (!raw) throw new PolicyViolation('QLT_CNT_CODE', '읽은 글자가 없습니다.');
  if (b.add !== undefined && b.add !== null && (!Number.isInteger(b.add) || b.add < 1 || b.add > 1000)) throw new PolicyViolation('QLT_CNT_QTY', '더하는 수는 1 ~ 1000 입니다.');
  if (b.counted !== undefined && b.counted !== null && (!Number.isInteger(b.counted) || b.counted < 0 || b.counted > 1_000_000)) throw new PolicyViolation('QLT_CNT_QTY', '센 수는 0 ~ 1,000,000 입니다.');
  const h0 = await head(db, id);
  if (h0.state !== 'OPEN') throw new StateConflict('QLT_CNT_STATE', '닫은 실사입니다.');
  /* ① 로트 QR → ② 로트 번호 → ③ 옵션 바코드 */
  let lotId = parseLotCode(raw);
  let via = 'QR';
  if (lotId) {
    const [ex] = await db.query<{ id: string }>(`SELECT id::text AS id FROM qlt_lots WHERE id = $1::bigint`, [lotId]);
    if (!ex) lotId = null;
  }
  if (!lotId && LOT_NO_RE.test(raw)) {
    const c = await candidates(db, h0.id, 'lot_no', raw);
    if (c.length === 1) { lotId = c[0]!.lotId; via = 'LOT_NO'; }
    else if (c.length > 1) return { ok: true, matched: false, candidates: c, note: `로트 번호 ${raw} 가 여러 상품에 있습니다 — 고르십시오.` };
  }
  if (!lotId && BARCODE_RE.test(raw.toUpperCase())) {
    const c = await candidates(db, h0.id, 'barcode', raw.toUpperCase());
    if (c.length === 1) { lotId = c[0]!.lotId; via = 'BARCODE'; }
    else if (c.length > 1) return { ok: true, matched: false, candidates: c, note: '이 바코드 상품의 로트가 여럿입니다 — 로트를 고르십시오(로트 QR 라벨을 붙이면 한 번에 찾습니다).' };
  }
  if (!lotId) throw new NotFound(`찾지 못했습니다(${raw}) — 로트 QR(SGB-LOT-000123) · 로트 번호 · 상품 바코드를 읽으십시오.`);
  return db.transaction(async () => {
    const h = await head(db, id, true);
    if (h.state !== 'OPEN') throw new StateConflict('QLT_CNT_STATE', '닫은 실사입니다.');
    const [lot] = await db.query<{ lotNo: string; name: string; state: string; qty: number | null }>(
      `SELECT l.lot_no AS "lotNo", p.name, l.state, q.qty FROM qlt_lots l JOIN hlt_products p ON p.id = l.product_id LEFT JOIN v_qlt_lot_qty q ON q.lot_id = l.id
        WHERE l.id = $1::bigint FOR UPDATE OF l`, [lotId]);
    if (!lot) throw new NotFound('없는 로트입니다.');
    const nowQty = n(lot.qty);
    let [line] = await db.query<{ counted: number | null }>(
      `SELECT counted FROM qlt_lot_count_lines WHERE count_id = $1::bigint AND lot_id = $2::bigint FOR UPDATE`, [h.id, lotId]);
    let late = false;
    if (!line) {
      if (lot.state === 'CLOSED') throw new StateConflict('QLT_CNT_LOT_CLOSED', `끝낸 로트입니다(${lot.lotNo}).`);
      await db.query(`INSERT INTO qlt_lot_count_lines (count_id, lot_id, expected, added_late) VALUES ($1::bigint, $2::bigint, $3::int, true)`, [h.id, lotId, nowQty]);
      line = { counted: null };
      late = true;
    }
    const next = b.counted !== undefined && b.counted !== null ? b.counted : (line.counted ?? 0) + (b.add ?? 1);
    if (next > 1_000_000) throw new PolicyViolation('QLT_CNT_QTY', '센 수는 1,000,000 까지입니다.');
    await db.query(
      `UPDATE qlt_lot_count_lines SET counted = $3::int, book_qty = coalesce(book_qty, $4::int), counted_by = $5::uuid, counted_at = now()
        WHERE count_id = $1::bigint AND lot_id = $2::bigint`, [h.id, lotId, next, nowQty, actor]);
    return { ok: true, matched: true, via, lotId, code: lotCode(lotId!), lotNo: lot.lotNo, name: lot.name, counted: next, addedLate: late,
             note: late ? `${lot.name} · 로트 ${lot.lotNo} — ${next}개(열린 뒤 등록한 로트 · 줄을 더함).` : `${lot.name} · 로트 ${lot.lotNo} — ${next}개.` };
  });
}

/** PUT /admin/qlt/lot-counts/{id}/lines/{lotId} — 손으로 고치기(센 수 · 메모 · reset 이면 세지 않음으로) */
export async function setLotCountLine(db: DatabaseService, id: string, lotId: string, b: { counted?: number; note?: string; reset?: boolean }, actor: string | null) {
  if (!idOk(lotId)) throw new NotFound('이 실사에 없는 로트입니다.');
  if (b.counted !== undefined && b.counted !== null && (!Number.isInteger(b.counted) || b.counted < 0 || b.counted > 1_000_000)) throw new PolicyViolation('QLT_CNT_QTY', '센 수는 0 ~ 1,000,000 입니다.');
  if (b.counted === undefined && b.note === undefined && b.reset !== true) throw new PolicyViolation('QLT_CNT_NOTHING', '바꿀 것이 없습니다.');
  return db.transaction(async () => {
    const h = await head(db, id, true);
    if (h.state !== 'OPEN') throw new StateConflict('QLT_CNT_STATE', '닫은 실사는 고치지 않습니다.');
    const [x] = await db.query<{ counted: number | null; note: string | null; qty: number | null }>(
      `SELECT x.counted, x.note, q.qty FROM qlt_lot_count_lines x LEFT JOIN v_qlt_lot_qty q ON q.lot_id = x.lot_id
        WHERE x.count_id = $1::bigint AND x.lot_id = $2::bigint FOR UPDATE OF x`, [h.id, lotId]);
    if (!x) throw new NotFound('이 실사에 없는 로트입니다.');
    const note = b.note !== undefined ? (clean(b.note, 200) || null) : x.note;
    if (b.reset === true) {
      await db.query(`UPDATE qlt_lot_count_lines SET counted = NULL, book_qty = NULL, counted_by = NULL, counted_at = NULL, note = $3 WHERE count_id = $1::bigint AND lot_id = $2::bigint`,
        [h.id, lotId, note]);
      return { ok: true, lotId, counted: null, note: `${lotCode(lotId)} — 세지 않음으로 되돌렸습니다.` };
    }
    if (b.counted === undefined || b.counted === null) {
      await db.query(`UPDATE qlt_lot_count_lines SET note = $3 WHERE count_id = $1::bigint AND lot_id = $2::bigint`, [h.id, lotId, note]);
      return { ok: true, lotId, counted: x.counted, note: `${lotCode(lotId)} — 메모를 남겼습니다.` };
    }
    await db.query(
      `UPDATE qlt_lot_count_lines SET counted = $3::int, book_qty = coalesce(book_qty, $4::int), counted_by = $5::uuid, counted_at = now(), note = $6
        WHERE count_id = $1::bigint AND lot_id = $2::bigint`, [h.id, lotId, b.counted, n(x.qty), actor, note]);
    return { ok: true, lotId, counted: b.counted, note: `${lotCode(lotId)} — ${b.counted}개로 적었습니다.` };
  });
}

/** POST /admin/qlt/lot-counts/{id}/close — 닫기(세지 않은 줄이 남으면 422 · skipUncounted 면 그대로 두고 닫음) */
export async function closeLotCount(db: DatabaseService, id: string, skipUncounted: boolean, actor: string | null) {
  return db.transaction(async () => {
    const h = await head(db, id, true);
    if (h.state !== 'OPEN') throw new StateConflict('QLT_CNT_STATE', '이미 닫은 실사입니다.');
    const [c] = await db.query<{ pending: number; diffs: number; counted: number }>(
      `SELECT count(*) FILTER (WHERE counted IS NULL)::int AS pending, count(*) FILTER (WHERE counted IS NOT NULL AND counted <> book_qty)::int AS diffs,
              count(*) FILTER (WHERE counted IS NOT NULL)::int AS counted
         FROM qlt_lot_count_lines WHERE count_id = $1::bigint`, [h.id]);
    const pending = n(c?.pending);
    if (pending && !skipUncounted) throw new PolicyViolation('QLT_CNT_PENDING', `세지 않은 로트가 ${pending}개 남아 있습니다 — 모두 세거나 「세지 않은 줄은 그대로 닫기」를 고르십시오.`);
    if (!n(c?.counted)) throw new PolicyViolation('QLT_CNT_NONE', '센 로트가 하나도 없습니다.');
    await db.query(`UPDATE qlt_lot_counts SET state = 'CLOSED', closed_by = $2::uuid, closed_at = now() WHERE id = $1::bigint`, [h.id, actor]);
    return { ok: true, id: h.id, counted: n(c?.counted), pending, diffs: n(c?.diffs),
             note: pending
               ? `로트 실사 「${h.title}」를 닫았습니다 — 센 로트 ${n(c?.counted)}개 · 차이 ${n(c?.diffs)}개 · 세지 않음 ${pending}개(차이에서 빠짐). 차이 조정은 SUPER 가 합니다.`
               : `로트 실사 「${h.title}」를 닫았습니다 — 센 로트 ${n(c?.counted)}개 · 차이 ${n(c?.diffs)}개. 차이 조정은 SUPER 가 합니다.` };
  });
}

/** POST /admin/qlt/lot-counts/{id}/lines/{lotId}/adjust — 차이 조정(SUPER · 닫은 회차 · 한 번) = D271 로트 조정 */
export async function adjustLotCountLine(db: DatabaseService, id: string, lotId: string, reasonIn: string | undefined, actor: string | null) {
  if (!idOk(lotId)) throw new NotFound('이 실사에 없는 로트입니다.');
  const reason = clean(reasonIn, 120);
  if (reason.length < 2) throw new PolicyViolation('QLT_REASON', '조정 사유(2자 이상)를 넣으십시오.');
  return db.transaction(async () => {
    const h = await head(db, id, true);
    if (h.state !== 'CLOSED') throw new StateConflict('QLT_CNT_STATE', '차이 조정은 실사를 닫은 뒤에 합니다.');
    const [x] = await db.query<{ counted: number | null; bookQty: number | null; adjustedAt: string | null }>(
      `SELECT counted, book_qty AS "bookQty", adjusted_at AS "adjustedAt" FROM qlt_lot_count_lines WHERE count_id = $1::bigint AND lot_id = $2::bigint FOR UPDATE`, [h.id, lotId]);
    if (!x) throw new NotFound('이 실사에 없는 로트입니다.');
    if (x.adjustedAt) throw new StateConflict('QLT_CNT_ADJUSTED', '이미 조정한 줄입니다.');
    if (x.counted == null || x.bookQty == null) throw new PolicyViolation('QLT_CNT_UNCOUNTED', '세지 않은 줄은 조정하지 않습니다.');
    const diff = x.counted - x.bookQty;
    if (diff === 0) throw new PolicyViolation('QLT_CNT_NODIFF', '차이가 없는 줄입니다.');
    /* 같은 트랜잭션 안(DatabaseService.transaction 은 안쪽 호출을 합류시킴) — 조정이 실패하면 표시도 남지 않음 */
    const r = await adjustLot(db, lotId, { qty: diff, reason: `재고 실사 #${h.id} · ${reason}` }, actor);
    await db.query(`UPDATE qlt_lot_count_lines SET adjusted_at = now(), adjust_move_id = $3::bigint WHERE count_id = $1::bigint AND lot_id = $2::bigint`, [h.id, lotId, r.moveId]);
    const signed = diff > 0 ? `+${diff}` : String(diff);
    return { ok: true, lotId, diff, moveId: r.moveId, note: `${lotCode(lotId)} — ${signed}개 조정했습니다(원가 장부 실사 조정 한 줄).` };
  });
}
