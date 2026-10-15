import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { uiMessages } from '@/lib/content';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, Empty, Table, wonP, shortId } from '@/components/my/ui';
import { TaxInvoiceButton } from '@/components/my/TaxInvoiceButton';

export const metadata: Metadata = { title: '지급 내역 · 세금계산서' };

interface Settlement {
  id: string; dealId?: string; amount: number; status: string; statusLabel?: string;
  requestedAt: string; paidAt: string | null; payee?: 'BUSINESS' | 'PERSON';
  /* v10.31 — 소개 건 이름 · 소개코드 · 부가세(사업자 수령만) · 세금계산서 발행 표시 */
  title?: string | null; attributedCode?: string | null; vat?: number | null;
  taxInvoiceIssuedAt?: string | null; taxInvoiceNo?: string | null;
}

/**
 * SB-MYP-STL-020
 * v10.29 — 시안(scMyPay) 배치: 표(정산번호 · 소개 건 · 소개비 · 상태 · 지급일 · 받는 방식) + 누적 지급 · 공제 0원 안내.
 *   v10.31 — 시안 표 그대로 정산번호 · 소개 건 · 소개코드 · 소개비 · 부가세 · 지급일 · 세금계산서(발행 완료 / 「미발행」 단추 — 발행 표시)를 그리고,
 *   개발에만 있던 상태 · 받는 방식은 뒤 칸에 남깁니다. 개인으로 받은 소개비는 세금계산서 대상이 아니라 「해당 없음」.
 */
export default async function SettlementHistoryPage() {
  const p = await me();
  const messages = await uiMessages();
  if (!p) redirect('/login');
  /* v10.28 — 본인인증 회원(개인 · 사업자) 모두 소개비를 받습니다(INV-10R). 전: 사업자만 */
  if (!p.identityVerifiedAt) redirect('/verify');

  const rows = await apiGet<Settlement[]>('/me/settlements/history', 0).catch(() => [] as Settlement[]);
  const paid = rows.filter((r) => r.status === 'PAID');
  const total = paid.reduce((a, r) => a + Number(r.amount || 0), 0);

  return (
    <>
      <MyHead title="지급 내역 · 세금계산서" sub="지급된 소개비와 처리 상태입니다. 세금계산서는 소개자가 직접 발행합니다 — 플랫폼이 대신 발행하지 않습니다."
        right={<span className="my-ls">지급 {paid.length}건</span>} />
      {rows.length === 0 ? (
        <Empty>지급 내역이 없습니다. 정산이 지급되면 여기에 쌓입니다.</Empty>
      ) : (
        <Table head={['정산번호', '소개 건', '소개코드', '소개비', '부가세', '지급일', '세금계산서', '상태 · 받는 방식']}>
          {rows.map((r) => (
            <tr key={r.id} data-stl-hist={r.id}>
              <td>{shortId(r.id, 'S-')}</td>
              <td><b>{r.title ?? '소개 건'}</b>{r.dealId && <><br /><span className="my-ls">{shortId(r.dealId, 'D-')}</span></>}</td>
              <td>{r.attributedCode ? <span className="my-code">{r.attributedCode}</span> : '—'}</td>
              <td><b>{wonP(r.amount)}</b></td>
              <td>{r.vat != null ? wonP(r.vat) : '—'}</td>
              <td>{r.paidAt ? ymdKst(r.paidAt) : '—'}</td>
              <td>{r.payee !== 'BUSINESS' ? <span className="my-ls">해당 없음(개인)</span>
                : r.taxInvoiceIssuedAt ? <span className="my-bg ok" title={r.taxInvoiceNo ?? ''}>발행 완료</span>
                : r.status === 'PAID' ? <TaxInvoiceButton id={r.id} /> : <span className="my-ls">지급 후</span>}</td>
              <td><span className={`my-bg ${r.status === 'PAID' ? 'ok' : 'no'}`}>{r.statusLabel ?? r.status}</span>{' '}
                <span className="my-ls">{r.payee === 'PERSON' ? '개인' : r.payee === 'BUSINESS' ? '사업자' : ''}</span></td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="ok">누적 지급 <b>{wonP(total)}</b> · 공제 <b>0원</b> — {messages.NO_DEDUCTION}</Note>
    </>
  );
}
