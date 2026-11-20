import { DatabaseService } from '../../db/database.service';
import { LPX_MARK_TEXT, LPX_POSITIONS, UUID_RE, lpxSettings } from './common';
import { awayNow } from './away';
import { cellStat } from './stats';

/* ---------------------------------------------------------------------
 * v10.550 (D286 · docs/688) 매물 사진 워터마크 — 대표 11/21 「(56) ② 매물 사진 워터마크」
 *
 *   새 npm 금지 · 이미 있는 그림 처리 도구 없음(package.json 에 sharp · jimp · canvas 없음 — b279 D279 지각 해시도 같은 까닭으로 안 함)
 *   → **원본 사진 바이트는 그대로**(GET /listings/{id}/photos/{n} 고치지 않음) · 서버는 「표시 정보」만 돌려줌
 *   → 사용자 웹 매물 상세의 사진 위에 CSS 로 「SogaeBank/소개뱅크」 글자를 겹쳐 그림(LpxPhotoMark · lpx.css · 토큰만)
 *   스위치 lpx.watermark(처음 off) · 자리 lpx.watermark_pos(BR · BL · TR · TL · C · TILE · 처음 BR) · 진하기 lpx.watermark_opacity(10 ~ 60 · 처음 35)
 *   ★ 한계(문서 688 5절): 사진 주소를 직접 열거나 내려받으면 글자가 없음 — 그림에 박는 방식은 이미지 도구를 들일 때(대표 결정 · 다음 묶음 후보)
 *
 *   공개 GET /site/lpx/listings/{id} — 매물 상세가 한 번 부르는 「덧붙임 정보」(로그인 없음 · 개인정보 없음)
 *     watermark  { on, text, pos, opacity }
 *     away       판매자 자리 비움(끝 날짜 · 안내 글) — 매물 주인이 공개하려고 쓴 글만
 *     offer      { enabled } — 가격 제안 칸을 그릴지(관별 · 게시 중 · 거래 금액 있음) · 내 제안은 로그인 API
 *     stats      같은 관 · 업종 · 시 · 구(없으면 시 · 도) 최근 달 가운데값(lpx.stats on · 매물 lpx.stats_min 개 넘는 칸만)
 * ------------------------------------------------------------------- */

export interface LpxMark { on: boolean; text: string; pos: (typeof LPX_POSITIONS)[number]; opacity: number }

export async function markInfo(db: DatabaseService): Promise<LpxMark> {
  const s = await lpxSettings(db);
  return { on: s.markOn, text: LPX_MARK_TEXT, pos: s.markPos, opacity: s.markOpacity };
}

const EMPTY = (mark: LpxMark) => ({ watermark: mark, away: null, offer: { enabled: false }, stats: null });

/** 공개 — 게시 중 매물만(아니면 표시 정보만 · 나머지 빈 값) */
export async function listingExtras(db: DatabaseService, id: string) {
  const mark = await markInfo(db);
  if (!UUID_RE.test(String(id ?? ''))) return EMPTY(mark);
  const s = await lpxSettings(db);
  const [l] = await db.query<{ ownerId: string; status: string; gwan: string; categoryId: string; asking: string | null; sido: string | null; sigungu: string | null }>(
    `SELECT owner_account_id::text AS "ownerId", status, gwan_code AS gwan, category_id::text AS "categoryId", deal_amount::text AS asking,
            address->>'sido' AS sido, address->>'sigungu' AS sigungu
       FROM listings WHERE id = $1::uuid`, [id]);
  if (!l || l.status !== 'PUBLISHED') return EMPTY(mark);
  const away = await awayNow(db, l.ownerId);
  const stats = s.statsOn && l.sido ? await cellStat(db, l.gwan, l.categoryId, l.sido, l.sigungu ?? '', s.statsMin) : null;
  return {
    watermark: mark,
    away: away ? { startsOn: away.startsOn, endsOn: away.endsOn, message: away.message } : null,
    offer: { enabled: s.offerOn && s.offerGwans.includes(l.gwan) && l.asking != null },
    stats,
  };
}

/* ── 운영 화면 › 검수 › 매물 사진 워터마크 ── */
export async function adminMark(db: DatabaseService) {
  const settings = await lpxSettings(db);
  const [n] = await db.query<{ listings: number; photos: number }>(
    `SELECT count(DISTINCT l.id)::int AS listings, count(m.id)::int AS photos
       FROM listings l JOIN listing_media m ON m.listing_id = l.id WHERE l.status = 'PUBLISHED' AND m.media_type = 'IMAGE'`);
  const [sample] = await db.query<{ id: string }>(
    `SELECT l.id::text AS id FROM listings l WHERE l.status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = l.id AND m.media_type = 'IMAGE')
      ORDER BY l.published_at DESC NULLS LAST LIMIT 1`);
  return { settings, mark: await markInfo(db), positions: LPX_POSITIONS, published: n ?? { listings: 0, photos: 0 }, sampleListingId: sample?.id ?? null,
    note: '원본 사진은 그대로이고, 사용자 웹 매물 상세의 사진 위에 글자를 겹쳐 보입니다 — 사진 주소를 직접 열면 글자가 없습니다(문서 688).' };
}
