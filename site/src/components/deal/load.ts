/** v10.31 (w1) — 거래 화면 공통: 거래 정보(GET /deals/{id}/summary)를 받거나 안내 상태를 돌려줍니다. 서버 전용 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import type { DealSummary } from './DealShell';

export async function loadDeal(id: string): Promise<{ d: DealSummary } | { error: string }> {
  try { return { d: await apiGetPersonal<DealSummary>(`/deals/${encodeURIComponent(id)}/summary`) }; }
  catch (e) {
    if (e instanceof ApiFailure && e.status === 403) return { error: (await getTranslations('deal'))('load.partyOnly') };
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound();   /* 없는 거래 · 형식이 틀린 번호는 404 */
    throw e;
  }
}
