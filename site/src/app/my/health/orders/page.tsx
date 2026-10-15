/** SB-HLT-MYO-010 내 주문 목록 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrderRow } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav, OrderButtons } from '@/components/health/MyHltNav';
import { krw, ORDER_LABEL, ORDER_TONE, ymd } from '@/components/health/util';
import { ProductArt } from '@/components/health/ProductArt';

export const metadata: Metadata = { title: '내 주문 · 소개몰' };
export const dynamic = 'force-dynamic';

/** 내 주문 — GET /me/health/orders (본인 것만, 최근 50건) */
export default async function MyHltOrders() {
  if (!(await me())) redirect('/login');

  let rows: HltOrderRow[] | null = null;
  let err: string | null = null;
  try {
    rows = await apiGetPersonal<HltOrderRow[]>('/me/health/orders');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="page-head"><h1>내 주문</h1></div>
      {rows === null ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows.length === 0 ? (
        <HltEmpty msg="주문 내역이 없습니다." href="/health" label="소개몰 가기" />
      ) : (
        <>
          <p className="hint">전체 {rows.length}건</p>
          <div className="rows">
            {rows.map((o) => (
              <div key={o.orderNo} className="hlt-ord">
                <div className="hlt-ord-h">
                  <span>{ymd(o.createdAt)} · <b>{o.orderNo}</b></span>
                  <span className={`state state-${ORDER_TONE[o.status] ?? 'held'}`}>{ORDER_LABEL[o.status] ?? o.status}</span>
                </div>
                {o.firstItemName && (
                  /* v10.31 (시안 주문 카드) — 첫 상품 그림 + 이름 · 판매자(직판 — 소개몰) */
                  <div className="hlt-ci" data-first-item style={{ padding: '0 0 9px' }}>
                    {o.firstItemCode && <span className="hlt-mini"><ProductArt p={{ code: o.firstItemCode, art: o.firstItemArt ?? null, imageUrl: o.firstItemImageUrl ?? null, name: o.firstItemName }} size={44} /></span>}
                    <div className="bd">
                      <b>{o.firstItemName}{(o.itemCount ?? 1) > 1 && ` 외 ${(o.itemCount ?? 1) - 1}건`}</b>
                      <span className="hint"><span className="hlt-bdg">직판</span> 소개몰</span>
                    </div>
                  </div>
                )}
                <div className="hlt-sum"><span>결제 금액</span><b className="money">{krw(o.total)}</b></div>
                {o.shippedAt && <p className="hint">발송 {ymd(o.shippedAt)}{o.deliveredAt && ` · 배송 완료 ${ymd(o.deliveredAt)}`}</p>}
                <OrderButtons o={o} />
              </div>
            ))}
          </div>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
