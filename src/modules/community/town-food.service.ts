import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';
import { GeoService } from '../../common/geo/geo.service';
import { GeoFail, KakaoPlace, searchKeyword } from '../../common/geo/kakao-local.provider';
import { publicAuthor } from './community.service';

/* ---------------------------------------------------------------------
 * v10.47 (D100 · docs/98) — 소개광장 › 우리동네 맛집
 *
 * ── 기존 기능에 영향 없음 ──────────────────────────────────────────────
 * 지도 사용(map.enabled)이 꺼져 있으면(v10.46 처음 값) 목록은 enabled=false · 빈 목록, 쓰기 · 가게 찾기는 422 MAP_DISABLED.
 * 소개광장 탭도 그때는 나오지 않습니다(사용자 웹 FoodTab). 글은 소개광장 글 표(posts · board FOOD)에 들어가므로
 * 금칙어 · 링크 · 도배 · 첫 글 검수 · 신고 · 댓글이 그대로 걸립니다(C810 트리거) — 여기서 다시 검사하지 않습니다.
 *
 * ── 가게 ──────────────────────────────────────────────────────────────
 * 「가게 찾기」는 서버가 카카오 키워드 검색을 대신 부릅니다(키를 브라우저에 주지 않음). 음식점(FD6) · 카페(CE7)만 남깁니다.
 * 글을 쓸 때 화면이 보낸 가게 정보는 믿지 않습니다 — 그 사람이 10분 안에 찾은 결과(서버 기억)에 있는 카카오 ID 이거나,
 * 이미 등록된 가게여야 합니다. 저장은 이름 · 분류 · 주소 · 좌표 · ID · 장소 주소만(카카오 자료를 통째로 저장하지 않음).
 *
 * ── 위치 ──────────────────────────────────────────────────────────────
 * 서버는 이용자 위치를 받지 않습니다. 지도 화면이 보낸 「보이는 네 모서리」로만 가게를 고릅니다.
 * 「현재 위치로」(map.food_geolocation · 처음 off)도 브라우저 안에서 지도를 옮길 뿐입니다.
 * ------------------------------------------------------------------- */

const FOOD_GROUPS = new Set(['FD6', 'CE7']);
const SEARCH_PER_MIN = 30;
const PICK_TTL_MS = 10 * 60_000;
const MAX_PINS = 200;

/** "경기 성남시 분당구 정자동 178-1" → 시도 · 시군구 · 동 (주소 글자에서만 — 목록을 지어내지 않음) */
export function splitRegion(addr: string | null | undefined) {
  const t = (addr ?? '').trim().split(/\s+/).filter(Boolean);
  if (t.length < 2) return { sido: null, sigungu: null, dong: null };
  const sido = t[0];
  let i = 1;
  let sigungu = t[1];
  if (/[시군]$/.test(t[1]) && t[2] && /구$/.test(t[2])) { sigungu = `${t[1]} ${t[2]}`; i = 2; }
  const dong = t.slice(i + 1).find((x) => /[동읍면리가]$/.test(x) && !/\d/.test(x)) ?? null;
  return { sido, sigungu, dong };
}

@Injectable()
export class TownFoodService {
  private rate = new Map<string, number[]>();
  private picks = new Map<string, { at: number; places: Map<string, KakaoPlace> }>();

  constructor(private readonly db: DatabaseService, private readonly geo: GeoService) {}
  private get me() { return RequestCtx.actorId(); }

  private async mustEnabled() {
    if (!(await this.geo.enabled())) throw new PolicyViolation('MAP_DISABLED', '우리동네 맛집은 준비 중입니다.');
  }

  /** 소개광장 탭 · 화면 머리 — 켜져 있는지 · 「현재 위치로」 단추 · 가게가 있는 동네(시 · 구) */
  async meta() {
    const enabled = await this.geo.enabled();
    if (!enabled) return { enabled: false, geolocation: false, regions: [] };
    const [g] = await this.db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'map.food_geolocation'`);
    const regions = await this.db.query<{ sido: string; sigungu: string; n: number; lat: string; lng: string }>(
      `SELECT sido, sigungu, count(*)::int AS n, round(avg(lat), 5) AS lat, round(avg(lng), 5) AS lng
         FROM v_town_places WHERE sido IS NOT NULL AND sigungu IS NOT NULL
        GROUP BY sido, sigungu ORDER BY count(*) DESC, sido, sigungu LIMIT 30`);
    return {
      enabled: true, geolocation: g?.value === 'on',
      regions: regions.map((r) => ({ sido: r.sido, sigungu: r.sigungu, count: r.n, lat: Number(r.lat), lng: Number(r.lng) })),
    };
  }

  /** 지도에 보이는 네 모서리 안의 가게(최대 200) · q 는 가게 이름 */
  async places(q: { swLat?: unknown; swLng?: unknown; neLat?: unknown; neLng?: unknown; q?: unknown }) {
    if (!(await this.geo.enabled())) return { enabled: false, items: [], truncated: false };
    const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();
    const num = (v: unknown) => { const n = Number(one(v)); return Number.isFinite(n) ? n : NaN; };
    const b = [num(q.swLat), num(q.swLng), num(q.neLat), num(q.neLng)];
    if (b.some(Number.isNaN)) throw new BadRequestException('지도 범위(swLat · swLng · neLat · neLng)를 숫자로 보내십시오.');
    const [swLat, swLng, neLat, neLng] = b;
    if (swLat > neLat || swLng > neLng || neLat - swLat > 3 || neLng - swLng > 3) {
      throw new BadRequestException('지도 범위가 너무 넓습니다. 지도를 더 확대하십시오.');
    }
    const kw = one(q.q).replace(/\s+/g, ' ');
    if ([...kw].length > 40) throw new BadRequestException('가게 이름은 40자까지 찾을 수 있습니다.');
    const rows = await this.db.query<{ id: string; name: string; category: string | null; road: string | null; jibun: string | null;
      sido: string | null; sigungu: string | null; dong: string | null; lat: string; lng: string; post_count: number; pick_count: number; last_post_at: Date }>(
      `SELECT id, name, category, road, jibun, sido, sigungu, dong, lat, lng, post_count, pick_count, last_post_at
         FROM v_town_places
        WHERE lat BETWEEN $1 AND $3 AND lng BETWEEN $2 AND $4
          AND ($5 = '' OR name ILIKE '%' || replace(replace($5, '%', ''), '_', '') || '%')
        ORDER BY post_count DESC, last_post_at DESC, id
        LIMIT $6`, [swLat, swLng, neLat, neLng, kw, MAX_PINS + 1]);
    return {
      enabled: true,
      truncated: rows.length > MAX_PINS,
      items: rows.slice(0, MAX_PINS).map((r) => ({
        id: r.id, name: r.name, category: r.category, address: r.road ?? r.jibun,
        region: [r.sigungu, r.dong].filter(Boolean).join(' '),
        lat: Number(r.lat), lng: Number(r.lng), count: r.post_count, picks: r.pick_count, lastAt: r.last_post_at,
      })),
    };
  }

  /** 가게 한 곳 — 정보 · 소개 글(공개분 + 내 검수 중인 글) */
  async place(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('없는 가게입니다.');
    const [p] = await this.db.query<{ id: string; kakao_place_id: string; name: string; category: string | null; phone: string | null; road: string | null;
      jibun: string | null; sido: string | null; sigungu: string | null; dong: string | null; lat: string; lng: string;
      place_url: string | null; is_hidden: boolean }>(
      `SELECT id, kakao_place_id, name, category, phone, road, jibun, sido, sigungu, dong, lat, lng, place_url, is_hidden
         FROM town_places WHERE id = $1`, [id]);
    if (!p || p.is_hidden) throw new NotFound('없거나 운영이 숨긴 가게입니다.');
    const posts = await this.db.query<{ id: string; title: string; body: string; state: string; menu: string | null; sponsored: boolean;
      comment_count: number; created_at: Date; _name: string | null; _staff: boolean; mine: boolean }>(
      `SELECT po.id, po.title, po.body, po.state, f.menu, f.sponsored, po.comment_count, po.created_at,
              a.name AS _name,
              EXISTS (SELECT 1 FROM account_roles ar WHERE ar.account_id = a.id AND ar.role IN ('ADMIN','SUPER')) AS _staff,
              (po.author_id = $2::uuid) AS mine
         FROM town_food_posts f
         JOIN posts po ON po.id = f.post_id AND po.board = 'FOOD'
         LEFT JOIN accounts a ON a.id = po.author_id
        WHERE f.place_id = $1
          AND (po.state = 'PUBLISHED' OR (po.state = 'PENDING' AND po.author_id = $2::uuid))
        ORDER BY po.created_at DESC
        LIMIT 50`, [id, this.me ?? null]);
    return {
      id: p.id, kakaoId: p.kakao_place_id, name: p.name, category: p.category, phone: p.phone, address: p.road ?? p.jibun, jibun: p.jibun,
      region: [p.sido, p.sigungu, p.dong].filter(Boolean).join(' '),
      lat: Number(p.lat), lng: Number(p.lng), placeUrl: p.place_url,
      posts: posts.map((r) => ({
        id: r.id, title: r.title, excerpt: [...r.body].slice(0, 140).join(''), menu: r.menu, sponsored: r.sponsored,
        pick: !!r._staff, pending: r.state === 'PENDING', commentCount: r.comment_count, createdAt: r.created_at,
        author: publicAuthor(r._name, r._staff),
      })),
    };
  }

  /** 가게 찾기(로그인) — 카카오 키워드 · 음식점 · 카페만 · 1분 30회 */
  async search(q: string, lat?: number, lng?: number) {
    await this.mustEnabled();
    const me = this.me!;
    const kw = (q ?? '').trim().replace(/\s+/g, ' ');
    if ([...kw].length < 2) throw new PolicyViolation('QUERY_TOO_SHORT', '가게 이름을 두 글자 이상 넣으십시오.');
    if ([...kw].length > 40) throw new PolicyViolation('QUERY_TOO_LONG', '가게 이름은 40자까지 찾을 수 있습니다.');
    const now = Date.now();
    const hits = (this.rate.get(me) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= SEARCH_PER_MIN) throw new PolicyViolation('SEARCH_RATE', '잠시 뒤 다시 찾아 주십시오(1분에 30번까지).');
    hits.push(now); this.rate.set(me, hits);
    const near = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
    const r = await searchKeyword(await this.geo.restKey(), kw, near ? { lat, lng } : {});
    if (!r.ok) {
      const f = r as GeoFail;   // ts-node(strict 끔)는 실패 쪽을 좁히지 못합니다 — GeoFail 주석
      throw new PolicyViolation('PLACE_SEARCH_FAILED', f.kind === 'QUOTA' ? '오늘 가게 찾기 한도를 넘었습니다. 내일 다시 해 주십시오.'
        : f.kind === 'NOT_CONFIGURED' ? '우리동네 맛집은 준비 중입니다.' : '가게를 찾지 못했습니다. 잠시 뒤 다시 해 주십시오.');
    }
    const hit = r as { ok: true; places: KakaoPlace[] };   // 성공 쪽도 명시 — GeoFail 주석(ts-node strict 끔)
    const food = hit.places.filter((p) => p.group && FOOD_GROUPS.has(p.group));
    const keep = this.picks.get(me);
    const map = keep && now - keep.at < PICK_TTL_MS ? keep.places : new Map<string, KakaoPlace>();
    food.forEach((p) => map.set(p.kakaoId, p));
    this.picks.set(me, { at: now, places: map });
    if (this.picks.size > 5000) for (const [k, v] of this.picks) if (now - v.at > PICK_TTL_MS) this.picks.delete(k);
    return {
      items: food.map((p) => ({ kakaoId: p.kakaoId, name: p.name, category: p.category, address: p.road ?? p.jibun, lat: p.lat, lng: p.lng })),
      note: hit.places.length > 0 && food.length === 0 ? '음식점 · 카페만 고를 수 있습니다.' : null,
    };
  }

  /** 맛집 소개 글 쓰기(로그인) — 가게 + 글(posts FOOD) + 추천 메뉴 · 광고 · 협찬 */
  async write(dto: { kakaoPlaceId: string; title: string; body: string; menu?: string; sponsored: boolean }) {
    await this.mustEnabled();
    const me = this.me!;
    return this.db.transaction(async () => {
      const [has] = await this.db.query<{ id: string; is_hidden: boolean }>(
        `SELECT id, is_hidden FROM town_places WHERE kakao_place_id = $1`, [dto.kakaoPlaceId]);
      let placeId = has?.id;
      if (has?.is_hidden) throw new PolicyViolation('PLACE_HIDDEN', '운영이 숨긴 가게라 글을 쓸 수 없습니다.');
      if (!placeId) {
        const keep = this.picks.get(me);
        const p = keep && Date.now() - keep.at < PICK_TTL_MS ? keep.places.get(dto.kakaoPlaceId) : undefined;
        if (!p) throw new PolicyViolation('PLACE_NOT_PICKED', '가게를 다시 찾아 고르십시오(찾은 뒤 10분 안에 저장).');
        const rg = splitRegion(p.road ?? p.jibun);
        const rj = splitRegion(p.jibun);
        const [ins] = await this.db.query<{ id: string }>(
          `INSERT INTO town_places (kakao_place_id, name, category, phone, road, jibun, sido, sigungu, dong, lat, lng, place_url, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (kakao_place_id) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [p.kakaoId, p.name, p.category, p.phone, p.road, p.jibun, rg.sido, rg.sigungu, rj.dong ?? rg.dong, p.lat, p.lng, p.url, me]);
        placeId = ins.id;
      }
      const [post] = await this.db.query<{ id: string; state: string }>(
        `INSERT INTO posts (board, author_id, title, body, classified_by)
         VALUES ('FOOD', $1, $2, $3, 'USER') RETURNING id, state`, [me, dto.title.trim(), dto.body.trim()]);
      await this.db.query(
        `INSERT INTO town_food_posts (post_id, place_id, menu, sponsored) VALUES ($1, $2, $3, $4)`,
        [post.id, placeId, dto.menu?.trim() || null, dto.sponsored]);
      return {
        id: post.id, placeId, state: post.state,
        note: post.state === 'PENDING' ? '첫 글이라 확인 후 올라갑니다. 보통 하루 안에 끝납니다.' : '올라갔습니다.',
      };
    });
  }

  /* ── 운영 ───────────────────────────────────────────────────────── */

  async adminPlaces(q?: string) {
    const kw = (q ?? '').trim().slice(0, 40);
    const rows = await this.db.query(
      `SELECT tp.id, tp.name, tp.category, coalesce(tp.road, tp.jibun) AS address, tp.sido, tp.sigungu, tp.dong,
              tp.is_hidden AS "isHidden", tp.hidden_reason AS "hiddenReason", tp.place_url AS "placeUrl", tp.created_at AS "createdAt",
              (SELECT count(*)::int FROM town_food_posts f JOIN posts p ON p.id = f.post_id
                WHERE f.place_id = tp.id AND p.state = 'PUBLISHED') AS "postCount",
              (SELECT count(*)::int FROM town_food_posts f JOIN posts p ON p.id = f.post_id
                WHERE f.place_id = tp.id AND p.state = 'PENDING') AS "pendingCount"
         FROM town_places tp
        WHERE ($1 = '' OR tp.name ILIKE '%' || replace(replace($1, '%', ''), '_', '') || '%'
               OR coalesce(tp.road, tp.jibun, '') ILIKE '%' || replace(replace($1, '%', ''), '_', '') || '%')
        ORDER BY tp.created_at DESC
        LIMIT 200`, [kw]);
    return { items: rows };
  }

  async adminHide(id: string, dto: { hidden: boolean; reason?: string }) {
    const reason = dto.reason?.trim() || null;
    if (dto.hidden && !reason) throw new PolicyViolation('HIDE_REASON', '숨기는 이유를 적어 주십시오.');
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE town_places SET is_hidden = $2, hidden_reason = CASE WHEN $2 THEN $3 ELSE NULL END, updated_at = now()
        WHERE id = $1 RETURNING id`, [id, dto.hidden, reason]);
    if (!r) throw new NotFound('없는 가게입니다.');
    return { id, hidden: dto.hidden, note: dto.hidden ? '숨겼습니다 — 지도 · 목록 · 가게 화면에서 빠집니다(글은 남습니다).' : '다시 보이게 했습니다.' };
  }
}
