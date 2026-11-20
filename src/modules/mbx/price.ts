import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { mbxSettings, MbxTarget, resolveTarget, targetType, txt, won } from './common';

/* ---------------------------------------------------------------------
 * v10.503 (D273 · docs/641) 가격 변동 알림 — 대표 11/20 「㊸ ③」
 *   매물: **관심 목록(favorites · 기존 찜)** 에 담은 것만 켤 수 있음 — 관심에서 빼면 알림도 DB 트리거가 지움(trg_mbx_fav_unwatch)
 *   상품: 소개몰에는 찜이 없어 상품 화면의 「가격 알림」 단추가 바로 켬(mbx_price_watches 한 줄)
 *   보는 값: 매물 = 거래 금액(deal_amount) · 희망 소개비(desired_fee) / 상품 = 판매가(price · 옵션에서 셈한 대표 값)
 *   하루 1번 묶음: 매일 08:30 정기 작업(mbx_price_digest) — 기준값과 지금 값이 다른 것만 모아 회원마다 알림 한 통(MBX_PRICE_DIGEST)
 *     · 알림 수신 설정을 따름(fn_notify — 회원이 「가격 변동 알림」 인앱을 끄면 보내지 않음) · 하루 두 번 보내지 않음(mbx_price_digests 고유)
 *     · 「내릴 때만」(drop_only)이면 오른 것은 알리지 않고 기준값만 새로 · 게시 중이 아니거나 판매하지 않으면 건너뜀
 *     · 활동 중(ACTIVE) 회원만 · 탈퇴 회원 것은 mbx_daily 가 지움
 *   스위치 mbx.price_alert(처음 off) — 꺼지면 새로 켜지 못하고(422 MBX_OFF) 정기 작업도 보내지 않음
 *   광고성 정보 여부: 회원이 상품마다 직접 신청한 정보만 보냄(정보통신망법 제50조 — 법무 확인 표시 · docs/641 5절)
 * ------------------------------------------------------------------- */

const num = (v: unknown) => (v == null ? null : Number(v));

/** GET /me/price-alerts — 켠 것 · 켤 수 있는 관심 매물 */
export async function listWatches(db: DatabaseService, me: string) {
  const s = await mbxSettings(db);
  const items = await db.query<Record<string, unknown>>(
    `SELECT w.target_type AS type, w.drop_only AS "dropOnly", w.created_at AS "createdAt", w.last_notified_at AS "lastNotifiedAt",
            w.base_price AS "basePrice", w.base_fee AS "baseFee",
            CASE WHEN w.target_type = 'LISTING' THEN l.id::text ELSE p.code END AS key,
            coalesce(l.title, p.name) AS title, l.gwan_code AS "gwanCode",
            CASE WHEN w.target_type = 'LISTING' THEN l.deal_amount ELSE p.price END AS price, l.desired_fee AS fee,
            CASE WHEN w.target_type = 'LISTING' THEN (l.status = 'PUBLISHED') ELSE (p.status IN ('ON_SALE', 'SOLD_OUT')) END AS open
       FROM mbx_price_watches w
       LEFT JOIN listings l ON w.target_type = 'LISTING' AND l.id = w.target_id
       LEFT JOIN hlt_products p ON w.target_type = 'PRODUCT' AND p.id = w.target_id
      WHERE w.account_id = $1::uuid ORDER BY w.created_at DESC`, [me]);
  const favorites = await db.query<Record<string, unknown>>(
    `SELECT l.id::text AS key, l.title, l.gwan_code AS "gwanCode", l.deal_amount AS price, l.desired_fee AS fee
       FROM favorites f JOIN listings l ON l.id = f.target_id AND l.status = 'PUBLISHED'
      WHERE f.account_id = $1::uuid AND f.target_type = 'LISTING'
        AND NOT EXISTS (SELECT 1 FROM mbx_price_watches w WHERE w.account_id = f.account_id AND w.target_type = 'LISTING' AND w.target_id = f.target_id)
      ORDER BY f.created_at DESC LIMIT 100`, [me]);
  return {
    enabled: s.priceAlert, max: s.watchMax, at: '08:30',
    items: items.filter((r) => r.key != null).map((r) => ({ ...r, price: num(r.price), fee: num(r.fee), basePrice: num(r.basePrice), baseFee: num(r.baseFee), open: !!r.open })),
    favorites: favorites.map((r) => ({ ...r, price: num(r.price), fee: num(r.fee) })),
  };
}

/** POST /me/price-alerts — 켜기(이미 있으면 「내릴 때만」만 바꿈) · 기준값 = 지금 값 */
export async function addWatch(db: DatabaseService, me: string, type: string, key: string, dropOnly?: boolean) {
  const t = targetType(type);
  const s = await mbxSettings(db);
  if (!s.priceAlert) throw new PolicyViolation('MBX_OFF', '지금은 가격 변동 알림을 쓰지 않는 중입니다.');
  const id = await resolveTarget(db, t, key, true);
  if (t === 'LISTING') {
    const [fav] = await db.query<{ ok: boolean }>(
      `SELECT true AS ok FROM favorites WHERE account_id = $1::uuid AND target_type = 'LISTING' AND target_id = $2::uuid`, [me, id]);
    if (!fav) throw new PolicyViolation('MBX_NEED_FAVORITE', '관심 목록에 담은 매물만 가격 알림을 켤 수 있습니다.');
  }
  return db.transaction(async () => {
    const [had] = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM mbx_price_watches WHERE account_id = $1::uuid AND target_type = $2 AND target_id = $3::uuid FOR UPDATE`, [me, t, id]);
    if (had) {
      if (dropOnly !== undefined) await db.query(`UPDATE mbx_price_watches SET drop_only = $2::boolean WHERE id = $1::bigint`, [had.id, dropOnly]);
      return { ok: true, created: false, note: '이미 켜 둔 알림입니다.' };
    }
    const [cnt] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mbx_price_watches WHERE account_id = $1::uuid`, [me]);
    if ((cnt?.n ?? 0) >= s.watchMax) throw new PolicyViolation('MBX_WATCH_MAX', `가격 알림은 ${s.watchMax}개까지 켤 수 있습니다.`);
    await db.query(
      `INSERT INTO mbx_price_watches (account_id, target_type, target_id, drop_only, base_price, base_fee)
       SELECT $1::uuid, $2, $3::uuid, $4::boolean,
              CASE WHEN $2 = 'LISTING' THEN (SELECT deal_amount FROM listings WHERE id = $3::uuid) ELSE (SELECT price FROM hlt_products WHERE id = $3::uuid) END,
              CASE WHEN $2 = 'LISTING' THEN (SELECT desired_fee FROM listings WHERE id = $3::uuid) END`,
      [me, t, id, dropOnly ?? false]);
    return { ok: true, created: true, note: '가격이 바뀌면 다음 날 아침 알림으로 알려 드립니다.' };
  });
}

/** DELETE /me/price-alerts/{type}/{key} — 끄기 */
export async function removeWatch(db: DatabaseService, me: string, type: string, key: string) {
  const t = targetType(type);
  const id = await resolveTarget(db, t, key, false);
  const rows = await db.query(`DELETE FROM mbx_price_watches WHERE account_id = $1::uuid AND target_type = $2 AND target_id = $3::uuid RETURNING id`, [me, t, id]);
  return { ok: true, removed: rows.length };
}

interface WatchRow {
  id: string; account_id: string; target_type: MbxTarget; drop_only: boolean; base_price: string | null; base_fee: string | null;
  title: string | null; open: boolean; cur_price: string | null; cur_fee: string | null;
}

/** 정기 작업 mbx_price_digest(매일 08:30) — 회원마다 바뀐 것 묶어 알림 한 통 */
export async function priceDigestJob(db: DatabaseService) {
  const s = await mbxSettings(db);
  if (!s.priceAlert) return { skipped: 'off', members: 0, lines: 0, rebased: 0 };
  const rows = await db.query<WatchRow>(
    `SELECT w.id::text AS id, w.account_id::text AS account_id, w.target_type, w.drop_only, w.base_price::text AS base_price, w.base_fee::text AS base_fee,
            coalesce(l.title, p.name) AS title,
            CASE WHEN w.target_type = 'LISTING' THEN coalesce(l.status = 'PUBLISHED', false) ELSE coalesce(p.status IN ('ON_SALE', 'SOLD_OUT'), false) END AS open,
            (CASE WHEN w.target_type = 'LISTING' THEN l.deal_amount ELSE p.price END)::text AS cur_price,
            l.desired_fee::text AS cur_fee
       FROM mbx_price_watches w
       JOIN accounts a ON a.id = w.account_id AND a.status = 'ACTIVE'
       LEFT JOIN listings l ON w.target_type = 'LISTING' AND l.id = w.target_id
       LEFT JOIN hlt_products p ON w.target_type = 'PRODUCT' AND p.id = w.target_id
      ORDER BY w.account_id, w.created_at
      LIMIT 20000`);
  const lines = new Map<string, string[]>();
  const touched = new Map<string, string[]>();
  let rebased = 0;
  for (const r of rows) {
    if (!r.open) continue;
    const priceChanged = r.cur_price !== r.base_price;
    const feeChanged = r.target_type === 'LISTING' && r.cur_fee !== r.base_fee;
    if (!priceChanged && !feeChanged) continue;
    const firstBase = r.base_price == null && r.base_fee == null;
    const down = (priceChanged && r.base_price != null && r.cur_price != null && Number(r.cur_price) < Number(r.base_price))
      || (feeChanged && r.base_fee != null && r.cur_fee != null && Number(r.cur_fee) < Number(r.base_fee));
    if (firstBase || (r.drop_only && !down)) {
      await db.query(`UPDATE mbx_price_watches SET base_price = $2::numeric, base_fee = $3::numeric, last_checked_at = now() WHERE id = $1::bigint`,
        [r.id, r.cur_price, r.cur_fee]);
      rebased++;
      continue;
    }
    const name = txt(r.title, 40);
    const parts: string[] = [];
    if (priceChanged) parts.push(`${r.target_type === 'LISTING' ? '거래 금액' : '판매가'} ${won(r.base_price)} → ${won(r.cur_price)}`);
    if (feeChanged) parts.push(`희망 소개비 ${won(r.base_fee)} → ${won(r.cur_fee)}`);
    const arr = lines.get(r.account_id) ?? []; arr.push(`· ${name}: ${parts.join(' · ')}`); lines.set(r.account_id, arr);
    const ids = touched.get(r.account_id) ?? []; ids.push(r.id); touched.set(r.account_id, ids);
  }
  let members = 0, total = 0;
  for (const [acc, ls] of lines) {
    const sent = await db.transaction(async () => {
      const ins = await db.query(
        `INSERT INTO mbx_price_digests (account_id, sent_on, items) VALUES ($1::uuid, (now() AT TIME ZONE 'Asia/Seoul')::date, $2::int)
         ON CONFLICT (account_id, sent_on) DO NOTHING RETURNING id`, [acc, ls.length]);
      if (!ins.length) return false;   // 오늘 이미 보냄 — 기준값을 바꾸지 않아 내일 묶음에 들어감
      const shown = ls.slice(0, 5).join('\n') + (ls.length > 5 ? `\n외 ${ls.length - 5}건` : '');
      await db.query(`SELECT fn_notify($1::uuid, 'MBX_PRICE_DIGEST', $2::jsonb, '/my/price-alerts')`, [acc, JSON.stringify({ count: String(ls.length), lines: shown })]);
      await db.query(
        `UPDATE mbx_price_watches w SET base_price = CASE WHEN w.target_type = 'LISTING' THEN l.deal_amount ELSE p.price END,
                base_fee = l.desired_fee, last_checked_at = now(), last_notified_at = now()
           FROM mbx_price_watches w2
           LEFT JOIN listings l ON w2.target_type = 'LISTING' AND l.id = w2.target_id
           LEFT JOIN hlt_products p ON w2.target_type = 'PRODUCT' AND p.id = w2.target_id
          WHERE w.id = w2.id AND w.id = ANY($1::bigint[])`, [touched.get(acc) ?? []]);
      return true;
    });
    if (sent) { members++; total += ls.length; }
  }
  return { members, lines: total, rebased, watched: rows.length };
}

/** 정기 작업(mbx_daily)이 부름 — 탈퇴 회원 알림 지우기 */
export async function purgeWatches(db: DatabaseService) {
  const rows = await db.query(
    `DELETE FROM mbx_price_watches w USING accounts a WHERE a.id = w.account_id AND a.status = 'WITHDRAWN' RETURNING w.id`);
  return rows.length;
}
