import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound } from '../../core/errors';
import { maskEmail, maskName } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.546 (D285 · docs/684) 같은 기기 여러 계정 탐지 — 대표 11/20 「(55) ①」
 *   기기 표지 = 사용자 웹이 로그인 · 가입 때 만든 무작위 값(쿠키 sgb_dm · HttpOnly) → 헤더 X-Device-Mark(ContextMiddleware 가 모양만 봄)
 *   여기서는 sha256('sgb-dm:' + 값)만 DB 로 보냄 — 원래 값 · IP · 브라우저 글자 · 화면 크기 같은 지문은 남기지 않음
 *   쌓기 · 세기 · 경보는 DB 함수 fn_sfx_device_seen(꺼져 있으면 아무것도 안 함 · 안에서 오류를 삼켜 가입 트랜잭션을 깨지 않음)
 *   자동 정지 없음 — 운영이 위험감지 › 같은 기기 여러 계정에서 보고 판단(정지는 회원 화면 기존 흐름)
 * ------------------------------------------------------------------- */

/** 서버 · 사용자 웹이 같은 모양으로 봄(ContextMiddleware markOf · site session.ts DM_RE) */
export const DEVICE_MARK_RE = /^[A-Za-z0-9-]{16,64}$/;
/** 화면 · 경보 subject 에 쓰는 짧은 표지(해시 앞 16자) — DB 색인 ix_sfx_device_marks_short 와 같은 길이 */
export const DEVICE_SHORT_RE = /^[0-9a-f]{16}$/;

const n = (v: unknown) => Number(v ?? 0);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};

export function deviceMarkHash(mark: string): string {
  return createHash('sha256').update(`sgb-dm:${mark}`).digest('hex');
}

/** 가입 · 로그인 성공 때 — 표지가 없거나(간편 로그인 · API 직접) 꺼져 있으면 아무것도 안 함 · 실패해도 가입 · 로그인은 그대로 */
export async function sfxDeviceSeen(db: DatabaseService, accountId: string | null | undefined, via: 'SIGNUP' | 'LOGIN'): Promise<number> {
  const mark = RequestCtx.get()?.deviceMark;
  if (!accountId || !mark || !DEVICE_MARK_RE.test(mark)) return 0;
  try {
    const [r] = await db.query<{ n: number }>(`SELECT public.fn_sfx_device_seen($1::text, $2::uuid, $3::text) AS n`, [deviceMarkHash(mark), accountId, via]);
    return n(r?.n);
  } catch {
    return 0;
  }
}

async function settings(db: DatabaseService) {
  const [s] = await db.query<Record<string, string | null>>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'sfx.device_watch') AS sw,
            (SELECT value FROM site_settings WHERE key = 'sfx.device_threshold') AS th,
            (SELECT value FROM site_settings WHERE key = 'sfx.device_keep_days') AS keep`);
  return { on: s?.sw === 'on', threshold: clampInt(s?.th, 2, 20, 3), keepDays: clampInt(s?.keep, 30, 365, 180) };
}

/** GET /admin/sfx/device — 스위치 · 기준 · 최근 30일 계정 2개 이상인 표지(많은 순 100) · 열린 경보 */
export async function deviceOverview(db: DatabaseService) {
  const s = await settings(db);
  const [t] = await db.query<{ marks: number; accounts: number }>(
    `SELECT count(DISTINCT mark_hash)::int AS marks, count(DISTINCT account_id)::int AS accounts
       FROM sfx_device_marks WHERE last_seen > now() - interval '30 days'`);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT left(d.mark_hash, 16) AS mark, count(*)::int AS accounts, min(d.first_seen) AS "firstSeen", max(d.last_seen) AS "lastSeen",
            sum(d.seen_count)::int AS seen, count(*) FILTER (WHERE d.first_via = 'SIGNUP')::int AS signups,
            EXISTS (SELECT 1 FROM risk_alerts a WHERE a.rule_code = 'RSK-SFX' AND a.subject = 'device:' || left(d.mark_hash, 16) AND a.state IN ('OPEN', 'REVIEWING')) AS "alertOpen"
       FROM sfx_device_marks d
      WHERE d.last_seen > now() - interval '30 days'
      GROUP BY d.mark_hash
     HAVING count(*) >= 2
      ORDER BY count(*) DESC, max(d.last_seen) DESC
      LIMIT 100`);
  return {
    ...s, marks30: n(t?.marks), accounts30: n(t?.accounts),
    groups: rows.map((r) => ({ ...r, overThreshold: n(r.accounts) >= s.threshold })),
    note: s.on
      ? `가입 · 로그인 때 기기 표지(무작위 값의 해시)를 쌓습니다. 최근 30일 같은 표지에 계정이 ${s.threshold}개 이상이면 위험감지 경보를 남깁니다. 자동 정지는 하지 않습니다.`
      : '꺼져 있습니다(sfx.device_watch) — 켜기 전에 처리방침에 기기 표지 항목을 게시하십시오.',
  };
}

/** GET /admin/sfx/device/{mark} — 그 표지의 계정(가린 이메일 · 이름 · 상태 · 가입일 · 처음 · 마지막 · 횟수) · 감사 기록 SFX_DEVICE_VIEW */
export async function deviceDetail(db: DatabaseService, mark: string) {
  if (!DEVICE_SHORT_RE.test(String(mark ?? ''))) throw new NotFound('기기 표지를 찾을 수 없습니다.');
  const rows = await db.query<{ accountId: string; email: string; name: string; status: string; joinedAt: string; firstVia: string; firstSeen: string; lastSeen: string; seen: number; staff: boolean }>(
    `SELECT a.id::text AS "accountId", a.email::text AS email, a.name, a.status, a.created_at AS "joinedAt",
            d.first_via AS "firstVia", d.first_seen AS "firstSeen", d.last_seen AS "lastSeen", d.seen_count AS seen,
            EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'ACCOUNTANT', 'PARTNER_MAL', 'PARTNER_AFF')) AS staff
       FROM sfx_device_marks d JOIN accounts a ON a.id = d.account_id
      WHERE left(d.mark_hash, 16) = $1::text
      ORDER BY d.first_seen
      LIMIT 200`, [mark]);
  if (!rows.length) throw new NotFound('기기 표지를 찾을 수 없습니다.');
  const [al] = await db.query<{ id: string; state: string }>(
    `SELECT id::text AS id, state FROM risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = $1 ORDER BY id DESC LIMIT 1`, [`device:${mark}`]);
  return {
    mark, accounts: rows.length, alert: al ?? null,
    rows: rows.map((r) => ({ ...r, email: maskEmail(r.email), name: maskName(r.name) })),
    note: '같은 브라우저에서 가입 · 로그인한 계정입니다. 가족 · 공용 PC 일 수 있으니 회원 상세 · 활동을 보고 판단하십시오(자동 정지 없음).',
  };
}

/** 정기 작업 sfx_daily — 마지막으로 본 날부터 보관 일수가 지난 표지 지움(꺼져 있어도 지움 — 줄이기만) */
export async function devicePurge(db: DatabaseService): Promise<number> {
  const s = await settings(db);
  const r = await db.query(`DELETE FROM sfx_device_marks WHERE last_seen < now() - make_interval(days => $1::int) RETURNING 1`, [s.keepDays]);
  return r.length;
}
