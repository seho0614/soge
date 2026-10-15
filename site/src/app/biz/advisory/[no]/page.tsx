import type { Metadata } from 'next';
import { AxisPage } from '@/components/gwan/AxisPage';

export const metadata: Metadata = { title: '자문 서비스 상세' };

/** v10.31 (w2) — 소개창업 축 항목 상세(시안 axDetail · SVC) */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <AxisPage kind="SVC" no={no} />;
}
