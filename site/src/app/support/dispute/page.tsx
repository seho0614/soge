import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { DisputeForm } from '@/components/DisputeForm';
import { MyFrame } from '@/components/my/MyFrame';
import { Msgs } from '@/i18n/Msgs';   // v10.99 — 나의공간 왼쪽 메뉴(MyShell)가 쓰는 사전 묶음(docs/157)
import { MyHead, Note, Empty, Table, Badge, shortId, type Tone } from '@/components/my/ui';
import { codeList, uiMessages } from '@/lib/content';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('dispute') };
}

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
  const t = await getTranslations('deal.dispute');

  return (
    <><Msgs ns={['my', 'myDeal', 'order', 'deal']}><MyFrame active="mydeal">{/* v10.32 (추가) — 시안 myShell("mydeal"): 왼쪽 메뉴 「소개 내역」 켜짐 */}
      <MyHead title={t('pageTitle')}
        sub={<>{t.rich('pageSub', { b: (x) => <b>{x}</b> })}</>} />
      <DisputeForm deals={deals.map((d) => ({ id: d.id, label: d.title ?? d.id.slice(0, 8) }))}
        reasons={reasons} />

      <h2 className="my-st2">{t('status')}</h2>
      {mine.length === 0 ? (
        <Empty data-dispute-empty="">{t('empty')}</Empty>
      ) : (
        <Table head={[t('head.no'), t('head.deal'), t('head.type'), t('head.state'), t('head.opened')]}>
          {mine.map((d) => (
            <tr key={d.id} data-dispute-row={d.id}>
              <td>{shortId(d.id, 'D-')}</td>
              <td>{d.dealTitle ?? shortId(d.dealId)}</td>
              <td>{d.reasonLabel ?? d.reasonCode}{(d.evidenceCount ?? 0) > 0 && <div className="my-ls">{t('evidence', { n: String(d.evidenceCount) })}</div>}</td>
              <td><Badge tone={TONE[d.status] ?? 'off'}>{d.statusLabel}</Badge>{d.resolution && <div className="my-ls">{d.resolution}</div>}</td>
              <td>{ymdKst(d.openedAt).slice(5)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="warn" data-msg="DISPUTE_HOLD"><b>{msg.DISPUTE_HOLD ?? t('holdDefault')}</b> {t('holdTail')}</Note>
      <Note kind="info">{t.rich('outside', { b: (x) => <b>{x}</b> })}</Note>
    </MyFrame></Msgs><i hidden data-root-end="" /></>
  );
}
