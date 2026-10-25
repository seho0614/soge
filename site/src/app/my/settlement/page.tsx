import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { PayoutBox, type PayoutAccount } from './PayoutBox';
import { ClaimButton } from './ClaimButton';
import { PaidMarkButton } from './PaidMarkButton';
import { MyHead, Note, Empty, Table, wonP, shortId, type Tone } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('stl.title') };
}

interface Settlement {
  id: string; dealId?: string; amount: number; status: string; statusLabel?: string | null;
  requestedAt: string; paidAt: string | null; payee?: 'BUSINESS' | 'PERSON';
}
/* v10.31 (시안 계산표) — 거래금액 · 소개코드 · tier · 상대(상호) · 받는 방식(그 거래 기준 · 소급 안 함) · 부가세(사업자 수령만) */
interface Due {
  dealId: string; amount: number; confirmedAt: string | null; title: string | null;
  attributedCode?: string | null; tier?: number | null; dealAmount?: number | null; counterpart?: string | null;
  payeeAs?: 'BUSINESS' | 'PERSON'; vat?: number | null;
}
interface Feature { feature: string; enabled: boolean }

const TONE: Record<string, Tone> = { PAID: 'ok', REQUESTED: 'wait', HELD: 'wait', APPROVED: 'wait', REJECTED: 'no' };

/**
 * SB-MYP-STL-010 정산 — v10.28 (지시서 5절 · D040 · INV-10R)
 *
 * **본인인증 회원이면 소개비를 받습니다.** 사업자 인증이 있으면 사업자로, 없으면 개인으로 받고
 *   개인은 **정산을 신청할 때** 받을 계좌(본인 명의 · 1원 확인)를 확인합니다(10/7 결정). 연동 전에는 「확인 간주」로 표시합니다.
 * 소개비는 당사자끼리 직접 지급합니다(INV-11) — 이 화면은 정산 기록을 확인 · 신청하는 곳이고 돈이 오가지 않습니다.
 * 소개비 기능(feature.referral_fee)은 연동 뒤 운영자가 켭니다(10/9 결정) — 꺼져 있으면 그 사실을 맨 위에 적습니다.
 *
 * v10.29 — 시안(scMyStl) 배치: 기능 꺼짐 경고 → 받는 방식 안내 → 받을 계좌 → 세금 → 받을 소개비 카드(계산표: 소개비 · 공제 0 · 실지급액)
 *   → 신청 대기 합계. 시안 위의 「개인 회원 · 사업자 회원」 단추는 시안에서 두 모습을 보여 주는 시연용이라 실제 웹은 회원에 맞는 하나만 보입니다.
 *   v10.31 — 시안 카드 그대로 거래금액 · 소개코드 · tier · 부가세 10%(별도 청구 · 사업자로 받을 때만) 줄과 입금 계좌 줄을 그립니다(GET /me/settlements/due).
 *   받는 방식은 거래마다 정합니다 — 사업자 인증 뒤에 성사된 거래만 사업자로(시안 「인증 시각이 기준일 · 소급 안 됨」), 그 전 거래는 개인으로.
 */
export default async function SettlementPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('myDeal');
  const b_ = (c: React.ReactNode) => <b>{c}</b>;

  if (!p.identityVerifiedAt) {
    return (
      <><div data-stl-need="IDENTITY">
        <MyHead title={t('stl.title')} sub={t('stl.sub')} />
        <Note kind="warn" className="act">
          <div>
            <b>{t('stl.needIdTitle')}</b>
            <p>{t('stl.needIdDesc')}</p>
          </div>
          <Link className="my-bp" href="/verify">{t('stl.verify')}</Link>
        </Note>
      </div><i hidden data-root-end="" /></>
    );
  }

  const isBiz = !!p.businessVerifiedAt;
  const [features, rows, due, accounts] = await Promise.all([
    /* 운영자가 스위치를 켜면 바로 보이게 — 캐시하지 않음(revalidate 0) */
    apiGet<Feature[]>('/features', 0).catch(() => [] as Feature[]),
    apiGetPersonal<Settlement[]>('/me/settlements').catch(() => [] as Settlement[]),
    apiGetPersonal<Due[]>('/me/settlements/due').catch(() => [] as Due[]),
    apiGetPersonal<PayoutAccount[]>('/me/payout-accounts').catch(() => [] as PayoutAccount[]),
  ]);
  const on = features.find((f) => f.feature === 'referral_fee')?.enabled === true;
  const verifiedAcc = accounts.find((a) => a.verified && a.isDefault) ?? accounts.find((a) => a.verified) ?? null;
  /* 개인으로 받을 거래(사업자 인증 전 성사 건 포함)가 있으면 받을 계좌가 필요합니다 */
  const needAcc = !isBiz || due.some((d) => d.payeeAs === 'PERSON');
  const sum = due.reduce((a, d) => a + Number(d.amount || 0), 0);

  return (
    <>
      <MyHead title={t('stl.title')} sub={t('stl.sub')} />
      {!on && (
        <Note kind="warn" data-stl-off="">
          {t.rich('stl.off', { b: b_ })}
        </Note>
      )}

      <div data-stl-payee={isBiz ? 'BUSINESS' : 'PERSON'}>
        {isBiz
          ? <Note kind="ok">{t.rich('stl.biz', { d: ymdKst(p.businessVerifiedAt), b: b_ })}</Note>
          : <Note kind="info">{t.rich('stl.person', { b: b_, link: (c) => <Link href="/my/business">{c}</Link> })}</Note>}
      </div>

      {isBiz && due.some((d) => d.payeeAs === 'PERSON') && (
        <Note kind="warn" data-stl-noretro="">{t.rich('stl.noRetro', { b: b_ })}</Note>
      )}
      {needAcc && <div className="my-card"><PayoutBox accounts={accounts} /></div>}

      <Note kind="info" data-stl-tax="">{t.rich('stl.tax', { b: b_ })}</Note>

      <h2 className="my-s2">{t('stl.dueH')}</h2>
      {due.length === 0 ? (
        <Empty data-stl-due-empty="">{t('stl.dueEmpty')}</Empty>
      ) : (
        <div data-stl-due="">
          {due.map((d) => (
            <div key={d.dealId} className="my-dcard" data-stl-due-row={d.dealId} data-payee-as={d.payeeAs ?? ''}>
              <div className="my-dh"><b>{d.title ?? t('stl.dealDefault')}</b><span className="my-bg ok">{t('stl.claimable')}</span></div>
              <div className="my-dm">
                <span>{t('stl.deal', { id: shortId(d.dealId, 'D-') })}</span>
                {d.attributedCode && <span className="my-code">{d.attributedCode} · tier {d.tier ?? 1}</span>}
                {d.counterpart && <span>{d.counterpart}</span>}
                <span>{t('stl.confirmed', { d: ymdKst(d.confirmedAt) })}</span>
                <span>{d.payeeAs === 'BUSINESS' ? t('stl.asBiz') : t('stl.asPerson')}</span>
              </div>
              <div className="my-calc">
                <div className="my-cr"><span>{t('stl.dealAmount')}</span><b>{d.dealAmount != null ? wonP(d.dealAmount) : <span className="my-ls">{t('stl.noCtrAmount')}</span>}</b></div>
                <div className="my-cr"><span>{t.rich('stl.feeRow', { i: (c) => <i>{c}</i> })}</span><b>{wonP(d.amount)}</b></div>
                <div className="my-cr"><span>{t('stl.deduct')}</span><b className="ok">{t('stl.zero')}</b></div>
                <div className="my-cr tot"><span>{t('stl.net')}</span><b>{wonP(d.amount)}</b></div>
                {d.payeeAs === 'BUSINESS' && d.vat != null && <div className="my-cr sub"><span>{t('stl.vat')}</span><b>{wonP(d.vat)}</b></div>}
              </div>
              {d.payeeAs === 'BUSINESS' && (
                <div className="my-bank" data-stl-bank=""><span>{t('stl.bank')}</span>
                  {verifiedAcc ? <><b>{verifiedAcc.bankName} {verifiedAcc.accountNo} · {verifiedAcc.holderName}</b><span className="my-bg ok">{verifiedAcc.isStub ? t('stl.assumed') : t('stl.realName')}</span></>
                    : <span className="my-ls">{t('stl.noAcc')}</span>}
                </div>
              )}
              <div className="my-dact">
                <ClaimButton dealId={d.dealId} ready={d.payeeAs === 'BUSINESS' || !!verifiedAcc} />
                <Link className="my-bo" href="/my/settlement/history">{t('stl.viewHistory')}</Link>
              </div>
            </div>
          ))}
          <Note kind="info">{t.rich('stl.pendingSum', { n: String(due.length), sum: wonP(sum), b: b_ })}</Note>
        </div>
      )}

      {/* 개발에만 있던 「정산 내역」(신청한 정산의 상태) — 시안 모양 표로 남깁니다 */}
      <h2 className="my-s2">{t('stl.histH')}</h2>
      {rows.length === 0 ? (
        <Empty>{t('stl.histEmpty')}</Empty>
      ) : (
        <>
        {/* v10.31 (합침 · w6 D080) — 정산 승인 단계: 승인 대기(신청) → 승인됨 · 지급 대기(운영이 정산서 확인) → 지급 완료(당사자 표시) */}
        <Note kind="info">{t.rich('stl.flow', { b: b_ })}</Note>
        <Table head={[t('stl.cols.no'), t('stl.cols.fee'), t('stl.cols.state'), t('stl.cols.payee'), t('stl.cols.requested'), t('stl.cols.paid'), t('stl.cols.action')]}>
          {rows.map((s) => (
            <tr key={s.id} data-stl-row={s.id}>
              <td>{shortId(s.id, 'S-')}</td>
              <td><b>{wonP(s.amount)}</b></td>
              <td><span className={`my-bg ${TONE[s.status] ?? 'off'}`}>{s.statusLabel ?? s.status}</span></td>
              <td>{s.payee && <span data-stl-row-payee={s.payee}>{s.payee === 'PERSON' ? t('stl.asPerson') : t('stl.asBiz')}</span>}</td>
              <td>{ymdKst(s.requestedAt)}</td>
              <td>{s.paidAt ? ymdKst(s.paidAt) : '—'}</td>
              <td>{s.status === 'APPROVED' ? <PaidMarkButton id={s.id} /> : <span className="my-ls">—</span>}</td>
            </tr>
          ))}
        </Table>
        </>
      )}
      <div className="my-btns"><Link className="my-bo" href="/my/settlement/history">{t('stl.toHistory')}</Link></div>
    </>
  );
}
