import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import type { ListingDetailData } from '@/lib/types';
import { me } from '@/lib/session';
import { PATH_GWAN } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { MyHead, Note } from '@/components/my/ui';
import { GwQnaBoard } from '@/components/gwan/GwQnaBoard';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

type Props = { params: Promise<{ gwan: string; id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('detail.board'))('title') };
}

/**
 * SB-HOM-MCH-020 공개 문의 — v10.32 시안(scQna · 「/l/{no}/qna」) 단독 화면.
 *   돌아가기(상세) → 「공개 문의 N건」 · 「{매물 제목} — 누구나 볼 수 있는 질문과 답입니다 …」
 *   → 질문 줄 → [질문 남기기] [1:1 문의] [매물 상세로] → INV-2 안내
 * 매물 제목은 상세를 view=0 으로 읽습니다(이 화면은 조회 수를 올리지 않음). 상세의 「문의 내용」 칸에서 「전체 보기」로 옵니다.
 */
export default async function QnaPage({ params }: Props) {
  const { gwan, id } = await params;
  if (!PATH_GWAN[gwan]) notFound();
  let item: ListingDetailData;
  try {
    item = await apiGetPersonal<ListingDetailData>(`/listings/${id}?view=0`);
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const [questions, viewer] = await Promise.all([
    apiGetPersonal<never[]>(`/listings/${id}/questions`).catch(() => apiGet<never[]>(`/listings/${id}/questions`, 10).catch(() => [] as never[])),
    me(),
  ]);
  const t = await getTranslations('detail.board');
  const detailHref = `/${gwan}/${id}`;
  const canAsk = item.canInquire;

  return (
    <><div className="gw" data-gw={PATH_GWAN[gwan]}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}><div className="mys" data-screen="SB-HOM-MCH-020">
        <BackBar href={detailHref} label={t('back')} wrap={false} />
        <MyHead title={t('heading', { n: String(questions.length) })}
          sub={<>{t('sub', { title: item.title })}</>} />
        <Msgs ns={['detail']}><GwQnaBoard listingId={item.id} detailHref={detailHref} canAsk={canAsk} canInquire={item.canInquire}
                    loggedIn={!!viewer} initial={questions} /></Msgs>
        <Note kind="info">{t.rich('note', { b: (c) => <b>{c}</b> })}</Note>
      </div></div>
    </div><i hidden data-root-end="" /></>
  );
}
