import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { PayMethod } from '@/components/PayMethod';
import type { SubDetail } from '@/components/billing/SubscriptionManage';
import { MyHead, Note, type Tone } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';   // v10.101 — 아래 부품이 쓰는 사전 묶음(deal · docs/159)
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.pay'))('title') };
}

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
/** v10.99 — 상태 이름은 사전 키(my.pay.inv.*) */
const INV: Record<string, ['paid' | 'failed' | 'pending' | 'refunded' | 'skipped', Tone]> = {
  PAID: ['paid', 'ok'], FAILED: ['failed', 'no'], PENDING: ['pending', 'wait'], REFUNDED: ['refunded', 'off'], SKIPPED: ['skipped', 'off'],
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
export default async function PaymentPage({ searchParams }: { searchParams: Promise<{ card?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('my.pay');
  const tc = await getTranslations('deal.payMethod');
  const cardFail = (await searchParams).card === 'fail';   // v10.148 — 카드 등록 창 실패 · 취소로 돌아옴
  const f = await getFmt();
  const B = (c: React.ReactNode) => <b>{c}</b>;

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
      <MyHead title={t('title')}
        sub={t('sub')}
        right={<span className="my-ls">{t('onePerAccount')}</span>} />

      {cardFail && <Note kind="warn"><span data-card-fail="">{tc('cardFail')}</span></Note>}

      {assumed && (
        <Note kind="warn">
          <b>{t('assumedB')}</b> {t('assumedText')}
        </Note>
      )}

      {registered && k ? (
        <div className="my-subnow" data-pay-card="">
          <div>
            <span className="my-ls">{t('card')}</span>
            <b className="big">{k.cardCompany ?? t('cardDefault')} ****{k.cardLast4 ?? '••••'}</b>
            <span className="my-ls">{t('registered', { date: ymdKst(k.registeredAt) || '—' })}{k.lastUsedAt ? t('lastCharged', { date: ymdKst(k.lastUsedAt) }) : ''}</span>
          </div>
          <div>
            <span className="my-ls">{t('nextCharge')}</span>
            <b className="big">{d?.subscribed && d.nextChargeAt ? ymdKst(d.nextChargeAt) : '—'}</b>
            <span className="my-ls">{d?.subscribed ? `${f.won(d.nextChargeAmount ?? d.monthlyPrice ?? null, '—')} · ${d.planName ?? ''}` : t('noSub')}</span>
          </div>
          <Msgs ns={['deal']}><PayMethod registered={registered} assumed={assumed} customerKey={p.accountId} /></Msgs>
        </div>
      ) : (
        <>
          {/* v10.32 — 카드가 없어도 시안의 「등록된 카드 · 다음 청구 · 단추」 한 줄 모양(빈 상태)으로 */}
          <div className="my-subnow" data-pay-card="" data-pay-empty="">
            <div>
              <span className="my-ls">{t('card')}</span>
              <b className="big">{t('none')}</b>
              <span className="my-ls">{t('notYet')}</span>
            </div>
            <div>
              <span className="my-ls">{t('nextCharge')}</span>
              <b className="big">{d?.subscribed && d.nextChargeAt ? ymdKst(d.nextChargeAt) : '—'}</b>
              <span className="my-ls">{d?.subscribed ? `${f.won(d.nextChargeAmount ?? d.monthlyPrice ?? null, '—')} · ${d.planName ?? ''}` : t('noSub')}</span>
            </div>
            <Msgs ns={['deal']}><PayMethod registered={registered} assumed={assumed} customerKey={p.accountId} /></Msgs>
          </div>
          <Note kind="warn">
            <b>{t('noCardB')}</b> {d?.subscribed ? t('noCardSub', { period: grace ? t('days', { n: String(grace) }) : t('grace') }) : t('noCardFree')}
          </Note>
        </>
      )}

      <Note kind="info">
        <b>{t('noStoreB')}</b> {t('noStoreText')}
      </Note>

      <h2 className="my-s2">{t('hInvoices')}</h2>
      {inv.length === 0 ? (
        <p className="my-ls" data-pay-invoices="0">{t('noInvoices')}</p>
      ) : (
        <div className="my-tbl-w">
          <table className="my-tbl">
            <thead><tr><th>{t('thPeriod')}</th><th>{t('thAmount')}</th><th>{t('thStatus')}</th><th>{t('thNote')}</th></tr></thead>
            <tbody>
              {inv.map((v) => {
                const s = INV[v.status];
                const st: [string, Tone] = s ? [t(`inv.${s[0]}`), s[1]] : [v.status, 'off'];
                return (
                  <tr key={v.id}>
                    <td>{v.kind === 'EXTRA_CODE' ? ymdKst(v.periodStart) : `${ymdKst(v.periodStart)} ~ ${ymdKst(v.periodEnd).slice(5)}`}</td>
                    <td className="my-num">{f.won(v.amount, '—')}</td>
                    <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
                    <td className="my-ls">{v.kind === 'EXTRA_CODE' ? t('extraRow', { n: String(v.codeCount ?? 1) }) : ''}{v.failureReason ?? ''}{v.status === 'FAILED' && v.attempt ? t('attempts', { n: String(v.attempt) }) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Note kind="warn">
        {t.rich('removeNote', { b: B, a: (c) => <Link href="/my/subscription">{c}</Link> })}
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
