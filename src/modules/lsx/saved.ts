import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { expandKeyword } from '../../core/search-expand';
import { lsxSettings, kstYmd, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.513 (D276 · docs/651) 저장한 검색 · 새 매물 하루 묶음 알림
 *   회원이 매물 검색 조건(관 · 업종 · 검색어 · 지역 · 안심소개 축)을 이름 붙여 저장 — 사람마다 lsx.saved_search_max(10)개(DB 트리거도 막음)
 *   매일 08:10(lsx_daily) 조건마다 「지난번 확인 뒤 새로 게시된 매물」 수를 세어 회원마다 한 통(LSX_SAVED_SEARCH · 알림 수신 설정 따름)
 *   알림 글에는 조건 이름과 건수만 — 매물 제목 · 등록자는 싣지 않음. 내 매물은 세지 않음.
 *   검색 규칙은 목록과 같음(fn_search_match · 동의어 expandKeyword) — 다만 우선노출(광고) 매물은 목록처럼 빼고 셈.
 *   스위치 lsx.saved_search 가 꺼져 있으면 저장 · 알림 모두 막음(저장해 둔 것은 지우지 않음).
 * ------------------------------------------------------------------- */

export const SAVED_AXES = ['RE', 'EQUIP', 'CONSULT'] as const;
export const SAVED_GWANS = ['MNY', 'MAL', 'BIZ', 'HLT'] as const;
/** DB CHECK 와 같은 글자(계약 규칙 2) */
export const REGION_RE = /^[0-9A-Z]{2,10}$/;

export interface SavedInput { name?: string; gwanCode?: string; categoryId?: string; keyword?: string; regionCode?: string; axis?: string; notify?: boolean }

type Row = { id: string; name: string; gwan_code: string | null; category_id: string | null; keyword: string | null; region_code: string | null; axis: string | null; notify: boolean; last_checked_at: string; created_at: string };

const shape = (r: Row & { category_name?: string | null }) => ({
  id: Number(r.id), name: r.name, gwanCode: r.gwan_code, categoryId: r.category_id, categoryName: r.category_name ?? null,
  keyword: r.keyword, regionCode: r.region_code, axis: r.axis, notify: r.notify, lastCheckedAt: r.last_checked_at, createdAt: r.created_at,
  /* 사용자 웹 검색 화면으로 가는 주소(검색어 · 관만 — 나머지는 관 목록 화면 조건) */
  searchUrl: r.keyword ? `/search?q=${encodeURIComponent(r.keyword)}${r.gwan_code && ['MNY', 'MAL', 'BIZ'].includes(r.gwan_code) ? `&gwanCode=${r.gwan_code}` : ''}` : null,
});

async function needOn(db: DatabaseService) {
  const s = await lsxSettings(db);
  if (!s.savedSearch) throw new PolicyViolation('LSX_OFF', '지금은 쓸 수 없는 기능입니다.');
  return s;
}

/** 입력 다듬기 — 빈 값은 null · 조건이 하나도 없으면 422 */
function clean(d: SavedInput) {
  const s = (v?: string) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t || null; };
  const gwan = s(d.gwanCode)?.toUpperCase() ?? null;
  if (gwan && !(SAVED_GWANS as readonly string[]).includes(gwan)) throw new PolicyViolation('LSX_SAVED_FIELD', '관 코드가 맞지 않습니다.');
  const cat = s(d.categoryId);
  if (cat && !UUID_RE.test(cat)) throw new PolicyViolation('LSX_SAVED_FIELD', '업종 번호가 맞지 않습니다.');
  const kw = s(d.keyword);
  if (kw && (kw.replace(/\s/g, '').length < 2 || kw.length > 60)) throw new PolicyViolation('LSX_SAVED_FIELD', '검색어는 2 ~ 60자입니다.');
  const region = s(d.regionCode)?.toUpperCase() ?? null;
  if (region && !REGION_RE.test(region)) throw new PolicyViolation('LSX_SAVED_FIELD', '지역 코드가 맞지 않습니다.');
  const axis = s(d.axis)?.toUpperCase() ?? null;
  if (axis && !(SAVED_AXES as readonly string[]).includes(axis)) throw new PolicyViolation('LSX_SAVED_FIELD', '안심소개 축은 RE · EQUIP · CONSULT 중 하나입니다.');
  if (!gwan && !cat && !kw && !region && !axis) throw new PolicyViolation('LSX_SAVED_EMPTY', '검색 조건을 하나 이상 넣어 주십시오.');
  const name = s(d.name) ?? (kw ?? '내 검색').slice(0, 40);
  if (name.length > 40) throw new PolicyViolation('LSX_SAVED_FIELD', '이름은 40자까지입니다.');
  return { name, gwan, cat, kw, region, axis };
}

export async function listSaved(db: DatabaseService, me: string) {
  const s = await lsxSettings(db);
  const rows = await db.query<Row & { category_name: string | null }>(
    `SELECT s.id::text, s.name, s.gwan_code, s.category_id::text, s.keyword, s.region_code, s.axis, s.notify, s.last_checked_at, s.created_at, c.name AS category_name
       FROM lsx_saved_searches s LEFT JOIN categories c ON c.id = s.category_id
      WHERE s.account_id = $1 ORDER BY s.id`, [me]);
  return { on: s.savedSearch, max: s.savedSearchMax, items: rows.map(shape) };
}

export async function addSaved(db: DatabaseService, me: string, d: SavedInput) {
  const s = await needOn(db);
  const c = clean(d);
  if (c.cat) {
    const [cat] = await db.query(`SELECT 1 FROM categories WHERE id = $1`, [c.cat]);
    if (!cat) throw new PolicyViolation('LSX_SAVED_FIELD', '업종 번호가 맞지 않습니다.');
  }
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('lsx-saved:' || $1::text, 0))`, [me]);
    const [n] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lsx_saved_searches WHERE account_id = $1`, [me]);
    if ((n?.n ?? 0) >= s.savedSearchMax) {
      throw new PolicyViolation('LSX_SAVED_MAX', `저장한 검색은 ${s.savedSearchMax}개까지입니다. 쓰지 않는 검색을 지운 뒤 저장해 주십시오.`);
    }
    const [dup] = await db.query(
      `SELECT 1 FROM lsx_saved_searches
        WHERE account_id = $1 AND gwan_code IS NOT DISTINCT FROM $2 AND category_id IS NOT DISTINCT FROM $3::uuid
          AND keyword IS NOT DISTINCT FROM $4 AND region_code IS NOT DISTINCT FROM $5 AND axis IS NOT DISTINCT FROM $6`,
      [me, c.gwan, c.cat, c.kw, c.region, c.axis]);
    if (dup) throw new StateConflict('LSX_SAVED_DUP', '같은 조건의 검색을 이미 저장했습니다.');
    const [r] = await db.query<Row>(
      `INSERT INTO lsx_saved_searches (account_id, name, gwan_code, category_id, keyword, region_code, axis, notify)
       VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8)
       RETURNING id::text, name, gwan_code, category_id::text, keyword, region_code, axis, notify, last_checked_at, created_at`,
      [me, c.name, c.gwan, c.cat, c.kw, c.region, c.axis, d.notify !== false]);
    return { ok: true, item: shape(r!), note: '검색을 저장했습니다. 새 매물이 올라오면 하루 한 번 알려 드립니다.' };
  });
}

export async function updateSaved(db: DatabaseService, me: string, id: number, d: { name?: string; notify?: boolean }) {
  await needOn(db);
  const name = d.name === undefined ? undefined : String(d.name).replace(/\s+/g, ' ').trim();
  if (name !== undefined && (name.length < 1 || name.length > 40)) throw new PolicyViolation('LSX_SAVED_FIELD', '이름은 1 ~ 40자입니다.');
  if (name === undefined && d.notify === undefined) throw new PolicyViolation('LSX_NOTHING', '바꿀 것이 없습니다.');
  const [r] = await db.query<Row>(
    `UPDATE lsx_saved_searches
        SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
            notify = CASE WHEN $5::boolean THEN $6::boolean ELSE notify END,
            last_checked_at = CASE WHEN $5::boolean AND $6::boolean AND NOT notify THEN now() ELSE last_checked_at END
      WHERE id = $1 AND account_id = $2
      RETURNING id::text, name, gwan_code, category_id::text, keyword, region_code, axis, notify, last_checked_at, created_at`,
    [id, me, name !== undefined, name ?? null, d.notify !== undefined, d.notify ?? false]);
  if (!r) throw new NotFound('저장한 검색을 찾을 수 없습니다.');
  return { ok: true, item: shape(r) };
}

/** 지우기는 스위치가 꺼져 있어도 됨(내 기록 정리) */
export async function removeSaved(db: DatabaseService, me: string, id: number) {
  const rows = await db.query(`DELETE FROM lsx_saved_searches WHERE id = $1 AND account_id = $2 RETURNING id`, [id, me]);
  if (!rows.length) throw new NotFound('저장한 검색을 찾을 수 없습니다.');
  return { ok: true, removed: 1 };
}

/** 한 조건의 새 매물 수 — (since, until] 사이에 게시 · 내 매물 빼고 · 우선노출 빼고 */
export async function countNew(db: DatabaseService, s: { gwan_code: string | null; category_id: string | null; keyword: string | null; region_code: string | null; axis: string | null },
                               me: string, since: string, until: string): Promise<number> {
  const kw = s.keyword ? await expandKeyword(db, s.keyword) : null;
  const [r] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM listings l
       JOIN categories cat ON cat.id = l.category_id
       LEFT JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND l.is_priority_exposed = false
        AND l.published_at > $1::timestamptz AND l.published_at <= $2::timestamptz
        AND l.owner_account_id <> $3::uuid
        AND ($4::text IS NULL OR l.gwan_code = $4)
        AND ($5::uuid IS NULL OR l.category_id = $5)
        AND ($6::text IS NULL OR fn_search_match(l.title, l.body, $6))
        AND ($7::text IS NULL OR left(vr.sido_code, 2) = left($7, 2))
        AND ($8::text IS NULL OR cat.axis = $8)`,
    [since, until, me, s.gwan_code, s.category_id, kw, s.region_code, s.axis]);
  return r?.n ?? 0;
}

/** 하루 묶음 — 회원마다 한 통 · (회원 · 한국 날짜) 한 줄이라 두 번 돌아도 한 번 */
export async function savedDigestJob(db: DatabaseService, limit = 2000) {
  const s = await lsxSettings(db);
  if (!s.savedSearch) return { skipped: 'OFF', accounts: 0, sent: 0 };
  const until = new Date().toISOString();
  const day = kstYmd(until)!;
  const accts = await db.query<{ account_id: string }>(
    `SELECT DISTINCT s.account_id::text FROM lsx_saved_searches s JOIN accounts a ON a.id = s.account_id
      WHERE s.notify AND a.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM lsx_search_digests d WHERE d.account_id = s.account_id AND d.day = $1::date)
      ORDER BY 1 LIMIT $2`, [day, limit]);
  let sent = 0;
  for (const a of accts) {
    const rows = await db.query<Row>(
      `SELECT id::text, name, gwan_code, category_id::text, keyword, region_code, axis, notify, last_checked_at, created_at
         FROM lsx_saved_searches WHERE account_id = $1 AND notify ORDER BY id`, [a.account_id]);
    const hits: { name: string; n: number }[] = [];
    for (const r of rows) {
      const n = await countNew(db, r, a.account_id, r.last_checked_at, until);
      if (n > 0) hits.push({ name: r.name, n });
    }
    await db.transaction(async () => {
      await db.query(`UPDATE lsx_saved_searches SET last_checked_at = $2::timestamptz WHERE account_id = $1 AND notify`, [a.account_id, until]);
      if (!hits.length) return;
      const total = hits.reduce((x, h) => x + h.n, 0);
      const [ins] = await db.query<{ id: string }>(
        `INSERT INTO lsx_search_digests (account_id, day, searches, total) VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (account_id, day) DO NOTHING RETURNING id::text`, [a.account_id, day, hits.length, total]);
      if (!ins) return;
      const names = hits.slice(0, 3).map((h) => `「${h.name}」 ${h.n}건`).join(' · ') + (hits.length > 3 ? ` 외 ${hits.length - 3}개` : '');
      await db.query(`SELECT fn_notify($1::uuid, 'LSX_SAVED_SEARCH', jsonb_build_object('count', $2::text, 'names', $3::text), '/my/saved-searches')`,
        [a.account_id, String(total), names]);
      sent++;
    });
  }
  return { accounts: accts.length, sent };
}

/** 운영 화면 — 모은 숫자만(누가 무엇을 저장했는지 보이지 않음) */
export async function savedStats(db: DatabaseService) {
  const [t] = await db.query<{ searches: number; accounts: number; notify: number; digests7: number }>(
    `SELECT (SELECT count(*)::int FROM lsx_saved_searches) AS searches,
            (SELECT count(DISTINCT account_id)::int FROM lsx_saved_searches) AS accounts,
            (SELECT count(*)::int FROM lsx_saved_searches WHERE notify) AS notify,
            (SELECT count(*)::int FROM lsx_search_digests WHERE created_at > now() - interval '7 days') AS digests7`);
  const byGwan = await db.query<{ gwan: string; n: number }>(
    `SELECT coalesce(gwan_code, '전체') AS gwan, count(*)::int AS n FROM lsx_saved_searches GROUP BY 1 ORDER BY 2 DESC`);
  /* 검색어는 3명 이상이 저장한 것만(한 사람의 검색어가 드러나지 않게) */
  const words = await db.query<{ keyword: string; n: number }>(
    `SELECT lower(keyword) AS keyword, count(DISTINCT account_id)::int AS n FROM lsx_saved_searches
      WHERE keyword IS NOT NULL GROUP BY 1 HAVING count(DISTINCT account_id) >= 3 ORDER BY 2 DESC, 1 LIMIT 20`);
  return { ...(t ?? { searches: 0, accounts: 0, notify: 0, digests7: 0 }), byGwan, words };
}
