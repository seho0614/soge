import { DatabaseService } from '../../db/database.service';
import { SMQ_KEYS, smqOn, smqYm } from './common';
import { smqQnaDueJob } from './qna';
import { smqExpireLimits, smqNotifyMonth, smqSaveMonth } from './grades';

/* ---------------------------------------------------------------------
 * v10.577 · 579 (docs/719 · 721) 정기 작업 smq_daily — 매일 09:20(한국)
 *   ① 상품 문의 답 기한 넘김(smq.qna on) — 입점 판매자 알림 SMQ_QNA_DUE(문의마다 한 번) · 운영 알림 SMQ_QNA_OVERDUE(하루 한 번)
 *   ② 판매자 평가(smq.penalty on) — 1일부터 지난달 셈 · 저장(알리기 전까지 날마다 다시 셈 · 늦은 반품 · 발송이 들어감)
 *                                     3일부터 알리지 않은 줄 알림(경고 이상만) · 잇달아 경고면 노출 제한 제안 SMQ_LIMIT_PROPOSED
 *   ③ 기간 끝난 노출 제한 저절로 풀기(스위치와 상관없이)
 *   실패해도 다음 단계는 돎(단계마다 따로 잡음)
 * ------------------------------------------------------------------- */
export async function smqDailyJob(db: DatabaseService) {
  const out: Record<string, unknown> = {};
  try { out.qna = await smqQnaDueJob(db); } catch (e) { out.qnaError = String((e as Error)?.message ?? e).slice(0, 200); }
  try {
    if (await smqOn(db, SMQ_KEYS.penalty)) {
      const ym = smqYm(-1);
      const day = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(8, 10));
      out.grade = await smqSaveMonth(db, ym);
      if (day >= 3) out.notify = await smqNotifyMonth(db, ym);
    } else out.grade = { on: false };
  } catch (e) { out.gradeError = String((e as Error)?.message ?? e).slice(0, 200); }
  try { out.lifted = await smqExpireLimits(db); } catch (e) { out.liftError = String((e as Error)?.message ?? e).slice(0, 200); }
  const n = (v: unknown, k: string) => Number((v as Record<string, unknown> | undefined)?.[k] ?? 0);
  return { affected: n(out.qna, 'sellerNotified') + n(out.qna, 'alerted') + n(out.grade, 'saved') + n(out.notify, 'warned') + Number(out.lifted ?? 0), ...out };
}
