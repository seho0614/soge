import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.609 ~ 614 (docs/751 ~ 756) 18차 파트너 · 고객센터 · 회계 · 인사 — 같이 쓰는 작은 도구
 *   스위치는 모두 처음 off(sql/bzx_609 ~ 614) · 켜고 끄기는 PUT /admin/bzx/switch(SUPER · 사유 · 감사 BZX_SWITCH)
 *   설정 값 바꾸기도 기존 site_settings 를 그대로(app.setting_reason 을 남겨 「바뀐 기록」 트리거가 사유를 적게)
 * ------------------------------------------------------------------- */

export const KST = 9 * 3600e3;
export const kstToday = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
export const kstYm = () => kstToday().slice(0, 7);
export const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ID_RE = /^\d{1,18}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 글 다듬기 — 제어 문자 빼고 빈칸 하나로 · 길이 자름 */
export const clean = (s: unknown, max: number) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

export function reasonOk(r: unknown) {
  const t = clean(r, 200);
  if (t.length < 2) throw new PolicyViolation('BZX_REASON', '사유는 2 ~ 200자입니다.');
  return t;
}

export async function setting(db: DatabaseService, key: string): Promise<string> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return (r?.v ?? '').trim();
}
export const isOn = async (db: DatabaseService, key: string) => (await setting(db, key)) === 'on';

/** 18차 스위치 — 이 목록 밖 키는 PUT /admin/bzx/switch 로 못 바꿈 */
export const BZX_SWITCHES: Record<string, string> = {
  'bzx.partner_esign': '파트너 계약 전자서명 업체로 보내기(꺼져 있으면 간주 서명 · 파트너센터에서 이름 적기)',
  'bzx.partner_notice': '파트너에게 계약 만기 · 재서명 알림 보내기',
  'bzx.ad_autopause': '광고 예산을 다 쓰면 소재 자동 정지',
  'bzx.inquiry_photos': '1:1 문의 사진 더 붙이기 · 답변 사진',
  'bzx.card_notify': '법인카드 사용 즉시 알림',
};

/** PUT /admin/bzx/switch — SUPER · 사유 · 「바뀐 기록」(설정 트리거)에 사유가 남음 */
export async function setSwitch(db: DatabaseService, key: string, on: boolean, reasonIn: string) {
  if (!(key in BZX_SWITCHES)) throw new PolicyViolation('BZX_SWITCH', '18차 스위치가 아닙니다.');
  const reason = reasonOk(reasonIn);
  return db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    const r = await db.query(`UPDATE site_settings SET value = $2 WHERE key = $1 RETURNING key`, [key, on ? 'on' : 'off']);
    if (!r.length) throw new PolicyViolation('BZX_SWITCH', '설정 줄이 없습니다 — 마이그레이션을 먼저 적용하십시오.');
    return { ok: true, key, on, note: on ? '켰습니다.' : '껐습니다.' };
  });
}

export async function switches(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [Object.keys(BZX_SWITCHES)]);
  return Object.entries(BZX_SWITCHES).map(([key, label]) => ({ key, label, on: (rows.find((r) => r.key === key)?.value ?? 'off') === 'on' }));
}

/** 숫자 설정 바꾸기(SUPER) — 무늬 검사는 site_settings.value_pattern 트리거가 마지막으로 막음 */
export async function setNumber(db: DatabaseService, key: string, value: number, min: number, max: number, reasonIn: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new PolicyViolation('BZX_SETTING', `값은 ${min} ~ ${max} 사이 정수입니다.`);
  const reason = reasonOk(reasonIn);
  return db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    await db.query(`UPDATE site_settings SET value = $2 WHERE key = $1`, [key, String(value)]);
    return { ok: true, key, value, note: '바꿨습니다.' };
  });
}

/** 운영 알림 한 줄 — 같은 열쇠(detail.key)는 한 번만 · 시각은 clock_timestamp(같은 종류 같은 시각 고유 제약) */
export async function alertOnceByKey(db: DatabaseService, code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, key: string, detail: Record<string, unknown>) {
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1, $2, $3, $4::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND detail->>'key' = $5)
     ON CONFLICT DO NOTHING RETURNING id`, [code, severity, title.slice(0, 300), JSON.stringify({ ...detail, key }), key]);
  return r.length > 0;
}
export async function resolveByKey(db: DatabaseService, code: string, keyPrefix: string, note: string) {
  const r = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $3 WHERE alert_code = $1 AND resolved_at IS NULL AND detail->>'key' LIKE $2 || '%' RETURNING id`, [code, keyPrefix, note]);
  return r.length;
}
