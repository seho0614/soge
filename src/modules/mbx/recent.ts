import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { mbxSettings, MbxTarget, resolveTarget, targetType, UUID_RE, PRODUCT_CODE_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.501 (D273 · docs/639) 최근 본 매물 · 상품 — 대표 11/20 「㊸ ①」
 *   로그인 회원: 서버(mbx_recent_views) — 사람마다 mbx.recent_max(처음 20)개까지(DB 트리거가 오래된 것부터 지움)
 *                · mbx.recent_keep_days(처음 90)일 지나면 매일 04:35 정기 작업(mbx_daily)이 지움 · 탈퇴 회원 것도 지움
 *   로그인 전:   이 브라우저(localStorage · 서버로 보내지 않음) — 로그인하면 화면이 한 번 합침(POST /me/recent/merge)
 *   스위치 mbx.recent(처음 off) — 꺼지면 적지 않고(saved:false) 목록은 비어 있음 · 이미 적힌 것은 정기 작업이 기간대로 지움
 *   보이는 것: 게시 중 매물 · 판매 중(품절 포함) 상품만 · 내려간 것은 「내려감」으로 표시만(눌러도 열리지 않음)
 * ------------------------------------------------------------------- */

const n = (v: unknown) => (v == null ? null : Number(v));

/** POST /me/recent — 본 것 적기(같은 것은 시각만 새로 · 본 횟수 +1) */
export async function recordView(db: DatabaseService, me: string, type: string, key: string) {
  const t = targetType(type);
  const s = await mbxSettings(db);
  if (!s.recent) return { saved: false, note: '최근 본 기록을 쓰지 않는 중입니다.' };
  const id = await resolveTarget(db, t, key, true);
  /* 내 매물은 적지 않음(본인이 고치려고 여는 것까지 쌓이면 목록이 쓸모없어짐) */
  if (t === 'LISTING') {
    const [own] = await db.query<{ own: boolean }>(`SELECT owner_account_id = $2::uuid AS own FROM listings WHERE id = $1::uuid`, [id, me]);
    if (own?.own) return { saved: false, note: '내 매물은 최근 본 목록에 넣지 않습니다.' };
  }
  await db.query(
    `INSERT INTO mbx_recent_views (account_id, target_type, target_id, viewed_at, view_count)
     VALUES ($1::uuid, $2, $3::uuid, now(), 1)
     ON CONFLICT (account_id, target_type, target_id) DO UPDATE SET viewed_at = now(), view_count = mbx_recent_views.view_count + 1`,
    [me, t, id]);
  return { saved: true };
}

/** GET /me/recent — 최근 순 · 카드에 필요한 공개 칸만 */
export async function listRecent(db: DatabaseService, me: string) {
  const s = await mbxSettings(db);
  if (!s.recent) return { enabled: false, max: s.recentMax, items: [] };
  const rows = await db.query<Record<string, unknown>>(
    `SELECT v.target_type AS type, v.viewed_at AS "viewedAt", v.view_count AS "viewCount",
            CASE WHEN v.target_type = 'LISTING' THEN l.id::text ELSE p.code END AS key,
            coalesce(l.title, p.name) AS title,
            CASE WHEN v.target_type = 'LISTING' THEN l.deal_amount ELSE p.price END AS price,
            l.desired_fee AS fee, l.gwan_code AS "gwanCode", cat.name AS "categoryName",
            CASE WHEN v.target_type = 'LISTING' THEN (l.status = 'PUBLISHED') ELSE (p.status IN ('ON_SALE', 'SOLD_OUT')) END AS open,
            CASE WHEN v.target_type = 'PRODUCT' THEN (p.stock = 0 OR p.status = 'SOLD_OUT') END AS "soldOut"
       FROM mbx_recent_views v
       LEFT JOIN listings l ON v.target_type = 'LISTING' AND l.id = v.target_id
       LEFT JOIN categories cat ON cat.id = l.category_id
       LEFT JOIN hlt_products p ON v.target_type = 'PRODUCT' AND p.id = v.target_id
      WHERE v.account_id = $1::uuid
      ORDER BY v.viewed_at DESC LIMIT $2::int`, [me, s.recentMax]);
  return {
    enabled: true, max: s.recentMax, keepDays: s.recentKeepDays,
    items: rows.filter((r) => r.key != null).map((r) => ({ ...r, price: n(r.price), fee: n(r.fee), viewCount: Number(r.viewCount ?? 1), open: !!r.open,
      title: r.open ? r.title : '(내려간 매물 · 상품)' })),
  };
}

/** DELETE /me/recent — 모두 지우기 */
export async function clearRecent(db: DatabaseService, me: string) {
  const rows = await db.query(`DELETE FROM mbx_recent_views WHERE account_id = $1::uuid RETURNING target_id`, [me]);
  return { ok: true, removed: rows.length, note: '최근 본 목록을 모두 지웠습니다.' };
}

/** DELETE /me/recent/{type}/{key} — 하나 지우기(내려간 것도 지울 수 있게 게시 여부는 보지 않음) */
export async function removeRecent(db: DatabaseService, me: string, type: string, key: string) {
  const t = targetType(type);
  const id = await resolveTarget(db, t, key, false);
  const rows = await db.query(`DELETE FROM mbx_recent_views WHERE account_id = $1::uuid AND target_type = $2 AND target_id = $3::uuid RETURNING target_id`, [me, t, id]);
  return { ok: true, removed: rows.length };
}

export interface MbxMergeItem { type: string; key: string; at?: string }

/** POST /me/recent/merge — 로그인 전 이 브라우저에 쌓인 것 합치기(최대 mbx.recent_max · 미래 · 보관 기간 밖 시각은 버림 · 없는 것은 건너뜀) */
export async function mergeRecent(db: DatabaseService, me: string, items: MbxMergeItem[]) {
  const s = await mbxSettings(db);
  if (!s.recent) return { saved: 0, skipped: items.length, note: '최근 본 기록을 쓰지 않는 중입니다.' };
  if (items.length > s.recentMax) throw new PolicyViolation('MBX_RECENT_MANY', `한 번에 ${s.recentMax}개까지 합칩니다.`);
  const now = Date.now(); const floor = now - s.recentKeepDays * 86400e3;
  let saved = 0, skipped = 0;
  for (const it of items) {
    const t = (it.type === 'LISTING' || it.type === 'PRODUCT') ? (it.type as MbxTarget) : null;
    const okKey = t === 'LISTING' ? UUID_RE.test(it.key ?? '') : t === 'PRODUCT' ? PRODUCT_CODE_RE.test(it.key ?? '') : false;
    const at = it.at ? Date.parse(it.at) : now;
    if (!t || !okKey || Number.isNaN(at) || at > now + 60e3 || at < floor) { skipped++; continue; }
    let id: string;
    try { id = await resolveTarget(db, t, it.key, true); } catch { skipped++; continue; }
    if (t === 'LISTING') {
      const [own] = await db.query<{ own: boolean }>(`SELECT owner_account_id = $2::uuid AS own FROM listings WHERE id = $1::uuid`, [id, me]);
      if (own?.own) { skipped++; continue; }
    }
    /* 서버에 이미 있으면 더 늦은 시각만 남김 */
    await db.query(
      `INSERT INTO mbx_recent_views (account_id, target_type, target_id, viewed_at, view_count)
       VALUES ($1::uuid, $2, $3::uuid, to_timestamp($4::double precision / 1000), 1)
       ON CONFLICT (account_id, target_type, target_id) DO UPDATE SET viewed_at = greatest(mbx_recent_views.viewed_at, EXCLUDED.viewed_at)`,
      [me, t, id, Math.min(at, now)]);
    saved++;
  }
  return { saved, skipped };
}

/** 정기 작업(mbx_daily)이 부름 — 보관 기간 지난 것 · 탈퇴(WITHDRAWN) 회원 것 */
export async function purgeRecent(db: DatabaseService, keepDays: number) {
  const old = await db.query(
    `DELETE FROM mbx_recent_views WHERE viewed_at < now() - make_interval(days => $1::int) RETURNING account_id`, [keepDays]);
  const gone = await db.query(
    `DELETE FROM mbx_recent_views v USING accounts a WHERE a.id = v.account_id AND a.status = 'WITHDRAWN' RETURNING v.account_id`);
  return old.length + gone.length;
}
