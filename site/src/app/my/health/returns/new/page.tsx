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
import { krw, ORDER_LABEL, RETURN_KIND, ymd } from '@/components/health/util';

export const metadata: Metadata = { title: '취소 · 반품 신청 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ o?: string }> };

type Judge =
  | { ok: true; kinds: string[]; sellerOnly: boolean; note: string | null }
  | { ok: false; reason: string };

/**
 * 취소·반품 판정 — **서버 판정(주문 상세의 returnable, fn_hlt_return_judge)을 그대로 씁니다.**
 * 발송 전이면 취소, 발송 후면 반품·교환, 받은 날부터 청약철회 기간이 지나면 판매자 사유(하자·오배송·
 * 표시와 다름, 3개월)만 받습니다. 접수할 때 서버가 같은 판정으로 다시 막으므로 여기는 안내용입니다.
 */
function judge(o: HltOrder, open: HltReturn | undefined): Judge {
  if (open) return { ok: false, reason: `이미 접수된 ${RETURN_KIND[open.kind] ?? ''} 신청이 있습니다(${ymd(open.createdAt)}). 결과를 기다려 주십시오.` };
  const r = o.returnable;
  if (!r) return { ok: false, reason: '신청 가능 여부를 확인하지 못했습니다. 잠시 뒤 다시 열어 주십시오.' };
  const until = (d: string | null) => (d ? ` (신청 마감 ${ymd(new Date(new Date(d).getTime() - 1).toISOString())})` : '');
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
  const no = (await searchParams).o;

  /* ── 주문을 고르지 않고 들어온 경우 — 대상 주문 목록 ── */
  if (!no) {
    const rows = await apiGetPersonal<HltOrderRow[]>('/me/health/orders').catch(() => null);
    const target = (rows ?? []).filter((o) => !['CANCELED', 'RETURNED'].includes(o.status));
    return (
      <><div className="hlt">
        <MyHltNav on="returns" />
        <div className="page-head"><h1>취소 · 반품 신청</h1></div>
        {rows === null ? (
          <p className="form-error" role="alert">주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
        ) : target.length === 0 ? (
          <HltEmpty msg="취소·반품할 주문이 없습니다." href="/my/health/orders" label="내 주문" />
        ) : (
          <section className="hlt-box">
            <h3>주문 선택</h3>
            {target.map((o) => (
              <div key={o.orderNo} className="hlt-sum">
                <span>{ymd(o.createdAt)} · {o.orderNo} · {ORDER_LABEL[o.status] ?? o.status} · {krw(o.total)}</span>
                <Link className="hlt-btn sm" href={`/my/health/returns/new?o=${encodeURIComponent(o.orderNo)}`}>이 주문 선택</Link>
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
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }
  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="returns" />
        <div className="page-head"><h1>취소 · 반품 신청</h1></div>
        <HltEmpty msg={err ?? '주문을 찾을 수 없습니다.'} href="/my/health/returns/new" label="주문 다시 고르기" />
      </div><i hidden data-root-end="" /></>
    );
  }

  const returns = await apiGetPersonal<HltReturn[]>('/me/health/returns').catch(() => [] as HltReturn[]);
  const open = returns.find((r) => r.orderNo === o!.orderNo && ['REQUESTED', 'APPROVED'].includes(r.state));
  const j = judge(o, open);
  const enc = encodeURIComponent(o.orderNo);
  /* v10.32 — 시안의 「반품 주소」 띠: 첫 품목의 판매자 반품 주소(공개 상품 상세 API 의 returnAddr — 판매자 값이 없으면 회사 주소) */
  const retAddr = j.ok && j.kinds.includes('RETURN') && o.items[0]?.code
    ? await apiGet<{ returnAddr?: string | null }>(`/health/products/${encodeURIComponent(o.items[0].code)}`, 300).then((x) => x.returnAddr ?? null).catch(() => null)
    : null;
  /* v10.32 — 시안 순서(신청 종류 → ① 항목 → ② 사유 → 포장 → ③ 환불 예상)를 맞추려고 항목 칸을 신청서 안으로 넘깁니다 */
  const itemsBox = (
      <section className="hlt-box" data-ret-items="">
        {/* v10.31 (시안 「① 항목 선택 (주문 전체)」 — 품목 그림 · 이름 · 옵션 × 수량) */}
        <h3>① 항목 선택 <span className="hint">(주문 전체 · {ORDER_LABEL[o.status] ?? o.status})</span></h3>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-ci" data-item={i.code}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <b>{i.name}</b>
              <span className="hint">{i.optionLabel && i.optionLabel !== '단품' ? `${i.optionLabel} × ` : ''}{i.qty}개{i.withdrawalBlockedIf && ` · 철회 제한: ${i.withdrawalBlockedIf}`}</span>
            </div>
            <b className="money">{krw(i.amount)}</b>
          </div>
        ))}
        <div className="hlt-sum tot"><span>결제 금액</span><span>{krw(o.total)}</span></div>
      </section>
  );

  return (
    <><div className="hlt">
      <MyHltNav on="returns" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">내 주문</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › 취소·반품
      </div>
      <div className="page-head"><h1>{j.ok && j.kinds[0] === 'CANCEL' ? '주문 취소' : '취소 · 반품 신청'}</h1></div>
      {/* 시안 — 항목 선택 → 사유 → 환불 확인 → 접수. 개발분은 주문 단위라 「항목 선택」이 아래 「대상 주문」입니다(일부 반품은 다음 판) */}
      <ol className="hlt-steps" aria-label="신청 단계">
        <li className="on">항목 선택</li><li>사유</li><li>환불 확인</li><li>접수</li>
      </ol>

      {!j.ok ? (
        <>
          {itemsBox}
          <div className="hlt-box hlt-fail" role="alert">{j.reason}</div>
          <div className="hlt-btns">
            <Link className="hlt-btn" href={`/my/health/orders/${enc}`}>주문 상세</Link>
            <Link className="hlt-btn" href="/my/health/returns">취소 · 반품 내역</Link>
            <Link className="hlt-btn" href="/health/guide">청약철회 안내</Link>
          </div>
        </>
      ) : (
        <>
          {j.note && <div className="notice">{j.note}</div>}
          <div className="notice">
            식품은 개봉하면 반품이 어렵습니다 — 개봉 여부 판단은 판매자가 합니다.
            <b> 상품이 상했거나 다른 것이 왔으면 여셨더라도 돌려받으실 수 있습니다.</b>
          </div>
          <ReturnForm orderNo={o.orderNo} kinds={j.kinds} sellerOnly={j.sellerOnly} ship={o.returnShip} exchangeFee={o.exchangeFee} items={itemsBox} returnAddr={retAddr} />
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
