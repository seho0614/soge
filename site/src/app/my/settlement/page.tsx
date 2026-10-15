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

export const metadata: Metadata = { title: '정산 · 소개비 받기' };

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

  if (!p.identityVerifiedAt) {
    return (
      <><div data-stl-need="IDENTITY">
        <MyHead title="정산 · 소개비 받기" sub="본인인증 회원이면 소개비를 받습니다. 성사가 확정된 건만 신청할 수 있고 (INV-3) 소개비에서 떼는 금액은 없습니다 (INV-9)." />
        <Note kind="warn" className="act">
          <div>
            <b>본인인증을 하시면 소개비를 받으실 수 있습니다</b>
            <p>개인 회원도 받습니다. 사업자 인증은 사업자로 소개비(세금계산서)를 받으실 때만 필요합니다.</p>
          </div>
          <Link className="my-bp" href="/verify">본인인증하기</Link>
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
      <MyHead title="정산 · 소개비 받기" sub="본인인증 회원이면 소개비를 받습니다. 성사가 확정된 건만 신청할 수 있고 (INV-3) 소개비에서 떼는 금액은 없습니다 (INV-9)." />
      {!on && (
        <Note kind="warn" data-stl-off="">
          <b>소개비 기능은 아직 열리지 않았습니다</b> — 본인인증 · 계좌 확인 연동을 마친 뒤 운영자가 엽니다.
          그 전에는 거래가 성사돼도 정산이 생기지 않습니다.
        </Note>
      )}

      <div data-stl-payee={isBiz ? 'BUSINESS' : 'PERSON'}>
        {isBiz
          ? <Note kind="ok"><b>사업자로 받습니다</b> — 사업자 인증 {ymdKst(p.businessVerifiedAt)}. 공제 0, 소개비 전액이 그대로 들어옵니다. 세금계산서는 소개자가 직접 발행합니다.</Note>
          : <Note kind="info"><b>개인으로 받습니다</b> — 정산을 신청할 때 <b>본인 명의 받을 계좌</b>를 확인합니다. 사업자 인증을 하시면 사업자로 받습니다(<Link href="/my/business">사업자 전환</Link>).
              {' '}<b>소개비는 거래 당사자가 직접 지급합니다</b> — 소개뱅크는 소개비를 대신 받거나 보내지 않습니다.</Note>}
      </div>

      {isBiz && due.some((d) => d.payeeAs === 'PERSON') && (
        <Note kind="warn" data-stl-noretro=""><b>사업자 인증 전에 성사된 거래는 개인으로 받습니다.</b> 인증 시각이 소개비 수령 자격의 기준일이며 소급되지 않습니다 — 그 거래는 받을 계좌를 확인한 뒤 「소개비 받기」를 누르십시오.</Note>
      )}
      {needAcc && <div className="my-card"><PayoutBox accounts={accounts} /></div>}

      <Note kind="info" data-stl-tax=""><b>세금</b> — 소개비는 받는 분의 소득이므로 세금 신고는 받는 분이 하십니다. 소개뱅크는 소개비를 지급하지 않아 원천징수하지 않습니다.</Note>

      <h2 className="my-s2">받을 소개비</h2>
      {due.length === 0 ? (
        <Empty data-stl-due-empty="">신청 가능한 건이 없습니다. 성사가 확정되면 정산이 자동으로 생기고, 계좌 확인이 늦어 생기지 않은 거래만 여기에 나타납니다.</Empty>
      ) : (
        <div data-stl-due="">
          {due.map((d) => (
            <div key={d.dealId} className="my-dcard" data-stl-due-row={d.dealId} data-payee-as={d.payeeAs ?? ''}>
              <div className="my-dh"><b>{d.title ?? '소개 거래'}</b><span className="my-bg ok">신청 가능</span></div>
              <div className="my-dm">
                <span>거래 {shortId(d.dealId, 'D-')}</span>
                {d.attributedCode && <span className="my-code">{d.attributedCode} · tier {d.tier ?? 1}</span>}
                {d.counterpart && <span>{d.counterpart}</span>}
                <span>확정 {ymdKst(d.confirmedAt)}</span>
                <span>{d.payeeAs === 'BUSINESS' ? '사업자로 받음' : '개인으로 받음'}</span>
              </div>
              <div className="my-calc">
                <div className="my-cr"><span>거래금액</span><b>{d.dealAmount != null ? wonP(d.dealAmount) : <span className="my-ls">계약서 금액 없음</span>}</b></div>
                <div className="my-cr"><span>소개비 <i>양측 협의로 정한 금액입니다 (A-12)</i></span><b>{wonP(d.amount)}</b></div>
                <div className="my-cr"><span>공제</span><b className="ok">0원</b></div>
                <div className="my-cr tot"><span>실지급액</span><b>{wonP(d.amount)}</b></div>
                {d.payeeAs === 'BUSINESS' && d.vat != null && <div className="my-cr sub"><span>부가세 10% (별도 청구)</span><b>{wonP(d.vat)}</b></div>}
              </div>
              {d.payeeAs === 'BUSINESS' && (
                <div className="my-bank" data-stl-bank=""><span>입금 계좌</span>
                  {verifiedAcc ? <><b>{verifiedAcc.bankName} {verifiedAcc.accountNo} · {verifiedAcc.holderName}</b><span className="my-bg ok">{verifiedAcc.isStub ? '확인 간주(연동 전)' : '실명 확인됨'}</span></>
                    : <span className="my-ls">등록된 계좌가 없습니다 — 상대에게 직접 알려 주십시오(소개뱅크는 이체하지 않습니다)</span>}
                </div>
              )}
              <div className="my-dact">
                <ClaimButton dealId={d.dealId} ready={d.payeeAs === 'BUSINESS' || !!verifiedAcc} />
                <Link className="my-bo" href="/my/settlement/history">지급 내역 보기</Link>
              </div>
            </div>
          ))}
          <Note kind="info">신청 대기 <b>{due.length}건 · 소개비 합계 {wonP(sum)}</b></Note>
        </div>
      )}

      {/* 개발에만 있던 「정산 내역」(신청한 정산의 상태) — 시안 모양 표로 남깁니다 */}
      <h2 className="my-s2">정산 내역</h2>
      {rows.length === 0 ? (
        <Empty>정산 내역이 없습니다.</Empty>
      ) : (
        <>
        {/* v10.31 (합침 · w6 D080) — 정산 승인 단계: 승인 대기(신청) → 승인됨 · 지급 대기(운영이 정산서 확인) → 지급 완료(당사자 표시) */}
        <Note kind="info">신청한 정산은 <b>승인 대기</b> → 운영이 정산서를 확인하면 <b>승인됨 · 지급 대기</b> → 소개비를 받으면 <b>받았음 표시</b>(지급 완료) 순서로 바뀝니다. 「받았음 표시」는 승인된 건에만 있습니다.</Note>
        <Table head={['정산번호', '소개비', '상태', '받는 방식', '신청일', '지급일', '처리']}>
          {rows.map((s) => (
            <tr key={s.id} data-stl-row={s.id}>
              <td>{shortId(s.id, 'S-')}</td>
              <td><b>{wonP(s.amount)}</b></td>
              <td><span className={`my-bg ${TONE[s.status] ?? 'off'}`}>{s.statusLabel ?? s.status}</span></td>
              <td>{s.payee && <span data-stl-row-payee={s.payee}>{s.payee === 'PERSON' ? '개인으로 받음' : '사업자로 받음'}</span>}</td>
              <td>{ymdKst(s.requestedAt)}</td>
              <td>{s.paidAt ? ymdKst(s.paidAt) : '—'}</td>
              <td>{s.status === 'APPROVED' ? <PaidMarkButton id={s.id} /> : <span className="my-ls">—</span>}</td>
            </tr>
          ))}
        </Table>
        </>
      )}
      <div className="my-btns"><Link className="my-bo" href="/my/settlement/history">지급 내역 · 세금계산서 ›</Link></div>
    </>
  );
}
