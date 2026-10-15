/**
 * 나의공간 › 소개몰 — 내 주문 · 취소·반품 내역 · 배송지 사이를 오가는 탭.
 */
import Link from 'next/link';
import type { HltOrderRow } from './types';
import { ConfirmButton } from './ConfirmButton';

const TABS = [
  { href: '/my/health/orders', label: '내 주문', key: 'orders' },
  { href: '/my/health/returns', label: '취소 · 반품 내역', key: 'returns' },
  { href: '/my/health/addresses', label: '배송지 관리', key: 'addresses' },
];

export function MyHltNav({ on }: { on: string }) {
  return (
    <nav className="hlt-lnav" aria-label="내 소개몰">
      <Link href="/my">나의공간</Link>
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === on ? 'on' : undefined}
          aria-current={t.key === on ? 'page' : undefined}>{t.label}</Link>
      ))}
      <Link href="/health">소개몰 가기</Link>
    </nav>
  );
}

/**
 * 상태별 버튼 — 시안 orderButtons() 를 서버 상태값(PENDING … RETURNED)에 맞췄습니다.
 * 발송 전은 "취소", 발송 후는 "반품", 취소·반품 완료는 버튼 없음.
 */
export function OrderButtons({ o, detail = true }: { o: Pick<HltOrderRow, 'orderNo' | 'status'> & { cancelRequested?: boolean; openReturn?: boolean; confirmDue?: string | null; reviewCount?: number }; detail?: boolean }) {
  const no = encodeURIComponent(o.orderNo);
  /* v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 주문은 결제 · 취소 단추를 내리고 「취소 신청 중」을 보입니다(서버도 결제를 거절합니다) */
  const waiting = o.cancelRequested === true;
  return (
    <div className="hlt-btns">
      {waiting && <span className="hlt-bdg" data-cancel-requested>취소 신청 중</span>}
      {o.status === 'PENDING' && !waiting && <Link className="hlt-btn sm pri" href={`/health/order/pay?no=${no}`}>결제하기</Link>}
      {['PENDING', 'PAID', 'PREPARING'].includes(o.status) && !waiting &&
        <Link className="hlt-btn sm" href={`/my/health/returns/new?o=${no}`}>주문취소</Link>}
      {['SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(o.status) && <>
        <Link className="hlt-btn sm" href={`/my/health/orders/${no}/ship`}>배송조회</Link>
        {/* v10.28 — 배송 완료면 「구매확정」(7일 뒤 자동) · 확정 뒤에는 「리뷰쓰기」. 확정 뒤에도 법정 기간 안의 반품 신청은 받음 */}
        {o.status === 'DELIVERED' && !o.openReturn && <ConfirmButton no={o.orderNo} due={o.confirmDue ?? null} />}
        {/* v10.31 (시안) — 쓴 리뷰가 있으면 「내 리뷰 고치기」 */}
        {o.status === 'CONFIRMED' && <Link className="hlt-btn sm pri" href={`/my/health/orders/${no}#review`} data-review-go>{o.reviewCount ? '내 리뷰 고치기' : '리뷰쓰기'}</Link>}
        <Link className="hlt-btn sm" href={`/my/health/returns/new?o=${no}`}>반품신청</Link>
      </>}
      {detail && <Link className="hlt-btn sm" href={`/my/health/orders/${no}`}>상세보기</Link>}
    </div>
  );
}
