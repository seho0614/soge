import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { viewLimitText, type PublicSettings, type ViewLimitMsgs } from '@/components/billing/viewLimit';
import { MyHead, Note } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.subUp'))('title') };
}

interface Plan {
  code: string; name: string; monthlyPrice: number; includedCodes: number;
  requestViewsPerMonth: number | null; listingSlots: number | null;
  prioritySlotCount: number; proposalLimit?: number | null; extraCodePrice?: number;
}
interface SubNow { planCode: string | null; planName: string | null; codesIssued: number; includedCodes: number | null; currentPeriodEnd: string | null }

/**
 * SB-MYP-SUB-020 한도 초과 · 업그레이드
 *
 * 한도 초과(422 VIEW_QUOTA_EXCEEDED · LISTING_SLOT_LIMIT)는 구독 전환의 가장 강한 순간입니다.
 * v10.29 — 시안(scMySubUp) 배치: 머리 오른쪽 「요금제 올리기 · 그대로 두기」 → 현재 요금제 · 소개코드 발급 사용/한도 한 줄
 *   → 경고 → 요금제 비교 표(월 회비 · 소개코드 발급 · 리스팅 슬롯 + 개발에만 있던 요청 열람 · 우선노출) → 안내.
 *   「요금제 올리기」는 기존대로 구독 화면의 요금제 고르기(#plans)로 갑니다 — 결제 · 예약 규칙은 그 화면 그대로.
 * v10.31 — 시안 표 순서(요금제 · 월 회비 · 소개코드 발급 · 리스팅 슬롯) + 소개 제안(서버 proposalLimit). 시안 글 「지금 올리시면 남은 기간만큼 계산해 청구」는
 *   시안 자신의 결제 패널(10/8 답 ③ 「올리기 · 내리기는 예약 · 지금 결제 없음」)과 어긋나는 옛 글이라(시안 결함 · 결정 기록 P7) 예약 규칙 글로 씁니다.
 */
export default async function UpgradePage() {
  if (!(await me())) redirect('/login');
  const [plans, settings, now] = await Promise.all([
    apiGet<Plan[]>('/subscription-plans', 300).catch(() => [] as Plan[]),
    apiGet<PublicSettings>('/site-settings/public', 30).catch(() => ({} as PublicSettings)),   // D011 — 요청 열람 한도 설정
    apiGet<SubNow>('/me/subscription', 0).catch(() => null),
  ]);
  const t = await getTranslations('my.subUp');
  const f = await getFmt();
  const tv = await getTranslations('billing.viewLimit');
  const vlm: ViewLimitMsgs = { promo: tv('promo'), unlimited: tv('unlimited'), perMonth: (n) => tv('perMonth', { n }) };
  const lim = (n: number | null) => (n == null ? t('unlimited') : String(n));
  const used = now?.codesIssued ?? 0;
  const cap = now?.includedCodes ?? null;

  return (
    <><div data-my-upgrade="">
      <MyHead title={t('title')}
        sub={t('sub')}
        right={<>
          <a className="my-bp" href="/my/subscription#plans" data-upgrade-go="">{t('go')}</a>
          <Link className="my-bo" href="/my/subscription">{t('keep')}</Link>
        </>} />

      <div className="my-subnow two" data-upgrade-now="">
        <div>
          <span className="my-ls">{t('now')}</span>
          <b className="big">{now?.planName ?? t('noSub')}</b>
          <span className="my-ls">{now?.currentPeriodEnd ? t('reset', { date: ymdKst(now.currentPeriodEnd) }) : t('subscribeHint')}</span>
        </div>
        <div>
          <span className="my-ls">{t('codes')}</span>
          <b className="big">{used} / {cap ?? '—'}</b>
          <span className="my-ls">{cap != null && used >= cap ? t('reached') : cap != null ? t('left', { n: String(cap - used) }) : ''}</span>
        </div>
      </div>

      <Note kind="warn"><b>{t('cancelB')}</b> {t('cancelText')}</Note>

      <h2 className="my-s2">{t('hCompare')}</h2>
      <div className="my-tbl-w">
        <table className="my-tbl" data-upgrade-plans="">
          <thead><tr><th>{t('thPlan')}</th><th>{t('thFee')}</th><th>{t('codes')}</th><th>{t('thSlots')}</th><th>{t('thProposal')}</th><th>{t('thView')}</th><th>{t('thPriority')}</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.code} className={p.code === now?.planCode ? 'on' : undefined}>
                <td><b>{p.name}</b>{p.code === now?.planCode && <> <span className="my-bg ok">{t('now')}</span></>}</td>
                <td className="my-num"><b>{p.monthlyPrice === 0 ? t('zeroWon') : f.won(p.monthlyPrice, '—')}</b></td>
                <td className="my-num">{p.includedCodes}</td>
                <td className="my-num">{lim(p.listingSlots)}</td>
                <td className="my-num">{p.proposalLimit == null ? t('unlimited') : t('perMonth', { n: String(p.proposalLimit) })}</td>
                <td className="my-num" data-view-limit={p.code}>{viewLimitText(settings, p, vlm)}</td>
                <td className="my-num">{p.prioritySlotCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v10.27 (G-189) 규칙 그대로 — 유료 구독 중 바꾸면 다음 결제일부터(지금 결제 없음) */}
      <Note kind="info">
        {t.rich('ruleNote', { b: (c) => <b>{c}</b>, price: f.won(plans[0]?.extraCodePrice ?? 30000, '—') })}
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
