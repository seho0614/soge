import { createHash } from 'crypto';

/* ---------------------------------------------------------------------
 * e1.3 (docs/003) ERP 작업 실행기 — 1분마다 「지금 돌 차례인 작업」을 고르고 겹치지 않게 돌림
 *   주기: every Nm(마지막 실행에서 N분 지남) · daily HH:MM(한국 시각 그 시각 지났고 오늘 아직 안 돎)
 *   주인: erp_settings erp.jobs_owner = ERP 일 때만 정기 실행 — 지금은 SGB(소개뱅크 scheduler 가 회계 · 인사 작업을 돌림 · E7 에서 넘김)
 *   겹침: pg_try_advisory_lock(이름 해시) · 실패하면 그 차례는 건너뜀
 *   실패: 기록 + 소개뱅크 운영 알림 ERP_JOB_FAIL(ONCE) · 다음 성공 때 RESOLVE
 * ------------------------------------------------------------------- */

import { alertFlush } from './alert-flush';
import { ACCT_JOBS } from '../acct/acct-jobs';
import type { DatabaseService } from '../../db/database.service';
type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
export type JobFn = (q: Q, a: Alerter, db?: DatabaseService) => Promise<string | void>;   // e3.6 — 옮긴 회계 작업은 DatabaseService(트랜잭션)를 씀   // e3.1 — 알림 넘기기가 소개뱅크 연결(Alerter)을 씀
export interface Alerter { alert(a: { code: string; title?: string; severity?: 'INFO' | 'WARN' | 'CRITICAL'; detail?: Record<string, unknown>; mode?: 'RAISE' | 'ONCE' | 'RESOLVE'; note?: string }): Promise<boolean> }

export const JOBS: Record<string, JobFn> = {
  erp_heartbeat: async () => 'ok',
  erp_alert_flush: (q, a) => alertFlush(q, a),   // e3.1 (E007)
  /* e3.6 회계 18 — 주인이 ERP 일 때만(ALWAYS_JOBS 아님) · DatabaseService 가 없으면(시험) 돌지 않음 */
  ...Object.fromEntries(Object.entries(ACCT_JOBS).map(([k, f]) => [k, async (_q: Q, _a: Alerter, db?: DatabaseService) => { if (!db) throw new Error('DatabaseService 필요'); return f(db); }])),
  erp_runs_purge: async (q) => {
    const r = await q<{ n: number }>(`WITH d AS (DELETE FROM erp_job_runs WHERE started_at < now() - interval '90 days' RETURNING 1) SELECT count(*)::int AS n FROM d`);
    return `지움 ${r[0]?.n ?? 0}`;
  },
};

/** 주인(erp.jobs_owner)과 상관없이 도는 ERP 자기 작업 */
export const ALWAYS_JOBS = ['erp_heartbeat', 'erp_runs_purge', 'erp_alert_flush'];

export const lockKey = (name: string) => {
  const h = createHash('sha256').update('erp_job:' + name).digest();
  return h.readInt32BE(0);   // advisory lock 키(int4 두 개 중 하나로 씀)
};

/** 지금 돌 차례인가(시험이 시각을 넣어 부름) */
export function due(schedule: string, lastRunAt: Date | null, now: Date): boolean {
  const m = /^every (\d{1,4})m$/.exec(schedule);
  if (m) return !lastRunAt || now.getTime() - lastRunAt.getTime() >= Number(m[1]) * 60_000;
  const d = /^daily ([0-2]\d):([0-5]\d)$/.exec(schedule);
  if (!d) return false;
  const kst = (t: Date) => new Date(t.getTime() + 9 * 3600_000);
  const k = kst(now);
  const today = k.toISOString().slice(0, 10);
  const passed = k.getUTCHours() * 60 + k.getUTCMinutes() >= Number(d[1]) * 60 + Number(d[2]);
  const ranToday = !!lastRunAt && kst(lastRunAt).toISOString().slice(0, 10) === today;
  return passed && !ranToday;
}

export async function runJob(q: Q, alerter: Alerter, name: string, manualBy: string | null = null, db?: DatabaseService) {
  const fn = JOBS[name];
  if (!fn) return { ok: false, note: '등록되지 않은 작업' };
  const [l] = await q<{ got: boolean }>(`SELECT pg_try_advisory_lock(7300, $1) AS got`, [lockKey(name)]);
  if (!l?.got) return { ok: false, note: '다른 곳에서 도는 중 — 건너뜀', skipped: true };
  const [run] = await q<{ id: number }>(`INSERT INTO erp_job_runs (job, manual_by) VALUES ($1, $2) RETURNING id`, [name, manualBy]);
  let ok = true, note = '';
  try { note = String((await fn(q, alerter, db)) ?? '').slice(0, 500); }
  catch (e: any) { ok = false; note = String(e?.message ?? e).slice(0, 500); }
  finally {
    await q(`UPDATE erp_job_runs SET ended_at = now(), ok = $2, note = $3 WHERE id = $1`, [run.id, ok, note || null]);
    await q(`UPDATE erp_jobs SET last_run_at = now(), last_ok = $2, last_note = $3, updated_at = now() WHERE name = $1`, [name, ok, note || null]);
    await q(`SELECT pg_advisory_unlock(7300, $1)`, [lockKey(name)]);
  }
  if (!ok) await alerter.alert({ code: 'ERP_JOB_FAIL', mode: 'ONCE', severity: 'WARN', title: `ERP 정기 작업 실패 — ${name}`, detail: { job: name, note } });
  else await alerter.alert({ code: 'ERP_JOB_FAIL', mode: 'RESOLVE', note: `${name} 성공` });
  return { ok, note };
}

/** 1분마다 부름 — 주인이 ERP 일 때만 · 켜진 작업 중 차례인 것 */
export async function tick(q: Q, alerter: Alerter, now = new Date(), db?: DatabaseService) {
  const [o] = await q<{ v: string | null }>(`SELECT value AS v FROM erp_settings WHERE key = 'erp.jobs_owner'`);
  const owner = o?.v ?? 'SGB';
  const jobs = await q<{ name: string; schedule: string; last_run_at: Date | null }>(`SELECT name, schedule, last_run_at FROM erp_jobs WHERE enabled ORDER BY name`);
  const ran: string[] = [];
  for (const j of jobs) {
    /* e3.1 — ERP 자기 일(ALWAYS_JOBS · 알림 넘기기)은 주인과 상관없이 · 회계 · 인사 작업은 주인이 ERP 일 때만(E7 에서 넘김) */
    if (owner !== 'ERP' && !ALWAYS_JOBS.includes(j.name)) continue;
    if (!JOBS[j.name] || !due(j.schedule, j.last_run_at ? new Date(j.last_run_at) : null, now)) continue;
    await runJob(q, alerter, j.name, null, db);
    ran.push(j.name);
  }
  return { owner, ran };
}
