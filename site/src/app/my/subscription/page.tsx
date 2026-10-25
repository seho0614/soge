import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { viewLimitText, type PublicSettings, type ViewLimitMsgs } from '@/components/billing/viewLimit';
import { SubscriptionManage, type RefundEligible, type SubDetail } from '@/components/billing/SubscriptionManage';
import { PlanPicker } from '@/components/billing/PlanPicker';
import { MyHead, Note, Table, Empty, type Tone } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.sub'))('title') };
}

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

/** v10.99 — 상태 이름은 사전 키(my.sub.inv.*) */
const INV: Record<string, ['paid' | 'failed' | 'pending' | 'refunded' | 'skipped', Tone]> = {
  PAID: ['paid', 'ok'], FAILED: ['failed', 'no'], PENDING: ['pending', 'wait'], REFUNDED: ['refunded', 'off'], SKIPPED: ['skipped', 'off'],
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
  const t = await getTranslations('my.sub');
  const f = await getFmt();
  const tv = await getTranslations('billing.viewLimit');
  const vlm: ViewLimitMsgs = { promo: tv('promo'), unlimited: tv('unlimited'), perMonth: (n) => tv('perMonth', { n }) };
  const B = (c: React.ReactNode) => <b>{c}</b>;
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
      <MyHead title={t('title')} sub={t('sub')} />
      {payFail && <Note kind="warn" role="alert" data-pay-fail="">{t('payFail')}</Note>}

      {/* 내 구독 — 자동 갱신 해지 · 해지 철회 · 환불(환불 완료 · 환불 결과 확인 중 · 환불 실패). 구독이 없으면 나오지 않습니다 */}
      <Msgs ns={['billing']}><SubscriptionManage detail={detail} eligible={eligible} /></Msgs>

      {detail?.subscribed && (
        <div className="my-subnow" data-sub-now="">
          <div>
            <span className="my-ls">{t('curPlan')}</span>
            <b className="big">{detail.planName}{detail.monthlyPrice != null && t('perMonth', { price: f.won(detail.monthlyPrice, '—') })}</b>
            <span className="my-ls">{t('started', { date: ymdKst(detail.periodStart) })}{detail.nextChargeAt ? t('nextCharge', { date: ymdKst(detail.nextChargeAt) }) : ''}</span>
          </div>
          <div>
            <span className="my-ls">{t('monthCodes')}</span>
            <b className="big">{now?.codesIssued ?? 0} / {cap ?? '—'}</b>
            <span className="my-ls">{cap != null ? t('left', { n: String(Math.max(0, cap - (now?.codesIssued ?? 0))) }) : ''}{extraN > 0 ? t('extraIssued', { n: String(extraN) }) : ''}</span>
          </div>
          <a className="my-bo" href="#plans">{t('changePlan')}</a>
        </div>
      )}

      <Note kind="info">
        {t.rich('extraNote', { b: B, price: f.won(cur?.extraCodePrice ?? plans[0]?.extraCodePrice ?? 30000, '—') })}
      </Note>

      {!p.businessVerifiedAt && (
        <Note kind="plain">{t('personal')} <Link href="/my/business">{t('toBiz')}</Link></Note>
      )}

      <h2 className="my-s2">{t('hPlans')}</h2>
      {/* v10.27 (G-189) — 요금제 고르기 · 구독 결제. 처음 유료는 지금 결제, 유료 구독 중 올리기 · 내리기는 다음 결제일부터 예약(10/8 답 ③) */}
      <div className="my-plans-w"><Msgs ns={['billing']}>
        <PlanPicker
          detail={detail}
          canSubscribe={p.roles.some((r) => r === 'MEMBER' || r === 'BIZ_OWNER')}   /* v10.37 (D095) — 개인 회원도 구독 */
          plans={plans.map((pl) => ({
            code: pl.code, name: pl.name, monthlyPrice: pl.monthlyPrice,
            lines: [
              ...(pl.features?.length
                ? pl.features.map((t, i) => ({ k: `f${i}`, t }))
                : [{ k: 'codes', t: pl.includedCodes ? t('codesN', { n: String(pl.includedCodes) }) : t('codesNone') }]),
              { k: 'view', t: t('view', { v: viewLimitText(settings, pl, vlm) }) },
              { k: 'slots', t: t('slots', { v: pl.listingSlots == null ? t('unlimited') : pl.listingSlots ? t('count', { n: String(pl.listingSlots) }) : String(pl.listingSlots) }) },
            ],
            note: pl.code === 'BASIC' ? t('basicNote', { price: f.won(pl.extraCodePrice ?? 30000, '—') }) : t('paidNote'),
          }))}
        />
      </Msgs></div>

      {/* 환불 조건은 결제 전에 보여야 합니다. 결제하고 나서 알면 "몰랐다" 가 분쟁이 됩니다. */}
      <Note kind="warn">
        {t.rich('refundNote', { b: B })}
      </Note>
      <p className="my-ls">{t.rich('testPay', { b: B })}</p>

      <h2 className="my-s2">{t('hInvoices')}</h2>
      {invoices.length === 0 ? (
        <Empty data-sub-invoices="0">{t('noInvoices')}</Empty>
      ) : (
        <Table head={[t('thDate'), t('thItem'), t('thAmount'), t('thStatus')]}>
          {invoices.map((v) => {
            const s = INV[v.status];
            const st: [string, Tone] = s ? [t(`inv.${s[0]}`), s[1]] : [v.status, 'off'];
            return (
              <tr key={v.id}>
                <td>{ymdKst(v.paidAt ?? v.issuedAt ?? v.periodStart)}</td>
                <td>{v.kind === 'EXTRA_CODE'
                  ? <>{t('extraRow', { n: String(v.codeCount ?? 1) })}</>
                  : <>{plans.find((x) => x.code === v.planCode)?.name ?? ''} {t('fee')} <span className="my-ls">{ymdKst(v.periodStart)} ~ {ymdKst(v.periodEnd)}</span></>}
                  {v.failureReason ? <><br /><span className="my-ls">{v.failureReason}</span></> : null}</td>
                <td><b>{f.won(v.amount, '—')}</b></td>
                <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
