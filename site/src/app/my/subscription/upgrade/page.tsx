import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { viewLimitText, type PublicSettings } from '@/components/billing/viewLimit';
import { MyHead, Note, wonP } from '@/components/my/ui';

export const metadata: Metadata = { title: '한도 안내' };

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
  const lim = (n: number | null) => (n == null ? '무제한' : String(n));
  const used = now?.codesIssued ?? 0;
  const cap = now?.includedCodes ?? null;

  return (
    <><div data-my-upgrade="">
      <MyHead title="한도 안내"
        sub="구독은 시장에 계속 보이기 위한 것입니다. 이번 달 한도를 다 쓰시면 다음 달에 초기화되거나 지금 올리실 수 있습니다."
        right={<>
          <a className="my-bp" href="/my/subscription#plans" data-upgrade-go="">요금제 올리기</a>
          <Link className="my-bo" href="/my/subscription">그대로 두기</Link>
        </>} />

      <div className="my-subnow two" data-upgrade-now="">
        <div>
          <span className="my-ls">현재</span>
          <b className="big">{now?.planName ?? '구독 없음'}</b>
          <span className="my-ls">{now?.currentPeriodEnd ? `${ymdKst(now.currentPeriodEnd)} 초기화` : '구독하시면 소개코드를 발급하실 수 있습니다'}</span>
        </div>
        <div>
          <span className="my-ls">소개코드 발급</span>
          <b className="big">{used} / {cap ?? '—'}</b>
          <span className="my-ls">{cap != null && used >= cap ? '한도 도달' : cap != null ? `남은 ${cap - used}장` : ''}</span>
        </div>
      </div>

      <Note kind="warn"><b>취소한 소개코드도 사용량에 포함됩니다.</b> 취소해도 그달 한도는 복원되지 않습니다 — 발급 전에 한 번 더 확인해 주세요.</Note>

      <h2 className="my-s2">요금제 비교</h2>
      <div className="my-tbl-w">
        <table className="my-tbl" data-upgrade-plans="">
          <thead><tr><th>요금제</th><th>월 회비</th><th>소개코드 발급</th><th>리스팅 슬롯</th><th>소개 제안</th><th>요청 열람</th><th>우선노출</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.code} className={p.code === now?.planCode ? 'on' : undefined}>
                <td><b>{p.name}</b>{p.code === now?.planCode && <> <span className="my-bg ok">현재</span></>}</td>
                <td className="my-num"><b>{p.monthlyPrice === 0 ? '0원' : wonP(p.monthlyPrice)}</b></td>
                <td className="my-num">{p.includedCodes}</td>
                <td className="my-num">{lim(p.listingSlots)}</td>
                <td className="my-num">{p.proposalLimit == null ? '무제한' : `월 ${p.proposalLimit}`}</td>
                <td className="my-num" data-view-limit={p.code}>{viewLimitText(settings, p)}</td>
                <td className="my-num">{p.prioritySlotCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v10.27 (G-189) 규칙 그대로 — 유료 구독 중 바꾸면 다음 결제일부터(지금 결제 없음) */}
      <Note kind="info">
        <b>유료 구독 중이면 바꾼 요금제는 다음 결제일부터 적용됩니다(지금 결제 없음).</b> 처음 유료 구독은 오늘부터 시작합니다.
        소개코드 초과분은 건당 {wonP(plans[0]?.extraCodePrice ?? 30000)} 정액입니다. 거래 금액과 무관합니다.
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
