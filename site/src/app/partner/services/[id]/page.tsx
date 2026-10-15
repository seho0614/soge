import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, SVC_ST, Tw, won } from '@/components/partner/ui';
import { BlockEditor, MatrixEditor, ServiceActions } from '@/components/partner/ServiceTools';

export const metadata: Metadata = { title: '서비스 상세 · 상세페이지' };

interface D {
  id: string; title: string; body: string | null; status: string; rejectReason: string | null; createdAt: string; updatedAt: string;
  formType: string | null; formLabel: string | null; target: string | null; receiveMode: string | null;
  topFee: number | null; referralRate: number | null; rebateBonus: number | null; suspendedBy: string | null;
  categoryName: string | null; categoryFee: string | null;
  blocks: Array<{ kind: string; label: string; filled: boolean; body: string | null; fileId: string | null }>;
  matrix: { rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: Array<{ row: string; col: string; amount: number }> };
  events: Array<{ action: string; from: string | null; to: string | null; reason: string | null; at: string }>;
  stats: { received: number; viewed: number };
  canEdit: boolean; canSuspend: boolean; canResume: boolean;
}
const ACT: Record<string, string> = { SUBMIT: '검수 요청', APPROVE: '승인', REJECT: '반려', EDIT: '수정 · 재검수', SUSPEND: '노출 중단', RESUME: '노출 재개' };

/**
 * SB-PTC-CTR-201 서비스 상세 · 상세페이지 — v10.31 (W5 · 10/10 시안 기준 scPtnSvcDetail)
 *   요약(.dsum) → 「상세페이지 블록」 표(블록 · 상태 · 내용 — 채우기/고치기) → 안내 → 「서비스 수정 · 노출 중단 · 승인 · 반려 이력」 단추.
 *   매트릭스 견적 서비스면 견적 칸을 여기서 고칩니다. 처리 이력은 서버 기록(partner_service_events)입니다.
 */
export default async function ServiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const { id } = await params;
  const s = await apiGet<D>(`/partner/services/${encodeURIComponent(id)}`, 0).catch(() => null);
  if (!s) {
    return (
      <><Pgh title="서비스 상세" />
        <Empty>해당 서비스를 찾을 수 없습니다.</Empty>
        <div className="pt-dact"><Link className="pt-bo" href="/partner/services">목록으로</Link></div>
      <i hidden data-root-end="" /></>
    );
  }
  const st = s.status === 'SUSPENDED' && s.suspendedBy === 'PARTNER' ? ['보관(노출 중단)', 'off'] as const : SVC_ST[s.status] ?? [s.status, 'off'] as const;

  return (
    <><Pgh title="서비스 상세 · 상세페이지" sub="상세페이지는 블록을 쌓아 만듭니다." />
      <div className="pt-dsum">
        <div className="dr"><span>서비스</span><b>{s.title}</b></div>
        <div className="dr"><span>상태</span><b><Bg tone={st[1]}>{st[0]}</Bg></b></div>
        <div className="dr"><span>등록 방식</span><b>{s.formLabel ?? '간단 등록'}{s.categoryName ? ` · ${s.categoryName}` : ''}</b></div>
        <div className="dr"><span>서비스 ID</span><b className="pt-code">S-{s.id.slice(0, 8)}</b></div>
        <div className="dr"><span>주요 타겟</span><b>{s.target ?? '—'}</b></div>
        <div className="dr"><span>최고 확인비용</span><b>{s.topFee ? `${won(s.topFee)}원` : s.categoryFee ? `업종 기준 ${won(s.categoryFee)}원` : '—'}</b></div>
        <div className="dr"><span>소개비</span><b>{s.referralRate != null ? `성사 ${Math.round(s.referralRate * 1000) / 10}%` : '—'}{s.rebateBonus ? ` · 재소개 ${won(s.rebateBonus)}원` : ''}</b></div>
        <div className="dr"><span>받은 리드</span><b>{s.stats.received}건 (연락처 열람 {s.stats.viewed})</b></div>
        <div className="dr"><span>수정일</span><b>{ymdKst(s.updatedAt)}</b></div>
      </div>
      {s.status === 'REJECTED' && s.rejectReason && (
        <Note kind="warn"><b>반려 사유</b> — {s.rejectReason}<br />새로 등록하지 말고 「서비스 수정」으로 고쳐 다시 내십시오.</Note>
      )}

      <S2>상세페이지 블록</S2>
      <Tw head={['블록', '상태', '내용', '']}>
        {s.blocks.map((b) => (
          <tr key={b.kind} data-block-row={b.kind}>
            <td><b>{b.label}</b></td>
            <td>{b.filled ? <Bg tone="ok">등록됨</Bg> : <Bg tone="off">비어 있음</Bg>}</td>
            <td>{b.body ? <span style={{ whiteSpace: 'pre-wrap' }}>{b.body.length > 120 ? `${b.body.slice(0, 120)}…` : b.body}</span> : b.fileId ? '사진 1' : '—'}</td>
            <td><BlockEditor id={s.id} kind={b.kind} label={b.label} body={b.body} fileId={b.fileId} /></td>
          </tr>
        ))}
      </Tw>
      <Note kind="info"><b>상세페이지는 블록을 쌓아 만듭니다.</b> 블록 순서와 노출은 배포 없이 바뀝니다.</Note>
      <Note kind="warn"><b>노출 중인 서비스를 수정하면 재검수 대상이 되어 다시 검수중으로 내려갑니다</b> — 그동안 리드가 들어오지 않습니다. 확인비용 · 소개비만 바꾸면 그대로입니다.</Note>

      {s.formType === 'MATRIX' && (<>
        <S2>자동 견적 매트릭스</S2>
        <MatrixEditor id={s.id} rows={s.matrix.rows} cols={s.matrix.cols} cells={s.matrix.cells} />
      </>)}

      <ServiceActions id={s.id} title={s.title} body={s.body} target={s.target} receiveMode={s.receiveMode}
                      topFee={s.topFee} referralRate={s.referralRate} rebateBonus={s.rebateBonus}
                      baseFee={s.categoryFee != null ? Number(s.categoryFee) : null}
                      canEdit={s.canEdit} canSuspend={s.canSuspend} canResume={s.canResume} status={s.status} />

      <S2>처리 이력</S2>
      {s.events.length === 0 ? <Empty>이력이 없습니다.</Empty> : (
        <Tw head={['일자', '처리', '상태', '사유']}>
          {s.events.map((e, i) => (
            <tr key={i}><td>{ymdKst(e.at)}</td><td><b>{ACT[e.action] ?? e.action}</b></td>
              <td>{e.to ? (SVC_ST[e.to]?.[0] ?? e.to) : '—'}</td><td>{e.reason ?? '—'}</td></tr>
          ))}
        </Tw>
      )}
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/services">목록으로</Link>
        <Link className="pt-bo" href="/partner/regions">서비스 지역</Link>
        <Link className="pt-bp" href="/partner/reviews">승인 · 반려 이력</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
