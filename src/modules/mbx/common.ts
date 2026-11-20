import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.501 ~ 504 (D273 · docs/639 ~ 642) ㊸ 회원 2 — 공통(설정 · 대상 찾기)
 *   대상(target): LISTING = 매물(uuid · 게시 중) · PRODUCT = 소개몰 상품(주소의 상품 코드 · 판매 중 · 품절)
 *   스위치 4개는 모두 처음 꺼짐(site_settings mbx.recent · mbx.compare · mbx.price_alert · mbx.dm) — 켜기는 SUPER
 * ------------------------------------------------------------------- */

export const TARGET_TYPES = ['LISTING', 'PRODUCT'] as const;
export type MbxTarget = (typeof TARGET_TYPES)[number];
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** 소개몰 상품 코드(주소 /health/p/{code}) — DB 칸이 아니라 찾는 값이라 서버만 검사 */
export const PRODUCT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
/** 한 번에 비교하는 수(시안 없음 · 대표 11/20 「최대 4개」) */
export const COMPARE_MAX = 4;

export const MBX_KEYS = {
  recent: 'mbx.recent', recentMax: 'mbx.recent_max', recentKeepDays: 'mbx.recent_keep_days',
  compare: 'mbx.compare',
  priceAlert: 'mbx.price_alert', watchMax: 'mbx.price_watch_max',
  dm: 'mbx.dm', patternMode: 'mbx.dm_pattern_mode', rateMin: 'mbx.dm_rate_per_min', rateDay: 'mbx.dm_rate_per_day',
  retentionDays: 'mbx.dm_retention_days', reportKeepDays: 'mbx.dm_report_keep_days',
} as const;

export interface MbxSettings {
  recent: boolean; recentMax: number; recentKeepDays: number;
  compare: boolean;
  priceAlert: boolean; watchMax: number;
  dm: boolean; patternMode: 'WARN' | 'MASK' | 'BLOCK'; rateMin: number; rateDay: number;
  retentionDays: number; reportKeepDays: number;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값(꺼짐 · 20 · 90 · 50 · MASK · 10 · 300 · 365 · 180) */
export async function mbxSettings(db: DatabaseService): Promise<MbxSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'mbx.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  const mode = m[MBX_KEYS.patternMode];
  return {
    recent: m[MBX_KEYS.recent] === 'on',
    recentMax: int(m[MBX_KEYS.recentMax], 20, 5, 50),
    recentKeepDays: int(m[MBX_KEYS.recentKeepDays], 90, 7, 365),
    compare: m[MBX_KEYS.compare] === 'on',
    priceAlert: m[MBX_KEYS.priceAlert] === 'on',
    watchMax: int(m[MBX_KEYS.watchMax], 50, 1, 200),
    dm: m[MBX_KEYS.dm] === 'on',
    patternMode: mode === 'WARN' || mode === 'BLOCK' ? mode : 'MASK',
    rateMin: int(m[MBX_KEYS.rateMin], 10, 1, 60),
    rateDay: int(m[MBX_KEYS.rateDay], 300, 10, 2000),
    retentionDays: int(m[MBX_KEYS.retentionDays], 365, 30, 1825),
    reportKeepDays: int(m[MBX_KEYS.reportKeepDays], 180, 30, 1825),
  };
}

/** 사용자 웹이 단추를 그릴지 정할 때 — 개인정보 없음(GET /site/mbx/switches) */
export async function mbxSwitches(db: DatabaseService) {
  const s = await mbxSettings(db);
  return { recent: s.recent, compare: s.compare, priceAlert: s.priceAlert, dm: s.dm, recentMax: s.recentMax, compareMax: COMPARE_MAX };
}

export function targetType(t: unknown): MbxTarget {
  if (typeof t === 'string' && (TARGET_TYPES as readonly string[]).includes(t)) return t as MbxTarget;
  throw new PolicyViolation('MBX_TYPE', '대상은 LISTING · PRODUCT 중 하나입니다.');
}

/** 화면이 보낸 열쇠(매물 uuid · 상품 코드) → 대상 uuid. publicOnly 면 게시 중 · 판매 중(품절 포함)만 */
export async function resolveTarget(db: DatabaseService, type: MbxTarget, key: string, publicOnly = true): Promise<string> {
  const k = String(key ?? '').trim();
  if (type === 'LISTING') {
    if (!UUID_RE.test(k)) throw new NotFound('매물을 찾을 수 없습니다.');
    const [r] = await db.query<{ id: string }>(
      `SELECT id FROM listings WHERE id = $1::uuid AND ($2::boolean = false OR status = 'PUBLISHED')`, [k, publicOnly]);
    if (!r) throw new NotFound('매물을 찾을 수 없습니다.');
    return r.id;
  }
  if (!PRODUCT_CODE_RE.test(k) && !UUID_RE.test(k)) throw new NotFound('상품을 찾을 수 없습니다.');
  const [r] = await db.query<{ id: string }>(
    `SELECT id FROM hlt_products WHERE (code = $1 OR ($2::boolean AND id::text = $1)) AND ($3::boolean = false OR status IN ('ON_SALE', 'SOLD_OUT'))`,
    [k, UUID_RE.test(k), publicOnly]);
  if (!r) throw new NotFound('상품을 찾을 수 없습니다.');
  return r.id;
}

/** 금액 글자(원) — 알림 본문용 */
export const won = (v: unknown) => (v == null || v === '' ? '협의' : `${Number(v).toLocaleString('ko-KR')}원`);
export const txt = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
