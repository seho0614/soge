import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { TermsViewer, type TermDoc, type TermIndex } from '@/components/terms/TermsViewer';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const t = await apiGet<TermDoc>(`/terms/doc/${encodeURIComponent(code)}`, 300).catch(() => null);
  return { title: t?.title ?? (await getTranslations('policy'))('meta.term') };
}

/** SB-HOM-ETC-021 약관 전문 — v10.31 시안 termsv(탭 10종 · 판 · 시행일 · 조항 목록 · 본문 마크다운을 그려서). 대소문자는 서버가 가리지 않습니다. */
export default async function TermPage({ params }: Props) {
  const { code } = await params;
  const [list, doc] = await Promise.all([
    apiGet<TermIndex[]>('/terms/index', 300).catch(() => [] as TermIndex[]),
    apiGet<TermDoc>(`/terms/doc/${encodeURIComponent(code)}`, 300).catch(() => null),
  ]);
  /* 발행 · 폐기 목록에도 없고 전문도 없으면 없는 주소(404) — 폐기된 약관은 목록에 있어 안내를 보입니다 */
  if (!doc && !list.some((t) => t.code === code.toUpperCase())) notFound();
  return <TermsViewer list={list} doc={doc} code={code} />;
}
