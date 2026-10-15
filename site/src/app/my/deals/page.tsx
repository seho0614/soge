import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { won, ymdKst } from '@/lib/format';
import { MyHead, Empty, Table, shortId, type Tone } from '@/components/my/ui';

export const metadata: Metadata = { title: '소개 내역' };

interface Deal {
  id: string; status: string; statusLabel?: string | null; title?: string | null;
  agreedFee: number | null; attributedCode: string | null;
  confirmedAt: string | null; createdAt: string;
  myPart?: 'BUYER' | 'SELLER' | 'INTRODUCER'; conversationId?: string | null;
  iConfirmed?: boolean; paymentReported?: boolean; iReviewed?: boolean;
}
const PART: Record<string, string> = { BUYER: '구매 쪽', SELLER: '판매 쪽', INTRODUCER: '소개자' };
/* 시안 badge() 색 — 성사 확정 초록 · 계약/협의 노랑 · 분쟁 빨강 · 철회 회색 */
const TONE = (s: string): Tone => (['CONFIRMED', 'SETTLED'].includes(s) ? 'ok'
  : ['CANCELLED'].includes(s) ? 'off' : ['DISPUTED', 'HELD'].includes(s) ? 'no' : 'wait');

/* v10.27 (G-193 ③) — 지금 내 차례인 다음 단계 하나를 앞에 둡니다. */
function nextStep(d: Deal): { href: string; label: string } | null {
  const party = d.myPart === 'BUYER' || d.myPart === 'SELLER';
  if (!party) return null;
  if (['INQUIRY', 'NEGOTIATING'].includes(d.status)) return { href: `/deal/${d.id}/contract`, label: '계약서 작성 ›' };
  if (d.status === 'CONTRACTED' && !d.paymentReported) return { href: `/deal/${d.id}/payment`, label: '대금 지급 신고 ›' };
  if (['CONTRACTED', 'PAYMENT_REPORTED'].includes(d.status) && !d.iConfirmed) return { href: `/deal/${d.id}/confirm`, label: '성사 확정 ›' };
  if (['CONFIRMED', 'SETTLED'].includes(d.status) && !d.iReviewed) return { href: `/deal/${d.id}/review`, label: '후기 쓰기 ›' };
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
  const review = rows.find((d) => (d.myPart === 'BUYER' || d.myPart === 'SELLER') && ['CONFIRMED', 'SETTLED'].includes(d.status) && !d.iReviewed);

  return (
    <>
      <MyHead title="소개 내역" sub="내가 소개한 건과 귀속된 소개코드입니다. 귀속은 첫 접촉 기준 90일이며, 소개받기는 수락 시점입니다 (INV-2 예외)." />
      {rows.length === 0 ? (
        <Empty>진행 중인 거래가 없습니다. 소개가 시작되면 여기에 거래번호와 소개코드가 나옵니다.</Empty>
      ) : (
        <Table head={['거래번호', '소개 건', '소개코드', '상태', '소개비', '일자', '']}>
          {rows.map((d) => {
            const n = nextStep(d);
            return (
              <tr key={d.id} data-deal-row={d.id}>
                <td>{shortId(d.id, 'D-')}</td>
                <td><b>{d.title ?? '(제목 없음)'}</b>{d.myPart && <><br /><span className="my-ls">{PART[d.myPart]}</span></>}
                  {d.iConfirmed && !['CONFIRMED', 'SETTLED'].includes(d.status) && <><br /><span className="my-ls">내 확정 완료 · 상대 확인 대기</span></>}</td>
                <td><span className="my-code">{d.attributedCode ?? '—'}</span></td>
                <td><span className={`my-bg ${TONE(d.status)}`}>{d.statusLabel ?? d.status}</span></td>
                <td>{d.agreedFee != null && ['CONFIRMED', 'SETTLED'].includes(d.status) ? <b>{won(d.agreedFee)}</b>
                  : d.agreedFee != null ? <span className="my-ls">{won(d.agreedFee)} · 확정 전</span> : <span className="my-ls">확정 전</span>}</td>
                <td>{ymdKst(d.confirmedAt ?? d.createdAt)}</td>
                <td>
                  <div className="my-lka" data-deal-act={d.id}>
                    {n && <Link className="my-bp sm" href={n.href} data-deal-next={n.href.split('/').pop()}>{n.label}</Link>}
                    {d.myPart !== 'INTRODUCER' && !['INQUIRY', 'NEGOTIATING'].includes(d.status) && <Link className="my-bo sm" href={`/deal/${d.id}/contract`}>계약서</Link>}
                    {d.conversationId && d.myPart !== 'INTRODUCER' && <Link className="my-bo sm" href={`/my/inquiries/${d.conversationId}`}>대화</Link>}
                    {['CONFIRMED', 'SETTLED'].includes(d.status) && d.myPart !== 'BUYER' && <Link className="my-bo sm" href="/my/settlement">정산 확인</Link>}
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
          ? <Link className="my-bo" href={`/deal/${review.id}/review`} data-rvw-link="">성사된 거래에 후기 쓰기 ›</Link>
          : <span className="my-bo off" aria-disabled="true" title="후기를 쓸 성사 거래가 없습니다" data-rvw-link="off">성사된 거래에 후기 쓰기 ›</span>}
      </div>
    </>
  );
}
