/* ---------------------------------------------------------------------
 * v10.590 ~ 593 (docs/732 ~ 735) 정기 작업 sec2_tick — 10분마다
 *   ① 07시(한국) 뒤 어제 운영자 이상 행동 셈 — sec2.anomaly_watch on 일 때만 · 하루 한 번(sec2_anomaly_runs)
 *   ② 회원 「내가 아니에요」 1시간 몰림 알림 — sec2.not_me_surge > 0
 *   ③ 정리(꺼져 있어도 — 줄이기만): 하루 지난 2단계 표 · 로그인 기록 보관 날수 지난 낯선 로그인 줄 · 400일 지난 유출 확인 건수
 *   하나가 실패해도 나머지는 함(결과에 오류 글).
 * ------------------------------------------------------------------- */
import { Sec2Db } from './common';
import { sec2AnomalyDaily } from './anomaly';
import { sec2NotMeSurge } from './login-alert';

export async function sec2TickJob(db: Sec2Db) {
  const out: Record<string, unknown> = {};
  const step = async (k: string, fn: () => Promise<unknown>) => {
    try { out[k] = await fn(); } catch (e) { out[k] = { error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  };
  await step('anomaly', () => sec2AnomalyDaily(db));
  await step('notMe', () => sec2NotMeSurge(db));
  await step('purge', async () => {
    const t = await db.query(`DELETE FROM sec2_mfa_tickets WHERE created_at < now() - interval '1 day' RETURNING 1`);
    const a = await db.query(
      `DELETE FROM sec2_login_alerts WHERE created_at < now() - make_interval(days => greatest(30, fn_setting_int('privacy.login_history_days', 180))) RETURNING 1`);
    const p = await db.query(`DELETE FROM sec2_pwned_log WHERE at < now() - interval '400 days' RETURNING 1`);
    return { tickets: t.length, alerts: a.length, pwned: p.length };
  });
  const purge = out.purge as { tickets?: number; alerts?: number; pwned?: number } | undefined;
  const an = out.anomaly as { added?: number } | undefined;
  return { affected: (an?.added ?? 0) + (purge?.tickets ?? 0) + (purge?.alerts ?? 0) + (purge?.pwned ?? 0), detail: out };
}
