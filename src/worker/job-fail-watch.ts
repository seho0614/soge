/* ---------------------------------------------------------------------
 * v10.627 (D307 · docs/771) 정기 작업 연속 실패 알림 — JOB_FAILING
 *   tick() 이 작업 한 차례를 job_runs 에 적은 바로 뒤에 부름 → DB 함수 fn_job_fail_watch(작업, 성공)
 *   · 실패: 최근 끝난 차례 N개(설정 ops.job_fail_streak · 처음 3 · 0 이면 끔)가 모두 실패면 운영 알림 한 번(작업마다 풀리지 않은 것 하나)
 *     심각도 CRITICAL(메일 · 텔레그램 길 그대로) · 「이 판에는 없는 작업」(UNKNOWN_JOB · 되돌린 상태)은 WARN
 *   · 성공: 그 작업의 풀리지 않은 JOB_FAILING 을 「다음 차례 성공」 으로 풂
 *   알림이 실패해도 작업 기록에는 영향 없음(부르는 쪽이 catch).
 * ------------------------------------------------------------------- */
export interface JobFailDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }

export async function jobFailWatch(db: JobFailDb, job: string, ok: boolean) {
  const [r] = await db.query<{ n: number }>(`SELECT fn_job_fail_watch($1, $2) AS n`, [job, ok]);
  return Number(r?.n ?? 0);   // 1 = 알림 만듦 · 음수 = 푼 수
}
