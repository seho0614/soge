import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import type { ListingCardData } from '@/lib/types';
import { MyHead, Note, Empty, Table, GwanTag, shortId } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.likes'))('title') };
}

/**
 * SB-MYP-LIK-010
 * v10.29 — 시안(scMyLik) 배치: 표(구분 · 상품 · 서비스 · 업종 · 소개비 · 등록자 · 보기 / 1:1 문의) + 늘 보이는 INV-2 안내.
 *   「1:1 문의 ›」는 그 매물의 문의방(/chat/{매물 id})으로 갑니다 — 계약으로 바로 보내지 않습니다(INV-2).
 */
export default async function LikesPage() {
  if (!(await me())) redirect('/login');
  const rows = await apiGet<ListingCardData[]>('/me/favorites', 0).catch(() => [] as ListingCardData[]);
  const t = await getTranslations('my.likes');
  const f = await getFmt();

  return (
    <>
      <MyHead title={t('title')}
        sub={t('sub')} />
      {rows.length === 0 ? (
        <Empty data-likes-empty="">{t('empty')} <Link href="/money">{t('browse')}</Link></Empty>
      ) : (
        <Table head={[t('thGwan'), t('thItem'), t('thCategory'), t('thFee'), t('thOwner'), '']}>
          {rows.map((x) => (
            <tr key={x.id} data-like-row={x.id}>
              <td><GwanTag code={x.gwanCode} /></td>
              <td><b>{x.title}</b><br /><span className="my-ls">{shortId(x.id, 'L-')}</span></td>
              <td>{x.categoryName}</td>
              <td>{f.won(x.desiredFee)}</td>
              <td>{x.owner?.companyName ?? '—'}</td>
              <td>
                <div className="my-lka">
                  <Link className="my-bo sm" href={`/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`}>{t('view')}</Link>
                  <Link className="my-bp sm" href={`/chat/${x.id}`}>{t('ask')}</Link>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {/* 안내는 목록이 있든 없든 늘 보여야 합니다 — 계약으로 바로 가려다 소개비를 놓치는 일을 막는 문구입니다(시안 그대로). */}
      <Note kind="info">
        {t.rich('note', { b: (c) => <b>{c}</b> })}
      </Note>
    </>
  );
}
