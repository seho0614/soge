/* ---------------------------------------------------------------------
 * v10.631 (D307 · docs/775) COMPARE 「다름」 하루 요약 — PERM_COMPARE_DIFF
 *   정기 작업 sec2_tick(10분)이 부름 → DB 함수 fn_perm_compare_daily()
 *   perm.mode = COMPARE 일 때만 · 08시(한국) 뒤 · 어제(한국) 하루치를 하루 한 번
 *   · 다름 있음 → WARN 「어제 다름 n건 · 주소 m곳」 + 많은 주소 5개(detail.top)
 *   · 다름 0   → INFO 「어제 다름 0」(GROUPS 로 바꾸는 조건 하루치 — 직원 · 권한 › 업무별 권한 › 판정 방식 점검표)
 *   읽기만(perm_shadow_log) · 알림 한 줄만 씀.
 * ------------------------------------------------------------------- */
export interface PermDailyDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }

export async function permCompareDaily(db: PermDailyDb) {
  const [r] = await db.query<{ n: number }>(`SELECT fn_perm_compare_daily() AS n`);
  const n = Number(r?.n ?? -1);
  return n < 0 ? { skipped: true, total: null } : { skipped: false, total: n };
}
