import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';
import {
  dayBase, fcstBase, getFcst, getNcst, ncstBase, todayKst, WX_REGION_CODES, WX_REGIONS,
  WxFail, WxFailKind, WxItem, WxItems, WxRegion,
} from './weather.provider';

/* ---------------------------------------------------------------------
 * v10.49 (D103 · docs/101) — 메인 「오늘의 날씨」 (외부 연동 WEATHER)
 *
 * ── 지금 화면에 영향 없음 ──────────────────────────────────────────────
 * weather.enabled 가 off(처음 값)이거나 키가 없으면 기상청을 부르지 않고 available=false — 메인은 날씨 띠를 그리지 않습니다.
 * 기상청이 실패해도 마찬가지입니다. **지어낸 날씨는 내보내지 않습니다.**
 *
 * ── 키 ────────────────────────────────────────────────────────────────
 * 운영 화면(외부 연동 › 날씨 키 · SUPER)에서 넣은 값이 먼저(integration_secrets · 암호화), 없으면 .env KMA_SERVICE_KEY.
 * 서버만 씁니다 — 화면 · 응답 · 로그 · 감사 기록에 내보내지 않습니다.
 *
 * ── 호출 수 ───────────────────────────────────────────────────────────
 * 기상청 응답은 「발표 시각 × 격자」마다 한 번만 받아 기억합니다. 같은 발표를 다시 부르지 않습니다.
 *   지역 하나에 하루 최대 실황 24 + 예보 8 + 최저 · 최고 1 = 33번 → 17곳 모두 보여도 약 560번(개발계정 한도 안 · 한도 수치는 확인 필요)
 * 실패하면 그 지역은 2분 동안 다시 부르지 않고, 직전에 받은 값이 있으면 그것을 씁니다(발표 시각을 함께 보여 줌).
 * ------------------------------------------------------------------- */

const CACHE_MS = 60_000;
const FAIL_BACKOFF_MS = 2 * 60_000;
const KEEP_MS = 30 * 3600_000;

export type WxIcon = 'sun' | 'partly' | 'cloud' | 'rain' | 'sleet' | 'snow';

export interface WeatherToday {
  available: boolean;
  region: string;
  regionName: string;
  regions: { code: string; name: string }[];
  temp: number | null;
  label: string | null;
  icon: WxIcon | null;
  min: number | null;
  max: number | null;
  pop: number | null;
  humidity: number | null;
  observedAt: string | null;
  source: string;
}

const PTY_LABEL: Record<string, [string, WxIcon]> = {
  '1': ['비', 'rain'], '2': ['비 또는 눈', 'sleet'], '3': ['눈', 'snow'], '4': ['소나기', 'rain'],
  '5': ['빗방울', 'rain'], '6': ['빗방울 · 눈날림', 'sleet'], '7': ['눈날림', 'snow'],
};
const SKY_LABEL: Record<string, [string, WxIcon]> = { '1': ['맑음', 'sun'], '3': ['구름 많음', 'partly'], '4': ['흐림', 'cloud'] };

const num = (v: string | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  /* 기상청 결측값은 +900 이상 · -900 이하 */
  return Number.isFinite(n) && n > -900 && n < 900 ? n : null;
};

@Injectable()
export class WeatherService {
  private readonly log = new Logger('Weather');
  private settings = new Map<string, { v: string | null; at: number }>();
  /** 기상청 응답 — 키: 종류:발표:격자 */
  private wx = new Map<string, { items: WxItem[]; at: number }>();
  /** 지역별 마지막 성공(실패 때 대신 씀) · 실패 시각 */
  private lastGood = new Map<string, { kind: string; items: WxItem[]; base: string }>();
  private failedAt = new Map<string, number>();
  private inflight = new Map<string, Promise<WxItems>>();

  constructor(private readonly db: DatabaseService) {}

  /* ── 설정 · 키 ───────────────────────────────────────────────────── */

  private async cached(k: string, load: () => Promise<string | null>) {
    const c = this.settings.get(k);
    if (c && Date.now() - c.at < CACHE_MS) return c.v;
    const v = await load().catch(() => null);
    this.settings.set(k, { v, at: Date.now() });
    return v;
  }
  forget() { this.settings.clear(); }

  private setting(key: string) {
    return this.cached(`set:${key}`, async () => {
      const [r] = await this.db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
      return r?.value ?? null;
    });
  }

  async enabled(): Promise<boolean> { return (await this.setting('weather.enabled')) === 'on'; }

  async defaultRegion(): Promise<string> {
    const v = await this.setting('weather.default_region');
    return v && WX_REGION_CODES.includes(v) ? v : 'SEOUL';
  }

  private async dbKey(): Promise<string | null> {
    return this.cached('secret', async () => {
      const [r] = await this.db.query<{ v: string | null }>(`SELECT public.fn_integ_secret_get('WEATHER', 'KMA_SERVICE_KEY') AS v`);
      return r?.v ?? null;
    });
  }

  async serviceKey(): Promise<string | null> {
    return (await this.dbKey()) || process.env.KMA_SERVICE_KEY?.trim() || null;
  }

  /* ── 기상청 부르기 (발표마다 한 번) ───────────────────────────────── */

  private prune() {
    const old = Date.now() - KEEP_MS;
    for (const [k, v] of this.wx) if (v.at < old) this.wx.delete(k);
  }

  private async fetchOnce(kind: 'N' | 'F' | 'D', r: WxRegion, b: { date: string; time: string }, key: string): Promise<WxItems> {
    const ck = `${kind}:${b.date}${b.time}:${r.nx},${r.ny}`;
    const hit = this.wx.get(ck);
    if (hit) return { ok: true, items: hit.items };
    const fk = `${kind}:${r.code}`;
    const failed = this.failedAt.get(fk);
    if (failed && Date.now() - failed < FAIL_BACKOFF_MS) return { ok: false, kind: 'UPSTREAM', detail: 'backoff' };
    const running = this.inflight.get(ck);
    if (running) return running;
    const p = (async (): Promise<WxItems> => {
      const g = { nx: r.nx, ny: r.ny };
      const out = kind === 'N' ? await getNcst(key, b, g) : await getFcst(key, b, g, kind === 'D' ? 400 : 120);
      if (out.ok) {
        const items = (out as { ok: true; items: WxItem[] }).items;
        this.prune();
        this.wx.set(ck, { items, at: Date.now() });
        this.lastGood.set(fk, { kind, items, base: `${b.date}${b.time}` });
        this.failedAt.delete(fk);
      } else {
        const f = out as WxFail;
        /* 자료 없음(발표 직후)은 바로 한 시간 전 자료로 다시 부르므로 쉬지 않습니다 */
        if (f.kind !== 'NO_DATA') this.failedAt.set(fk, Date.now());
        this.log.warn(`기상청 ${kind} ${r.code} 실패 — ${f.kind}${f.detail ? ` (${f.detail})` : ''}`);
      }
      return out;
    })().finally(() => this.inflight.delete(ck));
    this.inflight.set(ck, p);
    return p;
  }

  /** 성공이면 그 값, 실패면 직전 성공 값(없으면 null) */
  private async items(kind: 'N' | 'F' | 'D', r: WxRegion, b: { date: string; time: string }, key: string): Promise<{ items: WxItem[]; base: string } | null> {
    const out = await this.fetchOnce(kind, r, b, key);
    if (out.ok) return { items: (out as { ok: true; items: WxItem[] }).items, base: `${b.date}${b.time}` };
    const prev = this.lastGood.get(`${kind}:${r.code}`);
    return prev ? { items: prev.items, base: prev.base } : null;
  }

  /* ── GET /weather/today ─────────────────────────────────────────── */

  async today(regionCode?: string): Promise<WeatherToday> {
    const def = await this.defaultRegion();
    const code = regionCode && WX_REGION_CODES.includes(regionCode) ? regionCode : def;
    const r = WX_REGIONS.find((x) => x.code === code) ?? WX_REGIONS[0];
    const empty: WeatherToday = {
      available: false, region: r.code, regionName: r.name, regions: WX_REGIONS.map((x) => ({ code: x.code, name: x.name })),
      temp: null, label: null, icon: null, min: null, max: null, pop: null, humidity: null, observedAt: null, source: '기상청',
    };
    if (!(await this.enabled())) return empty;
    const key = await this.serviceKey();
    if (!key) return empty;

    const now = Date.now();
    const [n0, f, d] = await Promise.all([
      this.items('N', r, ncstBase(now), key),
      this.items('F', r, fcstBase(now), key),
      this.items('D', r, dayBase(now), key),
    ]);
    /* 정시 40분이 지났는데 아직 자료가 없으면 한 시간 전 자료 */
    const n = n0 ?? await this.items('N', r, ncstBase(now, 1), key);
    return { ...empty, ...WeatherService.compose(n, f, d, now) };
  }

  /** 기상청 줄 → 화면 값. 시험에서 따로 부를 수 있게 static */
  static compose(n: { items: WxItem[]; base: string } | null, f: { items: WxItem[]; base: string } | null,
                 d: { items: WxItem[]; base: string } | null, now: number): Partial<WeatherToday> {
    const today = todayKst(now);
    const hourKey = `${today}${String(new Date(now + 9 * 3600_000).getUTCHours()).padStart(2, '0')}00`;
    const ncst = (c: string) => n?.items.find((x) => x.category === c)?.value;
    /* 예보 — 지금 시각 이후 가장 가까운 시각의 값 */
    const ahead = (f?.items ?? []).filter((x) => `${x.fcstDate}${x.fcstTime}` >= hourKey)
      .sort((a, b) => `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`));
    const next = (c: string) => ahead.find((x) => x.category === c)?.value;

    const temp = num(ncst('T1H')) ?? num(next('TMP'));
    if (temp === null) return { available: false };

    const pty = ncst('PTY') ?? next('PTY') ?? '0';
    const look = PTY_LABEL[pty] ?? SKY_LABEL[next('SKY') ?? ''] ?? null;

    /* 최저 · 최고 — 오늘 02시 발표의 TMN · TMX. 없으면 예보의 오늘 남은 시간 기온으로 */
    const dayVal = (c: string) => num(d?.items.find((x) => x.category === c && x.fcstDate === today)?.value);
    const todayTmp = ahead.filter((x) => x.category === 'TMP' && x.fcstDate === today).map((x) => num(x.value)).filter((x): x is number => x !== null);
    let min = dayVal('TMN') ?? (todayTmp.length ? Math.min(...todayTmp, temp) : null);
    let max = dayVal('TMX') ?? (todayTmp.length ? Math.max(...todayTmp, temp) : null);
    if (min !== null && temp < min) min = temp;
    if (max !== null && temp > max) max = temp;

    /* 강수확률 — 오늘 남은 시간 중 가장 높은 값 */
    const pops = ahead.filter((x) => x.category === 'POP' && x.fcstDate === today).map((x) => num(x.value)).filter((x): x is number => x !== null);
    const pop = pops.length ? Math.max(...pops) : num(next('POP'));

    const obs = n?.base ?? f?.base ?? null;
    return {
      available: true,
      temp: Math.round(temp),
      label: look ? look[0] : null,
      icon: look ? look[1] : null,
      min: min === null ? null : Math.round(min),
      max: max === null ? null : Math.round(max),
      pop,
      humidity: num(ncst('REH')),
      observedAt: obs ? `${Number(obs.slice(8, 10))}시` : null,
    };
  }

  /* ── 운영 화면 › 외부 연동 › 날씨 키 (SUPER) ───────────────────────── */

  async adminView() {
    const [r] = await this.db.query<{ last4: string; updated_at: Date }>(
      `SELECT last4, updated_at FROM integration_secrets WHERE integration_code = 'WEATHER' AND name = 'KMA_SERVICE_KEY'`);
    const env = process.env.KMA_SERVICE_KEY?.trim();
    return {
      enabled: await this.enabled(),
      defaultRegion: await this.defaultRegion(),
      regions: WX_REGIONS.map((x) => ({ code: x.code, name: x.name })),
      key: {
        name: 'KMA_SERVICE_KEY',
        source: r ? 'ADMIN' : env ? 'ENV' : 'NONE',
        masked: r ? `••••••${r.last4}` : env ? `••••••${env.slice(-4)}` : null,
        updatedAt: r?.updated_at ?? null,
      },
    };
  }

  async setKey(value: string) {
    await this.db.query(`SELECT * FROM public.fn_integ_secret_set('WEATHER', 'KMA_SERVICE_KEY', $1, $2)`, [value, RequestCtx.actorId() ?? null]);
    this.forget();
    this.failedAt.clear();
    return this.adminView();
  }

  async clearKey() {
    await this.db.query(`DELETE FROM integration_secrets WHERE integration_code = 'WEATHER' AND name = 'KMA_SERVICE_KEY'`);
    await this.db.query(`UPDATE integrations SET secret_registered = false WHERE code = 'WEATHER'`);
    this.forget();
    return this.adminView();
  }

  async update(enabled: boolean | undefined, defaultRegion: string | undefined) {
    if (defaultRegion !== undefined && !WX_REGION_CODES.includes(defaultRegion)) {
      throw new PolicyViolation('WEATHER_REGION', '없는 지역입니다.');
    }
    const actor = RequestCtx.actorId() ?? null;
    if (enabled !== undefined) {
      await this.db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'weather.enabled'`,
        [enabled ? 'on' : 'off', actor]);
    }
    if (defaultRegion !== undefined) {
      await this.db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'weather.default_region'`,
        [defaultRegion, actor]);
    }
    this.forget();
    return this.adminView();
  }

  /** 시험 호출 — 서울 초단기실황 1번 · 키는 내보내지 않고 결과 종류만 */
  async testCall(): Promise<{ ok: boolean; kind: WxFailKind | null; message: string }> {
    const key = await this.serviceKey();
    if (!key) throw new PolicyViolation('WEATHER_KEY_MISSING', '기상청 인증키가 없습니다. 먼저 키를 넣으십시오.');
    const seoul = WX_REGIONS[0];
    let r = await getNcst(key, ncstBase(Date.now()), seoul);
    if (!r.ok && (r as WxFail).kind === 'NO_DATA') r = await getNcst(key, ncstBase(Date.now(), 1), seoul);
    if (r.ok) {
      const t = num((r as { ok: true; items: WxItem[] }).items.find((x) => x.category === 'T1H')?.value);
      return { ok: true, kind: null, message: `기상청 호출 성공 — 서울 지금 ${t ?? '?'}°C` };
    }
    const why: Partial<Record<WxFailKind, string>> = {
      AUTH: '키가 틀렸거나 아직 승인 · 반영 전입니다(공공데이터포털 › 마이페이지 › 활용 신청 상태 · 신청 직후 1시간쯤 걸릴 수 있음).',
      QUOTA: '오늘 호출 한도를 넘었습니다(공공데이터포털 › 활용 신청 상세의 일일 트래픽).',
      TIMEOUT: '응답이 늦습니다 — 잠시 뒤 다시 하십시오.',
      NETWORK: '서버에서 기상청(apis.data.go.kr)으로 연결하지 못했습니다(발신 · 방화벽).',
      NO_DATA: '아직 이번 시각 자료가 없습니다 — 몇 분 뒤 다시 하십시오.',
      REJECTED: '기상청이 요청을 받지 않았습니다 — 「단기예보 조회서비스」를 신청한 키인지 확인하십시오.',
    };
    const f = r as WxFail;
    return { ok: false, kind: f.kind, message: why[f.kind] ?? `실패(${f.kind})` };
  }
}
