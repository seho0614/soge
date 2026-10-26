import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';
import { SettlementAccountForm } from '@/components/partners/SettlementAccountForm';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.settle'))('metaTitle') };
}

interface S {
  unpaid: string; billed: string; voided: string; unpaidCount: number; unpaidCap: number;
  months: Array<{ month: string; leads: number; amount: string }>;
  payouts: Array<{ id: string; track: string; from: string; to: string; month: string; gross: number; withholding: number; net: number; state: string; paidAt: string | null; deals: number }>;
  account: { bankName: string; last4: string; holderName: string; verifiedAt: string | null; verifyStub: boolean } | null;
  /* v10.34 (D093) — 운영 법인이 발행하는 두 가지(리드 이용료 · 노출료)는 국세청 전송 상태 · 승인번호 */
  invoices: Array<{ kind: string; invoiceNo: string | null; issuedOn: string | null; total: number; supply: number | null; vat: number | null; state: string; month: string; etaxStatus?: string | null; approvalNo?: string | null }>;
  payoutDay: number; note: string;
}
/* 상태 · 구분 글자는 사전 partnerOps.settle.st.<코드> · track.<코드> · inv.<키> (v10.100 · 2-5a) */
const ST: Record<string, Tone> = { DRAFT: 'wait', CONFIRMED: 'wait', PAID: 'ok', CARRIED: 'off' };
/** v10.34 — 세금계산서 상태(사실 그대로) — 간주면 「전송 대기 — 연동 전」 · 글자는 사전 settle.inv.<키> */
const invSt = (i: S['invoices'][number]): ['sent' | 'assumed' | 'canceled' | 'sending' | 'issued' | 'requested', Tone] => i.etaxStatus === 'SENT' ? ['sent', 'ok']
  : i.etaxStatus === 'ASSUMED' ? ['assumed', 'wait']
  : i.etaxStatus === 'CANCELED' ? ['canceled', 'off']
  : i.etaxStatus === 'SENDING' || i.etaxStatus === 'FAILED' ? ['sending', 'wait']
  : i.state === 'ISSUED' ? ['issued', 'ok'] : ['requested', 'wait'];
const nextPay = (to: string, day: number) => { const [y, m] = to.split('-').map(Number); const d = new Date(Date.UTC(y ?? 1970, m ?? 0, day)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

/**
 * SB-PTC-CTR-410 정산 — v10.31 (W5 · 10/10 시안 기준 scPtnStl) 「성사된 소개의 정산 내역과 수령 계좌」
 *   정산 표(정산월 · 성사 · 금액 · 상태 · 지급일) → 정산 수령 계좌(인증) → 안내 → 세금계산서.
 *   ★ 정산 대상(정책 차이 — 결정 기록): 전에는 리드 이용료 청구 내역이었습니다. 이제 시안대로 **회사가 지급하는 정산**(partner_settlements ·
 *     지급 데스크 두 사람 확인)과 그 기간의 성사 건수입니다. 리드 이용료는 「리드 이용료」(선불 충전)에서 봅니다.
 *   소개비는 여기 없습니다 — 당사자끼리 직접(INV-9R). v10.38 (D096 · P2P) — 정산은 본인인증 개인도 봅니다(원천징수 3.3% · 세금계산서 대신 영수증).
 */
export default async function SettlementPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partnerOps.settle');
  const f = await getFmt();
  const code = (g: 'st' | 'track', c: string) => (t.has(`${g}.${c}` as never) ? t(`${g}.${c}` as never) : c);
  if (!p.identityVerifiedAt && !p.businessVerifiedAt) {
    return (
      <><Pgh title={t('title')} />
        <Note kind="warn">{t.rich('needId', { b: (c) => <b>{c}</b> })}</Note>
        <div className="pt-dact"><Link className="pt-bp" href="/verify">{t('goVerify')}</Link></div>
      <i hidden data-root-end="" /></>
    );
  }
  const s = await apiGet<S>('/partner/settlement', 0).catch(() => null);
  if (!s) return <><Pgh title={t('title')} /><Empty>{t('notPartner')}</Empty><i hidden data-root-end="" /></>;
  const acc = s.account;

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {s.payouts.length === 0 ? <Empty>{t('empty', { day: String(s.payoutDay) })}</Empty> : (
        <Tw head={[t('th.month'), t('th.deals'), t('th.amount'), t('th.state'), t('th.paidOn')]} numCols={[2]}>
          {s.payouts.map((r) => {
            const st: [string, Tone] = [code('st', r.state), ST[r.state] ?? 'off'];
            return (
              <tr key={r.id}>
                <td><b>{r.month}</b><div className="pt-ls">{ymdKst(r.from)} ~ {ymdKst(r.to)} · {code('track', r.track)}</div></td>
                <td>{t('dealsN', { n: String(r.deals) })}</td>
                <td className="num"><b>{f.wonOf(won(r.net))}</b><div className="pt-ls">{t('grossLine', { g: f.ko ? won(r.gross) : f.wonOf(won(r.gross)), w: f.ko ? won(r.withholding) : f.wonOf(won(r.withholding)) })}</div></td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td>{r.paidAt ? ymdKst(r.paidAt) : t('scheduled', { d: nextPay(r.to, s.payoutDay) })}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      <div className="pt-bank" data-ptn-bank>
        <span>{t('account')}</span>
        {acc ? <><b>{acc.bankName} ****{acc.last4} · {acc.holderName}</b>{acc.verifiedAt ? <Bg tone="ok">{t('verified')}</Bg> : <Bg tone="wait">{t('pending')}</Bg>}{acc.verifyStub ? <span className="pt-ls">{t('stub')}</span> : null}</>
          : <b>{t('noAccount')}</b>}
      </div>
      <Note kind="info"><b>{f.srv(s.note, t('noteSrv'))}</b> {t('accNote')}</Note>
      <details className="pt-fset" style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{acc ? t('accChange') : t('accAdd')}</summary>
        <div style={{ marginTop: 12 }}><SettlementAccountForm hasAccount={!!acc} identityVerified={!!p.identityVerifiedAt} account={acc ?? undefined} /></div>
      </details>

      <S2>{t('invH')}</S2>
      {s.invoices.length === 0 ? <Empty>{t('invEmpty')}</Empty> : (
        <Tw head={[t('ith.month'), t('ith.kind'), t('ith.supply'), t('ith.vat'), t('ith.total'), t('ith.state'), t('ith.no')]} numCols={[2, 3, 4]}>
          {s.invoices.map((i, k) => (
            <tr key={k}>
              <td>{i.month}</td><td>{i.kind === 'LEAD_CASH' ? t('kind.leadCash') : i.kind === 'DIRECTORY' ? t('kind.directory') /* v10.33 */ : t('kind.payout')}</td>
              <td className="num">{i.supply != null ? f.wonOf(won(i.supply)) : '—'}</td><td className="num">{i.vat != null ? f.wonOf(won(i.vat)) : '—'}</td>
              <td className="num"><b>{f.wonOf(won(i.total))}</b></td>
              <td><Bg tone={invSt(i)[1]}>{t(`inv.${invSt(i)[0]}`)}</Bg></td>
              <td>{i.invoiceNo ? <><span className="pt-code">{i.invoiceNo}</span> · {ymdKst(i.issuedOn)}</> : '—'}</td>
            </tr>
          ))}
        </Tw>
      )}
      <Note kind="warn">{t.rich('etaxNote', { b: (c) => <b>{c}</b> })}</Note>
      {(Number(s.unpaid) > 0 || s.unpaidCount > 0) && (
        <Note kind="plain">{t.rich('unpaidNote', { amt: f.wonOf(won(s.unpaid)), n: String(s.unpaidCount), b: (c) => <b>{c}</b> })}</Note>
      )}
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/cash">{t('kind.leadCash')}</Link>
        <Link className="pt-bo" href="/partners/settlements">{t('affLink')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
