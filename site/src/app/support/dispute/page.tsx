import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { DisputeForm } from '@/components/DisputeForm';
import { MyFrame } from '@/components/my/MyFrame';
import { MyHead, Note, Empty, Table, Badge, shortId, type Tone } from '@/components/my/ui';
import { codeList, uiMessages } from '@/lib/content';

export const metadata: Metadata = { title: '분쟁 접수 · 처리 현황' };

interface Deal { id: string; title?: string; status: string; statusLabel?: string; agreedFee: number | null }
interface MyDispute {
  id: string; dealId: string; dealTitle: string | null; reasonCode: string; reasonLabel?: string;
  status: string; statusLabel: string; resolution: string | null; openedAt: string; closedAt: string | null;
  evidenceCount?: number;
}

/** 상태 색 — 시안 badge(): 접수됨 회색 · 검토 중 노랑 · 처리 완료 초록 · 기각 빨강 */
const TONE: Record<string, Tone> = { OPEN: 'off', IN_REVIEW: 'wait', RESOLVED: 'ok', REJECTED: 'no' };

/**
 * SB-HOM-ETC-010 분쟁 접수 · 처리 현황
 *
 * v10.32 — 시안(scDspU · myShell("mydeal")) 그대로: 나의공간 옆 메뉴(「소개 내역」 켜짐) · 화면 머리 →
 *   「분쟁 접수」 카드(거래 · 유형 칩 · 내용 · [증빙 붙이기] [분쟁 접수]) → 「처리 현황」 표(접수 번호 · 거래 · 유형 · 상태 · 접수)
 *   → 정산 멈춤 안내(warn) → 외부 조정 안내(info).
 * 유형 칩은 서버의 분쟁 사유 코드(code_labels dispute.reason)입니다 — 보내는 값(reasonCode)은 그대로.
 * 처리 현황은 GET /me/disputes(내가 접수한 것만)의 실제 자료입니다. 없으면 시안 모양의 빈 상태.
 */
export default async function DisputePage() {
  const p = await me();
  if (!p) redirect('/login');
  const [deals, reasons, msg, mine] = await Promise.all([
    apiGet<Deal[]>('/me/deals', 0).catch(() => [] as Deal[]),
    codeList('dispute.reason'),
    uiMessages(),
    apiGet<MyDispute[]>('/me/disputes', 0).catch(() => [] as MyDispute[]),
  ]);

  return (
    <><MyFrame active="mydeal">{/* v10.32 (추가) — 시안 myShell("mydeal"): 왼쪽 메뉴 「소개 내역」 켜짐 */}
      <MyHead title="분쟁 접수 · 처리 현황"
        sub={<>거래 상대와 풀리지 않는 일을 접수합니다. 소개뱅크는 거래 당사자가 아니라 <b>기록과 절차</b>를 돕습니다 — 대금은 당사자끼리 주고받습니다.</>} />
      <DisputeForm deals={deals.map((d) => ({ id: d.id, label: d.title ?? d.id.slice(0, 8) }))}
        reasons={reasons} />

      <h2 className="my-st2">처리 현황</h2>
      {mine.length === 0 ? (
        <Empty data-dispute-empty="">접수한 분쟁이 없습니다. 접수하시면 이 표에서 처리 상태를 보실 수 있습니다.</Empty>
      ) : (
        <Table head={['접수 번호', '거래', '유형', '상태', '접수']}>
          {mine.map((d) => (
            <tr key={d.id} data-dispute-row={d.id}>
              <td>{shortId(d.id, 'D-')}</td>
              <td>{d.dealTitle ?? shortId(d.dealId)}</td>
              <td>{d.reasonLabel ?? d.reasonCode}{(d.evidenceCount ?? 0) > 0 && <div className="my-ls">증빙 {d.evidenceCount}건</div>}</td>
              <td><Badge tone={TONE[d.status] ?? 'off'}>{d.statusLabel}</Badge>{d.resolution && <div className="my-ls">{d.resolution}</div>}</td>
              <td>{ymdKst(d.openedAt).slice(5)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="warn" data-msg="DISPUTE_HOLD"><b>{msg.DISPUTE_HOLD ?? '분쟁이 접수된 거래는 정산이 자동으로 보류됩니다.'}</b> 처리가 끝나면(처리 완료 · 기각) 보류가 풀립니다.</Note>
      <Note kind="info"><b>합의가 안 되면</b> 꼬리줄 「분쟁조정 안내」의 외부 조정 기관으로 이어 드립니다. 소개뱅크가 누가 옳은지 판정하지 않습니다.</Note>
    </MyFrame><i hidden data-root-end="" /></>
  );
}
