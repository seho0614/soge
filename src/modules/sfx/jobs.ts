import { DatabaseService } from '../../db/database.service';
import { devicePurge } from './device';
import { retentionJob } from './retention';
import { tmPurge } from './tm';

/* v10.546 ~ 548 (D285) 정기 작업 sfx_daily — 매일 05:20
 *   ① 오래된 기기 표지 지움(sfx.device_keep_days · 꺼져 있어도 — 줄이기만)
 *   ② sfx.retention_alert on 이면 서류 보관 대장 맞추기 + 만료 알림 SFX_RETENTION_DUE(줄마다 한 번)
 *   ③ 쓰이지 않은 번역 메모리 지움(sfx.tm_keep_days)
 *   하나가 실패해도 나머지는 돎(실패는 detail 에 남김) */
export async function sfxDailyJob(db: DatabaseService) {
  const err: Record<string, string> = {};
  const msg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200);
  let devicePurged = 0;
  let tmPurged = 0;
  let retention: Record<string, unknown> = {};
  try { devicePurged = await devicePurge(db); } catch (e) { err.device = msg(e); }
  try { retention = await retentionJob(db); } catch (e) { err.retention = msg(e); }
  try { tmPurged = await tmPurge(db); } catch (e) { err.tm = msg(e); }
  return { devicePurged, retention, tmPurged, alerted: Number(retention.alerted ?? 0), errors: err };
}
