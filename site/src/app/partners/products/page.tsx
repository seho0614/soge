import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { LinkCreateForm } from '@/components/partners/LinkCreateForm';
import { krw, ymd } from '@/components/partners/fmt';
import type { AffProduct } from '@/components/partners/types';

export const metadata: Metadata = { title: '추천상품' };

/**
 * SB-AFC-REC-010 추천상품 — GET /partner/affiliate/products
 *
 * ★ 판매 중(ON_SALE)인 것만 옵니다. 행마다 바로 링크를 만들 수 있게 둡니다(POST /partner/affiliate/links).
 * ★ 수수료는 건당 정액 — 주문 금액과 무관합니다.
 */
export default async function PartnerProductsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGetPersonal<AffProduct[]>('/partner/affiliate/products').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>추천상품</h1></div>
      <p className="lead">판매 중인 제휴상품입니다.</p>
      <div className="notice"><b>수수료는 건당 정액입니다.</b> 주문 금액과 무관하게 정해진 금액을 받습니다.</div>

      {rows === null ? (
        <p className="form-error" role="alert">상품을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">지금 판매 중인 제휴상품이 없습니다. 새 상품이 열리면 공지사항으로 알려 드립니다.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>상품</th><th>광고주</th><th className="num">수수료</th><th>기간</th><th>링크</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.name}</strong>{x.description && <div className="dim">{x.description}</div>}</td>
                <td>{x.advertiser ?? <span className="dim">—</span>}</td>
                <td className="num">{krw(x.commission)}</td>
                <td>{x.endedAt ? `~ ${ymd(x.endedAt)}` : '상시'}</td>
                <td><LinkCreateForm products={[]} fixed={x.id} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="notice warn">
        <b>단가가 바뀌어도 이미 생긴 주문은 그대로입니다.</b> 주문이 생긴 그 시점의 단가로 고정됩니다.
      </div>
    </>
  );
}
