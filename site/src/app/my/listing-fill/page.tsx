import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { MyHead, Note, Empty } from '@/components/my/ui';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('grw.fill'))('title') };
}
export const dynamic = 'force-dynamic';

type Code = 'TITLE' | 'SUMMARY' | 'BODY' | 'PHOTO1' | 'PHOTO3' | 'REGION' | 'AMOUNT' | 'FEE' | 'HOURS';
interface Item { id: string; title: string | null; status: string; score: number; grade: 'A' | 'B' | 'C' | 'D'; todo: Code[] }

/** SB-MYP-GRW-030 매물 등록 도우미 (v10.601 · docs/743) — GET /me/grw/listings · 내 매물 충실도 · 더 적으면 좋은 칸 · 고치기로 바로 */
export default async function ListingFill() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('grw.fill');
  const d = await apiGetPersonal<{ on: boolean; items: Item[] }>('/me/grw/listings').catch(() => null);
  return (
    <div data-screen="SB-MYP-GRW-030">
      <MyHead title={t('title')} sub={t('sub')} />
      <Note kind="info">{t('notRank')}</Note>
      {!d?.on ? <Empty>{t('off')}</Empty> : d.items.length === 0 ? <Empty>{t('empty')} <Link href="/register">{t('first')}</Link></Empty> : (
        <div data-grw-fill-list={d.items.length}>
          {d.items.map((it) => (
            <div key={it.id} className="card p2pad" style={{ marginBottom: 10 }} data-grw-fill-row={it.id} data-score={it.score}>
              <p><b>{it.title ?? '—'}</b> · {t('score', { score: String(it.score) })} · {t(`grade.${it.grade}`)}{' '}
                <Link className="my-bo sm" href={`/listings/${it.id}/edit`}>{t('edit')}</Link></p>
              {it.todo.length ? <ul style={{ paddingLeft: 18 }}>{it.todo.map((c) => <li key={c}>{t(`tip.${c}`)}</li>)}</ul> : <p className="my-ps">{t('allDone')}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
