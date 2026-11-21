import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.573 ~ 576 (docs/715 ~ 718) 11차 회원 · 거래 — 공통(설정 · 작은 도우미)
 *   스위치는 모두 처음 꺼짐 — mtr.appeal · mtr.review_watch · mtr.trust · mtr.dormant · mtr.dormant_mail · 바꾸기는 SUPER
 *   설정 값 검사 정규식 = DB site_settings.value_pattern 과 같은 글자(계약 규칙 2 · test_v1573 이 대조)
 * ------------------------------------------------------------------- */

export const MTR_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const MTR_STAFF_ROLES = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'ACCOUNTANT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const MTR_PATTERNS: Record<string, string> = {
  'mtr.appeal': '^(on|off)$',
  'mtr.appeal_days': '^([1-9]|[1-8][0-9]|90)$',
  'mtr.appeal_sla_hours': '^(2[4-9]|[3-9][0-9]|[12][0-9]{2}|3[0-2][0-9]|33[0-6])$',
  'mtr.review_watch': '^(on|off)$',
  'mtr.review_threshold': '^([2-9][0-9]|100)$',
  'mtr.review_burst_count': '^([2-9]|[1-4][0-9]|50)$',
  'mtr.review_burst_hours': '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$',
  'mtr.review_similar_pct': '^([5-9][0-9]|100)$',
  'mtr.review_scan_days': '^([1-9]|[1-8][0-9]|90)$',
  'mtr.trust': '^(on|off)$',
  'mtr.dormant': '^(on|off)$',
  'mtr.dormant_days': '^(1[89][0-9]|[2-9][0-9]{2}|10[0-8][0-9]|109[0-5])$',
  'mtr.dormant_notice_days': '^([7-9]|[1-5][0-9]|60)$',
  'mtr.dormant_mail': '^(on|off)$',
};

export interface MtrSettings {
  appeal: boolean; appealDays: number; appealSlaHours: number;
  reviewWatch: boolean; reviewThreshold: number; reviewBurstCount: number; reviewBurstHours: number; reviewSimilarPct: number; reviewScanDays: number;
  trust: boolean;
  dormant: boolean; dormantDays: number; dormantNoticeDays: number; dormantMail: boolean;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값 */
export async function mtrSettings(db: DatabaseService): Promise<MtrSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'mtr.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  return {
    appeal: m['mtr.appeal'] === 'on',
    appealDays: int(m['mtr.appeal_days'], 30, 1, 90),
    appealSlaHours: int(m['mtr.appeal_sla_hours'], 72, 24, 336),
    reviewWatch: m['mtr.review_watch'] === 'on',
    reviewThreshold: int(m['mtr.review_threshold'], 50, 20, 100),
    reviewBurstCount: int(m['mtr.review_burst_count'], 5, 2, 50),
    reviewBurstHours: int(m['mtr.review_burst_hours'], 24, 1, 168),
    reviewSimilarPct: int(m['mtr.review_similar_pct'], 80, 50, 100),
    reviewScanDays: int(m['mtr.review_scan_days'], 30, 1, 90),
    trust: m['mtr.trust'] === 'on',
    dormant: m['mtr.dormant'] === 'on',
    dormantDays: int(m['mtr.dormant_days'], 365, 180, 1095),
    dormantNoticeDays: int(m['mtr.dormant_notice_days'], 30, 7, 60),
    dormantMail: m['mtr.dormant_mail'] === 'on',
  };
}

/** 운영 설정 바꾸기(SUPER) — 보낸 칸만 · 정규식은 DB 와 같음 · 사유는 「전체 설정」 바뀐 기록(app.setting_reason)에 남음 */
export interface MtrSettingsInput extends Partial<MtrSettings> { reason?: string }
export async function setMtrSettings(db: DatabaseService, d: MtrSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('MTR_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(MTR_PATTERNS[key]!).test(s)) throw new PolicyViolation('MTR_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.appeal, 'mtr.appeal'); put(d.appealDays, 'mtr.appeal_days'); put(d.appealSlaHours, 'mtr.appeal_sla_hours');
  put(d.reviewWatch, 'mtr.review_watch'); put(d.reviewThreshold, 'mtr.review_threshold'); put(d.reviewBurstCount, 'mtr.review_burst_count');
  put(d.reviewBurstHours, 'mtr.review_burst_hours'); put(d.reviewSimilarPct, 'mtr.review_similar_pct'); put(d.reviewScanDays, 'mtr.review_scan_days');
  put(d.trust, 'mtr.trust');
  put(d.dormant, 'mtr.dormant'); put(d.dormantDays, 'mtr.dormant_days'); put(d.dormantNoticeDays, 'mtr.dormant_notice_days'); put(d.dormantMail, 'mtr.dormant_mail');
  if (!set.length) throw new PolicyViolation('MTR_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await mtrSettings(db), note: '회원 · 거래 기능 설정을 바꿨습니다.' };
}

/** 사유 · 메모 — 공백 하나로 · lo ~ hi 자 */
export function mtrText(raw: unknown, lo: number, hi: number, code: string, msg: string): string {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (r.length < lo || r.length > hi) throw new PolicyViolation(code, msg);
  return r;
}

/** 운영 알림 — 같은 코드가 풀리지 않고 열려 있으면 넣지 않음(ops_alerts 고유 (코드 · 시각) → clock_timestamp) */
export async function mtrAlertOnce(db: DatabaseService, code: string, severity: 'INFO' | 'WARN', title: string, detail: unknown): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1::text, $2::text, $3::text, $4::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1::text AND resolved_at IS NULL AND acknowledged_at IS NULL)
     ON CONFLICT DO NOTHING RETURNING id`, [code, severity, title, JSON.stringify(detail ?? {})]);
  return r.length > 0;
}
export async function mtrAlertResolve(db: DatabaseService, code: string, note: string) {
  await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = $1 AND resolved_at IS NULL`, [code, note.slice(0, 200)]);
}

/** 이메일 가리기(앞 2자 + ***@도메인) — 운영 목록용 */
export function mtrMaskMail(v: string | null | undefined): string {
  const s = String(v ?? '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '—';
  return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
}
