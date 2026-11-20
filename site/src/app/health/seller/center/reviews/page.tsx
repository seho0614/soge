/** SB-HLT-SMX-010 판매자센터 › 리뷰 답글 (v10.555 · D287 · docs/693) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { stars } from '@/components/health/ReviewPanels';
import { SellerReplyBox } from '@/components/smx/SellerReplyBox';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  const tr = await getTranslations('smx.rp');
  return { title: t('meta.title', { title: tr('title') }) };
}
export const dynamic = 'force-dynamic';

type Reply = { id: string; body: string; state: string; holdWord: string | null; hiddenReason: string | null; editCount: number; updatedAt: string };
type Row = { reviewId: string; productCode: string; productName: string; rating: number; body: string; createdAt: string; writer: string; reply: Reply | null };
type List = { on: boolean; seller: { code: string; name: string }; view: string; items: Row[]; note: string };

/**
 * 판매자센터 「리뷰 답글」 — GET /me/health/seller/review-replies?view=open|all · PUT …/{reviewId}
 *   내 상품의 보이는 리뷰 · 답글 하나씩 · 고치면 기록(운영이 봄) · 금칙어는 운영 확인 뒤 보임 · 운영이 가린 답글은 사유만
 *   답글 스위치(smx.review_reply)가 꺼져 있으면 목록은 보이고 쓰기는 잠김
 */
export default async function HltSellerReviewRepliesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const tr = await getTranslations('smx.rp');
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'open';
  let d: List | null = null;
  let notSeller = false;
  try {
    d = await apiGetPersonal<List>(`/me/health/seller/review-replies?view=${view}`);
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const labels = { save: tr('save'), saving: tr('saving'), failed: tr('failed'), ph: tr('ph'), hidden: tr('hidden') };
  const stLabel = (s: string) => (s === 'VISIBLE' ? tr('stVISIBLE') : s === 'PENDING' ? tr('stPENDING') : s === 'HIDDEN' ? tr('stHIDDEN') : s);
  return (
    <><div className="hlt" data-smx-replies-page={d ? view : ''}>
      <HltNav back="/health/seller/center" />
      <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: tr('back') }, { label: tr('title') }]} />
      <div className="page-head"><h1>{tr('title')}</h1></div>
      {!d ? (notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : <p className="form-error" role="alert">{t('errLoad')}</p>) : (
        <>
          <p className="hlt-mut">{tr('sub')}</p>
          {!d.on && <p className="warn-text" data-smx-replies-off="">{tr('off')}</p>}
          <div className="hlt-rvf" role="group" aria-label={tr('title')}>
            <Link href="/health/seller/center/reviews" className={view === 'open' ? 'on' : undefined}>{tr('open')}</Link>
            <Link href="/health/seller/center/reviews?view=all" className={view === 'all' ? 'on' : undefined}>{tr('all')}</Link>
          </div>
          {d.items.length === 0 ? <p className="hlt-mut" data-smx-replies-empty="">{tr('empty')}</p> : (
            <ul className="hlt-rvlist">
              {d.items.map((x) => (
                <li key={x.reviewId} data-smx-reply-row={x.reviewId}>
                  <div><span className="hlt-stars">{stars(x.rating)}</span> <b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymdKst(x.createdAt)} · <Link href={`/health/p/${encodeURIComponent(x.productCode)}?tab=reviews`}>{x.productName}</Link></span></div>
                  <p>{x.body}</p>
                  {x.reply && (
                    <p className="hlt-mut hlt-sm" data-smx-reply-state={x.reply.state}>
                      {tr('mine')} · {stLabel(x.reply.state)}{x.reply.editCount > 0 ? ` · ${tr('edited', { n: x.reply.editCount })}` : ''}
                      {x.reply.state === 'PENDING' && x.reply.holdWord ? ` · ${tr('holdWord', { w: x.reply.holdWord })}` : ''}
                      {x.reply.state === 'HIDDEN' && x.reply.hiddenReason ? ` · ${tr('hiddenReason', { r: x.reply.hiddenReason })}` : ''}
                    </p>
                  )}
                  <SellerReplyBox reviewId={x.reviewId} initial={x.reply?.body ?? ''} state={x.reply?.state ?? null} disabled={!d!.on} labels={labels} />
                </li>))}
            </ul>)}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
