import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { searchAddress, GeoFail, GeoFailKind } from './kakao-local.provider';

/* ---------------------------------------------------------------------
 * v10.46 (docs/96) — 지도 · 좌표 (외부 연동 MAP)
 *
 * ── 지금 화면에 영향 없음 ──────────────────────────────────────────────
 * map.enabled 가 off(처음 값)이면 이 서비스는 아무것도 하지 않습니다 — 좌표를 구하지 않고, 상세 응답의 geo 는 null,
 * 지도 설정(GET /site-settings/map)은 enabled=false. 화면은 지도 연동 전과 같습니다.
 *
 * ── 키 ────────────────────────────────────────────────────────────────
 * 운영 화면(외부 연동 › 카카오맵 키 · SUPER)에서 넣은 값이 먼저(integration_secrets · 암호화), 없으면 .env.
 *   REST API 키  KAKAO_REST_KEY             서버만 씀 · 화면 · 응답 · 로그에 내보내지 않음
 *   JS 키        NEXT_PUBLIC_KAKAO_JS_KEY   공개 키(브라우저가 지도를 그릴 때) — GET /site-settings/map 이 줌
 * 키를 읽는 일은 1분 동안 기억합니다(넣거나 지우면 바로 잊음).
 *
 * ── 정밀도 ────────────────────────────────────────────────────────────
 * 정확 좌표(listing_geo)는 본인 · 운영에게만. 남에게는 시 · 구 중심(geo_region) + 반경 2km — 방침 「목록 · 상세에는 시 · 구까지」.
 *
 * ── 등록은 지도 때문에 실패하지 않습니다 ───────────────────────────────
 * 좌표는 매물 저장이 끝난 뒤 따로 구합니다(scheduleListing). 실패하면 상태만 남기고 배치(geo_backfill)가 다시 합니다.
 * 카카오에는 도로명(없으면 지번)만 보냅니다 — 상세주소(동 · 호)는 보내지 않습니다. 로그에 주소를 남기지 않습니다.
 * ------------------------------------------------------------------- */

export const REGION_RADIUS_M = 2000;
const CACHE_MS = 60_000;
const BACKFILL_MAX_TRIES = 3;
export const MAP_SECRET_NAMES = ['KAKAO_REST_KEY', 'KAKAO_JS_KEY'] as const;
export type MapSecretName = typeof MAP_SECRET_NAMES[number];

type Addr = { road?: string; jibun?: string; sido?: string; sigungu?: string } | null;

@Injectable()
export class GeoService {
  private readonly log = new Logger('Geo');
  private cache = new Map<string, { v: string | null; at: number }>();

  constructor(private readonly db: DatabaseService) {}

  /* ── 설정 · 키 ───────────────────────────────────────────────────── */

  private async cached(k: string, load: () => Promise<string | null>) {
    const c = this.cache.get(k);
    if (c && Date.now() - c.at < CACHE_MS) return c.v;
    const v = await load().catch(() => null);
    this.cache.set(k, { v, at: Date.now() });
    return v;
  }
  forget() { this.cache.clear(); }

  async enabled(): Promise<boolean> {
    const v = await this.cached('enabled', async () => {
      const [r] = await this.db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'map.enabled'`);
      return r?.value ?? null;
    });
    return v === 'on';
  }

  private async dbSecret(name: MapSecretName): Promise<string | null> {
    return this.cached(`secret:${name}`, async () => {
      const [r] = await this.db.query<{ v: string | null }>(`SELECT public.fn_integ_secret_get('MAP', $1) AS v`, [name]);
      return r?.v ?? null;
    });
  }

  async restKey(): Promise<string | null> {
    return (await this.dbSecret('KAKAO_REST_KEY')) || process.env.KAKAO_REST_KEY?.trim() || null;
  }

  async jsKey(): Promise<string | null> {
    return (await this.dbSecret('KAKAO_JS_KEY')) || process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim() || null;
  }

  /** GET /site-settings/map — 누구나. 꺼져 있거나 JS 키가 없으면 enabled=false · jsKey=null */
  async publicConfig() {
    const [on, js] = await Promise.all([this.enabled(), this.jsKey()]);
    return { enabled: on && !!js, jsKey: on && js ? js : null };
  }

  /* ── 매물 좌표 ───────────────────────────────────────────────────── */

  private static hash(a: Addr) {
    return createHash('sha256').update(`${a?.road ?? ''}|${a?.jibun ?? ''}`).digest('hex').slice(0, 32);
  }

  /** 매물 저장 · 수정 뒤에 부릅니다. 기다리지 않고, 요청 · 트랜잭션과 떨어진 곳에서 돕니다 */
  scheduleListing(listingId: string) {
    setImmediate(() => {
      void RequestCtx.run({ requestId: `geo-${listingId.slice(0, 8)}` }, async () => {
        try {
          if (await this.enabled()) await this.geocodeListing(listingId, false);
        } catch (e) { this.log.warn(`좌표 예약 실패 ${listingId}: ${(e as Error).message}`); }
      });
    });
  }

  /** 한 매물의 좌표를 구합니다. force 면 주소가 같아도 다시(운영 「다시 변환」) */
  async geocodeListing(listingId: string, force: boolean): Promise<{ status: string; failKind: string | null }> {
    const [l] = await this.db.query<{ address: Addr }>(`SELECT address FROM listings WHERE id = $1`, [listingId]);
    if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
    const a = l.address;
    const q = (a?.road || a?.jibun || '').trim();
    if (!q) {
      await this.db.query(`DELETE FROM listing_geo WHERE listing_id = $1`, [listingId]);
      return { status: 'NONE', failKind: null };
    }
    const h = GeoService.hash(a);
    const [cur] = await this.db.query<{ status: string; address_hash: string }>(
      `SELECT status, address_hash FROM listing_geo WHERE listing_id = $1`, [listingId]);
    if (!force && cur && cur.address_hash === h && cur.status === 'OK') return { status: 'OK', failKind: null };
    const sameAddr = !!cur && cur.address_hash === h;
    await this.db.query(
      `INSERT INTO listing_geo (listing_id, status, address_hash, tries, updated_at)
       VALUES ($1, 'PENDING', $2, 0, now())
       ON CONFLICT (listing_id) DO UPDATE
          SET status = 'PENDING', address_hash = EXCLUDED.address_hash, fail_kind = NULL, updated_at = now(),
              tries = CASE WHEN $3::boolean THEN listing_geo.tries ELSE 0 END,
              lat = CASE WHEN $3::boolean THEN listing_geo.lat END, lng = CASE WHEN $3::boolean THEN listing_geo.lng END`,
      [listingId, h, sameAddr]);

    const r = await searchAddress(await this.restKey(), q);
    if (r.ok) {
      await this.db.query(
        `UPDATE listing_geo SET status = 'OK', lat = $2, lng = $3, fail_kind = NULL, geocoded_at = now(), updated_at = now(),
                tries = tries + 1
          WHERE listing_id = $1`, [listingId, r.lat, r.lng]);
      if (a?.sido && a?.sigungu) await this.ensureRegion(a.sido, a.sigungu).catch(() => undefined);
      return { status: 'OK', failKind: null };
    }
    const f = r as GeoFail;   // ts-node(strict 끔)는 실패 쪽을 좁히지 못합니다 — GeoFail 주석
    const status = f.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'FAILED';
    await this.db.query(
      `UPDATE listing_geo SET status = $2, fail_kind = $3, lat = NULL, lng = NULL, updated_at = now(), tries = tries + 1
        WHERE listing_id = $1`, [listingId, status, f.kind]);
    return { status, failKind: f.kind };
  }

  /** 시 · 구 중심을 한 번만 찾아 둡니다(이미 있으면 부르지 않음) */
  async ensureRegion(sido: string, sigungu: string) {
    const s = sido.trim(), g = sigungu.trim();
    if (!s || !g) return;
    const [has] = await this.db.query(`SELECT 1 FROM geo_region WHERE sido = $1 AND sigungu = $2`, [s, g]);
    if (has) return;
    const r = await searchAddress(await this.restKey(), `${s} ${g}`);
    if (!r.ok) return;
    await this.db.query(
      `INSERT INTO geo_region (sido, sigungu, lat, lng) VALUES ($1, $2, $3, $4) ON CONFLICT (sido, sigungu) DO NOTHING`,
      [s, g, r.lat, r.lng]);
  }

  /**
   * 상세 응답의 geo 칸. 지도 사용이 꺼져 있으면 언제나 null(지금 화면 그대로).
   *   본인    EXACT — 좌표(OK) 또는 상태(PENDING · FAILED · NOT_FOUND)
   *   남      REGION — 시 · 구 중심(소수 4자리) · 반경 2km · 이름. 정확 좌표는 절대 내보내지 않습니다
   */
  async listingGeo(listingId: string, isOwn: boolean, address: Addr) {
    if (!(await this.enabled())) return null;
    if (isOwn) {
      const [g] = await this.db.query<{ status: string; lat: string | null; lng: string | null }>(
        `SELECT status, lat, lng FROM listing_geo WHERE listing_id = $1`, [listingId]);
      if (!g) return address?.road || address?.jibun ? { precision: 'EXACT' as const, status: 'PENDING' as const } : null;
      return g.status === 'OK' && g.lat != null && g.lng != null
        ? { precision: 'EXACT' as const, status: 'OK' as const, lat: Number(g.lat), lng: Number(g.lng) }
        : { precision: 'EXACT' as const, status: g.status as 'PENDING' | 'FAILED' | 'NOT_FOUND' };
    }
    const sido = address?.sido?.trim(), sigungu = address?.sigungu?.trim();
    if (!sido || !sigungu) return null;
    const [r] = await this.db.query<{ lat: string; lng: string }>(
      `SELECT round(lat, 4) AS lat, round(lng, 4) AS lng FROM geo_region WHERE sido = $1 AND sigungu = $2`, [sido, sigungu]);
    if (!r) return null;
    return { precision: 'REGION' as const, lat: Number(r.lat), lng: Number(r.lng), radiusM: REGION_RADIUS_M, label: `${sido} ${sigungu}` };
  }

  /* ── 운영 ───────────────────────────────────────────────────────── */

  async adminListingGeo(listingId: string) {
    const [l] = await this.db.query<{ address: Addr }>(`SELECT address FROM listings WHERE id = $1`, [listingId]);
    if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
    const [g] = await this.db.query<{ status: string; lat: string | null; lng: string | null; fail_kind: string | null;
                                      tries: number; geocoded_at: Date | null; updated_at: Date }>(
      `SELECT status, lat, lng, fail_kind, tries, geocoded_at, updated_at FROM listing_geo WHERE listing_id = $1`, [listingId]);
    return {
      enabled: await this.enabled(),
      hasAddress: !!(l.address?.road || l.address?.jibun),
      status: g?.status ?? 'NONE',
      lat: g?.lat != null ? Number(g.lat) : null, lng: g?.lng != null ? Number(g.lng) : null,
      failKind: g?.fail_kind ?? null, tries: g?.tries ?? 0,
      geocodedAt: g?.geocoded_at ?? null, updatedAt: g?.updated_at ?? null,
    };
  }

  async adminRetry(listingId: string) {
    const cur = await this.adminListingGeo(listingId);
    if (!cur.enabled) throw new PolicyViolation('MAP_DISABLED', '지도 사용이 꺼져 있습니다. 외부 연동 › 카카오맵 키에서 먼저 켜십시오.');
    if (!cur.hasAddress) throw new StateConflict('GEO_NOT_RETRYABLE', '이 매물에는 소재지 주소가 없습니다.');
    if (cur.status === 'OK' || cur.status === 'PENDING') {
      throw new StateConflict('GEO_NOT_RETRYABLE', cur.status === 'OK' ? '이미 좌표가 있습니다.' : '지금 찾는 중입니다. 잠시 뒤 새로 고침하십시오.');
    }
    await this.geocodeListing(listingId, true);
    return this.adminListingGeo(listingId);
  }

  /** 배치 geo_backfill — 좌표 없음 · 오래된 PENDING · 3회 미만 FAILED 를 50건까지 */
  async backfill(limit = 50) {
    if (!(await this.enabled()) || !(await this.restKey())) return { affected: 0, detail: { skipped: true } };
    const rows = await this.db.query<{ id: string }>(
      `SELECT l.id FROM listings l
         LEFT JOIN listing_geo g ON g.listing_id = l.id
        WHERE l.status IN ('PUBLISHED','IN_REVIEW')
          AND coalesce(nullif(btrim(l.address->>'road'), ''), nullif(btrim(l.address->>'jibun'), '')) IS NOT NULL
          AND (g.listing_id IS NULL
               OR (g.status = 'PENDING' AND g.updated_at < now() - interval '5 minutes')
               OR (g.status = 'FAILED' AND g.tries < $2))
        ORDER BY g.updated_at NULLS FIRST, l.created_at
        LIMIT $1`, [limit, BACKFILL_MAX_TRIES]);
    let ok = 0, fail = 0;
    const kinds: Record<string, number> = {};
    for (const r of rows) {
      const out = await this.geocodeListing(r.id, false).catch(() => ({ status: 'FAILED', failKind: 'UPSTREAM' }));
      if (out.status === 'OK') ok++; else { fail++; if (out.failKind) kinds[out.failKind] = (kinds[out.failKind] ?? 0) + 1; }
      if (out.failKind === 'QUOTA' || out.failKind === 'AUTH' || out.failKind === 'NOT_CONFIGURED') break;   // 더 불러도 같은 결과
    }
    return { affected: ok, detail: { picked: rows.length, ok, fail, kinds } };
  }

  /* ── 운영 화면 › 외부 연동 › 카카오맵 키 (SUPER) ───────────────────── */

  async secretsView() {
    const rows = await this.db.query<{ name: string; last4: string; updated_at: Date }>(
      `SELECT name, last4, updated_at FROM integration_secrets WHERE integration_code = 'MAP'`);
    const envOf: Record<MapSecretName, string | undefined> = {
      KAKAO_REST_KEY: process.env.KAKAO_REST_KEY, KAKAO_JS_KEY: process.env.NEXT_PUBLIC_KAKAO_JS_KEY };
    return {
      enabled: await this.enabled(),
      keys: MAP_SECRET_NAMES.map((n) => {
        const r = rows.find((x) => x.name === n);
        const env = envOf[n]?.trim();
        return {
          name: n,
          source: r ? 'ADMIN' : env ? 'ENV' : 'NONE',
          masked: r ? `••••••${r.last4}` : env ? `••••••${env.slice(-4)}` : null,
          updatedAt: r?.updated_at ?? null,
        };
      }),
    };
  }

  async setSecret(name: string, value: string) {
    if (!(MAP_SECRET_NAMES as readonly string[]).includes(name)) throw new NotFound('없는 키 이름입니다.');
    await this.db.query(`SELECT * FROM public.fn_integ_secret_set('MAP', $1, $2, $3)`, [name, value, RequestCtx.actorId() ?? null]);
    this.forget();
    return this.secretsView();
  }

  async clearSecret(name: string) {
    if (!(MAP_SECRET_NAMES as readonly string[]).includes(name)) throw new NotFound('없는 키 이름입니다.');
    await this.db.query(`DELETE FROM integration_secrets WHERE integration_code = 'MAP' AND name = $1`, [name]);
    if (name === 'KAKAO_REST_KEY') {
      await this.db.query(`UPDATE integrations SET secret_registered = false WHERE code = 'MAP'`);
    }
    this.forget();
    return this.secretsView();
  }

  async setEnabled(on: boolean) {
    await this.db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'map.enabled'`,
      [on ? 'on' : 'off', RequestCtx.actorId() ?? null]);
    this.forget();
    return this.secretsView();
  }

  /** 시험 호출 — 서울시청 주소 1건 · 키는 내보내지 않고 결과 종류만 */
  async testCall(): Promise<{ ok: boolean; kind: GeoFailKind | null; message: string }> {
    const key = await this.restKey();
    if (!key) throw new PolicyViolation('GEO_KEY_MISSING', 'REST API 키가 없습니다. 먼저 키를 넣으십시오.');
    const r = await searchAddress(key, '서울특별시 중구 세종대로 110');
    if (r.ok) return { ok: true, kind: null, message: '카카오 로컬 호출 성공 — 좌표를 받았습니다.' };
    const why: Partial<Record<GeoFailKind, string>> = {
      AUTH: '키가 틀렸거나 허용 IP 밖입니다(카카오 콘솔 › 앱 키 · 보안).',
      QUOTA: '오늘 쿼터를 넘었습니다(카카오 콘솔 › 통계).',
      TIMEOUT: '응답이 늦습니다 — 잠시 뒤 다시 하십시오.',
      NETWORK: '서버에서 카카오로 연결하지 못했습니다(발신 · 방화벽).',
      HTTP_4XX: '카카오가 요청을 받지 않았습니다 — 「카카오맵」 사용 설정(콘솔 › 제품 설정)을 확인하십시오.',
    };
    const f = r as GeoFail;   // GeoFail 주석
    return { ok: false, kind: f.kind, message: why[f.kind] ?? `실패(${f.kind})` };
  }
}
