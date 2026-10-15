import type { Metadata } from 'next';
import { AxisPage } from '@/components/gwan/AxisPage';

export const metadata: Metadata = { title: '공고 상세' };

/** v10.31 (w2) — 소개창업 축 항목 상세(시안 axDetail · JOB) */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <AxisPage kind="JOB" no={no} />;
}
