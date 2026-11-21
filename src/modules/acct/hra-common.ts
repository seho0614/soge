import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * 13차 인사 · 회계(v10.581 ~ 584 · docs/723 ~ 726) 공통 — 설정 · 역할 · 날짜
 *   설정은 모두 hra.* · 스위치 처음 off · 바꾸기는 SUPER(PUT /admin/hra/settings · 사유는 「전체 설정」 바뀐 기록 app.setting_reason)
 *   정규식은 DB value_pattern 과 같음(규칙 2)
 * ------------------------------------------------------------------- */

export const HRA_PATTERNS: Record<string, string> = {
  'hra.leave_promo': '^(on|off)$',
  'hra.leave_promo_first_months': '^([1-9]|1[01])$',
  'hra.leave_promo_second_months': '^([1-9]|10)$',
  'hra.leave_promo_reply_days': '^([1-9]|[12][0-9]|30)$',
  'hra.lib_unread_alert': '^(on|off)$',
  'hra.payfile_export': '^(on|off)$',
  'hra.close_alert': '^(on|off)$',
  'hra.close_alert_days_before': '^([0-9]|10)$',
};
export const HRA_DEFAULTS: Record<string, string> = {
  'hra.leave_promo': 'off', 'hra.leave_promo_first_months': '6', 'hra.leave_promo_second_months': '2', 'hra.leave_promo_reply_days': '10',
  'hra.lib_unread_alert': 'off', 'hra.payfile_export': 'off', 'hra.close_alert': 'off', 'hra.close_alert_days_before': '3',
};

export interface HraSettings {
  leavePromo: boolean; firstMonths: number; secondMonths: number; replyDays: number;
  libUnreadAlert: boolean; payfileExport: boolean; closeAlert: boolean; closeAlertDaysBefore: number;
}

export async function hraSettings(db: DatabaseService): Promise<HraSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'hra.%'`);
  const m: Record<string, string> = { ...HRA_DEFAULTS };
  for (const r of rows) if (r.value != null && HRA_PATTERNS[r.key] && new RegExp(HRA_PATTERNS[r.key]!).test(r.value)) m[r.key] = r.value;
  return {
    leavePromo: m['hra.leave_promo'] === 'on', firstMonths: Number(m['hra.leave_promo_first_months']), secondMonths: Number(m['hra.leave_promo_second_months']),
    replyDays: Number(m['hra.leave_promo_reply_days']), libUnreadAlert: m['hra.lib_unread_alert'] === 'on', payfileExport: m['hra.payfile_export'] === 'on',
    closeAlert: m['hra.close_alert'] === 'on', closeAlertDaysBefore: Number(m['hra.close_alert_days_before']),
  };
}

export interface HraSettingsInput {
  leavePromo?: boolean; firstMonths?: number; secondMonths?: number; replyDays?: number;
  libUnreadAlert?: boolean; payfileExport?: boolean; closeAlert?: boolean; closeAlertDaysBefore?: number; reason?: string;
}

/** PUT /admin/hra/settings (SUPER) — 보낸 칸만(undefined 는 거름 · 규칙 11) · 1차 > 2차 개월 */
export async function setHraSettings(db: DatabaseService, d: HraSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HRA_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(HRA_PATTERNS[key]!).test(s)) throw new PolicyViolation('HRA_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.leavePromo, 'hra.leave_promo'); put(d.firstMonths, 'hra.leave_promo_first_months'); put(d.secondMonths, 'hra.leave_promo_second_months');
  put(d.replyDays, 'hra.leave_promo_reply_days'); put(d.libUnreadAlert, 'hra.lib_unread_alert'); put(d.payfileExport, 'hra.payfile_export');
  put(d.closeAlert, 'hra.close_alert'); put(d.closeAlertDaysBefore, 'hra.close_alert_days_before');
  if (!set.length) throw new PolicyViolation('HRA_NOTHING', '바꿀 것이 없습니다.');
  const cur = await hraSettings(db);
  const first = Number(set.find(([k]) => k === 'hra.leave_promo_first_months')?.[1] ?? cur.firstMonths);
  const second = Number(set.find(([k]) => k === 'hra.leave_promo_second_months')?.[1] ?? cur.secondMonths);
  if (second >= first) throw new PolicyViolation('HRA_SETTING_VALUE', '연차 촉진 2차(개월)는 1차보다 작아야 합니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3::uuid, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await hraSettings(db), changed: set.map(([k]) => k), note: `인사 · 회계 설정 ${set.length}개를 바꿨습니다.` };
}

/** 지금 로그인한 계정의 운영 역할(기한 안) */
export async function hraRoles(db: DatabaseService, actor: string | null): Promise<string[]> {
  if (!actor) return [];
  const r = await db.query<{ role: string }>(
    `SELECT role FROM account_roles WHERE account_id = $1::uuid AND (expires_at IS NULL OR expires_at > now())`, [actor]);
  return r.map((x) => x.role);
}

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const dayOk = (d?: string | null) => !!d && YMD_RE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
/** 'YYYY-MM-DD' 에서 n개월 뺀 날(같은 날 · 없으면 그 달 말) */
export const minusMonths = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) - n;
  const yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
};
export const maskEmail = (e: string | null | undefined) => { if (!e) return null; const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };
export const textOk = (v: unknown, min: number, max: number) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length >= min && t.length <= max ? t : null;
};
