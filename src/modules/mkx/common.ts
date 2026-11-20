import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.538 ~ 541 (D283 · docs/676 ~ 679) (53) 회원 · 소개몰 — 공통 조각
 *   설정 읽기 · 끝값 자르기(DB value_pattern 과 같은 끝값) · 감사 · 운영 알림 · 한국 시각
 * ------------------------------------------------------------------- */

/** 웹 푸시 받는 주소 — DB CHECK mkx_push_subs.endpoint 와 같은 정규식(규칙 2 · 길이는 1,000자 따로) */
export const PUSH_ENDPOINT_RE = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)\/[!-~]+$/;
/** DB CHECK p256dh · auth 와 같음 */
export const P256DH_RE = /^[A-Za-z0-9_-]{80,100}$/;
export const AUTH_RE = /^[A-Za-z0-9_-]{16,32}$/;
/** DB value_pattern push.vapid_subject 와 같음(빈 값 빼고) */
export const VAPID_SUBJECT_RE = /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/;
/** 상품 코드(소개몰 hlt_products.code) — 주소 칸 검사 */
export const PRODUCT_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function readSettings(db: DatabaseService, keys: string[]): Promise<Record<string, string>> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [keys]);
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = (rows.find((r) => r.key === k)?.value ?? '').trim();
  return out;
}

export const isOn = (v: string | null | undefined) => (v ?? '').trim().toLowerCase() === 'on';

/** 정수 설정 — 무늬 밖이면 처음 값(DB value_pattern 이 막지만 한 번 더) */
export function intIn(v: string | null | undefined, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
}

/** 21:00 ~ 08:00(한국) — ㊳ isNightKst · DB fn_mkt_send_guard 와 같은 기준 */
export function nightKst(d = new Date()): boolean {
  const h = new Date(d.getTime() + 9 * 3600e3).getUTCHours();
  return h >= 21 || h < 8;
}

/** 오늘(한국) YYYY-MM-DD */
export const todayKst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function cleanReason(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** 감사 기록(audit.audit_logs — 시각 칸 occurred_at 은 표가 채움) · 실패해도 본 일은 막지 않음 */
export function mkxAudit(db: DatabaseService, action: string, targetType: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, targetType, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

/** 운영 알림 한 줄 — 같은 종류의 풀리지 않은 같은 열쇠(detail.key)가 있으면 넣지 않음 · 시각은 clock_timestamp()(같은 종류 같은 시각 고유) */
export async function mkxAlert(db: DatabaseService, code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, key: string, detail: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1, $2, $3, $4::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND detail->>'key' = $5 AND resolved_at IS NULL)
     ON CONFLICT DO NOTHING`,
    [code, severity, title.slice(0, 300), JSON.stringify({ ...detail, key }), key]).catch(() => undefined);
}
