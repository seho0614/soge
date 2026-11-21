import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AreaView } from '@/components/lsq/AreaView';
import '@/styles/lpx.css';

type Props = { params: Promise<{ sido: string; sigungu: string }>; searchParams: Promise<{ gwan?: string; page?: string }> };
const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return ''; } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('lsq.area');
  const p = await params;
  return { title: t('regionTitle', { region: `${dec(p.sido)} ${dec(p.sigungu)}` }) };
}

/** v10.605 (docs/747) SB-HOM-LSQ-020 시 · 군 · 구 매물 소개 — AreaView(공개 · 집계 · 목록) */
export default async function AreaSigunguPage({ params, searchParams }: Props) {
  const p = await params;
  const sp = await searchParams;
  return <AreaView sido={dec(p.sido)} sigungu={dec(p.sigungu)} gwan={sp.gwan} page={sp.page} />;
}
