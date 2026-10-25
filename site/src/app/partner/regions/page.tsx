import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { RegionEditor } from '@/components/partner/RegionEditor';
import { Note, Pgh } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';

// v10.31 (W5 · 10/10 시안 기준) — 화면 이름을 시안 「서비스 지역」 하나로
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('regions') };
}

interface Region { sido: string; sigungu: string }

/**
 * SB-PTC-CTR-230 — 켠 지역에서만 리드를 받습니다.
 * v10.29 — 시안 scPtnRegion 배치(「영업 중 N곳」 칩 → 「꺼둔 지역 N곳」 칩 → 안내). 칩을 누르면 켜고 끕니다(RegionEditor).
 */
export default async function RegionsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partner.regions');
  const tp = await getTranslations('partner');
  const B = (c: React.ReactNode) => <b>{c}</b>;

  const list = await apiGet<Region[]>('/partner/regions', 0).catch(() => []);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />

      {list.length === 0 ? (
        <Note kind="warn">{t.rich('none', { b: B })}</Note>
      ) : (
        <Note kind="ok">{t('count', { n: String(list.length) })}</Note>
      )}

      {/* v10.27 (G-192) — 켜고 끄기 · 더하기 · 저장(전에는 보기만 있었음) */}
      <RegionEditor initial={list} />

      <Note kind="info">
        {t.rich('addrNote', { b: B })}
      </Note>
      <Note kind="plain">
        {t.rich('freeNote', { b: B })}
      </Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">{tp('common.toServices')}</Link></div>
    <i hidden data-root-end="" /></>
  );
}
