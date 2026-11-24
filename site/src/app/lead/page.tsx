import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { Gwan } from '@/lib/types';
import { ConsultRows } from '@/components/mal/ConsultRows';
import type { ConsultCat } from '@/components/mal/types';
import '@/styles/mal.css';
import { getTranslations } from 'next-intl/server';
import { Fragment } from 'react';
import { getLayout, layOrder } from '@/lib/layout';   // v10.698 (D321 · docs/806) 꾸밀 페이지
import { LayBlocks } from '@/components/layout/LayBlocks';
import { MaintBand, MaintNotice, maintOf } from '@/components/gwan/MaintBand';   // v10.707 (D323) 관 점검 안내

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('consult'))('lead.title') };
}

/**
 * SB-LED-MAIN-010 — 리드관(소개리드) 메인 (v10.335 · D227 · docs/466)
 *
 * 대표 11/17 「리드관 다시 열기」 → 「B. 별도 관으로 되살림」 → 「개발 + 꺼진 채로」.
 * 업종 · 상담 신청 · 리드 엔진은 안심소개 「생활 · 금융 상담」(GET /consult/categories · /mal/consult/{code})을 그대로 씁니다.
 * 관이 꺼져 있으면(GET /gwans 에 LED 없음) 404 — 법무 재확인 회신(lead.legal_ok) 뒤 최고 관리자가 켭니다.
 */
export default async function LeadHallPage({ searchParams }: { searchParams: Promise<{ lp?: string }> }) {
  const gwans = await apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]);
  const g = gwans.find((x) => x.code === 'LED' && x.isActive !== false);
  const mt = await maintOf('LED');   // v10.707 점검 중이면 404 대신 안내
  if (mt?.running) return <><MaintNotice code="LED" m={mt} /><i hidden data-root-end="" /></>;
  if (!g) notFound();
  const t = await getTranslations('consult');
  const cats = await apiGet<ConsultCat[]>('/consult/categories', 60).catch(() => [] as ConsultCat[]);
  const lay = await getLayout('LED', (await searchParams).lp);   // v10.698 게시한 배치(없으면 처음 화면)
  const ins = (at: string) => <LayBlocks code="MAL" blocks={lay?.inserts[at]} at={at} />;   // 매물 · 업종 블록은 안심소개 기준
  return (
    <><MaintBand code="LED" m={mt} /><div className="mal mal-narrow mal-proto mal-csl32" data-screen="SB-LED-MAIN-010" data-lead-hall="">
      <div className="page-head mal-head">
        <h1>{lay?.texts.title || t('lead.title')}</h1>
        <p className="mal-desc">{lay?.texts.desc || t('lead.desc')}</p>
      </div>
      {ins('_top')}
      {layOrder(lay, ['warn', 'list', 'cta']).map(({ key, show }) => <Fragment key={key}>{show && key === 'warn' && <div className="mal-warn ok">{t('lead.warn')}</div>}
      {show && key === 'list' && <section className="mal-panel" aria-labelledby="led-list-h">
        <div className="mal-sh2">
          <b id="led-list-h">{t('common.cats')} {cats.length > 0 ? t('common.catsCount', { n: String(cats.length) }) : ''}</b>
          <span className="mal-ls">{t('common.gatedNote')}</span>
        </div>
        <ConsultRows cats={cats} label={t('common.apply')} />
      </section>}
      {show && key === 'cta' && <div className="mal-cta">
        <b>{t('list.ctaQ')}</b>
        <span>{t('list.ctaText')}</span>
        <a className="mal-btn ghost sm" href="/partner/apply">{t('list.ctaBtn')}</a>
      </div>}{ins(key)}</Fragment>)}
    </div><i hidden data-root-end="" /></>
  );
}
