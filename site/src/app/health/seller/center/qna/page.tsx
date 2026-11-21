/** SB-HLT-SMQ-010 판매자센터 › 상품 문의 (v10.577 · docs/719) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { SellerQnaBox } from '@/components/smq/SellerQnaBox';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  const tq = await getTranslations('smx.smq.qna');
  return { title: t('meta.title', { title: tq('title') }) };
}
export const dynamic = 'force-dynamic';

type Row = { id: string; productCode: string; productName: string; body: string; isPrivate: boolean; createdAt: string; writer: string; dueAt: string | null; overdue: boolean;
  answer: string | null; answerKind: string | null; answerState: string; holdWord: string | null; hiddenReason: string | null; answeredAt: string | null };
type List = { on: boolean; dueHours: number; seller: { code: string; name: string }; view: string; counts: { open: number; overdue: number }; items: Row[]; note: string };

/**
 * 판매자센터 「상품 문의」 — GET /me/health/seller/qna?view=open|all · PUT …/{id}
 *   내 상품의 보이는 문의(비밀글 포함 — 판매자는 답하려고 봄 · 쓴 사람 이름은 가림) · 답 기한 · 넘김 · 내 답 상태(보임 · 운영 확인 대기 · 운영이 가림 · 운영 답)
 *   스위치(smq.qna)가 꺼져 있으면 목록은 보이고 쓰기는 잠김(운영이 답함)
 */
export default async function HltSellerQnaPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const tq = await getTranslations('smx.smq.qna');
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'open';
  let d: List | null = null;
  let notSeller = false;
  try {
    d = await apiGetPersonal<List>(`/me/health/seller/qna?view=${view}`);
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const labels = { save: tq('save'), saving: tq('saving'), failed: tq('failed'), ph: tq('ph'), hidden: tq('hidden') };
  const stLabel = (r: Row) => (r.answerKind === 'STAFF' ? tq('byStaff') : r.answerState === 'PENDING' ? tq('stPENDING') : r.answerState === 'HIDDEN' ? tq('stHIDDEN') : tq('stVISIBLE'));
  return (
    <><div className="hlt" data-smq-qna-page={d ? view : ''}>
      <HltNav back="/health/seller/center" />
      <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: tq('back') }, { label: tq('title') }]} />
      <div className="page-head"><h1>{tq('title')}</h1></div>
      {!d ? (notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : <p className="form-error" role="alert">{t('errLoad')}</p>) : (
        <>
          <p className="hlt-mut">{tq('sub', { h: String(d.dueHours) })}</p>
          {!d.on && <p className="warn-text" data-smq-qna-off="">{tq('off')}</p>}
          <div className="hlt-rvf" role="group" aria-label={tq('title')}>
            <Link href="/health/seller/center/qna" className={view === 'open' ? 'on' : undefined}>{tq('open', { n: String(d.counts.open) })}</Link>
            <Link href="/health/seller/center/qna?view=all" className={view === 'all' ? 'on' : undefined}>{tq('all')}</Link>
            {d.counts.overdue > 0 && <span className="warn-text" data-smq-qna-overdue={d.counts.overdue}>{tq('overdueN', { n: String(d.counts.overdue) })}</span>}
          </div>
          {d.items.length === 0 ? <p className="hlt-mut" data-smq-qna-empty="">{tq('empty')}</p> : (
            <ul className="hlt-qnalist">
              {d.items.map((x) => (
                <li key={x.id} data-smq-qna-row={x.id}>
                  <div><b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymdKst(x.createdAt)}{x.isPrivate ? ` · ${tq('private')}` : ''} · <Link href={`/health/p/${encodeURIComponent(x.productCode)}?tab=qna`}>{x.productName}</Link></span></div>
                  <p>{x.body}</p>
                  {!x.answer && x.dueAt && <p className={`hlt-sm ${x.overdue ? 'warn-text' : 'hlt-mut'}`}>{x.overdue ? tq('overdue') : tq('due', { d: ymdKst(x.dueAt) })}</p>}
                  {x.answer && (
                    <p className="hlt-mut hlt-sm" data-smq-qna-state={x.answerState}>
                      {stLabel(x)}{x.answeredAt ? ` · ${ymdKst(x.answeredAt)}` : ''}
                      {x.answerState === 'PENDING' && x.holdWord ? ` · ${tq('holdWord', { w: x.holdWord })}` : ''}
                      {x.answerState === 'HIDDEN' && x.hiddenReason ? ` · ${tq('hiddenReason', { r: x.hiddenReason })}` : ''}
                    </p>
                  )}
                  <SellerQnaBox qnaId={x.id} initial={x.answerKind === 'SELLER' ? x.answer ?? '' : ''} hidden={!!x.answer && x.answerState === 'HIDDEN'} disabled={!d!.on} labels={labels} />
                </li>))}
            </ul>)}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
