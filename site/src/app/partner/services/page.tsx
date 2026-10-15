import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, SVC_ST, Tw } from '@/components/partner/ui';
import { MatrixEditor } from '@/components/partner/ServiceTools';

export const metadata: Metadata = { title: '내 서비스' };

interface Svc {
  id: string; title: string; status: string; rejectReason: string | null; createdAt: string;
  updatedAt?: string; formType?: string | null; suspendedBy?: string | null; categoryName?: string | null;
  leadCount?: number; viewedCount?: number; doneCount?: number; convRate?: string | number | null;
}
interface Detail { matrix: { rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: Array<{ row: string; col: string; amount: number }> }; title: string }
const FORM_KO: Record<string, string> = { MATRIX: '매트릭스 견적', CONTRACT: '계약 성사형', CONSULT: '상담형', RENTAL: '약정 월요금형', PAYMENT: '결제형', MEDICAL: '의료 심의 트랙' };

/**
 * SB-PTC-CTR-200 내 서비스 — v10.31 (W5 · 10/10 시안 기준 scPtnSvc)
 *   단추 줄 → 표(서비스 · 등록 방식 · 상태 · 받은 리드 · 성사율 · 수정일 · 상세) → 「자동 견적 매트릭스」(매트릭스 견적 서비스의 칸 값).
 *   받은 리드 = 그 서비스 업종으로 받은 배정 · 성사율 = 소비자가 확인한 이행 보고 ÷ 연락처를 연 배정(서버 계산).
 *   파트너가 멈춘 서비스는 「보관(노출 중단)」으로 보입니다.
 */
export default async function ServicesPage() {
  const p = await me();
  if (!p) redirect('/login');

  const list = await apiGet<Svc[]>('/partner/services', 0).catch(() => [] as Svc[]);
  const approved = list.filter((s) => s.status === 'APPROVED').length;
  const mxSvc = list.find((s) => s.formType === 'MATRIX' && s.status !== 'REJECTED');
  const mx = mxSvc ? await apiGet<Detail>(`/partner/services/${encodeURIComponent(mxSvc.id)}`, 0).catch(() => null) : null;

  return (
    <><Pgh title="내 서비스" sub="등록한 서비스와 노출 상태입니다. 수정하면 재검수 대상이 됩니다." />
      <div className="pt-pact" data-ptn-actions>
        <Link className="pt-bp" href="/partner/services/new" data-ptn-new>✚ 서비스 등록</Link>
        <Link className="pt-bo" href="/partner/regions">서비스 지역</Link>
        <Link className="pt-bo" href="/partner/performance">성과 관리</Link>
        <Link className="pt-bo" href="/partner/reviews">승인 이력</Link>
      </div>

      {approved === 0 && (
        <Note kind="warn"><b>승인된 서비스가 없어 리드가 오지 않습니다.</b> 검수 중인 건은 노출되지 않습니다.</Note>
      )}

      {list.length === 0 ? (
        <Empty>등록한 서비스가 없습니다. 「✚ 서비스 등록」으로 시작하십시오.</Empty>
      ) : (
        <Tw head={['서비스', '등록 방식', '상태', '받은 리드', '성사율', '수정일', '']} numCols={[3, 4]}>
          {list.map((s) => {
            const st = s.status === 'SUSPENDED' && s.suspendedBy === 'PARTNER' ? ['보관', 'off'] as const : SVC_ST[s.status] ?? [s.status, 'off'] as const;
            return (
              <tr key={s.id}>
                <td>
                  <b>{s.title}</b><br /><span className="pt-ls pt-code">S-{s.id.slice(0, 8)}{s.categoryName ? ` · ${s.categoryName}` : ''}</span>
                  {s.rejectReason ? <div className="pt-wn">{s.rejectReason}</div> : null}
                  {s.status === 'IN_REVIEW' ? <div className="pt-ls">본사 검수 대기 — 승인 전에는 리드가 오지 않습니다</div> : null}
                </td>
                <td>{s.formType ? FORM_KO[s.formType] ?? s.formType : <span className="pt-ls">— (간단 등록)</span>}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td className="num">{s.leadCount ?? 0}</td>
                <td className="num">{s.convRate != null ? `${s.convRate}%` : '—'}</td>
                <td>{ymdKst(s.updatedAt ?? s.createdAt)}</td>
                <td><Link className="pt-bo sm" href={`/partner/services/${encodeURIComponent(s.id)}`}>상세</Link></td>
              </tr>
            );
          })}
        </Tw>
      )}

      <S2>자동 견적 매트릭스</S2>
      {mxSvc && mx ? (
        <>
          <p className="pt-ls">「{mx.title}」의 견적 칸 — 고치려면 서비스 상세에서 합니다.</p>
          <MatrixEditor rows={mx.matrix.rows} cols={mx.matrix.cols} cells={mx.matrix.cells} readOnly />
        </>
      ) : <Empty>매트릭스 견적 서비스가 없습니다. 이사처럼 「이사유형 × 물량」으로 견적을 내는 업종은 등록 때 칸을 채웁니다.</Empty>}
      <Note kind="warn"><b>견적 축(이사유형 · 물량)은 업종 마스터에 있습니다.</b> 축을 늘리거나 바꾸는 것은 본사(업종 마스터)가 합니다 — 배포 없이 바뀝니다.</Note>
      <Note kind="info">
        <b>반려되면 새로 등록하지 말고 고쳐서 내십시오.</b> 새로 내면 같은 건이 검수 큐에 두 번 쌓입니다. 금칙어(&lsquo;원금 보장&rsquo; &lsquo;100% 성공&rsquo; 등)가 있으면 등록되지 않습니다.
      </Note>
    <i hidden data-root-end="" /></>
  );
}
