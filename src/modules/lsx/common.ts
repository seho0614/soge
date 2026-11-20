import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.513 ~ 516 (D276 · docs/651 ~ 654) ㊻ 매물 — 공통(설정 · 매물 찾기)
 *   스위치는 모두 처음 꺼짐 — lsx.saved_search · lsx.expiry · lsx.bump_mode(OFF) · lsx.ai_summary · 바꾸기는 SUPER
 *   설정 값 검사 정규식 = DB site_settings.value_pattern(D276 ⑥)과 같은 글자(계약 규칙 2 · test_v1513 이 대조)
 * ------------------------------------------------------------------- */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const BUMP_MODES = ['OFF', 'FREE', 'PAID'] as const;
export type BumpMode = (typeof BUMP_MODES)[number];
/** 검수 승인 · 연장 때 고르는 기간(대표 결정 11/20 — 1 · 3 · 6 · 12개월 · 직접 날짜) */
export const EXPIRY_MONTHS = [1, 3, 6, 12] as const;
/** 직접 날짜의 끝(오늘부터 36개월) — 설정이 아니라 잘못 친 날짜를 막는 울타리 */
export const EXPIRY_MAX_MONTHS = 36;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const LSX_PATTERNS: Record<string, string> = {
  'lsx.saved_search': '^(on|off)$',
  'lsx.saved_search_max': '^([1-9]|10)$',
  'lsx.expiry': '^(on|off)$',
  'lsx.expiry_default_months': '^([1-9]|1[0-9]|2[0-4])$',
  'lsx.expiry_warn_days': '^([1-9]|[12][0-9]|30)$',
  'lsx.bump_mode': '^(OFF|FREE|PAID)$',
  'lsx.bump_free_count': '^([1-9]|[12][0-9]|30)$',
  'lsx.bump_period_days': '^([1-9]|[1-8][0-9]|90)$',
  'lsx.bump_min_hours': '^([1-9]|[1-9][0-9]|[1-6][0-9]{2}|7[01][0-9]|720)$',
  'lsx.bump_price': '^(0|[1-9][0-9]{0,5}|1000000)$',
  'lsx.bump_effect_hours': '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$',
  'lsx.ai_summary': '^(on|off)$',
  'lsx.ai_summary_model': '^(|[a-z0-9][a-z0-9.-]{2,59})$',
  'lsx.ai_summary_batch': '^([1-9]|[12][0-9]|30)$',
};

export interface LsxSettings {
  savedSearch: boolean; savedSearchMax: number;
  expiry: boolean; expiryDefaultMonths: number; expiryWarnDays: number;
  bumpMode: BumpMode; bumpFreeCount: number; bumpPeriodDays: number; bumpMinHours: number; bumpPrice: number; bumpEffectHours: number;
  aiSummary: boolean; aiSummaryModel: string; aiSummaryBatch: number;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값 */
export async function lsxSettings(db: DatabaseService): Promise<LsxSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'lsx.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  const mode = m['lsx.bump_mode'];
  return {
    savedSearch: m['lsx.saved_search'] === 'on',
    savedSearchMax: int(m['lsx.saved_search_max'], 10, 1, 10),
    expiry: m['lsx.expiry'] === 'on',
    expiryDefaultMonths: int(m['lsx.expiry_default_months'], 6, 1, 24),
    expiryWarnDays: int(m['lsx.expiry_warn_days'], 7, 1, 30),
    bumpMode: mode === 'FREE' || mode === 'PAID' ? mode : 'OFF',
    bumpFreeCount: int(m['lsx.bump_free_count'], 3, 1, 30),
    bumpPeriodDays: int(m['lsx.bump_period_days'], 30, 1, 90),
    bumpMinHours: int(m['lsx.bump_min_hours'], 24, 1, 720),
    bumpPrice: int(m['lsx.bump_price'], 0, 0, 1_000_000),
    bumpEffectHours: int(m['lsx.bump_effect_hours'], 72, 1, 168),
    aiSummary: m['lsx.ai_summary'] === 'on',
    aiSummaryModel: (m['lsx.ai_summary_model'] ?? '').trim(),
    aiSummaryBatch: int(m['lsx.ai_summary_batch'], 10, 1, 30),
  };
}

/** 공개 스위치(사용자 웹이 단추를 그릴지) — 금액 · 개인정보 없음 */
export async function lsxSwitches(db: DatabaseService) {
  const s = await lsxSettings(db);
  return { savedSearch: s.savedSearch, savedSearchMax: s.savedSearchMax, expiry: s.expiry, bumpMode: s.bumpMode, aiSummary: s.aiSummary };
}

/** 운영 설정 바꾸기(SUPER) — 보낸 칸만 · 정규식은 DB 와 같음 · 사유는 「전체 설정」 바뀐 기록(app.setting_reason)에 남음 */
export interface LsxSettingsInput {
  savedSearch?: boolean; savedSearchMax?: number;
  expiry?: boolean; expiryDefaultMonths?: number; expiryWarnDays?: number;
  bumpMode?: string; bumpFreeCount?: number; bumpPeriodDays?: number; bumpMinHours?: number; bumpPrice?: number; bumpEffectHours?: number;
  aiSummary?: boolean; aiSummaryModel?: string; aiSummaryBatch?: number;
  reason?: string;
}
export async function setLsxSettings(db: DatabaseService, d: LsxSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('LSX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(LSX_PATTERNS[key]!).test(s)) throw new PolicyViolation('LSX_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.savedSearch, 'lsx.saved_search'); put(d.savedSearchMax, 'lsx.saved_search_max');
  put(d.expiry, 'lsx.expiry'); put(d.expiryDefaultMonths, 'lsx.expiry_default_months'); put(d.expiryWarnDays, 'lsx.expiry_warn_days');
  put(d.bumpMode, 'lsx.bump_mode'); put(d.bumpFreeCount, 'lsx.bump_free_count'); put(d.bumpPeriodDays, 'lsx.bump_period_days');
  put(d.bumpMinHours, 'lsx.bump_min_hours'); put(d.bumpPrice, 'lsx.bump_price'); put(d.bumpEffectHours, 'lsx.bump_effect_hours');
  put(d.aiSummary, 'lsx.ai_summary'); put(d.aiSummaryModel, 'lsx.ai_summary_model'); put(d.aiSummaryBatch, 'lsx.ai_summary_batch');
  if (!set.length) throw new PolicyViolation('LSX_NOTHING', '바꿀 것이 없습니다.');
  /* PAID 로 바꾸려면 1회 금액이 먼저(0 원 유료 방식은 받지 않음) */
  const nextMode = set.find(([k]) => k === 'lsx.bump_mode')?.[1];
  const nextPrice = Number(set.find(([k]) => k === 'lsx.bump_price')?.[1] ?? (await lsxSettings(db)).bumpPrice);
  if (nextMode === 'PAID' && !(nextPrice > 0)) throw new PolicyViolation('LSX_BUMP_PRICE_UNSET', '유료 끌어올리기 1회 금액을 먼저 정해 주십시오.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await lsxSettings(db), note: '매물 기능 설정을 바꿨습니다.' };
}

/** 내 매물 하나(주인 확인) — 없거나 남의 것이면 404 */
export async function ownListing(db: DatabaseService, id: string, ownerId: string) {
  if (!UUID_RE.test(id)) throw new NotFound('매물을 찾을 수 없습니다.');
  const [l] = await db.query<{ id: string; title: string; status: string; version: number; is_priority_exposed: boolean; published_at: string | null }>(
    `SELECT id::text, title, status, version, is_priority_exposed, published_at FROM listings WHERE id = $1 AND owner_account_id = $2`, [id, ownerId]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  return l;
}

/** 사유 2 ~ 300자 */
export function needReason(raw: unknown, code = 'LSX_REASON'): string {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (r.length < 2 || r.length > 300) throw new PolicyViolation(code, '사유를 2 ~ 300자로 적어 주십시오.');
  return r;
}

/** 한국 날짜 YYYY-MM-DD */
export const kstYmd = (iso: string | Date | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10) : null;
