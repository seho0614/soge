/** SB-HLT-ORD-030 주문 완료 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder } from '@/components/health/types';
import { HltEmpty, HltSteps, SellerBox } from '@/components/health/HltParts';
import { krw, ORDER_LABEL, ORDER_TONE, PAY_LABEL, PAY_STATE, ymdhm } from '@/components/health/util';

export const metadata: Metadata = { title: '주문 완료 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ no?: string; m?: string; st?: string }> };

/**
 * 주문 완료 — GET /me/health/orders/{no}
 *
 * 상태는 **서버 값 그대로** 보여 줍니다(주소의 m · st 는 쓰지 않습니다 — 고칠 수 있습니다).
 * D006 — 결제 건(payment)으로 결제수단 · 결제 상태 · **시험 결제(stub)** · 가상계좌 안내를 보여 줍니다.
 */
export default async function HltOrderDone({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const { no } = await searchParams;

  let o: HltOrder | null = null;
  let err: string | null = null;
  if (no) {
    try {
      o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
    } catch (e) {
      err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
    }
  }

  const pay = o?.payment ?? null;
  const vbank = pay?.state === 'READY' && pay.pgStatus === 'WAITING_FOR_DEPOSIT' ? pay.vbank : null;

  if (!o) {
    return (
      <><div className="hlt">
        <div className="page-head"><h1>주문 완료</h1></div>
        <HltEmpty msg={err ?? '표시할 주문이 없습니다.'} href="/my/health/orders" label="내 주문" />
      </div><i hidden data-root-end="" /></>
    );
  }

  return (
    <><div className="hlt">
      <div className="page-head"><h1>{o.status === 'PAID' ? '결제가 완료되었습니다' : '주문이 접수되었습니다'}</h1></div>
      <HltSteps at={3} />

      <section className="hlt-box">
        <div className="hlt-ord-h">
          <b>주문번호 {o.orderNo}</b>
          <span className={`state state-${ORDER_TONE[o.status] ?? 'held'}`}>{ORDER_LABEL[o.status] ?? o.status}</span>
        </div>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-sum" data-item={i.code}><span>{i.name}{i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm"> {i.optionLabel}</span>} × {i.qty}</span><span>{krw(i.amount)}</span></div>
        ))}
        <div className="hlt-sum"><span>배송비</span><span>{Number(o.shipFee) === 0 ? '무료' : krw(o.shipFee)}</span></div>
        <div className="hlt-sum tot"><span>결제 금액</span><span>{krw(o.total)}</span></div>
        {pay && (
          <p className="hint">
            결제수단 {PAY_LABEL[pay.method] ?? pay.method} · 결제 상태 {PAY_STATE[pay.state] ?? pay.state}
            {pay.approvedAt && pay.state === 'PAID' && ` · 승인 ${ymdhm(pay.approvedAt)}`}
            {pay.stub && <> <span className="state state-held" title="결제 연동 키가 없는 환경 — 실제 돈은 오가지 않았습니다">시험 결제</span></>}
          </p>
        )}
      </section>

      {pay?.stub && (
        <div className="notice" role="note">
          <b>시험 결제(스텁)</b>입니다 — 결제 연동 키가 없는 환경이라 실제 돈은 오가지 않았습니다.
        </div>
      )}

      {o.status === 'PENDING' && (
        vbank ? (
          <section className="hlt-box">
            <h3>입금하실 계좌</h3>
            <div className="hlt-sum"><span>은행</span><span>{vbank.bankCode ?? '-'}</span></div>
            <div className="hlt-sum"><span>계좌번호</span><span className="mono">{vbank.accountNumber ?? '-'}</span></div>
            <div className="hlt-sum"><span>예금주</span><span>{vbank.customerName ?? '-'}</span></div>
            <div className="hlt-sum"><span>입금 기한</span><span>{ymdhm(vbank.dueDate)}</span></div>
            <div className="hlt-sum tot"><span>입금하실 금액</span><span>{krw(o.total)}</span></div>
            <p className="hint">입금이 확인되면 주문이 결제 완료로 바뀌고 보내 드립니다. 기한이 지나면 계좌가 닫힙니다.</p>
          </section>
        ) : (
          <div className="notice">
            결제가 아직 승인되지 않았습니다. <Link href={`/health/order/pay?no=${encodeURIComponent(o.orderNo)}`}>결제하기</Link>에서 다시 시도해 주십시오.
          </div>
        )
      )}

      <div className="notice">
        받으신 날부터 <b>7일 안</b>이면 이유를 묻지 않고 청약철회하실 수 있습니다(전자상거래법 17조).
        다만 식품은 개봉하면 반품이 어렵습니다 — 여시기 전에 확인해 주십시오.
        {o.items.filter((i) => i.withdrawalBlockedIf).map((i) => (
          <span key={i.optionId ?? i.code}><br />· {i.name}: {i.withdrawalBlockedIf} 철회가 제한됩니다.</span>
        ))}
      </div>

      <SellerBox compact />

      <div className="hlt-btns">
        <Link className="hlt-btn pri" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>주문 상세</Link>
        <Link className="hlt-btn" href="/health">계속 쇼핑</Link>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
