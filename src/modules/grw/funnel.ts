import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { STAFF_ROLES } from '../admin/staff';
import { grwSettings, kstDay, num } from './common';

/* ---------------------------------------------------------------------
 * v10.597 (docs/739) ⑬ 가입 퍼널 분석 — 읽기만 · 숫자만(누가 어디서 멈췄는지는 알 수 없음)
 *   이미 있는 것을 넓힘:
 *     · 화면 사용 통계(v10.508 · D274 site_usage_daily) — /signup · /signup/done 화면 수(site.usage_stats on 일 때만 쌓임)
 *     · 유입 기록(D010 attribution_events · INTRO · AD) · 추천 관계(D189 introducer_referrals) → 유입 경로 넷(추천 코드 · 소개코드 링크 · 광고 · 직접)
 *     · 가입 · 본인인증(accounts) · 첫 활동(관심 · 문의 · 매물 · 요청) · 첫 거래(deals)
 *   새로 쌓는 것: 가입 화면 단계(1 유형 · 2 기업 인증 · 3 정보 · 4 약관 · 5 관심 성향)에 닿은 하루 수만(grw_signup_steps_daily)
 *     · grw.signup_steps 가 꺼져 있으면(처음) 받지 않음 · 계정 · IP · 브라우저 정보 · 쿠키 저장 없음 · DNT · GPC · 로봇 무시
 *     · 브라우저 탭마다 단계 하나에 한 번(sessionStorage · 서버로 가지 않음) · 보관은 site.usage_keep_days(400일 · 정기 작업 grw_daily)
 *   운영자 · 직원 계정(SUPER · ADMIN · PAYOUT · REVIEWER · PARTNER_* · ACCOUNTANT)은 셈에서 뺌
 * ------------------------------------------------------------------- */

export const SIGNUP_STEPS = [1, 2, 3, 4, 5] as const;
export const FUNNEL_SOURCES = ['RECOMMEND', 'REFCODE', 'AD', 'DIRECT'] as const;
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests|lighthouse/i;

/* 요청 수 제한 — IP 지문(저장 안 함 · 메모리 1분) 1분 60번 */
const hits = new Map<string, { n: number; t: number }>();
function tooMany(ip: string) {
  const now = Date.now();
  if (hits.size > 50000) hits.clear();
  const k = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const h = hits.get(k);
  if (!h || now - h.t > 60_000) { hits.set(k, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 60;
}

/** POST /site/grw/signup-step — 받으면 하루 수에 1 더함 · 받지 않은 까닭만 돌려줌(화면은 결과를 보지 않음) */
export async function signupStepBeat(db: DatabaseService, step: unknown, h: { ua?: string; dnt?: string; gpc?: string; ip?: string }) {
  const s = await grwSettings(db);
  if (!s.signupSteps) return { ok: false, reason: 'OFF' };
  if (h.dnt === '1' || h.gpc === '1') return { ok: false, reason: 'DNT' };
  if (!h.ua || BOT_UA.test(h.ua)) return { ok: false, reason: 'BOT' };
  if (h.ip && tooMany(h.ip)) return { ok: false, reason: 'RATE' };
  const st = Number(step);
  if (!(SIGNUP_STEPS as readonly number[]).includes(st)) return { ok: false, reason: 'STEP' };
  await db.query(`SELECT fn_grw_step_add($1::date, $2::int)`, [kstDay(), st]);
  return { ok: true };
}

/** GET /admin/grw/funnel?days=7|30|90 — 가입 화면 → 단계 → 가입 → 본인인증 → 첫 활동 → 첫 거래 · 유입 경로별 · 날마다 */
export async function funnelView(db: DatabaseService, daysIn?: string) {
  const days = [7, 30, 90].includes(num(daysIn)) ? num(daysIn) : 30;
  const from = kstDay(-(days - 1));
  const s = await grwSettings(db);
  const [u] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'site.usage_stats'`);
  const usageOn = u?.v === 'on';
  const [page] = await db.query<{ signup: string; done: string }>(
    `SELECT coalesce(sum(views) FILTER (WHERE path = '/signup'), 0)::int AS signup, coalesce(sum(views) FILTER (WHERE path = '/signup/done'), 0)::int AS done
       FROM site_usage_daily WHERE day >= $1::date AND path IN ('/signup', '/signup/done')`, [from]);
  const steps = await db.query<{ step: number; n: number }>(
    `SELECT step::int AS step, sum(n)::int AS n FROM grw_signup_steps_daily WHERE day >= $1::date GROUP BY step ORDER BY step`, [from]);
  const rows = await db.query<{ src: string; signed: number; verified: number; active: number; dealt: number }>(
    `WITH c AS (
       SELECT a.id, a.identity_verified_at,
              CASE WHEN EXISTS (SELECT 1 FROM introducer_referrals r WHERE r.invitee_id = a.id) THEN 'RECOMMEND'
                   WHEN EXISTS (SELECT 1 FROM attribution_events e WHERE e.account_id = a.id AND e.source = 'AD' AND e.occurred_at <= a.created_at + interval '1 day') THEN 'AD'
                   WHEN EXISTS (SELECT 1 FROM attribution_events e WHERE e.account_id = a.id AND e.source = 'INTRO' AND e.occurred_at <= a.created_at + interval '1 day') THEN 'REFCODE'
                   ELSE 'DIRECT' END AS src
         FROM accounts a
        WHERE a.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul')
          AND NOT EXISTS (SELECT 1 FROM account_roles x WHERE x.account_id = a.id AND x.role = ANY($2::text[]))
     ), f AS (
       SELECT c.src, c.identity_verified_at,
              (EXISTS (SELECT 1 FROM favorites v WHERE v.account_id = c.id) OR EXISTS (SELECT 1 FROM conversations v WHERE v.initiator_id = c.id)
               OR EXISTS (SELECT 1 FROM listings l WHERE l.owner_account_id = c.id) OR EXISTS (SELECT 1 FROM requests q WHERE q.owner_account_id = c.id)) AS active,
              EXISTS (SELECT 1 FROM deals d WHERE (d.buyer_account_id = c.id OR d.seller_account_id = c.id OR d.introducer_account_id = c.id) AND d.status <> 'CANCELLED') AS dealt
         FROM c)
     SELECT src, count(*)::int AS signed, count(identity_verified_at)::int AS verified,
            count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE dealt)::int AS dealt
       FROM f GROUP BY src`, [from, [...STAFF_ROLES]]);
  const bySource = FUNNEL_SOURCES.map((src) => {
    const r = rows.find((x) => x.src === src);
    const signed = num(r?.signed);
    const pct = (v: number) => (signed ? Math.round((1000 * v) / signed) / 10 : null);
    return { source: src, signed, verified: num(r?.verified), active: num(r?.active), dealt: num(r?.dealt),
             verifiedPct: pct(num(r?.verified)), activePct: pct(num(r?.active)), dealtPct: pct(num(r?.dealt)) };
  });
  const total = bySource.reduce((a, b) => ({ signed: a.signed + b.signed, verified: a.verified + b.verified, active: a.active + b.active, dealt: a.dealt + b.dealt }),
    { signed: 0, verified: 0, active: 0, dealt: 0 });
  const daily = await db.query(
    `SELECT to_char((a.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS day, count(*)::int AS signed, count(a.identity_verified_at)::int AS verified
       FROM accounts a
      WHERE a.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul')
        AND NOT EXISTS (SELECT 1 FROM account_roles x WHERE x.account_id = a.id AND x.role = ANY($2::text[]))
      GROUP BY 1 ORDER BY 1`, [from, [...STAFF_ROLES]]);
  const stepRows = SIGNUP_STEPS.map((st) => ({ step: st, n: num(steps.find((x) => x.step === st)?.n) }));
  const first = stepRows[0]?.n ?? 0;
  return {
    days, from, settings: { signupSteps: s.signupSteps, usageStats: usageOn },
    page: usageOn ? { signupViews: num(page?.signup), doneViews: num(page?.done) } : null,
    steps: stepRows.map((x, i) => ({ ...x, pct: first ? Math.round((1000 * x.n) / first) / 10 : null, dropPct: i && stepRows[i - 1]!.n ? Math.round((1000 * Math.max(stepRows[i - 1]!.n - x.n, 0)) / stepRows[i - 1]!.n) / 10 : null })),
    total, bySource, daily,
    note: '숫자만 있습니다(누가 어느 단계에서 멈췄는지 · IP · 브라우저 정보는 없습니다). 가입 단계는 grw.signup_steps 가 켜진 날부터 · 화면 수는 화면 사용 통계(site.usage_stats)가 켜진 날부터 쌓입니다. 운영 · 직원 계정은 뺐습니다.',
  };
}

/** 정기(grw_daily) — 보관 날 수(site.usage_keep_days · 400) 지난 단계 수 지움 */
export async function stepPurge(db: DatabaseService) {
  const [k] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'site.usage_keep_days'`);
  const keep = Math.min(1100, Math.max(30, num(k?.v ?? 400)));
  const a = await db.query(`DELETE FROM grw_signup_steps_daily WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - $1::int RETURNING day`, [keep]);
  return { days: keep, steps: a.length };
}
