import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.602 ~ 608 (docs/744 ~ 750) 17차 매물 · 소개몰 — 공통(설정 16 · 정규식 · 알림 · 가림)
 *   스위치는 모두 처음 off — lsq.bulk · lsq.review_ask · lsq.search_click · lsq.region_pages · lsq.sub_retry · lsq.track · lsq.track_auto_deliver · lsq.return_photos
 *   외부 연동(택배사 조회)은 방식 lsq.track_mode = ASSUME(처음) · 바꾸기는 SUPER(사유 · 설정 바뀜 기록)
 *   설정 값 검사 정규식 = DB site_settings.value_pattern 과 같은 글자(계약 규칙 2)
 * ------------------------------------------------------------------- */

export const LSQ_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const LSQ_PATTERNS: Record<string, string> = {
  'lsq.bulk': '^(on|off)$',
  'lsq.bulk_max_rows': '^([1-9][0-9]|1[0-9]{2}|200)$',
  'lsq.review_ask': '^(on|off)$',
  'lsq.review_ask_days': '^([1-9]|1[0-4])$',
  'lsq.review_ask_again': '^([0-9]|[12][0-9]|30)$',
  'lsq.search_click': '^(on|off)$',
  'lsq.search_click_keep_days': '^([3-9][0-9]|[1-6][0-9]{2}|7[0-2][0-9]|730)$',
  'lsq.region_pages': '^(on|off)$',
  'lsq.region_min': '^([1-9]|[1-4][0-9]|50)$',
  'lsq.sub_retry': '^(on|off)$',
  'lsq.sub_retry_days': '^([1-9]|1[0-4])(,([1-9]|1[0-4])){0,4}$',
  'lsq.track': '^(on|off)$',
  'lsq.track_mode': '^(ASSUME|LIVE)$',
  'lsq.track_auto_deliver': '^(on|off)$',
  'lsq.return_photos': '^(on|off)$',
  'lsq.return_photo_max': '^([1-9]|10)$',
};

export interface LsqSettings {
  bulkOn: boolean; bulkMaxRows: number;
  reviewAskOn: boolean; reviewAskDays: number; reviewAskAgain: number;
  searchClickOn: boolean; searchClickKeepDays: number;
  regionOn: boolean; regionMin: number;
  subRetryOn: boolean; subRetryDays: number[];
  trackOn: boolean; trackMode: 'ASSUME' | 'LIVE'; trackAutoDeliver: boolean;
  returnPhotosOn: boolean; returnPhotoMax: number;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값(캐시 없음 — 끄면 바로 멈추게) */
export async function lsqSettings(db: DatabaseService): Promise<LsqSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'lsq.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, (r.value ?? '').trim()])) as Record<string, string>;
  const days = m['lsq.sub_retry_days'] ?? '';
  return {
    bulkOn: m['lsq.bulk'] === 'on',
    bulkMaxRows: int(m['lsq.bulk_max_rows'], 50, 10, 200),
    reviewAskOn: m['lsq.review_ask'] === 'on',
    reviewAskDays: int(m['lsq.review_ask_days'], 3, 1, 14),
    reviewAskAgain: int(m['lsq.review_ask_again'], 7, 0, 30),
    searchClickOn: m['lsq.search_click'] === 'on',
    searchClickKeepDays: int(m['lsq.search_click_keep_days'], 180, 30, 730),
    regionOn: m['lsq.region_pages'] === 'on',
    regionMin: int(m['lsq.region_min'], 3, 1, 50),
    subRetryOn: m['lsq.sub_retry'] === 'on',
    subRetryDays: new RegExp(LSQ_PATTERNS['lsq.sub_retry_days']!).test(days) ? days.split(',').map(Number) : [1, 3, 5],
    trackOn: m['lsq.track'] === 'on',
    trackMode: m['lsq.track_mode'] === 'LIVE' ? 'LIVE' : 'ASSUME',
    trackAutoDeliver: m['lsq.track_auto_deliver'] === 'on',
    returnPhotosOn: m['lsq.return_photos'] === 'on',
    returnPhotoMax: int(m['lsq.return_photo_max'], 5, 1, 10),
  };
}

export interface LsqSettingsInput {
  bulkOn?: boolean; bulkMaxRows?: number;
  reviewAskOn?: boolean; reviewAskDays?: number; reviewAskAgain?: number;
  searchClickOn?: boolean; searchClickKeepDays?: number;
  regionOn?: boolean; regionMin?: number;
  subRetryOn?: boolean; subRetryDays?: number[];
  trackOn?: boolean; trackMode?: string; trackAutoDeliver?: boolean;
  returnPhotosOn?: boolean; returnPhotoMax?: number;
  reason: string;
}

/** SUPER — 보낸 칸만 바꿈(컨트롤러가 undefined 를 거름 · 규칙 11) · 사유는 설정 바뀜 기록(app.setting_reason) */
export async function setLsqSettings(db: DatabaseService, d: LsqSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('LSQ_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : Array.isArray(v) ? v.map(String).join(',') : String(v).trim();
    if (!new RegExp(LSQ_PATTERNS[key]!).test(s)) throw new PolicyViolation('LSQ_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.bulkOn, 'lsq.bulk'); put(d.bulkMaxRows, 'lsq.bulk_max_rows');
  put(d.reviewAskOn, 'lsq.review_ask'); put(d.reviewAskDays, 'lsq.review_ask_days'); put(d.reviewAskAgain, 'lsq.review_ask_again');
  put(d.searchClickOn, 'lsq.search_click'); put(d.searchClickKeepDays, 'lsq.search_click_keep_days');
  put(d.regionOn, 'lsq.region_pages'); put(d.regionMin, 'lsq.region_min');
  put(d.subRetryOn, 'lsq.sub_retry'); put(d.subRetryDays, 'lsq.sub_retry_days');
  put(d.trackOn, 'lsq.track'); put(d.trackMode, 'lsq.track_mode'); put(d.trackAutoDeliver, 'lsq.track_auto_deliver');
  put(d.returnPhotosOn, 'lsq.return_photos'); put(d.returnPhotoMax, 'lsq.return_photo_max');
  if (!set.length) throw new PolicyViolation('LSQ_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, changed: set.map(([k]) => k), settings: await lsqSettings(db), note: '17차 매물 · 소개몰 설정을 바꿨습니다 — 바로 반영됩니다.' };
}

/** 알림 — fn_notify(회원 알림 수신 설정을 따름) · 실패가 본 일을 막지 않음 */
export function lsqNotify(db: DatabaseService, accountId: string, code: string, vars: Record<string, string>, link: string) {
  return db.query(`SELECT fn_notify($1::uuid, $2::text, $3::jsonb, $4::text)`, [accountId, code, JSON.stringify(vars), link]).catch(() => undefined);
}

/** 연락처 · 메일 · 계좌 모양 가림(매물 글 · 메모) */
export function lsqMask(raw: string): string {
  return raw
    .replace(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, '***-****-****')
    .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, '***-****-****')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***')
    .replace(/\b\d{2,6}-\d{2,6}-\d{2,8}(-\d{1,4})?\b/g, '***-***-***');
}

/** 한 줄 글(가림 · 공백 하나 · max 자) — 비면 null */
export function lsqLine(raw: unknown, max = 200): string | null {
  if (raw === undefined || raw === null) return null;
  const s = lsqMask(String(raw).replace(/\s+/g, ' ').trim()).slice(0, max);
  return s || null;
}

/** 한국 날짜(YYYY-MM-DD) · add 일 뒤 */
export const lsqDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
export const lsqNum = (v: unknown) => Number(v ?? 0);
