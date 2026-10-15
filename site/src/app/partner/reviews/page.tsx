import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, Tw, type Tone } from '@/components/partner/ui';

export const metadata: Metadata = { title: '승인 · 반려 이력' };

interface Row {
  id: string; title: string; status: string;
  rejectReason: string | null; createdAt: string; categoryName: string | null;
}

const LABEL: Record<string, [string, Tone]> = {
  DRAFT: ['작성 중', 'wait'], IN_REVIEW: ['검수 중', 'wait'], APPROVED: ['승인', 'ok'],
  REJECTED: ['반려', 'no'], SUSPENDED: ['중지', 'no'],
};

/**
 * SB-PTC-CTR-250 승인 · 반려 이력 — v10.29 시안 scPtnRev 표(서비스 · 이름 · 요청일 · 결과 · 이후)
 *
 * 반려에는 **반드시 사유가 있습니다**(DB 가 강제합니다).
 * 무엇을 고쳐야 다시 올릴 수 있는지 모르면 같은 것을 또 올리게 됩니다.
 * 시안의 「본사 검수 화면 보기」(BO 로 가는 단추)는 파트너 화면에 두지 않았습니다(diffs).
 */
export default async function ReviewsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<Row[]>('/partner/reviews', 0).catch(() => []);

  return (
    <><Pgh title="승인 · 반려 이력" sub={<>검수 결과와 재제출 경로입니다. <b>반려된 건은 사유를 고쳐 다시 올리시면</b> 됩니다.</>} />

      {rows.length === 0 ? (
        <Empty>아직 검수 이력이 없습니다. 서비스를 등록하시면 여기에 쌓입니다.</Empty>
      ) : (
        <Tw head={['서비스', '이름', '요청일', '결과', '이후']}>
          {rows.map((r) => {
            const st = LABEL[r.status] ?? [r.status, 'off' as Tone];
            return (
              <tr key={r.id}>
                <td><b className="pt-code">{r.categoryName ?? '—'}</b></td>
                <td><b>{r.title}</b></td>
                <td>{ymdKst(r.createdAt)}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td className="reason">
                  {r.status === 'REJECTED'
                    ? <>{r.rejectReason ?? '—'} <Link className="pt-bo sm" href={`/partner/services/${encodeURIComponent(r.id)}`}>고쳐 내기</Link></>
                    : r.status === 'IN_REVIEW' ? <span className="pt-ls">대기</span> : r.status === 'APPROVED' ? '노출중' : '—'}
                </td>
              </tr>
            );
          })}
        </Tw>
      )}

      <Note kind="info"><b>반려되면 새로 등록하지 말고 그 건을 고쳐서 내십시오.</b> 새로 내면 검수 큐에 두 번 쌓여 결과가 늦어집니다.</Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">내 서비스로</Link></div>
    <i hidden data-root-end="" /></>
  );
}
