import { DatabaseService } from '../../db/database.service';
import { STAFF_ROLES } from '../admin/staff';
import { grwSettings, kstDay, num } from './common';

/* ---------------------------------------------------------------------
 * v10.598 (docs/740) ⑭ 첫 거래 안내 체크리스트 — 새 회원 · 나의공간 첫 화면 카드
 *   새로 모으는 정보 없음 — 이미 있는 기록을 본인 것만 셈(본인인증 · 관심 성향 · 관심 담기 · 문의 · 매물/요청 · 거래 · 알림 설정 · 추천 코드)
 *   보여 주는 때: grw.first_steps on(처음 on · 표시만) · 가입 grw.first_steps_days(60)일 안 · 「그만 보기」 안 함 · 아직 남은 단계가 있음
 *   「그만 보기」 · 「다시 보기」는 grw_first_steps 한 줄(본인) · 다 끝나면 all_done_at 을 한 번 적음(운영 통계)
 *   운영 화면은 숫자만(최근 가입자 중 단계마다 끝낸 수 · 그만 보기 수)
 * ------------------------------------------------------------------- */

export const FIRST_STEPS = [
  { code: 'VERIFY', href: '/verify' },
  { code: 'PROFILE', href: '/ai/profile' },
  { code: 'LIKE', href: '/' },
  { code: 'ASK', href: '/' },
  { code: 'POST', href: '/register' },
  { code: 'DEAL', href: '/my/deals' },
  { code: 'NOTIFY', href: '/my/notifications#prefs' },
  { code: 'SHARE', href: '/my/recommend' },
] as const;
export type FirstStepCode = (typeof FIRST_STEPS)[number]['code'];

/** 한 사람(또는 여러 사람)의 단계 끝남 — 같은 셈을 본인 · 운영 통계가 함께 씀 */
const STEP_SQL = `
  SELECT a.id::text AS id, a.created_at,
         (a.identity_verified_at IS NOT NULL) AS "VERIFY",
         EXISTS (SELECT 1 FROM member_ad_profiles p WHERE p.account_id = a.id) AS "PROFILE",
         EXISTS (SELECT 1 FROM favorites v WHERE v.account_id = a.id) AS "LIKE",
         EXISTS (SELECT 1 FROM conversations v WHERE v.initiator_id = a.id) AS "ASK",
         (EXISTS (SELECT 1 FROM listings l WHERE l.owner_account_id = a.id) OR EXISTS (SELECT 1 FROM requests q WHERE q.owner_account_id = a.id)) AS "POST",
         EXISTS (SELECT 1 FROM deals d WHERE (d.buyer_account_id = a.id OR d.seller_account_id = a.id OR d.introducer_account_id = a.id) AND d.status <> 'CANCELLED') AS "DEAL",
         (EXISTS (SELECT 1 FROM notification_preferences np WHERE np.account_id = a.id) OR EXISTS (SELECT 1 FROM grw_digest_prefs g WHERE g.account_id = a.id)) AS "NOTIFY",
         EXISTS (SELECT 1 FROM introducer_referrals r WHERE r.inviter_id = a.id) AS "SHARE",
         f.hidden_at, f.all_done_at
    FROM accounts a
    LEFT JOIN grw_first_steps f ON f.account_id = a.id`;

type StepRow = { id: string; created_at: Date; hidden_at: Date | null; all_done_at: Date | null } & Record<FirstStepCode, boolean>;

/** GET /me/grw/first-steps — 내 단계 · 보여 줄지(show) */
export async function myFirstSteps(db: DatabaseService, accountId: string) {
  const s = await grwSettings(db);
  const [r] = await db.query<StepRow>(`${STEP_SQL} WHERE a.id = $1::uuid`, [accountId]);
  if (!r) return { show: false, reason: 'NONE', steps: [], done: 0, total: FIRST_STEPS.length };
  const steps = FIRST_STEPS.map((x) => ({ code: x.code, href: x.href, done: !!r[x.code] }));
  const done = steps.filter((x) => x.done).length;
  if (done === FIRST_STEPS.length && !r.all_done_at) {
    await db.query(
      `INSERT INTO grw_first_steps (account_id, all_done_at) VALUES ($1::uuid, now())
       ON CONFLICT (account_id) DO UPDATE SET all_done_at = coalesce(grw_first_steps.all_done_at, now()), updated_at = now()`, [accountId]);
  }
  const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400e3);
  const reason = !s.firstSteps ? 'OFF' : r.hidden_at ? 'HIDDEN' : ageDays > s.firstStepsDays ? 'OLD' : done === FIRST_STEPS.length ? 'DONE' : null;
  return { show: reason === null, reason, steps, done, total: FIRST_STEPS.length, hidden: !!r.hidden_at, days: s.firstStepsDays, ageDays };
}

/** POST /me/grw/first-steps/hide { hidden } — 그만 보기 · 다시 보기(본인) */
export async function hideFirstSteps(db: DatabaseService, accountId: string, hidden: boolean) {
  await db.query(
    `INSERT INTO grw_first_steps (account_id, hidden_at) VALUES ($1::uuid, CASE WHEN $2::boolean THEN now() END)
     ON CONFLICT (account_id) DO UPDATE SET hidden_at = CASE WHEN $2::boolean THEN coalesce(grw_first_steps.hidden_at, now()) END, updated_at = now()`,
    [accountId, hidden]);
  return { ok: true, hidden, note: hidden ? '첫 거래 안내를 더 보이지 않게 했습니다.' : '첫 거래 안내를 다시 보이게 했습니다.' };
}

/** GET /admin/grw/first-steps?days=30|60|90 — 최근 가입자(운영 · 직원 빼고) 중 단계마다 끝낸 수 · 그만 보기 · 다 끝냄(숫자만) */
export async function firstStepsStats(db: DatabaseService, daysIn?: string) {
  const days = [30, 60, 90].includes(num(daysIn)) ? num(daysIn) : 30;
  const from = kstDay(-(days - 1));
  const s = await grwSettings(db);
  const rows = await db.query<StepRow>(
    `${STEP_SQL}
      WHERE a.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul') AND a.withdrawn_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM account_roles x WHERE x.account_id = a.id AND x.role = ANY($2::text[]))
      LIMIT 50000`, [from, [...STAFF_ROLES]]);
  const members = rows.length;
  const steps = FIRST_STEPS.map((x) => {
    const done = rows.filter((r) => r[x.code]).length;
    return { code: x.code, done, pct: members ? Math.round((1000 * done) / members) / 10 : null };
  });
  const allDone = rows.filter((r) => FIRST_STEPS.every((x) => r[x.code])).length;
  return {
    days, from, settings: { firstSteps: s.firstSteps, firstStepsDays: s.firstStepsDays },
    members, steps, allDone, hidden: rows.filter((r) => r.hidden_at).length,
    note: '최근 가입한 회원(운영 · 직원 계정 빼고) 중 단계마다 끝낸 사람 수입니다. 누가 끝냈는지는 보이지 않습니다.',
  };
}
