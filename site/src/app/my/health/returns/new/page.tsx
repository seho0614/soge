/** SB-HLT-RTN-010 취소 · 반품 신청 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltOrderRow, HltReturn } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import { ReturnForm } from '@/components/health/ReturnForm';
import { ProductArt } from '@/components/health/ProductArt';
import { codeText, ORDER_LABEL, RETURN_KIND, ymd } from '@/components/health/util';

import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hRetNew.meta') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ o?: string; draft?: string }> };

type Judge =
  | { ok: true; kinds: string[]; sellerOnly: boolean; note: string | null }
  | { ok: false; reason: string };

/**
 * 취소·반품 판정 — **서버 판정(주문 상세의 returnable, fn_hlt_return_judge)을 그대로 씁니다.**
 * 발송 전이면 취소, 발송 후면 반품·교환, 받은 날부터 청약철회 기간이 지나면 판매자 사유(하자·오배송·
 * 표시와 다름, 3개월)만 받습니다. 접수할 때 서버가 같은 판정으로 다시 막으므로 여기는 안내용입니다.
 */
type MyDealT = Awaited<ReturnType<typeof getTranslations<'myDeal'>>>;
type OrderT = Awaited<ReturnType<typeof getTranslations<'order'>>>;
function judge(o: HltOrder, open: HltReturn | undefined, t: MyDealT, to: OrderT): Judge {
  if (open) return { ok: false, reason: t('hRetNew.already', { kind: codeText(to, 'returnKind', open.kind, RETURN_KIND[open.kind] ?? ''), d: ymd(open.createdAt) }) };
  const r = o.returnable;
  if (!r) return { ok: false, reason: t('hRetNew.judgeFail') };
  const until = (d: string | null) => (d ? t('hRetNew.until', { d: ymd(new Date(new Date(d).getTime() - 1).toISOString()) }) : '');
  if (r.cancel.ok) return { ok: true, kinds: ['CANCEL'], sellerOnly: false, note: r.cancel.message };
  if (r.return.ok) return { ok: true, kinds: ['RETURN', 'EXCHANGE'], sellerOnly: false, note: r.return.message + until(r.return.deadline) };
  if (r.returnSellerFault.ok) {
    return { ok: true, kinds: ['RETURN', 'EXCHANGE'], sellerOnly: true,
      note: r.return.message + until(r.returnSellerFault.deadline) };
  }
  return { ok: false, reason: r.returnSellerFault.message };
}

export default async function MyHltReturnNew({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const to = await getTranslations('order');
  const sp = await searchParams;
  const no = sp.o;
  /* v10.139 (AI 상담 4단계 · docs/209) — ?draft= 면 본인 초안(같은 주문일 때만)으로 종류 · 사유 · 상세를 채움 · 판정 · 제출은 지금 그대로 */
  const draft = no && sp.draft && /^[0-9a-f-]{36}$/i.test(sp.draft)
    ? await apiGetPersonal<{ id: string; kind: string; fields: { orderNo?: string; kind?: string; reason?: string; detail?: string } }>(`/me/agent/drafts/${sp.draft}`).catch(() => null)
    : null;
  const aiDraft = draft?.kind === 'HLT_RETURN' && draft.fields.orderNo === no
    ? { id: draft.id, kind: draft.fields.kind, reason: draft.fields.reason, detail: draft.fields.detail } : undefined;

  /* ── 주문을 고르지 않고 들어온 경우 — 대상 주문 목록 ── */
  if (!no) {
    const rows = await apiGetPersonal<HltOrderRow[]>('/me/health/orders').catch(() => null);
    const target = (rows ?? []).filter((o) => !['CANCELED', 'RETURNED'].includes(o.status));
    return (
      <><div className="hlt">
        <MyHltNav on="returns" />
        <div className="page-head"><h1>{t('hRetNew.title')}</h1></div>
        {rows === null ? (
          <p className="form-error" role="alert">{t('h.loadFail')}</p>
        ) : target.length === 0 ? (
          <HltEmpty msg={t('hRetNew.noTarget')} href="/my/health/orders" label={t('hNav.orders')} />
        ) : (
          <section className="hlt-box">
            <h3>{t('hRetNew.pickH')}</h3>
            {target.map((o) => (
              <div key={o.orderNo} className="hlt-sum">
                <span>{ymd(o.createdAt)} · {o.orderNo} · {codeText(to, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status)} · {f.won(o.total, '-')}</span>
                <Link className="hlt-btn sm" href={`/my/health/returns/new?o=${encodeURIComponent(o.orderNo)}`}>{t('hRetNew.pick')}</Link>
              </div>
            ))}
          </section>
        )}
      </div><i hidden data-root-end="" /></>
    );
  }

  let o: HltOrder | null = null;
  let err: string | null = null;
  try {
    o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 && f.ko ? e.body.message : t('h.loadFail');
  }
  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="returns" />
        <div className="page-head"><h1>{t('hRetNew.title')}</h1></div>
        <HltEmpty msg={err ?? t('h.notFound')} href="/my/health/returns/new" label={t('hRetNew.repick')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  const returns = await apiGetPersonal<HltReturn[]>('/me/health/returns').catch(() => [] as HltReturn[]);
  const open = returns.find((r) => r.orderNo === o!.orderNo && ['REQUESTED', 'APPROVED'].includes(r.state));
  const j = judge(o, open, t, to);
  const enc = encodeURIComponent(o.orderNo);
  /* v10.32 — 시안의 「반품 주소」 띠: 첫 품목의 판매자 반품 주소(공개 상품 상세 API 의 returnAddr — 판매자 값이 없으면 회사 주소) */
  const retAddr = j.ok && j.kinds.includes('RETURN') && o.items[0]?.code
    ? await apiGet<{ returnAddr?: string | null }>(`/health/products/${encodeURIComponent(o.items[0].code)}`, 300).then((x) => x.returnAddr ?? null).catch(() => null)
    : null;
  /* v10.32 — 시안 순서(신청 종류 → ① 항목 → ② 사유 → 포장 → ③ 환불 예상)를 맞추려고 항목 칸을 신청서 안으로 넘깁니다 */
  const itemsBox = (
      <section className="hlt-box" data-ret-items="">
        {/* v10.31 (시안 「① 항목 선택 (주문 전체)」 — 품목 그림 · 이름 · 옵션 × 수량) */}
        <h3>{t('hRetNew.itemsH')} <span className="hint">{t('hRetNew.itemsHint', { s: codeText(to, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status) })}</span></h3>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-ci" data-item={i.code}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <b>{i.name}</b>
              <span className="hint">{i.optionLabel && i.optionLabel !== '단품' ? `${i.optionLabel} × ` : ''}{t('h.qty', { n: String(i.qty) })}{i.withdrawalBlockedIf && t('hRetNew.limit', { v: i.withdrawalBlockedIf })}</span>
            </div>
            <b className="money">{f.won(i.amount, '-')}</b>
          </div>
        ))}
        <div className="hlt-sum tot"><span>{t('h.payAmount')}</span><span>{f.won(o.total, '-')}</span></div>
      </section>
  );

  return (
    <><div className="hlt">
      <MyHltNav on="returns" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">{t('hNav.orders')}</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › {t('hRetNew.crumb')}
      </div>
      <div className="page-head"><h1>{j.ok && j.kinds[0] === 'CANCEL' ? t('hRetNew.cancelTitle') : t('hRetNew.title')}</h1></div>
      {/* 시안 — 항목 선택 → 사유 → 환불 확인 → 접수. 개발분은 주문 단위라 「항목 선택」이 아래 「대상 주문」입니다(일부 반품은 다음 판) */}
      <ol className="hlt-steps" aria-label={t('hRetNew.stepsLabel')}>
        <li className="on">{t('hRetNew.s1')}</li><li>{t('hReturns.reason')}</li><li>{t('hRetNew.s3')}</li><li>{t('hRetNew.s4')}</li>
      </ol>

      {!j.ok ? (
        <>
          {itemsBox}
          <div className="hlt-box hlt-fail" role="alert">{j.reason}</div>
          <div className="hlt-btns">
            <Link className="hlt-btn" href={`/my/health/orders/${enc}`}>{t('hOrder.title')}</Link>
            <Link className="hlt-btn" href="/my/health/returns">{t('hNav.returns')}</Link>
            <Link className="hlt-btn" href="/health/guide">{t('hRetNew.guide')}</Link>
          </div>
        </>
      ) : (
        <>
          {j.note && <div className="notice">{j.note}</div>}
          <div className="notice">
            {t.rich('hRetNew.foodNote', { b: (c) => <b>{c}</b> })}
          </div>
          <ReturnForm orderNo={o.orderNo} kinds={j.kinds} sellerOnly={j.sellerOnly} ship={o.returnShip} exchangeFee={o.exchangeFee} items={itemsBox} returnAddr={retAddr} draft={aiDraft} />
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
