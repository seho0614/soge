import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { uiMessages } from '@/lib/content';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, Empty, Table, shortId } from '@/components/my/ui';
import { TaxInvoiceButton } from '@/components/my/TaxInvoiceButton';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('stlHist.title') };
}

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
  const t = await getTranslations('myDeal');
  const f = await getFmt();

  const rows = await apiGet<Settlement[]>('/me/settlements/history', 0).catch(() => [] as Settlement[]);
  const paid = rows.filter((r) => r.status === 'PAID');
  const total = paid.reduce((a, r) => a + Number(r.amount || 0), 0);

  return (
    <>
      <MyHead title={t('stlHist.title')} sub={t('stlHist.sub')}
        right={<span className="my-ls">{t('stlHist.paidN', { n: String(paid.length) })}</span>} />
      {rows.length === 0 ? (
        <Empty>{t('stlHist.empty')}</Empty>
      ) : (
        <Table head={[t('stl.cols.no'), t('stlHist.cols.deal'), t('stlHist.cols.code'), t('stl.cols.fee'), t('stlHist.cols.vat'), t('stl.cols.paid'), t('stlHist.cols.tax'), t('stlHist.cols.statePayee')]}>
          {rows.map((r) => (
            <tr key={r.id} data-stl-hist={r.id}>
              <td>{shortId(r.id, 'S-')}</td>
              <td><b>{r.title ?? t('form.dealDefault')}</b>{r.dealId && <><br /><span className="my-ls">{shortId(r.dealId, 'D-')}</span></>}</td>
              <td>{r.attributedCode ? <span className="my-code">{r.attributedCode}</span> : '—'}</td>
              <td><b>{f.won(r.amount, '—')}</b></td>
              <td>{r.vat != null ? f.won(r.vat, '—') : '—'}</td>
              <td>{r.paidAt ? ymdKst(r.paidAt) : '—'}</td>
              <td>{r.payee !== 'BUSINESS' ? <span className="my-ls">{t('stlHist.na')}</span>
                : r.taxInvoiceIssuedAt ? <span className="my-bg ok" title={r.taxInvoiceNo ?? ''}>{t('stlHist.issued')}</span>
                : r.status === 'PAID' ? <TaxInvoiceButton id={r.id} /> : <span className="my-ls">{t('stlHist.afterPay')}</span>}</td>
              <td><span className={`my-bg ${r.status === 'PAID' ? 'ok' : 'no'}`}>{r.statusLabel ?? r.status}</span>{' '}
                <span className="my-ls">{r.payee === 'PERSON' ? t('stlHist.person') : r.payee === 'BUSINESS' ? t('stlHist.biz') : ''}</span></td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="ok">{t.rich('stlHist.total', { total: f.won(total, '—'), msg: messages.NO_DEDUCTION ?? '', b: (c) => <b>{c}</b> })}</Note>
    </>
  );
}
