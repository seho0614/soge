import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.events'))('title') };
}

interface J {
  code: string; title: string; benefit: string; endsAt: string;
  joinedAt: string; grantedAt?: string; grantNote?: string;
}

/**
 * SB-MYP-EVT-010 내 이벤트 참여
 *
 * 받았는지 못 받았는지 **여기서 알 수 있어야** 합니다.
 * v10.29 — 시안(scMyEvt) 배치: 표(이벤트 · 혜택 · 상태 · 참여) → 안내.
 */
export default async function MyEventsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<J[]>('/me/events', 0).catch(() => [] as J[]);
  const waiting = rows.filter((r) => !r.grantedAt).length;
  const t = await getTranslations('my.events');

  return (
    <>
      <MyHead title={t('title')}
        sub={waiting > 0 ? t('subWaiting', { n: String(waiting) }) : t('sub')} />
      {rows.length === 0 ? (
        <Empty>{t('empty')} <Link href="/money/event">{t('browse')}</Link></Empty>
      ) : (
        <Table head={[t('thEvent'), t('thBenefit'), t('thStatus'), t('thJoined')]}>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><b>{r.title}</b></td>
              <td>{r.benefit}</td>
              <td>
                {r.grantedAt
                  ? <><span className="my-bg ok">{t('granted')}</span>{r.grantNote ? <span className="my-ls blk">{r.grantNote}</span> : null}</>
                  : <span className="my-bg wait">{t('checking')}</span>}
              </td>
              <td>{ymdKst(r.joinedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="info"><b>{t('noteB')}</b> {t('noteText')}</Note>
    </>
  );
}
