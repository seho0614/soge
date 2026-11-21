/* ---------------------------------------------------------------------
 * v10.590 ~ 594 (docs/732 ~ 736) 15차 보안 · 기반 — 공통(설정 · 감사 · 운영 역할)
 *
 *   설정은 모두 site_settings 의 sec2.* (처음 off · 알림 기준 숫자만 값) · 30초 메모리.
 *   값 무늬(SEC2_PATTERNS)는 마이그레이션 site_settings.value_pattern 과 같은 글자(계약 규칙 2).
 * ------------------------------------------------------------------- */
import { RequestCtx } from '../../core/request-context';

export interface Sec2Db { query<T = any>(sql: string, params?: unknown[]): Promise<T[]>; transaction?<T>(fn: () => Promise<T>): Promise<T> }

/** 운영 역할 — mfa.service OPS_ROLES · D291 fn_staff_left_role 과 같은 7개 */
export const SEC2_OPS_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;
export const sec2IsStaff = (roles: readonly string[]) => roles.some((r) => (SEC2_OPS_ROLES as readonly string[]).includes(r));

/** 설정 키 → 값 무늬(DB value_pattern 과 같음) */
export const SEC2_PATTERNS: Record<string, RegExp> = {
  'sec2.anomaly_watch': /^(on|off)$/,
  'sec2.anomaly_view_min': /^([1-9][0-9]{0,3})$/,
  'sec2.anomaly_export_min': /^([1-9][0-9]{0,2})$/,
  'sec2.anomaly_night_min': /^([1-9][0-9]{0,3})$/,
  'sec2.anomaly_factor': /^([2-9]|10)$/,
  'sec2.pwned_check': /^(off|ASSUME|LIVE)$/,
  'sec2.pwned_min': /^([1-9][0-9]{0,3})$/,
  'sec2.pwned_legal_ok': /^(on|off)$/,
  'sec2.member_mfa': /^(on|off)$/,
  'sec2.not_me_surge': /^([0-9]{1,3})$/,
};
export const SEC2_DEFAULTS: Record<string, string> = {
  'sec2.anomaly_watch': 'off', 'sec2.anomaly_view_min': '100', 'sec2.anomaly_export_min': '3', 'sec2.anomaly_night_min': '10',
  'sec2.anomaly_factor': '3', 'sec2.pwned_check': 'off', 'sec2.pwned_min': '1', 'sec2.pwned_legal_ok': 'off',
  'sec2.member_mfa': 'off', 'sec2.not_me_surge': '5',
};

export interface Sec2Settings {
  anomalyWatch: boolean; viewMin: number; exportMin: number; nightMin: number; factor: number;
  pwnedMode: 'off' | 'ASSUME' | 'LIVE'; pwnedMin: number; pwnedLegalOk: boolean;
  memberMfa: boolean; notMeSurge: number;
}

let cache: { at: number; v: Sec2Settings } | null = null;
const CACHE_MS = 30_000;
/** 시험 · 저장 뒤 — 바로 다시 읽게 */
export function sec2CacheClear() { cache = null; }

export async function sec2Settings(db: Sec2Db): Promise<Sec2Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.v;
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'sec2.%'`).catch(() => [] as { key: string; value: string | null }[]);
  const m: Record<string, string> = { ...SEC2_DEFAULTS };
  for (const r of rows) {
    const p = SEC2_PATTERNS[r.key];
    if (p && r.value != null && p.test(r.value)) m[r.key] = r.value;   // 무늬 밖 값은 처음 값으로(안전한 쪽)
  }
  const v: Sec2Settings = {
    anomalyWatch: m['sec2.anomaly_watch'] === 'on',
    viewMin: Number(m['sec2.anomaly_view_min']), exportMin: Number(m['sec2.anomaly_export_min']), nightMin: Number(m['sec2.anomaly_night_min']),
    factor: Number(m['sec2.anomaly_factor']),
    pwnedMode: m['sec2.pwned_check'] as Sec2Settings['pwnedMode'], pwnedMin: Number(m['sec2.pwned_min']), pwnedLegalOk: m['sec2.pwned_legal_ok'] === 'on',
    memberMfa: m['sec2.member_mfa'] === 'on', notMeSurge: Number(m['sec2.not_me_surge']),
  };
  cache = { at: Date.now(), v };
  return v;
}

/** 감사 한 줄 — 결과만(비밀번호 · 인증 앱 비밀값 · 예비 번호 · 표는 넣지 않음) · 실패해도 본 요청은 그대로 */
export function sec2Audit(db: Sec2Db, action: string, targetType: string, targetId: string | null, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [c?.actorId ?? targetId, c?.actorRole ?? null, action, targetType, targetId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null],
  ).catch((e: Error) => { console.error('[AUDIT_WRITE_FAILED]', action, e.message); return []; });
}

/** 가린 메일 — 앞 2글자 + ***@도메인 */
export const sec2Mask = (e: string | null | undefined) => (e ? `${e.slice(0, 2)}***@${e.split('@')[1] ?? ''}` : null);
