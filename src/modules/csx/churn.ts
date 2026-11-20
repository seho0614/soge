import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';
import { csxSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.529 (D280 · docs/667) 이탈 위험 신호
 *   ① 매일(csx_daily 06:20 · csx.churn on 일 때만) fn_csx_churn_build() — 활동한 날(로그인 성공 · 매물 등록 · 거래 시작 · 1:1 문의)을
 *      앞 60일(91 ~ 31일 전) · 최근 30일로 나눠 하루 비율이 얼마나 줄었는지(0 ~ 100) — csx.churn_drop_pct(70) 이상이면 MID · 90 이상이면 HIGH
 *      앞 60일에 csx.churn_min_prev_days(3)일 넘게 쓴 회원만 · 운영 역할 회원 · 쓰지 않는 계정은 뺌
 *   ② 표 csx_churn_signals(지금 위험한 회원만 · 매일 다시 만듦) · csx_churn_daily(날마다 수 · 사람 정보 없음)
 *   ③ 개인 식별은 운영 화면 안에서만 — 목록은 가린 메일 · 이름 첫 글자 · 내려받기(CSV) 없음 · 밖으로 보내지 않음
 *   ④ 재방문 안내는 마케팅 수신 동의자만 — 기존 「문자 · 메일 캠페인」(D268)의 대상 CHURN_RISK(동의 · 야간 동의 · (광고) · 수신 거부는 그쪽 서버가 지킴)
 * ------------------------------------------------------------------- */

export const CHURN_LEVELS = ['HIGH', 'MID'] as const;
const PAGE = 50;

export async function churnList(db: DatabaseService, levelIn?: string, pageIn?: number) {
  const level = (CHURN_LEVELS as readonly string[]).includes(String(levelIn ?? '')) ? String(levelIn) : null;
  const page = Math.max(1, Math.min(200, Math.floor(Number(pageIn) || 1)));
  const s = await csxSettings(db);
  const rows = await db.query<{ email: string | null; name: string | null } & Record<string, unknown>>(
    `SELECT c.account_id::text AS "accountId", a.email::text AS email, a.name, c.prev_days AS "prevDays", c.recent_days AS "recentDays",
            c.last_active_on AS "lastActiveOn", c.score, c.level, c.day, a.created_at AS "joinedAt",
            public.fn_consent_at(a.id, 'MARKETING', now()) AS marketing,
            (SELECT count(*)::int FROM listings l WHERE l.owner_account_id = a.id AND l.status = 'PUBLISHED') AS listings
       FROM csx_churn_signals c JOIN accounts a ON a.id = c.account_id
      WHERE ($1::text IS NULL OR c.level = $1)
      ORDER BY c.score DESC, c.prev_days DESC, c.account_id
      LIMIT $2::int OFFSET $3::int`, [level, PAGE + 1, (page - 1) * PAGE]);
  const [c] = await db.query<{ high: number; mid: number; consented: number; built: string | null }>(
    `SELECT count(*) FILTER (WHERE level = 'HIGH')::int AS high, count(*) FILTER (WHERE level = 'MID')::int AS mid,
            count(*) FILTER (WHERE public.fn_consent_at(account_id, 'MARKETING', now()))::int AS consented, max(built_at)::text AS built
       FROM csx_churn_signals`);
  const trend = await db.query(`SELECT day, high, mid FROM csx_churn_daily WHERE day > (now() AT TIME ZONE 'Asia/Seoul')::date - 30 ORDER BY day`);
  return {
    on: s.churn, minPrevDays: s.churnMinPrevDays, dropPct: s.churnDropPct, page, more: rows.length > PAGE,
    counts: { high: c?.high ?? 0, mid: c?.mid ?? 0, consented: c?.consented ?? 0 }, builtAt: c?.built ?? null, trend,
    rows: rows.slice(0, PAGE).map(({ email, name, ...r }) => ({ ...r, email: maskMail(email), nameHead: name ? `${name.slice(0, 1)}*` : '—' })),
    note: '재방문 안내는 회원 › 문자 · 메일 캠페인에서 대상 「이탈 위험 신호 회원(동의자만)」으로 보냅니다 — 마케팅 수신 동의가 없는 회원에게는 가지 않습니다.',
  };
}

/** 지금 다시 셈(운영 · 스위치 켜져 있을 때만) */
export async function churnRebuild(db: DatabaseService) {
  const s = await csxSettings(db);
  if (!s.churn) throw new PolicyViolation('CSX_CHURN_OFF', '이탈 위험 신호가 꺼져 있습니다(csx.churn) — 켠 뒤 다시 셉니다.');
  const [r] = await db.query<{ n: number }>(`SELECT fn_csx_churn_build() AS n`);
  return { ok: true, count: Number(r?.n ?? 0), note: `이탈 위험 신호를 다시 셌습니다 — ${Number(r?.n ?? 0)}명.` };
}

/** 매일 — 스위치 꺼져 있으면 아무것도 안 함(표는 그대로) */
export async function churnJob(db: DatabaseService) {
  const s = await csxSettings(db);
  if (!s.churn) return { skipped: 'CHURN_OFF', made: 0 };
  const [r] = await db.query<{ n: number }>(`SELECT fn_csx_churn_build() AS n`);
  return { made: Number(r?.n ?? 0) };
}
