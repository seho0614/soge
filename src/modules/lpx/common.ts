import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.549 ~ 552 (D286 · docs/687 ~ 690) (56) 매물 3 — 공통(설정 13 · 정규식 · 매물 찾기 · 알림)
 *   대표 11/21 — 가격 제안을 너그럽게: 하한 30% · 답 기한 7일 · 되제안 3번까지(lpx.offer_counter_max · DB 가 넘는 것을 막음)
 *   스위치 4개는 모두 처음 꺼짐 — lpx.offer · lpx.watermark · lpx.away · lpx.stats · 바꾸기는 SUPER(사유 · 설정 바뀜 기록)
 *   관별 설정 lpx.offer_gwans(처음 NONE = 모두 꺼짐 · b284 vsx.gwans 와 같은 모양)
 *   설정 값 검사 정규식 = DB site_settings.value_pattern(D286 ④)과 같은 글자(계약 규칙 2)
 * ------------------------------------------------------------------- */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** 금액(원) — 100원 ~ 13자리 · DB CHECK ck_lpx_offer_amount 와 같은 글자(규칙 2) */
export const LPX_AMOUNT_RE = /^[1-9][0-9]{2,12}$/;
/** 날짜 YYYY-MM-DD · 달 YYYY-MM */
export const LPX_DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
export const LPX_YM_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
/** 관 코드 — DB gwans_code_check(^[A-Z]{3,4}$)와 같음 */
export const LPX_GWAN_RE = /^[A-Z]{3,4}$/;
export const LPX_POSITIONS = ['BR', 'BL', 'TR', 'TL', 'C', 'TILE'] as const;
/** 워터마크 글자 — 고정(대표 지시 「SogaeBank/소개뱅크」) · 설정으로 바꾸지 않음 */
export const LPX_MARK_TEXT = 'SogaeBank/소개뱅크';

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const LPX_PATTERNS: Record<string, string> = {
  'lpx.offer': '^(on|off)$',
  'lpx.offer_gwans': '^(NONE|[A-Z]{3,4}(,[A-Z]{3,4}){0,29})$',
  'lpx.offer_days': '^([1-9]|1[0-4])$',
  'lpx.offer_min_pct': '^([0-9]|[1-9][0-9])$',
  'lpx.offer_member_max': '^([1-9]|[1-4][0-9]|50)$',
  'lpx.offer_counter_max': '^[1-5]$',
  'lpx.watermark': '^(on|off)$',
  'lpx.watermark_pos': '^(BR|BL|TR|TL|C|TILE)$',
  'lpx.watermark_opacity': '^([1-5][0-9]|60)$',
  'lpx.away': '^(on|off)$',
  'lpx.away_max_days': '^([1-9]|[1-8][0-9]|90)$',
  'lpx.stats': '^(on|off)$',
  'lpx.stats_min': '^([5-9]|[1-4][0-9]|50)$',
  'lpx.stats_months': '^([3-9]|1[0-9]|2[0-4])$',
};

export interface LpxSettings {
  offerOn: boolean; offerGwans: string[]; offerDays: number; offerMinPct: number; offerMemberMax: number; offerCounterMax: number;
  markOn: boolean; markPos: (typeof LPX_POSITIONS)[number]; markOpacity: number;
  awayOn: boolean; awayMaxDays: number;
  statsOn: boolean; statsMin: number; statsMonths: number;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값 */
export async function lpxSettings(db: DatabaseService): Promise<LpxSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'lpx.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, (r.value ?? '').trim()])) as Record<string, string>;
  const g = m['lpx.offer_gwans'] ?? 'NONE';
  const pos = m['lpx.watermark_pos'] as LpxSettings['markPos'];
  return {
    offerOn: m['lpx.offer'] === 'on',
    offerGwans: new RegExp(LPX_PATTERNS['lpx.offer_gwans']!).test(g) && g !== 'NONE' ? g.split(',') : [],
    offerDays: int(m['lpx.offer_days'], 7, 1, 14),   // 대표 11/21 — 처음 7일
    offerMinPct: int(m['lpx.offer_min_pct'], 30, 0, 99),   // 대표 11/21 — 처음 30%
    offerMemberMax: int(m['lpx.offer_member_max'], 20, 1, 50),
    offerCounterMax: int(m['lpx.offer_counter_max'], 3, 1, 5),   // 대표 11/21 — 되제안 3번까지(DB fn_lpx_counter_max 와 같은 처음 값)
    markOn: m['lpx.watermark'] === 'on',
    markPos: (LPX_POSITIONS as readonly string[]).includes(pos) ? pos : 'BR',
    markOpacity: int(m['lpx.watermark_opacity'], 35, 10, 60),
    awayOn: m['lpx.away'] === 'on',
    awayMaxDays: int(m['lpx.away_max_days'], 30, 1, 90),
    statsOn: m['lpx.stats'] === 'on',
    statsMin: int(m['lpx.stats_min'], 5, 5, 50),
    statsMonths: int(m['lpx.stats_months'], 12, 3, 24),
  };
}

export interface LpxSettingsInput {
  offerOn?: boolean; offerGwans?: string[]; offerDays?: number; offerMinPct?: number; offerMemberMax?: number; offerCounterMax?: number;
  markOn?: boolean; markPos?: string; markOpacity?: number;
  awayOn?: boolean; awayMaxDays?: number;
  statsOn?: boolean; statsMin?: number; statsMonths?: number;
  reason: string;
}

/** SUPER — 보낸 칸만 바꿈(컨트롤러가 undefined 를 거름 · 규칙 11) · 사유는 설정 바뀜 기록(app.setting_reason) */
export async function setLpxSettings(db: DatabaseService, d: LpxSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('LPX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(LPX_PATTERNS[key]!).test(s)) throw new PolicyViolation('LPX_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.offerOn, 'lpx.offer');
  if (d.offerGwans !== undefined && d.offerGwans !== null) {
    const list = [...new Set((Array.isArray(d.offerGwans) ? d.offerGwans : []).map(String))].sort();
    if (list.some((x) => !LPX_GWAN_RE.test(x))) throw new PolicyViolation('LPX_GWANS', '관 코드가 맞지 않습니다.');
    put(list.length ? list.join(',') : 'NONE', 'lpx.offer_gwans');
  }
  put(d.offerDays, 'lpx.offer_days'); put(d.offerMinPct, 'lpx.offer_min_pct'); put(d.offerMemberMax, 'lpx.offer_member_max'); put(d.offerCounterMax, 'lpx.offer_counter_max');
  put(d.markOn, 'lpx.watermark'); put(d.markPos, 'lpx.watermark_pos'); put(d.markOpacity, 'lpx.watermark_opacity');
  put(d.awayOn, 'lpx.away'); put(d.awayMaxDays, 'lpx.away_max_days');
  put(d.statsOn, 'lpx.stats'); put(d.statsMin, 'lpx.stats_min'); put(d.statsMonths, 'lpx.stats_months');
  if (!set.length) throw new PolicyViolation('LPX_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, changed: set.map(([k]) => k), settings: await lpxSettings(db), note: '매물 3 설정을 바꿨습니다 — 바로 반영됩니다.' };
}

export interface LpxListing { id: string; title: string; ownerId: string; status: string; gwan: string; categoryId: string; askingAmount: string | null; sido: string | null; sigungu: string | null }

/** 매물 하나 — 없으면 404 */
export async function lpxListing(db: DatabaseService, id: string): Promise<LpxListing> {
  if (!UUID_RE.test(String(id ?? ''))) throw new NotFound('매물을 찾을 수 없습니다.');
  const [l] = await db.query<LpxListing>(
    `SELECT id::text AS id, title, owner_account_id::text AS "ownerId", status, gwan_code AS gwan, category_id::text AS "categoryId",
            deal_amount::text AS "askingAmount", address->>'sido' AS sido, address->>'sigungu' AS sigungu
       FROM listings WHERE id = $1::uuid`, [id]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  return l;
}

/** 알림 — fn_notify(회원 알림 수신 설정을 따름 · 템플릿은 D286 ④) · 실패가 본 요청을 막지 않음 */
export function lpxNotify(db: DatabaseService, accountId: string, code: string, vars: Record<string, string>, link: string) {
  return db.query(`SELECT fn_notify($1::uuid, $2::text, $3::jsonb, $4::text)`, [accountId, code, JSON.stringify(vars), link]).catch(() => undefined);
}

/** 연락처 · 메일 가림(1:1 문의 대화의 가림과 같은 모양) */
export function lpxMask(raw: string): string {
  return raw
    .replace(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, '***-****-****')
    .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, '***-****-****')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***');
}

/** 한 줄 글(가림 · 공백 하나 · 200자) — 비면 null */
export function lpxLine(raw: unknown, max = 200): string | null {
  if (raw === undefined || raw === null) return null;
  const s = lpxMask(String(raw).replace(/\s+/g, ' ').trim()).slice(0, max);
  return s || null;
}

/** 원 단위 글자(알림 글) */
export const lpxWon = (v: string | number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('ko-KR')}원`);
/** 한국 날짜(YYYY-MM-DD) */
export const lpxToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
