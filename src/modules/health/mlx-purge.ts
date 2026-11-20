import { DatabaseService } from '../../db/database.service';
import { restockDaily } from './health-restock';
import { crPurge } from './health-cashrcpt';
import { usagePurge } from '../site/site-usage';

/* ---------------------------------------------------------------------
 * v10.505 · 506 · 508 (D274) 정기 작업 mlx_daily_purge — 매일 04:35
 *   ① 재입고 알림: 기한(mall.restock_keep_days) 지난 기다림 닫기 · 스위치를 켜기 전 재고가 돌아온 옵션 따라잡기
 *   ② 현금영수증: 보관 해 수(mall.cash_receipt_keep_years) 지난 번호(암호화) 지우기 — 가린 값 · 금액 · 승인번호는 남김
 *   ③ 사용 통계: 보관 날 수(site.usage_keep_days) 지난 하루 묶음 지우기
 *   하나가 실패해도 나머지는 돎(실패는 detail 에 남김)
 * ------------------------------------------------------------------- */
export async function mlxDailyPurgeJob(db: DatabaseService) {
  const out: Record<string, unknown> = {};
  let affected = 0;
  for (const [k, fn] of [['restock', restockDaily], ['cashReceipt', crPurge], ['usage', usagePurge]] as const) {
    try {
      const r = (await fn(db)) as Record<string, number>;
      out[k] = r;
      affected += Object.entries(r).filter(([x]) => x !== 'days').reduce((a, [, v]) => a + (Number(v) || 0), 0);
    } catch (e) {
      out[k] = { error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }
  return { affected, detail: out };
}
