import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { won, GWAN_PATH } from '@/lib/format';
import type { ListingCardData } from '@/lib/types';
import { MyHead, Note, Empty, Table, GwanTag, shortId } from '@/components/my/ui';

export const metadata: Metadata = { title: '관심 목록' };

/**
 * SB-MYP-LIK-010
 * v10.29 — 시안(scMyLik) 배치: 표(구분 · 상품 · 서비스 · 업종 · 소개비 · 등록자 · 보기 / 1:1 문의) + 늘 보이는 INV-2 안내.
 *   「1:1 문의 ›」는 그 매물의 문의방(/chat/{매물 id})으로 갑니다 — 계약으로 바로 보내지 않습니다(INV-2).
 */
export default async function LikesPage() {
  if (!(await me())) redirect('/login');
  const rows = await apiGet<ListingCardData[]>('/me/favorites', 0).catch(() => [] as ListingCardData[]);

  return (
    <>
      <MyHead title="관심 목록"
        sub="담아 둔 상품 · 서비스입니다. 계약은 1:1 대화에서 조건을 맞춘 뒤 요청하십시오 — 소개코드는 대화가 시작되는 순간 발급됩니다 (INV-2)." />
      {rows.length === 0 ? (
        <Empty data-likes-empty="">담아 둔 항목이 없습니다. <Link href="/money">소개장터 둘러보기 ›</Link></Empty>
      ) : (
        <Table head={['구분', '상품 · 서비스', '업종', '소개비', '등록자', '']}>
          {rows.map((x) => (
            <tr key={x.id} data-like-row={x.id}>
              <td><GwanTag code={x.gwanCode} /></td>
              <td><b>{x.title}</b><br /><span className="my-ls">{shortId(x.id, 'L-')}</span></td>
              <td>{x.categoryName}</td>
              <td>{won(x.desiredFee)}</td>
              <td>{x.owner?.companyName ?? '—'}</td>
              <td>
                <div className="my-lka">
                  <Link className="my-bo sm" href={`/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`}>보기</Link>
                  <Link className="my-bp sm" href={`/chat/${x.id}`}>1:1 문의 ›</Link>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {/* 안내는 목록이 있든 없든 늘 보여야 합니다 — 계약으로 바로 가려다 소개비를 놓치는 일을 막는 문구입니다(시안 그대로). */}
      <Note kind="info">
        <b>계약은 바로 요청하실 수 없습니다.</b> 1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다(INV-2).
        대화를 건너뛰면 <b>소개자가 누구인지 증명할 수 없어</b> 소개비를 받지 못합니다.
      </Note>
    </>
  );
}
