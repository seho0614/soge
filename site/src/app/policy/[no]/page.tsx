import type { Metadata } from 'next';
import { AxisPage } from '@/components/gwan/AxisPage';

export const metadata: Metadata = { title: '정책 상세' };

/** v10.31 (w2) — SB-BIZ-POL-020 정책 상세(시안 axDetail · POL). 원문은 /policy/{no}/source */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <AxisPage kind="POL" no={no} />;
}
