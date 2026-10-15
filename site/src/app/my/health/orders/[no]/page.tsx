/** SB-HLT-MYO-020 주문 상세 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltReturn } from '@/components/health/types';
import { HltEmpty, SellerBox } from '@/components/health/HltParts';
import { MyHltNav, OrderButtons } from '@/components/health/MyHltNav';
import { ReviewForm, type MyReview } from '@/components/health/ReviewForm';
import { ProductArt } from '@/components/health/ProductArt';
import {
  krw, ORDER_LABEL, ORDER_STEPS, ORDER_TONE, reasonLabel, RETURN_KIND, RETURN_STATE, RETURN_TONE, ymd, ymdhm,
} from '@/components/health/util';

export const metadata: Metadata = { title: '주문 상세 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 주문 상세 — GET /me/health/orders/{no}
 * 주문 시점에 복사된 청약철회 규칙이 품목마다 옵니다 — 상품 규칙이 나중에 바뀌어도 이 값이 적용됩니다.
 * 이 주문의 취소·반품 신청도 함께 보여 드립니다(GET /me/health/returns 에서 거름).
 */
export default async function MyHltOrderDetail({ params }: Props) {
  if (!(await me())) redirect('/login');
  const no = decodeURIComponent((await params).no);

  let o: HltOrder | null = null;
  let err: string | null = null;
  try {
    o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }
  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="orders" />
        <div className="page-head"><h1>주문 상세</h1></div>
        <HltEmpty msg={err ?? '주문을 찾을 수 없습니다.'} href="/my/health/orders" label="내 주문" />
      </div><i hidden data-root-end="" /></>
    );
  }

  const returns = (await apiGetPersonal<HltReturn[]>('/me/health/returns').catch(() => [] as HltReturn[]))
    .filter((r) => r.orderNo === o!.orderNo);
  /* v10.28 (D036) — 구매확정 주문이면 상품 줄마다 리뷰 쓰기 · 내 리뷰 */
  const myReviews = o.status === 'CONFIRMED'
    ? await apiGetPersonal<Array<MyReview & { productCode: string; optionId: string | null }>>(`/me/health/orders/${encodeURIComponent(o.orderNo)}/reviews`).catch(() => [])
    : [];
  const cur = ORDER_STEPS.indexOf(o.status);
  const ended = o.status === 'CANCELED' || o.status === 'RETURNED';

  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb"><Link href="/my/health/orders">내 주문</Link> › {o.orderNo}</div>
      <div className="page-head">
        <h1>주문 상세</h1>
        <span className={`state state-${ORDER_TONE[o.status] ?? 'held'}`}>{ORDER_LABEL[o.status] ?? o.status}</span>
      </div>

      <section className="hlt-box">
        <h3>진행 상태</h3>
        {ended
          ? <p>{ORDER_LABEL[o.status]} 된 주문입니다.</p>
          : (
            <ol className="hlt-steps">
              {ORDER_STEPS.map((s, i) => <li key={s} className={i === cur ? 'on' : i < cur ? 'done' : undefined}>{ORDER_LABEL[s]}</li>)}
            </ol>
          )}
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>주문</th><td>{ymdhm(o.createdAt)}</td></tr>
            <tr><th>결제</th><td>{o.paidAt ? ymdhm(o.paidAt) : '결제 전'}</td></tr>
            <tr><th>발송</th><td>{o.shippedAt ? ymdhm(o.shippedAt) : '-'}</td></tr>
            <tr><th>배송 완료</th><td>{o.deliveredAt ? ymdhm(o.deliveredAt) : '-'}</td></tr>
            {/* v10.28 (D035) — 구매확정(직접 · 자동) · 배송 완료면 자동 확정 기한 */}
            <tr data-confirm-row><th>구매확정</th><td>{o.confirmedAt ? `${ymdhm(o.confirmedAt)} · ${o.confirmedBy === 'AUTO' ? '자동 확정' : '직접 확정'}`
              : o.confirmOverdue && o.confirmDue ? `${ymdhm(o.confirmDue)} 자동 확정 기한이 지났습니다 — 다음 일괄 처리(매일 04시)에 확정됩니다. 지금 직접 확정하셔도 됩니다.`
              : o.confirmDue ? `${ymdhm(o.confirmDue)}에 자동 확정(그 전에 직접 하실 수 있습니다)` : '-'}</td></tr>
            {/* v10.31 (시안 주문서 「배송 요청사항」) */}
            {o.shipMemo && <tr data-ship-memo><th>배송 요청사항</th><td>{o.shipMemo}</td></tr>}
          </tbody>
        </table>
        {/* v10.31 (결함 · 주문 시각 어긋남) — 시각 순서가 맞지 않는 예전 기록(시험 자료)은 그 사실을 알립니다. 이제 DB 가 순서를 지킵니다(D064) */}
        {((o.deliveredAt && o.deliveredAt < o.createdAt) || (o.shippedAt && o.shippedAt < o.createdAt) || (o.deliveredAt && !o.shippedAt)) && (
          <p className="hint" data-time-odd="">이 주문의 발송 · 배송 기록 시각이 주문 시각과 맞지 않습니다(이전 기록). 반품 기한은 배송 완료 시각 기준으로 서버가 계산합니다.</p>
        )}
      </section>

      <section className="hlt-box">
        <h3>주문 상품</h3>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-ci" data-item={i.code}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <Link href={`/health/p/${encodeURIComponent(i.code)}`}><b>{i.name}</b></Link>
              {i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm" data-optlabel>{i.optionLabel}</span>}
              <span className="hint">{krw(i.unitPrice)} × {i.qty}개</span>
              <span className="hint">
                청약철회 {i.withdrawalDays ?? 7}일{i.withdrawalLabel && ` · ${i.withdrawalLabel}`}
                {i.withdrawalBlockedIf && ` · 제한: ${i.withdrawalBlockedIf}`}
              </span>
            </div>
            <b className="money">{krw(i.amount)}</b>
          </div>
        ))}
      </section>

      {o.status === 'CONFIRMED' && (
        <section className="hlt-box" id="review" data-review-sec>
          <h3>리뷰</h3>
          {o.items.map((i) => (
            <ReviewForm key={`r-${i.optionId ?? i.code}`} orderNo={o!.orderNo} productCode={i.code} optionId={i.optionId ?? null} name={i.name}
              mine={myReviews.find((r) => r.productCode === i.code && (r.optionId ?? null) === (i.optionId ?? null)) ?? null} />
          ))}
        </section>
      )}

      <section className="hlt-box">
        <h3>결제 정보</h3>
        <div className="hlt-sum"><span>상품 금액</span><span>{krw(o.goodsAmount)}</span></div>
        <div className="hlt-sum"><span>배송비</span><span>{Number(o.shipFee) === 0 ? '무료' : krw(o.shipFee)}</span></div>
        <div className="hlt-sum tot"><span>총 결제 금액</span><span>{krw(o.total)}</span></div>
      </section>

      {returns.length > 0 && (
        <section className="hlt-box">
          <h3>취소 · 반품</h3>
          {returns.map((r) => (
            <div key={r.id} className="hlt-sum" data-return={r.kind}>
              <span>
                {ymd(r.createdAt)} · {RETURN_KIND[r.kind] ?? r.kind} · {reasonLabel(r.reason)}
                {r.convertedFrom && ' · 교환에서 바꾼 반품'}
                {/* v10.26 — 교환 배송비를 아직 내지 않은 교환은 여기서도 결제로 갑니다 */}
                {r.kind === 'EXCHANGE' && r.feeState === 'UNPAID' && r.state === 'REQUESTED' && (
                  <> · 교환 배송비 {krw(r.exchangeFee)} 결제 전 <Link className="hlt-btn sm pri" href={`/my/health/returns/${encodeURIComponent(r.id)}/fee`} data-fee-pay-link>결제하기</Link></>
                )}
                {r.kind === 'EXCHANGE' && r.feeState === 'PAID' && ` · 교환 배송비 ${krw(r.exchangeFee)} 결제 완료`}
              </span>
              <span className={`state state-${RETURN_TONE[r.state] ?? 'requested'}`}>{RETURN_STATE[r.state] ?? r.state}</span>
            </div>
          ))}
          <Link href="/my/health/returns">취소 · 반품 내역 보기</Link>
        </section>
      )}

      <SellerBox />
      <OrderButtons o={o} detail={false} />
    </div><i hidden data-root-end="" /></>
  );
}
