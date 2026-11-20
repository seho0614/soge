import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.556 · 557 (D288 · docs/694 · 695) (58) 운영 4 — 설정 6개 한 곳 · 감사 한 줄
 *   스위치 3개(opz.nl_enabled · opz.ir_enabled · opz.ir_page_now)는 처음 off
 *   범위 끝값은 D288 site_settings.value_pattern 과 같음(규칙 2)
 * ------------------------------------------------------------------- */

export interface OpzSettings {
  nlOn: boolean; nlItems: number; nlListingDays: number;
  irOn: boolean; irPageNow: boolean; irReviewDays: number;
}

const KEYS = ['opz.nl_enabled', 'opz.nl_items', 'opz.nl_listing_days', 'opz.ir_enabled', 'opz.ir_page_now', 'opz.ir_review_days'] as const;

/** 범위 [최소, 최대, 처음 값] — value_pattern 과 같은 끝값 */
export const OPZ_RANGES: Record<string, [number, number, number]> = {
  'opz.nl_items': [1, 10, 5], 'opz.nl_listing_days': [7, 90, 30], 'opz.ir_review_days': [1, 14, 3],
};

const num = (raw: string, key: string) => {
  const [lo, hi, d] = OPZ_RANGES[key]!;
  const v = Number(raw);
  return raw !== '' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;
};

export async function opzSettings(db: DatabaseService): Promise<OpzSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [KEYS as unknown as string[]]);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  return {
    nlOn: v('opz.nl_enabled') === 'on', nlItems: num(v('opz.nl_items'), 'opz.nl_items'), nlListingDays: num(v('opz.nl_listing_days'), 'opz.nl_listing_days'),
    irOn: v('opz.ir_enabled') === 'on', irPageNow: v('opz.ir_page_now') === 'on', irReviewDays: num(v('opz.ir_review_days'), 'opz.ir_review_days'),
  };
}

export interface OpzNlSettingsInput { nlOn?: boolean; nlItems?: number; nlListingDays?: number; reason: string }
export interface OpzIrSettingsInput { irOn?: boolean; irPageNow?: boolean; irReviewDays?: number; reason: string }

/** SUPER — 보낸 칸만 바꿈(안 보낸 칸은 undefined 로 들어오므로 거름 · 규칙 11) · 사유는 설정 바뀜 기록(app.setting_reason) */
async function saveSettings(db: DatabaseService, set: Array<[string, string]>, reasonIn: string) {
  const reason = String(reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('OPZ_REASON', '사유는 2 ~ 200자입니다.');
  if (!set.length) throw new PolicyViolation('OPZ_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, changed: set.map(([k]) => k), settings: await opzSettings(db), note: '설정을 바꿨습니다 — 바로 반영됩니다.' };
}

function rangeSet(set: Array<[string, string]>, k: string, x: number | undefined) {
  if (x === undefined) return;
  const [lo, hi] = OPZ_RANGES[k]!;
  if (!Number.isInteger(x) || x < lo || x > hi) throw new PolicyViolation('OPZ_RANGE', `${k} 는 ${lo} ~ ${hi} 입니다.`);
  set.push([k, String(x)]);
}

export function setOpzNlSettings(db: DatabaseService, d: OpzNlSettingsInput) {
  const set: Array<[string, string]> = [];
  if (d.nlOn !== undefined) set.push(['opz.nl_enabled', d.nlOn ? 'on' : 'off']);
  rangeSet(set, 'opz.nl_items', d.nlItems);
  rangeSet(set, 'opz.nl_listing_days', d.nlListingDays);
  return saveSettings(db, set, d.reason);
}

export function setOpzIrSettings(db: DatabaseService, d: OpzIrSettingsInput) {
  const set: Array<[string, string]> = [];
  if (d.irOn !== undefined) set.push(['opz.ir_enabled', d.irOn ? 'on' : 'off']);
  if (d.irPageNow !== undefined) set.push(['opz.ir_page_now', d.irPageNow ? 'on' : 'off']);
  rangeSet(set, 'opz.ir_review_days', d.irReviewDays);
  return saveSettings(db, set, d.reason);
}

/** 한국 달(YYYY-MM) · 한국 날짜 */
export const opzYm = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 7);
export const OPZ_YM_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;   // DB CHECK opz_nl_issues.ym 과 같음

/** 감사 한 줄(서비스가 직접 남길 때) — 실패해도 본 일은 막지 않음 */
export function opzAudit(db: DatabaseService, action: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, 'SETTING', $4::jsonb, $5, $6)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}
