import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Empty, Table, shortId } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my'))('settleAll.title') };
}

type Sum = { status: string; n: number; amount: number };
interface Summary {
  intro: { sums: Sum[]; paid: number; waiting: number; items: Array<{ id: string; dealId: string; amount: number; status: string; requestedAt: string; paidAt: string | null; held: boolean }> };
  points: { total: number; redeemable: number; byRule: Array<{ code: string; name: string | null; n: number; points: number }>;
    ledger: Array<{ code: string; points: number; memo: string | null; at: string }>;
    cashout: { sums: Sum[]; paid: number; items: Array<{ id: string; points: number; netAmount: number; status: string; requestedAt: string; paidAt: string | null }> } };
  affiliate: { paid: number; items: Array<{ id: string; track: string; from: string; to: string; gross: number; withholding: number; net: number; state: string; paidAt: string | null }> } | null;
  referral: { points: number; got: number; wait: number; none: number; items: Array<{ name: string | null; joined: string; state: 'GOT' | 'WAIT' | 'NONE'; points: number; at: string | null }> };
  seller: { paid: number; items: Array<{ id: string; seller: string; from: string; to: string; gross: number; commission: number; refund: number; net: number; status: string; paidAt: string | null }> } | null;
}

/**
 * SB-MYP-STL-030 나의공간 › 돈 · 정산 › 정산 내역 › 한눈에 — v10.255 (docs/388)
 *   대표 「정산내역 보기 추가」(11/12 · 내 것만) — GET /me/settlement-summary 하나로 소개비 정산 · 포인트(적립 · 출금) · 제휴 파트너 정산 · 소개몰 판매자 정산.
 *   보기만 — 신청 · 계좌 · 지급 표시는 각 화면(소개비 정산 · 활동 · 포인트 출금 · 파트너센터 정산 · 소개몰 판매자)에서 합니다.
 *   다른 회원(추천한 분 · 추천받은 분)의 금액은 없음(partner-affiliate #7).
 *   v10.258 (docs/390) — 「추천 보상」 칸 · 표: 내가 직접 추천한 분별로 **내가 받은** 포인트(받음 · 기다림 · 없음 · 1단계만).
 */
export default async function SettlementAllPage() {
  const p = await me();
  if (!p) redirect('/login?next=/my/settlement/all');
  const t = await getTranslations('my.settleAll');
  const f = await getFmt();
  const s = await apiGetPersonal<Summary>('/me/settlement-summary').catch(() => null);
  const kst = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10) : '');
  const day = (iso: string | null) => (iso ? f.ymd(iso, kst(iso)) : '—');
  const st = (k: string) => (t.has(`st.${k}` as never) ? t(`st.${k}` as never) : k);

  if (!s) return <><MyHead title={t('title')} /><p className="form-error" role="alert">{t('loadFail')}</p></>;
  return (
    <div data-screen="SB-MYP-STL-030" data-settle-all="">
      <MyHead title={t('title')} sub={t('lead')} />
      <div className="my-tiles" data-settle-tiles="">
        <div className="my-tile" data-settle-tile="intro"><b>{f.won(s.intro.paid)}</b><span className="my-tl">{t('tIntroPaid')}</span><span className="my-tu">{t('tWaiting', { v: f.won(s.intro.waiting) })}</span></div>
        <div className="my-tile" data-settle-tile="points"><b>{f.num(s.points.total)}P</b><span className="my-tl">{t('tPoints')}</span><span className="my-tu">{t('tRedeemable', { v: f.num(s.points.redeemable) })}</span></div>
        <div className="my-tile" data-settle-tile="cashout"><b>{f.won(s.points.cashout.paid)}</b><span className="my-tl">{t('tCashout')}</span></div>
        <div className="my-tile" data-settle-tile="referral"><b>{f.num(s.referral.points)}P</b><span className="my-tl">{t('tReferral')}</span><span className="my-tu">{t('tReferralSub', { a: s.referral.got, b: s.referral.wait })}</span></div>
        {s.affiliate && <div className="my-tile" data-settle-tile="affiliate"><b>{f.won(s.affiliate.paid)}</b><span className="my-tl">{t('tAffiliate')}</span></div>}
        {s.seller && <div className="my-tile" data-settle-tile="seller"><b>{f.won(s.seller.paid)}</b><span className="my-tl">{t('tSeller')}</span></div>}
      </div>

      <h2 className="my-s2">{t('hIntro')} <Link className="dim" href="/my/settlement">{t('goIntro')}</Link></h2>
      {s.intro.items.length === 0 ? <Empty data-settle-empty="intro">{t('emptyIntro')}</Empty> : (
        <Table head={[t('cNo'), t('cAmount'), t('cState'), t('cAsked'), t('cPaid')]}>
          {s.intro.items.map((x) => (
            <tr key={x.id} data-settle-row="intro"><td className="mono">{shortId(x.dealId)}</td><td>{f.won(x.amount)}</td>
              <td>{st(x.status)}{x.held ? ` · ${t('held')}` : ''}</td><td>{day(x.requestedAt)}</td><td>{day(x.paidAt)}</td></tr>
          ))}
        </Table>
      )}

      <h2 className="my-s2">{t('hPoints')} <Link className="dim" href="/my/intro/activity">{t('goPoints')}</Link></h2>
      {s.points.byRule.length === 0 ? <Empty data-settle-empty="points">{t('emptyPoints')}</Empty> : (
        <Table head={[t('cRule'), t('cCount'), t('cPoints')]}>
          {s.points.byRule.map((r) => <tr key={r.code} data-settle-row="rule"><td>{f.srv(r.name, r.code)}</td><td>{f.num(r.n)}</td><td>{f.num(r.points)}P</td></tr>)}
        </Table>
      )}
      {s.points.cashout.items.length > 0 && (
        <Table head={[t('cAsked'), t('cPoints'), t('cNet'), t('cState'), t('cPaid')]}>
          {s.points.cashout.items.map((x) => (
            <tr key={x.id} data-settle-row="cashout"><td>{day(x.requestedAt)}</td><td>{f.num(x.points)}P</td><td>{f.won(x.netAmount)}</td><td>{st(x.status)}</td><td>{day(x.paidAt)}</td></tr>
          ))}
        </Table>
      )}

      <h2 className="my-s2" id="referral">{t('hReferral')} <Link className="dim" href="/my/recommend">{t('goReferral')}</Link></h2>
      {s.referral.items.length === 0 ? <Empty data-settle-empty="referral">{t('emptyReferral')}</Empty> : (
        <Table head={[t('cWho'), t('cJoined'), t('cState'), t('cPoints'), t('cGot')]}>
          {s.referral.items.map((x, i) => (
            <tr key={i} data-settle-row="referral" data-settle-rstate={x.state}><td>{x.name ?? t('left')}</td><td>{day(x.joined)}</td>
              <td>{t(`rs.${x.state}` as never)}</td><td>{x.points ? `${f.num(x.points)}P` : '—'}</td><td>{day(x.at)}</td></tr>
          ))}
        </Table>
      )}
      {s.referral.items.length > 0 && <p className="dim">{t('referralNote')}</p>}

      {s.affiliate && <>
        <h2 className="my-s2">{t('hAffiliate')} <Link className="dim" href="/partners/settlements">{t('goAffiliate')}</Link></h2>
        <Table head={[t('cPeriod'), t('cGross'), t('cWithholding'), t('cNet'), t('cState'), t('cPaid')]}>
          {s.affiliate.items.map((x) => (
            <tr key={x.id} data-settle-row="affiliate"><td>{x.from} ~ {x.to}</td><td>{f.won(x.gross)}</td><td>{f.won(x.withholding)}</td><td>{f.won(x.net)}</td><td>{st(x.state)}</td><td>{day(x.paidAt)}</td></tr>
          ))}
        </Table>
      </>}

      {s.seller && <>
        <h2 className="my-s2">{t('hSeller')}</h2>
        <Table head={[t('cSeller'), t('cPeriod'), t('cGross'), t('cCommission'), t('cNet'), t('cState'), t('cPaid')]}>
          {s.seller.items.map((x) => (
            <tr key={x.id} data-settle-row="seller"><td>{x.seller}</td><td>{x.from} ~ {x.to}</td><td>{f.won(x.gross)}</td><td>{f.won(x.commission)}</td><td>{f.won(x.net)}</td><td>{st(x.status)}</td><td>{day(x.paidAt)}</td></tr>
          ))}
        </Table>
      </>}

      <Note kind="plain">{t('note')}</Note>
    </div>
  );
}
