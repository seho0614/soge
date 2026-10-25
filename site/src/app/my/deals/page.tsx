import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { MyHead, Empty, Table, shortId, type Tone } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.deals'))('title') };
}

interface Deal {
  id: string; status: string; statusLabel?: string | null; title?: string | null;
  agreedFee: number | null; attributedCode: string | null;
  confirmedAt: string | null; createdAt: string;
  myPart?: 'BUYER' | 'SELLER' | 'INTRODUCER'; conversationId?: string | null;
  iConfirmed?: boolean; paymentReported?: boolean; iReviewed?: boolean;
}
/* v10.99 — 이름은 사전 키(my.deals.part.* · my.deals.next.*) */
const PART: Record<string, 'buyer' | 'seller' | 'introducer'> = { BUYER: 'buyer', SELLER: 'seller', INTRODUCER: 'introducer' };
/* 시안 badge() 색 — 성사 확정 초록 · 계약/협의 노랑 · 분쟁 빨강 · 철회 회색 */
const TONE = (s: string): Tone => (['CONFIRMED', 'SETTLED'].includes(s) ? 'ok'
  : ['CANCELLED'].includes(s) ? 'off' : ['DISPUTED', 'HELD'].includes(s) ? 'no' : 'wait');

/* v10.27 (G-193 ③) — 지금 내 차례인 다음 단계 하나를 앞에 둡니다. */
function nextStep(d: Deal): { href: string; label: 'contract' | 'payment' | 'confirm' | 'review' } | null {
  const party = d.myPart === 'BUYER' || d.myPart === 'SELLER';
  if (!party) return null;
  if (['INQUIRY', 'NEGOTIATING'].includes(d.status)) return { href: `/deal/${d.id}/contract`, label: 'contract' };
  if (d.status === 'CONTRACTED' && !d.paymentReported) return { href: `/deal/${d.id}/payment`, label: 'payment' };
  if (['CONTRACTED', 'PAYMENT_REPORTED'].includes(d.status) && !d.iConfirmed) return { href: `/deal/${d.id}/confirm`, label: 'confirm' };
  if (['CONFIRMED', 'SETTLED'].includes(d.status) && !d.iReviewed) return { href: `/deal/${d.id}/review`, label: 'review' };
  return null;
}

/**
 * SB-MYP-DEA-010 — 귀속 코드가 보여야 소개자가 자기 실적을 확인합니다.
 * v10.29 — 시안(scMyDeal) 표: 거래번호 · 소개 건 · 소개코드 · 상태 · 소개비 · 일자 + 아래 「성사된 거래에 후기 쓰기 ›」.
 *   개발에만 있던 거래별 다음 단계 단추(계약서 · 대금 신고 · 성사 확정 · 대화 · 정산 확인)는 마지막 칸에 그대로 둡니다(diffs 마이-4).
 */
export default async function MyDeals() {
  if (!(await me())) redirect('/login');
  const rows = await apiGet<Deal[]>('/me/deals', 5).catch(() => [] as Deal[]);
  const t = await getTranslations('my.deals');
  const f = await getFmt();
  const review = rows.find((d) => (d.myPart === 'BUYER' || d.myPart === 'SELLER') && ['CONFIRMED', 'SETTLED'].includes(d.status) && !d.iReviewed);

  return (
    <>
      <MyHead title={t('title')} sub={t('sub')} />
      {rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Table head={[t('thNo'), t('thItem'), t('thCode'), t('thStatus'), t('thFee'), t('thDate'), '']}>
          {rows.map((d) => {
            const n = nextStep(d);
            const part = d.myPart ? PART[d.myPart] : undefined;
            return (
              <tr key={d.id} data-deal-row={d.id}>
                <td>{shortId(d.id, 'D-')}</td>
                <td><b>{d.title ?? t('untitled')}</b>{d.myPart && <><br /><span className="my-ls">{part ? t(`part.${part}`) : undefined}</span></>}
                  {d.iConfirmed && !['CONFIRMED', 'SETTLED'].includes(d.status) && <><br /><span className="my-ls">{t('myConfirmed')}</span></>}</td>
                <td><span className="my-code">{d.attributedCode ?? '—'}</span></td>
                <td><span className={`my-bg ${TONE(d.status)}`}>{d.statusLabel ?? d.status}</span></td>
                <td>{d.agreedFee != null && ['CONFIRMED', 'SETTLED'].includes(d.status) ? <b>{f.won(d.agreedFee)}</b>
                  : d.agreedFee != null ? <span className="my-ls">{t('feeBefore', { fee: f.won(d.agreedFee) })}</span> : <span className="my-ls">{t('before')}</span>}</td>
                <td>{ymdKst(d.confirmedAt ?? d.createdAt)}</td>
                <td>
                  <div className="my-lka" data-deal-act={d.id}>
                    {n && <Link className="my-bp sm" href={n.href} data-deal-next={n.href.split('/').pop()}>{t(`next.${n.label}`)}</Link>}
                    {d.myPart !== 'INTRODUCER' && !['INQUIRY', 'NEGOTIATING'].includes(d.status) && <Link className="my-bo sm" href={`/deal/${d.id}/contract`}>{t('contract')}</Link>}
                    {d.conversationId && d.myPart !== 'INTRODUCER' && <Link className="my-bo sm" href={`/my/inquiries/${d.conversationId}`}>{t('chat')}</Link>}
                    {['CONFIRMED', 'SETTLED'].includes(d.status) && d.myPart !== 'BUYER' && <Link className="my-bo sm" href="/my/settlement">{t('settle')}</Link>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {/* 시안 v10.27 (G-198) — 후기 작성 화면으로 가는 길. 쓸 거래가 없으면 눌리지 않습니다 */}
      <div className="my-btns">
        {review
          ? <Link className="my-bo" href={`/deal/${review.id}/review`} data-rvw-link="">{t('writeReview')}</Link>
          : <span className="my-bo off" aria-disabled="true" title={t('noReview')} data-rvw-link="off">{t('writeReview')}</span>}
      </div>
    </>
  );
}
