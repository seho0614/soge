import { DatabaseService } from '../../db/database.service';
import { pcDailyJob } from './partner-contract';
import { adBudgetJob } from './ad-budget';
import { cardNoticeJob } from './card-notice';

/* ---------------------------------------------------------------------
 * v10.609 ~ 614 (docs/751 ~ 756) 18차 정기 작업 — 배치 호출기(sgb-jobs)가 job_schedules 시각에 부름
 *   bzx_daily     매일 09:35 — ㉕ 파트너 계약 만기 알림 · 만기 지남 정리 · 서명 없는 계약 알림
 *   bzx_frequent  10분마다   — ㉖ 광고 예산 알림 · 자동 정지(스위치) · ㉙ 법인카드 사용 알림(스위치)
 *   한 갈래가 실패해도 다른 갈래는 돎(결과에 err)
 * ------------------------------------------------------------------- */

async function safe<T>(fn: () => Promise<T>): Promise<T | { err: string }> {
  try { return await fn(); } catch (e) { return { err: String((e as Error)?.message ?? e).slice(0, 200) }; }
}

export async function bzxDailyJob(db: DatabaseService) {
  const contracts = await safe(() => pcDailyJob(db));
  const n = 'err' in contracts ? 0 : contracts.due + contracts.expired + contracts.unsigned;
  return { contracts, affected: n };
}

export async function bzxFrequentJob(db: DatabaseService) {
  const ads = await safe(() => adBudgetJob(db));
  const cards = await safe(() => cardNoticeJob(db));
  const n = ('err' in ads ? 0 : ads.near + ads.spent + ads.resumed) + ('err' in cards ? 0 : cards.sent);
  return { ads, cards, affected: n };
}
