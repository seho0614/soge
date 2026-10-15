import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { PayMethod } from '@/components/PayMethod';
import type { SubDetail } from '@/components/billing/SubscriptionManage';
import { MyHead, Note, wonP, type Tone } from '@/components/my/ui';

export const metadata: Metadata = { title: '결제 수단' };

/**
 * GET /me/billing-key — 등록돼 있으면 { id, cardCompany, cardLast4, registeredAt, lastUsedAt }, 없으면 { registered: false, note }.
 * v10.26 (G-179) — 전에는 화면이 registered · brand · last4 를 읽어, 카드를 등록해도 늘 「등록된 결제 수단이 없습니다」로 보였습니다.
 */
interface Key {
  id?: string; registered?: boolean;
  cardCompany?: string | null; cardLast4?: string | null; registeredAt?: string; lastUsedAt?: string | null;
}
type Site = Record<string, string | null>;
interface Invoice { id: string; kind?: 'SUBSCRIPTION' | 'EXTRA_CODE'; periodStart: string; periodEnd: string | null; amount: number; status: string; attempt?: number; failureReason: string | null; codeCount?: number | null }
const INV: Record<string, [string, Tone]> = {
  PAID: ['결제 완료', 'ok'], FAILED: ['실패 · 재시도', 'no'], PENDING: ['확인 중', 'wait'], REFUNDED: ['환불', 'off'], SKIPPED: ['건너뜀', 'off'],
};

/**
 * SB-MYP-PAY-010 결제 수단 관리
 *
 * ── 카드 번호는 저장하지 않습니다 ── 토스가 보관하고 우리는 **빌링키만** 받습니다.
 * ── 지금은 간주 상태입니다 ── 토스 심사 전이라 **실제 결제가 일어나지 않습니다.** 그 사실을 화면에 표시합니다.
 *
 * v10.29 — 시안(scMyPayMethod) 배치: 오른쪽 위 「계정당 결제 수단 1개」 → 등록된 카드 · 다음 청구 한 줄(카드 변경)
 *   → 카드번호 저장 안 함 안내 → 청구 내역 표(GET /me/subscription/invoices) → 「결제 수단을 지우면 다음 갱신이 실패」 안내.
 */
export default async function PaymentPage() {
  const p = await me();
  if (!p) redirect('/login');

  const [k, s, d, inv] = await Promise.all([
    apiGet<Key>('/me/billing-key', 0).catch(() => null),
    /* 공개 설정은 GLOBAL 을 통째로 내려줍니다 — assume.* 도 여기 있습니다. */
    apiGet<Site>('/site-settings/public', 60).catch(() => null),
    apiGet<SubDetail>('/me/subscription/detail', 0).catch(() => null),
    apiGet<Invoice[]>('/me/subscription/invoices', 0).catch(() => [] as Invoice[]),
  ]);
  const assumed = s?.['assume.payment'] !== 'off';
  const registered = !!k?.id;
  /* v10.31 (시안 「N일 안에 등록하지 않으면」) — 유예 일수는 운영 설정(billing.grace_days · 공개 설정)에서 */
  const grace = Number(s?.['billing.grace_days'] ?? '') || null;

  return (
    <><div data-my-payment="">
      <MyHead title="결제 수단"
        sub="월 구독료가 여기 등록된 수단으로 자동 청구됩니다. 카드번호는 소개뱅크 서버에 저장되지 않습니다 — 결제창이 직접 받고 토큰만 돌려줍니다."
        right={<span className="my-ls">계정당 결제 수단 1개</span>} />

      {assumed && (
        <Note kind="warn">
          <b>지금은 연동 전이라 실제 결제가 일어나지 않습니다.</b> 카드를 등록하셔도 청구되지 않습니다 — 결제사 심사가 끝나면 다시 등록하셔야 합니다.
        </Note>
      )}

      {registered && k ? (
        <div className="my-subnow" data-pay-card="">
          <div>
            <span className="my-ls">등록된 카드</span>
            <b className="big">{k.cardCompany ?? '카드'} ****{k.cardLast4 ?? '••••'}</b>
            <span className="my-ls">{ymdKst(k.registeredAt) || '—'} 등록{k.lastUsedAt ? ` · 최근 청구 ${ymdKst(k.lastUsedAt)}` : ''}</span>
          </div>
          <div>
            <span className="my-ls">다음 청구</span>
            <b className="big">{d?.subscribed && d.nextChargeAt ? ymdKst(d.nextChargeAt) : '—'}</b>
            <span className="my-ls">{d?.subscribed ? `${wonP(d.nextChargeAmount ?? d.monthlyPrice ?? null)} · ${d.planName ?? ''}` : '구독이 없습니다'}</span>
          </div>
          <PayMethod registered={registered} assumed={assumed} />
        </div>
      ) : (
        <>
          {/* v10.32 — 카드가 없어도 시안의 「등록된 카드 · 다음 청구 · 단추」 한 줄 모양(빈 상태)으로 */}
          <div className="my-subnow" data-pay-card="" data-pay-empty="">
            <div>
              <span className="my-ls">등록된 카드</span>
              <b className="big">없음</b>
              <span className="my-ls">아직 등록하지 않았습니다</span>
            </div>
            <div>
              <span className="my-ls">다음 청구</span>
              <b className="big">{d?.subscribed && d.nextChargeAt ? ymdKst(d.nextChargeAt) : '—'}</b>
              <span className="my-ls">{d?.subscribed ? `${wonP(d.nextChargeAmount ?? d.monthlyPrice ?? null)} · ${d.planName ?? ''}` : '구독이 없습니다'}</span>
            </div>
            <PayMethod registered={registered} assumed={assumed} />
          </div>
          <Note kind="warn">
            <b>등록된 결제 수단이 없습니다.</b> {d?.subscribed ? `갱신일에 청구가 실패하고, ${grace ? `${grace}일` : '유예 기간'} 안에 등록하지 않으면 구독이 만료됩니다.` : '구독과 리드 이용료를 쓰시려면 등록이 필요합니다.'}
          </Note>
        </>
      )}

      <Note kind="info">
        <b>카드번호는 저장하지 않습니다.</b> 결제창이 카드 정보를 직접 받고 소개뱅크는 청구용 토큰(빌링키)만 보관합니다. 화면에 보이는 것은 카드사와 뒤 4자리뿐입니다.
        청구는 매달 한 번이며, 실패하면 안내가 가고 하루 최대 10회까지 다시 시도합니다.
      </Note>

      <h2 className="my-s2">청구 내역</h2>
      {inv.length === 0 ? (
        <p className="my-ls" data-pay-invoices="0">청구 내역이 없습니다.</p>
      ) : (
        <div className="my-tbl-w">
          <table className="my-tbl">
            <thead><tr><th>기간</th><th>금액</th><th>상태</th><th>비고</th></tr></thead>
            <tbody>
              {inv.map((v) => {
                const st = INV[v.status] ?? [v.status, 'off' as Tone];
                return (
                  <tr key={v.id}>
                    <td>{v.kind === 'EXTRA_CODE' ? ymdKst(v.periodStart) : `${ymdKst(v.periodStart)} ~ ${ymdKst(v.periodEnd).slice(5)}`}</td>
                    <td className="my-num">{wonP(v.amount)}</td>
                    <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
                    <td className="my-ls">{v.kind === 'EXTRA_CODE' ? `초과 소개코드 ${v.codeCount ?? 1}건` : ''}{v.failureReason ?? ''}{v.status === 'FAILED' && v.attempt ? ` · ${v.attempt}회 시도` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Note kind="warn">
        <b>결제 수단을 지우면 다음 갱신이 실패합니다.</b> 해지하려면 결제 수단이 아니라 <Link href="/my/subscription">구독 해지</Link>를 쓰십시오 — 이미 낸 기간은 그대로 이용할 수 있습니다.
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
