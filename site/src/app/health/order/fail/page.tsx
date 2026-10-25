/** SB-HLT-ORD-040 주문 실패 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { HltNav } from '@/components/health/HltParts';
import { codeText } from '@/components/health/util';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.fail') };
}
export const dynamic = 'force-dynamic';

/* 토스 결제창 실패 주소는 code · message · orderId 를 붙여 줍니다(D006) — msg 가 없으면 message 를 씁니다 */
type Props = { searchParams: Promise<{ step?: string; no?: string; code?: string; msg?: string; message?: string; orderId?: string }> };

/* 오류코드별 다음 행동 — 서버 오류코드(HealthPaymentService)를 그대로 받습니다 · v10.99 문구는 사전 order.failPage.hint.<코드> */

/**
 * 주문 실패 — 전용 API 가 없습니다. 주문서 · 결제 화면이 받은 오류(코드·문구)를
 * 주소로 넘겨받아 보여 주고, 어디서 다시 할지 안내합니다.
 * 문구는 서버가 준 것이므로 여기서 지어내지 않습니다(없을 때만 기본 문구).
 */
export default async function HltOrderFail({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const sp = await searchParams;
  const t = await getTranslations('order');
  const { step, code } = sp;
  const no = sp.no ?? sp.orderId;
  const msg = sp.msg ?? sp.message;
  const safe = (s: string | undefined, n: number) => (s ?? '').slice(0, n);
  const atPay = step === 'pay' && !!no;
  const c = safe(code, 40) || (atPay ? 'PAY_REJECTED' : 'ORDER_FAILED');
  const hint = /^[A-Z0-9_]+$/.test(c) ? codeText(t, 'failPage.hint', c, '') : '';   // 주소창 값 — 코드 모양만 사전에서 찾음

  return (
    <><div className="hlt">
      <HltNav back="/health/order" />
      <div className="page-head"><h1>{t('failPage.title')}</h1></div>
      <div className="hlt-box hlt-fail" role="alert">
        <b>{safe(msg, 200) || (atPay ? t('common.notApproved') : t('failPage.orderFail'))}</b>
        <p className="hint">{t('failPage.code', { c })}{no && t('failPage.orderNoSep', { no: safe(no, 40) })}</p>
        {hint && <p>{hint}</p>}
        {atPay && c !== 'ALREADY' && <p className="hint">{t('failPage.noMoney')}</p>}
      </div>
      <div className="hlt-btns">
        {/* v10.25 — 단추 이름은 시안대로 「다시 시도」. 가는 곳은 실패한 단계에 맞춥니다(결제 단계 → 결제 화면 · 주문 단계 → 장바구니) */}
        {atPay && c !== 'ALREADY'
          ? <Link className="hlt-btn pri" href={`/health/order/pay?no=${encodeURIComponent(safe(no, 40))}`}>{t('failPage.retry')}</Link>
          : atPay
            ? <Link className="hlt-btn pri" href={`/my/health/orders/${encodeURIComponent(safe(no, 40))}`}>{t('common.orderDetail')}</Link>
          : c === 'IDENTITY_REQUIRED'
            ? <Link className="hlt-btn pri" href="/verify?next=/health/cart">{t('common.verify')}</Link>
            : <Link className="hlt-btn pri" href="/health/cart">{t('failPage.retry')}</Link>}
        <Link className="hlt-btn" href="/my/health/orders">{t('failPage.history')}</Link>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
