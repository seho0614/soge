import { DatabaseService } from '../../db/database.service';
import { itsAssetRenewJob } from './its-assets';
import { itsSuggestWaitingJob } from './its-suggest';
import { itsSurveyCloseJob } from './its-survey';

/* ---------------------------------------------------------------------
 * v10.491 ~ 493 (D270) 정기 작업 its_office_daily(매일 08:55) — 사무 · 보안 하루 정리
 *   ① IT 자산: 자동 갱신 자산의 지난 갱신일을 다음 주기로 · 자금 흐름 예정 맞춤 · 갱신 N일 전 ITS_ASSET_RENEW(its.asset_alert)
 *   ② 제안함: 「접수」 그대로인 수 → ITS_SUGGEST_WAITING(its.suggest_alert · 수만)
 *   ③ 사내 설문: 기간 지난 받는 중 설문 마감
 *   하나가 실패해도 나머지는 돎(실패는 결과에 이름만).
 * ------------------------------------------------------------------- */
export async function itsOfficeDailyJob(db: DatabaseService) {
  const run = async <T>(name: string, f: () => Promise<T>) => {
    try { return await f(); } catch (e) { return { failed: name, error: String((e as Error)?.message ?? e).slice(0, 120) }; }
  };
  const assets = await run('assets', () => itsAssetRenewJob(db));
  const suggest = await run('suggest', () => itsSuggestWaitingJob(db));
  const survey = await run('survey', () => itsSurveyCloseJob(db));
  const made = (x: unknown) => Number((x as { made?: number })?.made ?? 0);
  return { made: made(assets) + made(suggest), assets, suggest, survey };
}
