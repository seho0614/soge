import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { FulfillConfirm } from '@/components/my/FulfillConfirm';

export const metadata: Metadata = { title: '이행 확인' };

interface Report { id: string; content: string | null; doneOn: string | null; state: string; rating: number | null; confirmedAt: string | null; reportedAt: string; company: string | null; summary: string | null }
const ST: Record<string, [string, string]> = { WAITING: ['확인 대기', 'wait'], CONFIRMED: ['확인함 · 성사', 'ok'], DISPUTED: ['이의 제기', 'no'] };

/**
 * v10.31 (W5 요청 · SHARED_NOTES 「소비자 쪽 — /my/fulfillments 화면 없음 → w3」) — 상담 신청에 업체가 보낸 이행 보고를 확인합니다.
 * GET /me/fulfillment-reports(W5 서버) — 확인하면 성사로 잡히고, 이의는 사유를 남깁니다. 이 화면은 알림 링크(/my/fulfillments)의 도착지입니다.
 */
export default async function FulfillmentsPage() {
  if (!(await me())) redirect('/login?next=/my/fulfillments');
  const rows = await apiGetPersonal<Report[]>('/me/fulfillment-reports').catch(() => [] as Report[]);
  return (
    <><div data-my-fulfill="">
      <MyHead title="이행 확인" sub="상담을 맡은 업체가 일을 마쳤다고 보고한 건입니다. 확인하시면 성사로 잡히고, 다르면 이의를 남기실 수 있습니다." />
      {rows.length === 0 ? <Empty>확인할 이행 보고가 없습니다.</Empty> : (
        <div className="my-reqs">
          {rows.map((r) => {
            const st = ST[r.state] ?? [r.state, 'off'];
            return (
              <div key={r.id} className={`my-req${r.state === 'WAITING' ? '' : ' done'}`} data-fulfill-row={r.id}>
                <div className="my-rh"><b>{r.company ?? '업체'}{r.summary ? ` · ${r.summary}` : ''}</b><span className={`my-bg ${st[1]}`}>{st[0]}</span></div>
                <p className="my-ls">보고 {ymdKst(r.reportedAt)}{r.doneOn ? ` · 완료일 ${ymdKst(r.doneOn)}` : ''}{r.confirmedAt ? ` · 확인 ${ymdKst(r.confirmedAt)}` : ''}{r.rating ? ` · ${r.rating}점` : ''}</p>
                {r.content && <p>{r.content}</p>}
                {r.state === 'WAITING' && <FulfillConfirm id={r.id} />}
              </div>
            );
          })}
        </div>
      )}
      <Note kind="info"><b>소개뱅크는 이 거래의 당사자가 아닙니다.</b> 이행 확인은 업체의 성과 기록에 쓰이고, 대금은 당사자끼리 주고받습니다.</Note>
    </div><i hidden data-root-end="" /></>
  );
}
