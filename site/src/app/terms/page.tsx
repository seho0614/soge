import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import { TermsViewer, type TermDoc, type TermIndex } from '@/components/terms/TermsViewer';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('meta.terms') };
}

/** 약관 · 법적 고지 — v10.31: 링크 목록 대신 시안 약관 전문 화면(탭 10종)으로. 첫 탭(이용약관)을 엽니다 */
export default async function TermsIndex() {
  const [list, doc] = await Promise.all([
    apiGet<TermIndex[]>('/terms/index', 300).catch(() => [] as TermIndex[]),
    apiGet<TermDoc>('/terms/doc/SERVICE', 300).catch(() => null),
  ]);
  // v10.32 (추가) — 시안 terms 제목 「약관 · 법정 고지」(index)
  return <TermsViewer list={list} doc={doc} code="SERVICE" index />;
}
