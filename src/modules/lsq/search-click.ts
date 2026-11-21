import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { LSQ_UUID_RE, lsqDay, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.604 (docs/746) ⑳ 검색 클릭 분석 — 익명 · 순위 자료만
 *   사용자 웹 통합 검색 결과(/search)에서 매물 줄을 누르면 한 번 POST /site/lsq/search-click (q · listingId · pos · gwan)
 *   ★ 회원 · 방문자를 알 수 없게: 계정(로그인해도 읽지 않음) · IP(요청 수 제한에만 잠깐 메모리) · 브라우저 정보 · 쿠키 · 방문자 번호 모두 남기지 않음
 *   ★ 낱말은 기존 검색어 집계(search.service logTerm)와 같은 손질 — 소문자 · 동의어 정규화(fn_search_normalize) · 숫자 3자리 이상 · @ 든 말 · 제한업종 낱말은 버림
 *   저장: 날(한국) × 낱말 × 관 × 순위 수(lsq_search_clicks) · 날 × 낱말 × 매물 수(lsq_search_click_items) · 보관 lsq.search_click_keep_days(180일)
 *   쓰임: 운영 참고(낱말별 클릭 · 평균 순위 · 1 ~ 3위 비율 · 많이 눌린 매물) — 노출 순위 · 광고 과금에 쓰지 않음
 *   끄기: lsq.search_click off(처음) · 브라우저 DNT · GPC · 로봇이면 받지 않음
 * ------------------------------------------------------------------- */

const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests|lighthouse/i;
export const LSQ_GWAN_RE = /^(ALL|[A-Z]{3,4})$/;   // DB CHECK lsq_search_clicks.gwan 과 같음(규칙 2)
const STOP = ['가장', '제일', '많이', '되는', '있는', '싶은', '하는', '좋은', '어떤', '무슨', '추천', '해줘', '주세요', '알려', '찾아', '찾아요', '찾습니다', '있어', '있나요'];

/* 요청 수 제한 — IP 지문(저장 안 함 · 메모리 1분) 1분 60번 */
const hits = new Map<string, { n: number; t: number }>();
function tooMany(ip: string) {
  const now = Date.now();
  if (hits.size > 50000) hits.clear();
  const k = createHash('sha256').update(`lsq|${ip}`).digest('hex').slice(0, 16);
  const h = hits.get(k);
  if (!h || now - h.t > 60_000) { hits.set(k, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 60;
}

/** 낱말 손질 — 기존 검색어 집계와 같은 규칙 · 못 쓰면 null */
export async function lsqTerm(db: DatabaseService, raw: unknown): Promise<string | null> {
  const q = String(raw ?? '').replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (q.length < 2 || q.length > 40 || /\d{3,}/.test(q) || STOP.includes(q)) return null;
  const [n] = await db.query<{ canonical: string | null }>(`SELECT canonical FROM fn_search_normalize($1)`, [q]);
  const term = (n?.canonical ?? q).toLowerCase().trim().slice(0, 40);
  if (!term || /\d{3,}/.test(term) || term.includes('@')) return null;
  const blocked = await db.query<{ t: string }>(
    `SELECT lower(term) AS t FROM restrict_vocab UNION SELECT lower(name) FROM restricted_industries WHERE is_active AND mode IN ('BLOCK','AD_ONLY')`);
  if (blocked.some((b) => b.t && term.includes(b.t))) return null;
  return term;
}

export interface LsqClickIn { q: string; listingId?: string; pos: number; gwan?: string }

/** POST /site/lsq/search-click — 받으면 하루 묶음에 더함 · 받지 않은 까닭만 돌려줌(화면은 결과를 보지 않음) */
export async function searchClick(db: DatabaseService, b: LsqClickIn, h: { ua?: string; dnt?: string; gpc?: string; ip?: string }) {
  const s = await lsqSettings(db);
  if (!s.searchClickOn) return { ok: false, reason: 'OFF' };
  if (h.dnt === '1' || h.gpc === '1') return { ok: false, reason: 'DNT' };
  if (!h.ua || BOT_UA.test(h.ua)) return { ok: false, reason: 'BOT' };
  if (h.ip && tooMany(h.ip)) return { ok: false, reason: 'RATE' };
  const pos = Number(b.pos);
  if (!Number.isInteger(pos) || pos < 1 || pos > 100) throw new PolicyViolation('LSQ_CLICK_POS', '순위는 1 ~ 100 입니다.');
  const gwan = String(b.gwan ?? 'ALL').toUpperCase();
  if (!LSQ_GWAN_RE.test(gwan)) throw new PolicyViolation('LSQ_CLICK_GWAN', '관 코드가 맞지 않습니다.');
  if (b.listingId !== undefined && b.listingId !== null && b.listingId !== '' && !LSQ_UUID_RE.test(String(b.listingId))) throw new PolicyViolation('LSQ_CLICK_LISTING', '매물 번호가 맞지 않습니다.');
  const term = await lsqTerm(db, b.q);
  if (!term) return { ok: false, reason: 'TERM' };
  await db.query(`SELECT lsq_fn_search_click_add($1::date, $2::text, $3::text, $4::int, $5::uuid)`, [lsqDay(), term, gwan, pos, b.listingId || null]);
  return { ok: true };
}

/** 운영 — 최근 N일 낱말별 클릭 · 평균 순위 · 1 ~ 3위 비율 · 순위 분포 · 많이 눌린 매물(제목만) */
export async function adminSearchClicks(db: DatabaseService, daysIn?: string) {
  const days = [1, 7, 30, 90].includes(Number(daysIn)) ? Number(daysIn) : 7;
  const from = lsqDay(-(days - 1));
  const settings = await lsqSettings(db);
  const [sum] = await db.query<{ clicks: number; terms: number; avgPos: string | null; top3Pct: string | null }>(
    `SELECT coalesce(sum(clicks), 0)::int AS clicks, count(DISTINCT term)::int AS terms,
            round(sum(pos * clicks)::numeric / nullif(sum(clicks), 0), 2) AS "avgPos",
            round(100.0 * sum(clicks) FILTER (WHERE pos <= 3) / nullif(sum(clicks), 0), 1) AS "top3Pct"
       FROM lsq_search_clicks WHERE day >= $1::date`, [from]);
  const terms = await db.query(
    `SELECT c.term, sum(c.clicks)::int AS clicks, round(sum(c.pos * c.clicks)::numeric / nullif(sum(c.clicks), 0), 2) AS "avgPos",
            round(100.0 * sum(c.clicks) FILTER (WHERE c.pos <= 3) / nullif(sum(c.clicks), 0), 1) AS "top3Pct",
            max(st.hits)::int AS searches
       FROM lsq_search_clicks c LEFT JOIN search_term_stats st ON st.term = c.term
      WHERE c.day >= $1::date GROUP BY c.term ORDER BY 2 DESC, 1 LIMIT 100`, [from]);
  const positions = await db.query(
    `SELECT CASE WHEN pos <= 10 THEN pos::text WHEN pos <= 20 THEN '11-20' ELSE '21+' END AS pos, sum(clicks)::int AS clicks
       FROM lsq_search_clicks WHERE day >= $1::date GROUP BY 1 ORDER BY min(pos)`, [from]);
  const items = await db.query(
    `SELECT i.listing_id::text AS "listingId", l.title, l.gwan_code AS "gwanCode", sum(i.clicks)::int AS clicks,
            (SELECT string_agg(t.term, ' · ') FROM (SELECT term FROM lsq_search_click_items x WHERE x.listing_id = i.listing_id AND x.day >= $1::date
                GROUP BY term ORDER BY sum(clicks) DESC LIMIT 3) t) AS terms
       FROM lsq_search_click_items i JOIN listings l ON l.id = i.listing_id
      WHERE i.day >= $1::date GROUP BY i.listing_id, l.title, l.gwan_code ORDER BY 4 DESC LIMIT 50`, [from]);
  return { settings, days, from, summary: sum, terms, positions, items,
    note: '누가 눌렀는지는 모으지 않습니다 — 날 × 낱말 × 순위 수만. 노출 순위 · 광고 과금에는 쓰지 않는 참고 자료입니다.' };
}

/** 정기 정리 — 보관 지난 묶음 지움 */
export async function searchClickPurge(db: DatabaseService) {
  const s = await lsqSettings(db);
  const cut = lsqDay(-s.searchClickKeepDays);
  const a = await db.query(`DELETE FROM lsq_search_clicks WHERE day < $1::date RETURNING day`, [cut]);
  const b = await db.query(`DELETE FROM lsq_search_click_items WHERE day < $1::date RETURNING day`, [cut]);
  return { deleted: a.length + b.length };
}
