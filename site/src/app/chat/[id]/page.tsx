import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import type { ListingDetailData } from '@/lib/types';
import { me } from '@/lib/session';
import { GWAN_PATH, won } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { AskChat } from '@/components/chat/AskChat';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import { isGwanKey } from '@/i18n/keys';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('chat') };
}
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> };

/* v10.101 — 관 이름은 사전 키(header.gwan.*) */
const GCLS: Record<string, string> = { MNY: 'g-mny', MAL: 'g-mal', BIZ: 'g-biz' };

/**
 * SB-HOM-MCH-010 1:1 문의 — v10.31 시안 scAsk: ← 이전 화면 · 위쪽 매물 줄(관 · 업종 · 제목 · 관 표시 · 소개비 · 부담 · 리스팅 보기 ›) ·
 *   대화(AskChat) · 오른쪽 거래 정보 · 소개 귀속 · 예상 소개비 · 계약서 요청하기.
 * 문의 자격(본인인증 · 사업자)은 서버가 판정한 canInquire 를 그대로 따릅니다(프런트가 역할을 다시 계산하지 않음).
 * 내 매물이면 대화창 대신 「받은 문의」로 잇습니다.
 */
export default async function ChatPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await me();
  if (!p) redirect(`/login?next=/chat/${id}`);

  let item: ListingDetailData;
  try {
    item = await apiGet<ListingDetailData>(`/listings/${id}`, 10);
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound() /* 20261002 — 형식이 틀린 번호도 404 (전: 500) */;
    throw e;
  }
  const own = item.inquireBlockReason === 'OWN_LISTING';
  if (!item.canInquire && !own) {
    const to = item.inquireBlockReason === 'IDENTITY_REQUIRED' ? `/verify?next=/chat/${id}` : null;
    if (to) redirect(to);
  }
  const href = `/${GWAN_PATH[item.gwanCode] ?? 'money'}/${item.id}`;
  const photo = item.mediaUrls?.[0];
  const t = await getTranslations('deal');
  const th = await getTranslations('header');
  const gn = (c: string) => (isGwanKey(c) ? th(`gwan.${c}`) : c);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-MCH-010">
      <BackBar href={href} label={t('common.prevScreen')} wrap={false} />
      <div className="w1-askbar chat-item">
        <div className="th">{photo ? <img src={photo} alt="" /> : <span aria-hidden="true">{(item.categoryName ?? '?').slice(0, 1)}</span>}</div>
        <div className="tx">
          <div className="c">{gn(item.gwanCode)} · {item.categoryName ?? t('chat.catDefault')}</div>
          <h2>{item.title}</h2>
          <div className="m">
            <span className={`w1-gt ${GCLS[item.gwanCode] ?? ''}`}>{gn(item.gwanCode)}</span>
            <span className="fe">{item.desiredFee ? t('chat.fee', { fee: won(item.desiredFee) }) : t('chat.feeTbd')}{item.feeBearerLabel ? ` · ${item.feeBearerLabel}` : ''}</span>
          </div>
        </div>
        <Link className="lk" href={href}>{t('chat.viewListing')}</Link>
      </div>
      {own ? (
        <div className="w1-jc i" style={{ marginTop: 14 }}><span className="lb">{t('chat.own')}</span>
          {t.rich('chat.ownBody', { link: (x) => <Link href={`/my/inquiries?listing=${item.id}`}>{x}</Link> })}</div>
      ) : (
        <Msgs ns={['deal']}><AskChat listingId={item.id} conversationId={/^[0-9a-f-]{36}$/i.test(sp.c ?? '') ? sp.c : null}
          canDeal={!!p.identityVerifiedAt && p.roles.some((r) => r === 'MEMBER' || r === 'BIZ_OWNER' || r === 'BIZ_STAFF')} listingFee={item.desiredFee} bearerLabel={item.feeBearerLabel} /></Msgs>
      )}
    </div>
  );
}
