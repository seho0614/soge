import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { kstToday } from './hr';
import { disposeAsset } from './assets';

/* ---------------------------------------------------------------------
 * v10.474 (D265 · docs/612) 자산 실사 — 대표 11/20 「㉟ 인사 4」
 *   QR 라벨 — ⑬ 고정자산 대장(acct_assets)의 자산마다 코드 SGB-AST-000123(번호 6자리 이상) · 화면이 QR 그림을 그려 인쇄(새 npm 없이 · web/src/lib/qr.ts)
 *   실사 회차 — 열면 기준일까지 취득한 쓰는 자산이 모두 「확인 전」 · QR 읽기(바코드 · QR 리더기는 글자 입력처럼 들어옴) 또는 손으로 찾음 · 없음 · 둔 곳
 *               닫기(확인 전이 남으면 422 · 「확인 전은 없음으로」를 고르면 바꾸고 닫음) · 닫으면 못 고침
 *   없어진 자산 — 닫은 회차의 「없음」 자산을 SUPER 가 처분(⑬ assets.disposeAsset · 받은 돈 0 · 사유 실사) → 다음 전표 작업에서 ASSET_DISPOSE
 *                 (감가상각누계액 · 처분 손실 = 장부가 / 고정자산) · 줄에 처분 시각 · 되돌리지 않음(처분은 원래 되돌리지 않음)
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const HRX_ST_RESULTS = ['PENDING', 'FOUND', 'MISSING'] as const;
export const HRX_ASSET_CODE_RE = /^(?:SGB-)?AST-?0*(\d{1,18})$/i;
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 자산 번호 → 라벨 코드 */
export const hrxAssetCode = (id: string | number) => `SGB-AST-${String(id).padStart(6, '0')}`;
/** 읽은 글자 → 자산 번호(코드 · 숫자만 · 앞뒤 빈칸 무시) — 못 읽으면 null */
export function hrxParseAssetCode(raw: string): string | null {
  const t = String(raw ?? '').trim();
  const m = /^\d{1,18}$/.test(t) ? [t, t] : HRX_ASSET_CODE_RE.exec(t);
  const id = m && m[1] ? m[1].replace(/^0+/, '') : '';
  return id || null;
}
const RESULT_KO: Record<string, string> = { PENDING: '확인 전', FOUND: '찾음', MISSING: '없음' };

/** GET /admin/hrx/asset-labels?ids= — 라벨 인쇄할 자산(비우면 쓰는 자산 모두 · 200개까지) */
export async function assetLabels(db: DatabaseService, idsIn?: string) {
  const ids = String(idsIn ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d{1,18}$/.test(x)).slice(0, 200);
  const rows = await db.query<{ id: string; name: string; category: string | null; acquiredOn: string; state: string }>(
    `SELECT id::text AS id, name, category, acquired_on::text AS "acquiredOn", state FROM acct_assets
      WHERE (cardinality($1::text[]) = 0 AND state = 'ACTIVE') OR id::text = ANY ($1::text[]) ORDER BY id LIMIT 200`, [ids]);
  return { items: rows.map((a) => ({ ...a, code: hrxAssetCode(a.id) })), count: rows.length,
           note: 'QR 에는 자산 코드(SGB-AST-번호)만 들어 있습니다 — 금액 · 사람 이름은 넣지 않습니다. 실사 화면의 읽기 칸에 리더기로 읽거나 코드를 적습니다.' };
}

/** GET /admin/hrx/stocktakes — 회차 목록 */
export async function stocktakes(db: DatabaseService) {
  const items = await db.query(
    `SELECT s.id::text AS id, s.title, s.as_of::text AS "asOf", s.state, s.note, s.created_at AS "createdAt", s.closed_at AS "closedAt", c.email AS "createdBy",
            count(l.id)::int AS total, count(l.id) FILTER (WHERE l.result = 'FOUND')::int AS found, count(l.id) FILTER (WHERE l.result = 'MISSING')::int AS missing,
            count(l.id) FILTER (WHERE l.result = 'PENDING')::int AS pending, count(l.id) FILTER (WHERE l.disposed_at IS NOT NULL)::int AS disposed
       FROM hrx_stocktakes s LEFT JOIN hrx_stocktake_lines l ON l.stocktake_id = s.id LEFT JOIN accounts c ON c.id = s.created_by
      GROUP BY s.id, c.email ORDER BY (s.state = 'OPEN') DESC, s.id DESC LIMIT 100`);
  const [a] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_assets WHERE state = 'ACTIVE'`);
  return { items, activeAssets: a?.n ?? 0, note: '회차를 열면 기준일까지 취득한 쓰는 자산이 모두 「확인 전」으로 들어갑니다. 닫은 회차의 「없음」 자산은 SUPER 가 처분(처분 손실 전표)합니다.' };
}

/** POST /admin/hrx/stocktakes — 회차 열기 */
export async function openStocktake(db: DatabaseService, b: { title?: string; asOf?: string; note?: string | null }, actor: string | null) {
  const title = clean(b.title), asOf = b.asOf ? String(b.asOf) : kstToday(), note = b.note ? clean(b.note).slice(0, 200) || null : null;
  if (title.length < 2 || title.length > 60) throw new PolicyViolation('HRX_ST_TITLE', '회차 이름은 2 ~ 60자입니다.');
  if (!dayOk(asOf) || asOf > kstToday()) throw new PolicyViolation('HRX_ST_DATE', '기준일(YYYY-MM-DD)은 오늘까지입니다.');
  return db.transaction(async () => {
    const [s] = await db.query<{ id: string }>(
      `INSERT INTO hrx_stocktakes (title, as_of, note, created_by) VALUES ($1, $2::date, $3, $4::uuid) RETURNING id::text AS id`, [title, asOf, note, actor]);
    const r = await db.query(
      `INSERT INTO hrx_stocktake_lines (stocktake_id, asset_id) SELECT $1::bigint, a.id FROM acct_assets a WHERE a.state = 'ACTIVE' AND a.acquired_on <= $2::date ORDER BY a.id RETURNING id`,
      [s!.id, asOf]);
    if (!r.length) throw new PolicyViolation('HRX_ST_EMPTY', '기준일까지 취득한 쓰는 고정자산이 없습니다(회계 › 매입 · 경비 › 고정자산).');
    return { ok: true, id: s!.id, assets: r.length, note: `실사 회차 「${title}」를 열었습니다 — 자산 ${r.length}개 「확인 전」.` };
  });
}

export interface StHead { id: string; title: string; asOf: string; state: string; note: string | null; closedAt: string | null }
async function head(db: DatabaseService, id: string, lock = false) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 실사 회차입니다.');
  const [s] = await db.query<StHead>(
    'SELECT id::text AS id, title, as_of::text AS "asOf", state, note, closed_at AS "closedAt" FROM hrx_stocktakes WHERE id = $1::bigint' + (lock ? ' FOR UPDATE' : ''), [id]);
  if (!s) throw new NotFound('없는 실사 회차입니다.');
  return s;
}

/** GET /admin/hrx/stocktakes/{id} — 회차 · 자산 줄 */
export async function stocktakeDetail(db: DatabaseService, id: string) {
  const s = await head(db, id);
  const lines = await db.query<{ assetId: string; name: string; category: string | null; acquiredOn: string; cost: number; assetState: string; result: string; location: string | null;
    note: string | null; checkedAt: string | null; checkedBy: string | null; disposedAt: string | null }>(
    `SELECT l.asset_id::text AS "assetId", a.name, a.category, a.acquired_on::text AS "acquiredOn", a.cost::float8 AS cost, a.state AS "assetState", l.result, l.location, l.note,
            l.checked_at AS "checkedAt", c.email AS "checkedBy", l.disposed_at AS "disposedAt"
       FROM hrx_stocktake_lines l JOIN acct_assets a ON a.id = l.asset_id LEFT JOIN accounts c ON c.id = l.checked_by
      WHERE l.stocktake_id = $1::bigint ORDER BY (l.result = 'PENDING') DESC, l.result, a.id`, [s.id]);
  const cnt = (r: string) => lines.filter((x) => x.result === r).length;
  return { stocktake: s, lines: lines.map((x) => ({ ...x, code: hrxAssetCode(x.assetId), resultKo: RESULT_KO[x.result] ?? x.result })),
           counts: { total: lines.length, found: cnt('FOUND'), missing: cnt('MISSING'), pending: cnt('PENDING'), disposed: lines.filter((x) => x.disposedAt).length },
           disposable: s.state === 'CLOSED' ? lines.filter((x) => x.result === 'MISSING' && !x.disposedAt && x.assetState === 'ACTIVE').length : 0 };
}

/** POST /admin/hrx/stocktakes/{id}/scan — QR · 코드 읽기 → 찾음 */
export async function scanAsset(db: DatabaseService, id: string, code: string, locationIn: string | undefined, actor: string | null) {
  const assetId = hrxParseAssetCode(code);
  if (!assetId) throw new PolicyViolation('HRX_ST_CODE', '자산 코드를 읽지 못했습니다(SGB-AST-000123 모양 · 숫자).');
  const location = locationIn ? clean(locationIn).slice(0, 60) || null : null;
  return db.transaction(async () => {
    const s = await head(db, id, true);
    if (s.state !== 'OPEN') throw new StateConflict('HRX_ST_STATE', '닫은 회차입니다.');
    const [l] = await db.query<{ result: string; name: string }>(
      `SELECT l.result, a.name FROM hrx_stocktake_lines l JOIN acct_assets a ON a.id = l.asset_id WHERE l.stocktake_id = $1::bigint AND l.asset_id = $2::bigint FOR UPDATE OF l`, [s.id, assetId]);
    if (!l) throw new NotFound(`이 회차에 없는 자산입니다(${hrxAssetCode(assetId)}) — 기준일 뒤 취득했거나 처분한 자산일 수 있습니다.`);
    await db.query(
      `UPDATE hrx_stocktake_lines SET result = 'FOUND', location = coalesce($3, location), checked_by = $4::uuid, checked_at = now() WHERE stocktake_id = $1::bigint AND asset_id = $2::bigint`,
      [s.id, assetId, location, actor]);
    return { ok: true, assetId, code: hrxAssetCode(assetId), name: l.name, again: l.result === 'FOUND', note: l.result === 'FOUND' ? `${l.name} — 이미 찾음으로 적혀 있습니다.` : `${l.name}을 찾음으로 적었습니다.` };
  });
}

/** PUT /admin/hrx/stocktakes/{id}/lines/{assetId} — 손으로 적기(찾음 · 없음 · 확인 전 · 둔 곳 · 메모) */
export async function markLine(db: DatabaseService, id: string, assetId: string, b: { result?: string; location?: string | null; note?: string | null }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(assetId ?? ''))) throw new NotFound('이 회차에 없는 자산입니다.');
  if (b.result !== undefined && !(HRX_ST_RESULTS as readonly string[]).includes(b.result)) throw new PolicyViolation('HRX_ST_RESULT', '결과는 확인 전(PENDING) · 찾음(FOUND) · 없음(MISSING)입니다.');
  return db.transaction(async () => {
    const s = await head(db, id, true);
    if (s.state !== 'OPEN') throw new StateConflict('HRX_ST_STATE', '닫은 회차는 고치지 않습니다.');
    const [l] = await db.query<{ result: string; location: string | null; note: string | null }>(
      `SELECT result, location, note FROM hrx_stocktake_lines WHERE stocktake_id = $1::bigint AND asset_id = $2::bigint FOR UPDATE`, [s.id, assetId]);
    if (!l) throw new NotFound('이 회차에 없는 자산입니다.');
    const result = b.result ?? l.result;
    const location = b.location !== undefined ? (b.location ? clean(b.location).slice(0, 60) || null : null) : l.location;
    const note = b.note !== undefined ? (b.note ? clean(b.note).slice(0, 200) || null : null) : l.note;
    await db.query(
      `UPDATE hrx_stocktake_lines SET result = $3, location = $4, note = $5, checked_by = CASE WHEN $3 = 'PENDING' THEN NULL ELSE $6::uuid END,
              checked_at = CASE WHEN $3 = 'PENDING' THEN NULL ELSE now() END WHERE stocktake_id = $1::bigint AND asset_id = $2::bigint`,
      [s.id, assetId, result, location, note, actor]);
    return { ok: true, assetId, result, note: `${hrxAssetCode(assetId)} — ${RESULT_KO[result] ?? result}.` };
  });
}

/** POST /admin/hrx/stocktakes/{id}/close — 닫기(확인 전이 남으면 422 · pendingAsMissing 이면 없음으로 바꾸고 닫음) */
export async function closeStocktake(db: DatabaseService, id: string, pendingAsMissing: boolean, actor: string | null) {
  return db.transaction(async () => {
    const s = await head(db, id, true);
    if (s.state !== 'OPEN') throw new StateConflict('HRX_ST_STATE', '이미 닫은 회차입니다.');
    const [p] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hrx_stocktake_lines WHERE stocktake_id = $1::bigint AND result = 'PENDING'`, [s.id]);
    const pending = p?.n ?? 0;
    if (pending && !pendingAsMissing) throw new PolicyViolation('HRX_ST_PENDING', `확인 전 자산이 ${pending}개 남아 있습니다 — 모두 적거나 「확인 전은 없음으로」를 고르십시오.`);
    if (pending) {
      await db.query(
        `UPDATE hrx_stocktake_lines SET result = 'MISSING', note = coalesce(note, '닫을 때 확인 전 → 없음'), checked_by = $2::uuid, checked_at = now()
          WHERE stocktake_id = $1::bigint AND result = 'PENDING'`, [s.id, actor]);
    }
    await db.query(`UPDATE hrx_stocktakes SET state = 'CLOSED', closed_by = $2::uuid, closed_at = now() WHERE id = $1::bigint`, [s.id, actor]);
    const [m] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hrx_stocktake_lines WHERE stocktake_id = $1::bigint AND result = 'MISSING'`, [s.id]);
    return { ok: true, id: s.id, missing: m?.n ?? 0, madeMissing: pending,
             note: `실사 회차 「${s.title}」를 닫았습니다 — 없음 ${m?.n ?? 0}개${pending ? `(확인 전 ${pending}개를 없음으로)` : ''}. 없어진 자산 처분은 SUPER 가 합니다.` };
  });
}

/** POST /admin/hrx/stocktakes/{id}/dispose — 닫은 회차의 없음 자산 처분(SUPER · 고른 자산만 · 비우면 모두) → ASSET_DISPOSE 전표 */
export async function disposeMissing(db: DatabaseService, id: string, b: { assetIds?: string[]; disposedOn?: string }) {
  const s = await head(db, id);
  if (s.state !== 'CLOSED') throw new StateConflict('HRX_ST_STATE', '닫은 회차의 없음 자산만 처분합니다.');
  const day = b.disposedOn ? String(b.disposedOn) : kstToday();
  if (!dayOk(day) || day > kstToday()) throw new PolicyViolation('ACCT_DATE', '처분일(YYYY-MM-DD)은 오늘까지입니다.');
  const pick = Array.isArray(b.assetIds) ? b.assetIds.filter((x) => /^\d{1,18}$/.test(String(x))).map(String) : [];
  const rows = await db.query<{ assetId: string; name: string; acquiredOn: string }>(
    `SELECT l.asset_id::text AS "assetId", a.name, a.acquired_on::text AS "acquiredOn" FROM hrx_stocktake_lines l JOIN acct_assets a ON a.id = l.asset_id
      WHERE l.stocktake_id = $1::bigint AND l.result = 'MISSING' AND l.disposed_at IS NULL AND a.state = 'ACTIVE'
        AND (cardinality($2::text[]) = 0 OR l.asset_id::text = ANY ($2::text[])) ORDER BY l.asset_id`, [s.id, pick]);
  if (!rows.length) throw new PolicyViolation('HRX_ST_NOTHING', '처분할 없음 자산이 없습니다(이미 처분했거나 찾음).');
  const done: Array<{ assetId: string; name: string; gain: number }> = [], failed: Array<{ assetId: string; name: string; why: string }> = [];
  for (const r of rows) {
    try {
      const out = await db.transaction(async () => {
        const x = await disposeAsset(db, r.assetId, { disposedOn: day < r.acquiredOn ? r.acquiredOn : day, amount: 0, receiveRole: 'CASH',
          reason: `자산 실사 「${s.title}」(${s.id}번)에서 없음 — 처분`.slice(0, 200) });
        await db.query(`UPDATE hrx_stocktake_lines SET disposed_at = now() WHERE stocktake_id = $1::bigint AND asset_id = $2::bigint`, [s.id, r.assetId]);
        return x;
      });
      done.push({ assetId: r.assetId, name: r.name, gain: out.gain });
    } catch (e) {
      failed.push({ assetId: r.assetId, name: r.name, why: (e as { message?: string })?.message?.slice(0, 120) ?? '처분하지 못했습니다' });
    }
  }
  const loss = done.reduce((a, x) => a + Math.max(0, -x.gain), 0);
  return { ok: done.length > 0, disposed: done.length, failed, items: done, loss,
           note: done.length ? `없어진 자산 ${done.length}개를 처분했습니다 — 처분 손실 ${loss.toLocaleString('ko-KR')}원(다음 전표 작업에서 ASSET_DISPOSE 전표).` : '처분하지 못했습니다.' };
}
