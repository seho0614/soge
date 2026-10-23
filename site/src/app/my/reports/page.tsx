import type { Metadata } from 'next';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';

export const metadata: Metadata = { title: '내 신고 내역' };

interface R {
  id: string; state: string; reasonCode: string; reasonLabel?: string;
  targetType: string; resolution?: string; createdAt: string; handledAt?: string;
}

const ST: Record<string, [string, string]> = {
  OPEN: ['접수됨', 'wait'], QUEUED: ['확인 중', 'wait'], UPHELD: ['인정됨', 'ok'], DISMISSED: ['기각됨', 'no'],
};
const TT: Record<string, string> = {
  LISTING: '등록글', REQUEST: '요청글', SERVICE: '서비스', PROFILE: '프로필',
  POST: '소개광장 글', COMMENT: '소개광장 댓글',   // v10.80 — 전에는 글도 영어 코드로 보였음
};

/**
 * SB-MYP-RPT-010 내 신고 내역
 *
 * 처리했는지 안 했는지 모르면 같은 건을 또 올립니다. **기각도 사유와 함께 보여 줍니다.**
 * v10.29 — 시안(scMyRpt) 배치: 머리 설명에 확인 중 건수 → 표(대상 · 사유 · 상태 · 처리 내용 · 신고) → 안내.
 */
export default async function MyReportsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<R[]>('/me/reports', 0).catch(() => [] as R[]);
  const open = rows.filter((r) => r.state === 'OPEN' || r.state === 'QUEUED').length;

  return (
    <>
      <MyHead title="내 신고 내역"
        sub={open > 0 ? `확인 중인 신고가 ${open}건 있습니다. 처리되면 알림으로 알려 드립니다.` : '처리 중인 신고가 없습니다. 신고하신 건은 처리되면 알림으로 알려 드립니다.'} />
      {rows.length === 0 ? (
        <Empty>아직 신고하신 건이 없습니다. 잘못된 글을 보시면 그 글의 「신고」로 알려 주십시오.</Empty>
      ) : (
        <Table head={['대상', '사유', '상태', '처리 내용', '신고']}>
          {rows.map((r) => {
            const st = ST[r.state] ?? [r.state, 'off'];
            return (
              <tr key={r.id}>
                <td>{TT[r.targetType] ?? r.targetType}</td>
                <td><b>{r.reasonLabel ?? r.reasonCode}</b></td>
                <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
                <td>{r.resolution ?? '—'}</td>
                <td>{ymdKst(r.createdAt)}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Note kind="info"><b>기각된 건도 사유를 적어 드립니다.</b> 왜 아닌지 아셔야 다음에 제대로 신고하실 수 있습니다.</Note>
    </>
  );
}
