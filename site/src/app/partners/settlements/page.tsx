import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { SettlementAccountForm } from '@/components/partners/SettlementAccountForm';
import { krw, ymd, SETTLE_STATE, codeText } from '@/components/partners/fmt';
import type { AffSettlements } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('settlements.title') };
}

/**
 * SB-AFC-STL-010 정산내역
 *
 * GET /partner/affiliate/settlements · POST /partner/affiliate/settlement-account
 * · POST /partner/affiliate/settlement-account/verify/request · POST /partner/affiliate/settlement-account/verify (D001 1원 인증)
 * ★ 계좌 등록은 본인인증(IDENTITY_VERIFIED) 뒤에만 됩니다 — 403 IDENTITY_REQUIRED 면 /verify 로.
 * ★ 원천징수 3.3% 는 사업소득세입니다. 실지급액과 함께 적어 둡니다.
 */
export default async function PartnerSettlementsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const d = await apiGetPersonal<AffSettlements>('/partner/affiliate/settlements').catch(() => null);
  const acc = d?.account ?? null;

  return (
    <>
      <div className="page-head"><h1>{t('settlements.title')}</h1></div>
      <p className="lead">{t('settlements.lead')}</p>

      {d?.note && <div className="notice warn"><b>{d.note}</b> {acc ? <>{t('settlements.verifyBelow')}</> : null}</div>}

      {d === null ? (
        <p className="form-error" role="alert">{t('settlements.loadFail')}</p>
      ) : d.items.length === 0 ? (
        <p className="empty">{t('settlements.empty')}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>{t('settlements.colPeriod')}</th><th>{t('common.colTrack')}</th><th className="num">{t('settlements.colGross')}</th><th className="num">{t('settlements.colWithholding')}</th><th className="num">{t('settlements.colNet')}</th><th>{t('common.colState')}</th><th>{t('settlements.colPaidAt')}</th></tr></thead>
          <tbody>
            {d.items.map((s) => (
              <tr key={s.id}>
                <td>{ymd(s.from)} ~ {ymd(s.to)}</td>
                <td>{codeText(t, 'track', s.track)}</td>
                <td className="num">{krw(s.gross)}</td>
                <td className="num">{krw(s.withholding)}</td>
                <td className="num"><b>{krw(s.net)}</b></td>
                <td><span className={'state ' + (SETTLE_STATE[s.state]?.c ?? '')}>{codeText(t, 'settleState', s.state)}</span></td>
                <td>{ymd(s.paidAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="notice">{t.rich('settlements.taxNote', { b: (c) => <b>{c}</b> })}</div>

      <h2 className="sec-title p2gap">{t('settlements.accountTitle')}</h2>
      {acc ? (
        <table className="tbl">
          <tbody>
            <tr><th>{t('settlements.bank')}</th><td>{acc.bankName} <span className="dim">{t('settlements.last4', { last4: acc.last4 })}</span></td></tr>
            <tr><th>{t('settlements.holder')}</th><td>{acc.holderName}</td></tr>
            <tr><th>{t('common.colState')}</th><td data-testid="account-state">{acc.verifiedAt
              ? <><span className="state state-published">{t('settlements.verified')}</span> <span className="dim">{ymd(acc.verifiedAt)}</span></>
              : acc.verifyLocked
                ? <span className="state state-rejected">{t('settlements.locked')}</span>
                : acc.verifyPending
                  ? <span className="state state-in_review">{t('settlements.pending')}</span>
                  : <span className="state state-in_review">{t('settlements.notVerified')}</span>}</td></tr>
          </tbody>
        </table>
      ) : <p className="empty">{t('settlements.noAccount')}</p>}
      <SettlementAccountForm hasAccount={!!acc} identityVerified={!!p.identityVerifiedAt} account={acc} />
    </>
  );
}
