import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/624 ~ 627) 공용 — 날짜 · 글자 · 번호 · 파일 · 설정 · 알림 날수
 *   파일은 법무 전용 파일 용도 LGL_DOC(대표 11/20 · 올림 SUPER · ADMIN · 열람 ADMIN · SUPER · 올린 사람 · 보험 증권에 붙은 파일만 PAYOUT 도) — DB fn_lgl_check_files 와 같은 검사.
 * ------------------------------------------------------------------- */

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ID_RE = /^\d{1,18}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,30}$/;   // DB CHECK lgl_license_kinds.code 와 같음
export const DAYS_LIST_RE = /^([1-9][0-9]{0,2})(,[1-9][0-9]{0,2}){0,4}$/;   // DB 설정 value_pattern 과 같음

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const dayOk = (d?: string | null) => !!d && YMD_RE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export const clean = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400e3);
/** 날짜 + n 달(말일 넘치면 그 달 말일) */
export function addMonths(day: string, n: number): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1, d = Number(day.slice(8, 10));
  const t = new Date(Date.UTC(y, m + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function idOk(id: string | undefined, what: string) {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound(`없는 ${what}입니다.`);
  return String(id);
}
export function dayOrNull(v: string | null | undefined, field: string) {
  if (v == null || v === '') return null;
  if (!dayOk(v)) throw new PolicyViolation('LGL_DATE', `${field} 날짜(YYYY-MM-DD)가 바르지 않습니다.`);
  return v;
}
export function reasonOk(r: string | undefined) {
  const t = clean(r, 200);
  if (!t || t.length < 2) throw new PolicyViolation('LGL_REASON', '사유는 2 ~ 200자입니다.');
  return t;
}

/** 붙일 파일 — LGL_DOC · READY · 개수 상한(DB fn_lgl_check_files 와 같음) */
export async function filesOk(db: DatabaseService, ids: string[] | undefined, max: number, min = 0): Promise<string[]> {
  const list = [...new Set((ids ?? []).map(String))];
  if (list.length < min) throw new PolicyViolation('LGL_FILE', min === 1 ? '파일을 하나 이상 붙이십시오.' : `파일을 ${min}개 이상 붙이십시오.`);
  if (list.length > max) throw new PolicyViolation('LGL_FILE', `파일은 ${max}개까지입니다.`);
  if (list.some((f) => !UUID_RE.test(f))) throw new PolicyViolation('LGL_FILE', '파일 번호가 바르지 않습니다.');
  if (!list.length) return list;
  const [r] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'LGL_DOC' AND status = 'READY'`, [list]);
  if (Number(r?.n ?? 0) !== list.length) throw new PolicyViolation('LGL_FILE', '법무 서류 용도(LGL_DOC)로 올린 파일(JPG · PNG · PDF)만 붙입니다.');
  return list;
}

export async function settingOf(db: DatabaseService, key: string) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
  return r?.value ?? null;
}
/** 「60,30,7」 → [60, 30, 7](큰 수부터 · 1 ~ 365 · 틀리면 처음 값) */
export async function alertDays(db: DatabaseService, key: string, fallback: number[]): Promise<number[]> {
  const v = (await settingOf(db, key)) ?? '';
  if (!DAYS_LIST_RE.test(v)) return fallback;
  const xs = [...new Set(v.split(',').map(Number))].filter((n) => n >= 1 && n <= 365).sort((a, b) => b - a);
  return xs.length ? xs : fallback;
}
/** 남은 날 → 지금 알림 차례(가장 작은, 남은 날 이상인 날수) · 없으면 null */
export function stageOf(left: number, days: number[]): number | null {
  const hit = days.filter((d) => left <= d);
  return hit.length ? Math.min(...hit) : null;
}

export async function rolesOf(db: DatabaseService, id: string | null) {
  if (!id) return [] as string[];
  return (await db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid`, [id])).map((r) => r.role);
}

/** 운영 알림 한 줄(clock_timestamp · 같은 열쇠 열린 알림 있으면 안 넣음) — 한 줄씩 INSERT(같은 시각 충돌 막음) */
export async function raiseOnce(db: DatabaseService, code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, key: string, detail: Record<string, unknown>) {
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1::text, $2::text, $3::text, $4::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = $1::text AND a.detail->>'key' = $5::text)
     ON CONFLICT DO NOTHING RETURNING id`,
    [code, severity, title, JSON.stringify({ ...detail, key }), key]);
  return r.length;
}
/** 열린 알림 풀기 — 열쇠 앞머리(예: 'LIC:12:')가 같은 것 중 지금 열쇠가 아닌 것 · keepKey 가 null 이면 그 앞머리 모두 */
export async function resolveOthers(db: DatabaseService, code: string, prefix: string, keepKey: string | null, note: string) {
  const r = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $4
      WHERE alert_code = $1 AND resolved_at IS NULL AND left(detail->>'key', char_length($2::text)) = $2::text AND ($3::text IS NULL OR detail->>'key' <> $3::text)
      RETURNING id`, [code, prefix, keepKey, note]);
  return r.length;
}
