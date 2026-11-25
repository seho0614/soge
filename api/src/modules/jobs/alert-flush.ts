/* ---------------------------------------------------------------------
 * e3.1 (E007 · docs/010) ERP 운영 알림 → 소개뱅크 (정기 작업 erp_alert_flush · 1분 · 주인과 상관없이)
 *   ① 새 줄(forwarded_at 없음 · 시도 5번 미만) → RAISE · detail 에 erpAlertId · 성공하면 forwarded_at
 *      실패하면 forward_tries + 1 · 5번 넘으면 멈춤(ERP 화면에서 볼 수 있게 forward_error 남김)
 *   ② 풀린 줄(resolved_at 있음 · resolve_forwarded_at 없음 · 이미 넘긴 줄) → 같은 종류에 안 풀린 줄이 없을 때만 RESOLVE(종류 단위)
 *   한 번에 100줄 · 소개뱅크가 멈춰 있으면 다음 차례에 다시
 * ------------------------------------------------------------------- */
type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
export interface FlushAlerter { alert(a: { code: string; title?: string; severity?: 'INFO' | 'WARN' | 'CRITICAL'; detail?: Record<string, unknown>; mode?: 'RAISE' | 'ONCE' | 'RESOLVE'; note?: string }): Promise<boolean> }

export const FLUSH_MAX = 100;
export const FLUSH_TRIES = 5;

export async function alertFlush(q: Q, a: FlushAlerter) {
  let sent = 0, failed = 0, resolved = 0;
  const rows = await q<{ id: number; alert_code: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; title: string; detail: Record<string, unknown> | null }>(
    `SELECT id, alert_code, severity, title, detail FROM ops_alerts
      WHERE forwarded_at IS NULL AND forward_tries < $1 ORDER BY id LIMIT $2`, [FLUSH_TRIES, FLUSH_MAX]);
  for (const r of rows) {
    const ok = await a.alert({ code: r.alert_code, mode: 'RAISE', severity: r.severity, title: r.title.slice(0, 200), detail: { ...(r.detail ?? {}), erpAlertId: r.id } });
    if (ok) { sent++; await q(`UPDATE ops_alerts SET forwarded_at = now(), forward_error = NULL WHERE id = $1`, [r.id]); }
    else { failed++; await q(`UPDATE ops_alerts SET forward_tries = forward_tries + 1, forward_error = $2 WHERE id = $1`, [r.id, '소개뱅크가 받지 않음(종류 · 연결 · 토큰 확인)']); }
  }
  const done = await q<{ alert_code: string }>(
    `SELECT DISTINCT o.alert_code FROM ops_alerts o
      WHERE o.resolved_at IS NOT NULL AND o.resolve_forwarded_at IS NULL AND o.forwarded_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_code = o.alert_code AND x.resolved_at IS NULL)
      LIMIT $1`, [FLUSH_MAX]);
  for (const d of done) {
    if (await a.alert({ code: d.alert_code, mode: 'RESOLVE', note: 'ERP 에서 풀림' })) {
      resolved++;
      await q(`UPDATE ops_alerts SET resolve_forwarded_at = now() WHERE alert_code = $1 AND resolved_at IS NOT NULL AND resolve_forwarded_at IS NULL`, [d.alert_code]);
    }
  }
  return `보냄 ${sent} · 실패 ${failed} · 풀림 ${resolved}`;
}
