import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { RoleTabs } from '@/components/gwan/GwParts';
import type { Cat, Gwan } from '@/components/form/RegParts';
import { RequestForm } from './RequestForm';
import { gradeLabels } from '@/lib/grades';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '소개받기 등록' };

const REQ_GWANS = ['MNY', 'MAL', 'BIZ'];

/** SB-HOM-REQ-010 소개받기 등록하기 — v10.31 시안 scReqNew(← 이전 화면 · 3단추 · 안내 · 4구역 폼) */
export default async function NewRequest({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const p = await me();
  if (!p) redirect('/login?next=/request/new');
  if (!p.identityVerifiedAt) redirect('/verify?next=/request/new');
  const sp = await searchParams;

  const [gw, labels, ...lists] = await Promise.all([
    apiGet<Array<Gwan & { isActive: boolean }>>('/gwans', 300).catch(() => []),
    gradeLabels(),
    ...REQ_GWANS.map((g) => apiGet<Cat[]>(`/categories?gwanCode=${g}`, 300).catch(() => [] as Cat[])),
  ]);
  const gwans = gw.filter((g) => g.isActive && REQ_GWANS.includes(g.code)).map((g) => ({ code: g.code, name: g.name }));
  /* 제한업종(다단계 · 대부 등)은 고르기에서 뺍니다 — 골라 봐야 등록 때 막힙니다 */
  const cats = (lists as Array<Array<Cat & { restrictedCode?: string | null }>>).flat().filter((c) => !c.restrictedCode);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REQ-010">
      <BackBar href="/request" label="이전 화면" wrap={false} />
      <div style={{ marginTop: 12 }}>
        <RoleTabs on="want" note="원하는 상품이나 서비스를 소개받고 연결 기회를 만들어보세요!" />
      </div>
      <RequestForm gwans={gwans} cats={cats} gradeLabels={labels}
        initialGwan={REQ_GWANS.includes(sp.g ?? '') ? sp.g : undefined} />
    </div>
  );
}
