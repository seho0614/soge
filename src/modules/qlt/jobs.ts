import { DatabaseService } from '../../db/database.service';
import { qltLotAllocJob, qltLotExpiryCheck } from './lots';
import { qltClaimRepeatCheck } from './claims';

/* ---------------------------------------------------------------------
 * v10.495 · 496 (D271 · docs/633 · 634) 품질 정기 작업 — scheduler.service.ts 가 부름
 *   qlt_lot_alloc  매시간  로트 관리 상품의 출고(배송 뒤) · 반입 · 줄이는 실사에 로트 붙이기(lots.ts)
 *   qlt_daily      매일 07:20  로트 유통기한 임박 · 지남(QLT_LOT_EXPIRY) · 클레임 재발(QLT_CLAIM_REPEAT)
 * ------------------------------------------------------------------- */

export { qltLotAllocJob };

export async function qltDailyJob(db: DatabaseService) {
  const expiry = await qltLotExpiryCheck(db).catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 200) }));
  const repeat = await qltClaimRepeatCheck(db).catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 200) }));
  const made = ('made' in expiry ? expiry.made.length : 0) + ('made' in repeat ? repeat.made.length : 0);
  return { made, expiry, repeat };
}
