import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { viewLimitText, type PublicSettings } from '@/components/billing/viewLimit';
import { SubscriptionManage, type RefundEligible, type SubDetail } from '@/components/billing/SubscriptionManage';
import { PlanPicker } from '@/components/billing/PlanPicker';
import { MyHead, Note, Table, Empty, wonP, type Tone } from '@/components/my/ui';

export const metadata: Metadata = { title: '구독 · 소개코드' };

interface Plan {
  code: string; name: string; monthlyPrice: number; includedCodes: number;
  requestViewsPerMonth: number | null; listingSlots: number | null;
  prioritySlotCount: number;
  /* v10.31 — 시안 요금제 카드 혜택 줄(서버 subscription_plans.features) · 소개 제안 월 한도(null = 무제한) */
  features?: string[]; proposalLimit?: number | null; extraCodePrice?: number;
}
/** GET /me/subscription — 이번 달 소개코드 발급 수(codesIssued) · 포함 수(includedCodes) */
interface SubNow { planCode: string | null; planName: string | null; codesIssued: number; includedCodes: number | null; currentPeriodEnd: string | null }
/** GET /me/subscription/invoices — 결제 내역 */
interface Invoice { id: string; kind?: 'SUBSCRIPTION' | 'EXTRA_CODE'; planCode?: string | null; periodStart: string; periodEnd: string | null; amount: number; status: string; failureReason: string | null; paidAt: string | null; refundedAt: string | null; issuedAt: string | null; codeCount?: number | null }

const INV: Record<string, [string, Tone]> = {
  PAID: ['완료', 'ok'], FAILED: ['실패', 'no'], PENDING: ['확인 중', 'wait'], REFUNDED: ['환불', 'off'], SKIPPED: ['건너뜀', 'off'],
};

/**
 * SB-MYP-SUB-010
 *
 * 구독의 대가는 코드가 아니라 노출과 열람입니다 (B-13R2).
 * v10.29 — 시안(scMySub) 배치: 내 구독(관리) → 현재 요금제 한 줄(이번 달 소개코드 사용/포함) → 초과 소개코드 안내 → 요금제 3칸 → 결제 내역 표.
 *   기능(해지 · 환불 · 요금제 고르기 · 결제)은 기존 부품(SubscriptionManage · PlanPicker) 그대로입니다.
 * v10.31 (10/10 시안 기준) — 요금제 카드 글을 시안대로(서버 features: 베이직 「소개코드 발급 없음 · 소개 제안 월 10건 · 목록 · 상세 열람」 …),
 *   개발에만 있던 열람 · 노출 슬롯 줄은 그 아래에 남김 · 결제 내역에 초과 소개코드 줄(서버 kind=EXTRA_CODE) · 환불 사유 + 환불 신청은 유료 구독이면 늘 보임.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ pay?: string }> }) {
  const payFail = (await searchParams).pay === 'fail';
  const p = await me();
  if (!p) redirect('/login');
  const plans = await apiGet<Plan[]>('/subscription-plans', 300).catch(() => [] as Plan[]);
  /* D011 — 요청 열람 한도는 운영 설정입니다(홍보 기간에는 제한 없음). 설정은 짧게(30초) 캐시합니다 */
  const settings = await apiGet<PublicSettings>('/site-settings/public', 30).catch(() => ({} as PublicSettings));
  /* v10.18 (D022) — 내 구독 상태 · 환불 상태. 사람마다 다른 응답이라 캐시하지 않습니다(/me 는 apiGet 이 no-store 로 보냅니다). */
  const [detail, eligible, now, invoices] = await Promise.all([
    apiGet<SubDetail>('/me/subscription/detail', 0).catch(() => null),
    apiGet<RefundEligible>('/me/subscription/refund-eligible', 0).catch(() => null),
    apiGet<SubNow>('/me/subscription', 0).catch(() => null),
    apiGet<Invoice[]>('/me/subscription/invoices', 0).catch(() => [] as Invoice[]),
  ]);
  const cur = plans.find((x) => x.code === (detail?.planCode ?? now?.planCode));
  const cap = now?.includedCodes ?? cur?.includedCodes ?? null;
  /* 이번 달 초과 소개코드 발급 수(결제 내역의 EXTRA_CODE · 이번 달) — 시안 「초과 발급 N건」 */
  const month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  const extraN = invoices.filter((v) => v.kind === 'EXTRA_CODE' && ymdKst(v.paidAt ?? v.periodStart).startsWith(month)).reduce((a, v) => a + Number(v.codeCount ?? 1), 0);

  return (
    <>
      <MyHead title="구독 · 소개코드" sub="소개뱅크의 수익원은 두 가지입니다 — 월 구독료와 초과 소개코드 발급비. 거래금액에 연동되는 수수료는 없습니다." />
      {payFail && <Note kind="warn" role="alert" data-pay-fail="">결제가 완료되지 않았습니다. 돈은 나가지 않았습니다 — 다시 시도해 주십시오.</Note>}

      {/* 내 구독 — 자동 갱신 해지 · 해지 철회 · 환불(환불 완료 · 환불 결과 확인 중 · 환불 실패). 구독이 없으면 나오지 않습니다 */}
      <SubscriptionManage detail={detail} eligible={eligible} />

      {detail?.subscribed && (
        <div className="my-subnow" data-sub-now="">
          <div>
            <span className="my-ls">현재 요금제</span>
            <b className="big">{detail.planName}{detail.monthlyPrice != null && ` · ${wonP(detail.monthlyPrice)}/월`}</b>
            <span className="my-ls">{ymdKst(detail.periodStart)} 시작{detail.nextChargeAt ? ` · 다음 결제 ${ymdKst(detail.nextChargeAt)}` : ''}</span>
          </div>
          <div>
            <span className="my-ls">이번 달 소개코드</span>
            <b className="big">{now?.codesIssued ?? 0} / {cap ?? '—'}</b>
            <span className="my-ls">{cap != null ? `남은 ${Math.max(0, cap - (now?.codesIssued ?? 0))}장` : ''}{extraN > 0 ? ` · 초과 발급 ${extraN}건` : ''}</span>
          </div>
          <a className="my-bo" href="#plans">요금제 변경</a>
        </div>
      )}

      <Note kind="info">
        <b>초과 소개코드는 건당 {wonP(cur?.extraCodePrice ?? plans[0]?.extraCodePrice ?? 30000)} 정액입니다.</b> 거래금액이 얼마든 금액은 같습니다 — 소개비에서 떼는 구조가 아니기 때문입니다 (B-13R · INV-9).
        소개비는 거래 당사자끼리 직접 정하고 주고받으며, 소개뱅크는 이를 대신 보관하거나 지급하지 않고 공제하지도 않습니다.
      </Note>

      {!p.businessVerifiedAt && (
        <Note kind="plain">개인 회원도 구독하실 수 있습니다. 사업자로 소개비(세금계산서)를 받으시려면 <Link href="/my/business">사업자 전환 ›</Link></Note>
      )}

      <h2 className="my-s2">요금제</h2>
      {/* v10.27 (G-189) — 요금제 고르기 · 구독 결제. 처음 유료는 지금 결제, 유료 구독 중 올리기 · 내리기는 다음 결제일부터 예약(10/8 답 ③) */}
      <div className="my-plans-w">
        <PlanPicker
          detail={detail}
          canSubscribe={p.roles.some((r) => r === 'MEMBER' || r === 'BIZ_OWNER')}   /* v10.37 (D095) — 개인 회원도 구독 */
          plans={plans.map((pl) => ({
            code: pl.code, name: pl.name, monthlyPrice: pl.monthlyPrice,
            lines: [
              ...(pl.features?.length
                ? pl.features.map((t, i) => ({ k: `f${i}`, t }))
                : [{ k: 'codes', t: pl.includedCodes ? `소개코드 월 ${pl.includedCodes}건` : '소개코드 발급 없음' }]),
              { k: 'view', t: `요청 열람 ${viewLimitText(settings, pl)}` },
              { k: 'slots', t: `노출 슬롯 ${pl.listingSlots ?? '무제한'}${pl.listingSlots ? '건' : ''}` },
            ],
            note: pl.code === 'BASIC' ? `소개코드가 필요하면 건당 ${wonP(pl.extraCodePrice ?? 30000)} 정액으로 발급합니다.` : '해지하면 노출 슬롯이 줄어 매물이 내려갑니다.',
          }))}
        />
      </div>

      {/* 환불 조건은 결제 전에 보여야 합니다. 결제하고 나서 알면 "몰랐다" 가 분쟁이 됩니다. */}
      <Note kind="warn">
        <b>환불은 결제 당일에만 가능합니다.</b> 구독을 켜시면 그 순간부터 요청을 열람하실 수 있어,
        <b> 한 건이라도 열람하시면 당일이어도 환불되지 않습니다</b> — 열람한 연락처는 되돌릴 수 없기 때문입니다.
      </Note>
      <p className="my-ls">결제사 키를 넣기 전에는 <b>시험 결제</b>로 동작합니다(돈이 오가지 않음). 키를 넣으면 토스 결제창이 열립니다.</p>

      <h2 className="my-s2">결제 내역</h2>
      {invoices.length === 0 ? (
        <Empty data-sub-invoices="0">결제 내역이 없습니다.</Empty>
      ) : (
        <Table head={['일자', '항목', '금액', '상태']}>
          {invoices.map((v) => {
            const st = INV[v.status] ?? [v.status, 'off' as Tone];
            return (
              <tr key={v.id}>
                <td>{ymdKst(v.paidAt ?? v.issuedAt ?? v.periodStart)}</td>
                <td>{v.kind === 'EXTRA_CODE'
                  ? <>초과 소개코드 {v.codeCount ?? 1}건</>
                  : <>{plans.find((x) => x.code === v.planCode)?.name ?? ''} 구독료 <span className="my-ls">{ymdKst(v.periodStart)} ~ {ymdKst(v.periodEnd)}</span></>}
                  {v.failureReason ? <><br /><span className="my-ls">{v.failureReason}</span></> : null}</td>
                <td><b>{wonP(v.amount)}</b></td>
                <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
