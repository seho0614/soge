/**
 * v10.31 (w2) — 소개창업 축 항목 상세 화면의 바깥 틀(공고 · 자문 서비스 · 정책 · 교육 — 주소 /biz/job/{번호} · /biz/advisory/{번호} · /policy/{번호} · /biz/edu/{번호}).
 *   시안 axDetail — 돌아가기 줄 + 상세 한 틀. 번호가 없거나 다른 종류면 404.
 */
import { notFound } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import type { AxisItem } from '@/components/market/types';
import { BackBar } from '@/components/common/BackBar';
import { AXKIND, AxisDetail } from './GwBizAxes';
import { GwFrame } from './GwParts';

export async function AxisPage({ kind, no }: { kind: 'JOB' | 'SVC' | 'POL' | 'EDU'; no: string }) {
  if (!/^\d{1,12}$/.test(no)) notFound();
  const it = await apiGetPersonal<AxisItem>(`/biz/axis/${kind}/${no}`).catch((e) => {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  });
  if (!it) notFound();
  const KD = AXKIND[kind];
  return (
    <><GwFrame code="BIZ">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={KD.up} label={KD.ax} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}><AxisDetail it={it} /></div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
