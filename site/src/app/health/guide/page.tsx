/** SB-HLT-ETC-010 이용안내 · 청약철회 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalMarkdown } from '@/components/health/LegalMarkdown';
import { apiGet } from '@/lib/api';
import type { HltSaleCategory, HltTerm } from '@/components/health/types';
import { Crumb, HltNav, SellerBox } from '@/components/health/HltParts';
import { krw, RETURN_SHIP_ROUND_TRIP, RETURN_WINDOW_DAYS } from '@/components/health/util';

export const metadata: Metadata = { title: '이용안내 · 청약철회 · 소개몰' };

/**
 * 이용안내 · 청약철회.
 *
 * 약관 본문은 GET /terms 의 HLT_SALE(건강상품 판매 약관)을 **그대로** 보여 드립니다 —
 * 법정 고지 문구를 화면에 하드코딩하면 고칠 때마다 배포가 필요하고, 그 사이가 곧 위반 기간입니다.
 * 위의 요약 표는 시안의 안내를 약관과 같은 내용으로 줄인 것입니다.
 */
export default async function HltGuide() {
  const [terms, cats] = await Promise.all([
    apiGet<HltTerm[]>('/terms', 300).catch(() => null),
    apiGet<HltSaleCategory[]>('/health/categories', 60).catch(() => [] as HltSaleCategory[]),
  ]);
  const sale = terms?.find((t) => t.code === 'HLT_SALE');
  /* v10.25 (D025) — 팔지 않는 갈래 · 준비 중인 갈래의 안내 글은 서버 값입니다(갈래를 열면 여기서도 사라집니다) */
  const notSold = cats.filter((c) => c.state === 'NOT_SOLD');
  const locked = cats.filter((c) => c.state === 'LOCKED');

  return (
    <><div className="hlt">
      <HltNav on="guide" />
      <Crumb items={[{ label: '이용안내 · 청약철회' }]} />
      <div className="page-head"><h1>이용안내 · 청약철회</h1></div>

      <section className="hlt-box">
        <h3>소개몰은 어떤 곳입니까</h3>
        <p>
          소개장터 · 안심소개 · 소개창업에서는 소개뱅크가 <b>중개만</b> 하지만,
          소개몰(건강관)은 <b>소개뱅크가 직접 팝니다.</b> 상품의 하자 · 배송 · 반품 · 환불 책임이 판매자인 소개뱅크에 있습니다.
        </p>
      </section>

      <section className="hlt-box">
        <h3>청약철회 (전자상거래법 제17조)</h3>
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>기간</th><td>상품을 받으신 날부터 {RETURN_WINDOW_DAYS}일 이내 — 이유를 묻지 않습니다</td></tr>
            <tr><th>발송 전 취소</th><td>내 주문에서 바로 접수됩니다</td></tr>
            <tr><th>발송 후</th><td>취소가 아니라 반품으로 진행됩니다</td></tr>
            <tr><th>단순 변심 · 잘못 주문</th><td>왕복 배송비 {krw(RETURN_SHIP_ROUND_TRIP)}을 고객이 부담합니다 — 반품하시면 환불 금액에서 뺍니다. 발송 전 취소는 비용이 없습니다</td></tr>
            <tr><th>파손 · 오배송 · 표시 상이</th><td>비용이 들지 않습니다 — 여셨더라도 돌려받으실 수 있습니다</td></tr>
            <tr><th>철회 제한</th><td>개봉한 식품 · 건강기능식품, 사용 흔적이 있거나 위생상 재판매가 어려운 건강기기</td></tr>
            <tr><th>환불</th><td>반품 상품을 받은 날부터 영업일 3일 안 (카드는 카드사 사정으로 더 걸릴 수 있습니다)</td></tr>
          </tbody>
        </table>
        <div className="hlt-btns">
          <Link className="hlt-btn" href="/my/health/returns/new">취소 · 반품 신청</Link>
          <Link className="hlt-btn" href="/my/health/orders">내 주문</Link>
        </div>
      </section>

      <section className="hlt-box">
        <h3>배송</h3>
        <p>결제 확인 후 영업일 2일 안에 보내 드립니다. <b>배송비는 받지 않습니다</b>(전 상품 무료).</p>
      </section>

      <section className="hlt-box" id="not-sold">
        <h3>취급하지 않는 것</h3>
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>의약품</th><td>약사법 제44조 — 약국 개설자가 아니면 판매할 수 없습니다</td></tr>
            {notSold.map((c) => <tr key={c.code}><th>{c.name}</th><td>{c.note}</td></tr>)}
            <tr><th>의료 서비스</th><td>의료법 제27조 — 환자 유인·알선 금지</td></tr>
          </tbody>
        </table>
        {locked.map((c) => <p key={c.code} className="hint">🔒 {c.note}</p>)}
      </section>

      <section className="hlt-box">
        <h3>표시 · 광고</h3>
        <p>
          건강기능식품은 질병의 예방이나 치료를 위한 의약품이 아니며, 표시된 기능성은 식품의약품안전처가 인정한 범위입니다.
        </p>
      </section>

      <SellerBox />

      <article className="doc hlt-gap">
        {sale ? (
          <>
            <h1>{sale.title}</h1>
            <p className="doc-meta">버전 {sale.version} · <Link href="/terms/HLT_SALE">약관 페이지로 보기</Link></p>
            {/* v10.31 (결함-중) — 마크다운 기호를 그대로 보이던 것을 그려서 보입니다(글은 DB 약관 그대로) */}
            <LegalMarkdown body={sale.body} className="doc-body hlt-legal-md" />
          </>
        ) : terms === null ? (
          <p className="form-error" role="alert">약관을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
        ) : (
          <p className="stub-note">건강상품 판매 약관이 아직 발행되지 않았습니다.</p>
        )}
      </article>
    </div><i hidden data-root-end="" /></>
  );
}
