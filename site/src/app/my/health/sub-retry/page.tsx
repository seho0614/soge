import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { MyHltNav } from '@/components/health/MyHltNav';
import { HltEmpty } from '@/components/health/HltParts';
import { LsqSubRetryButton } from '@/components/lsq/SubRetryButton';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsq.sub'))('title') };
}
export const dynamic = 'force-dynamic';

type Fails = { on: boolean; days: number[]; items: Array<{ id: string; state: string; failCount: number; productName: string; lastFailOn: string | null; nextTryOn: string | null; nextOn: string }> };

/** SB-HLT-LSQ-010 정기 배송 결제 다시 시도 (v10.606 · docs/748) — GET /lsq/me/subscriptions/fails · 회원 알림 LSQ_SUB_PAY_FAIL 의 링크 */
export default async function SubRetryPage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsq.sub');
  const d = await apiGetPersonal<Fails>('/lsq/me/subscriptions/fails').catch(() => null);
  return (
    <><div className="hlt" data-screen="SB-HLT-LSQ-010" data-lsq-sub-fails={d?.items.length ?? 0}>
      <MyHltNav on="orders" />
      <div className="page-head"><h1>{t('title')}</h1></div>
      <p className="hint">{t('sub')}</p>
      {d && !d.on && <p className="hint">{t('off')}</p>}
      {!d || d.items.length === 0 ? <HltEmpty msg={t('none')} href="/my/health/orders" label={t('title')} /> : (
        <div className="rows">
          {d.items.map((s) => (
            <section key={s.id} className="hlt-box" data-lsq-sub={s.id}>
              <h3>{s.productName}{s.state === 'PAUSED' ? ` · ${t('paused')}` : ''}</h3>
              <p className="hint">{t('line', { n: s.failCount, day: s.lastFailOn ?? '-', next: s.nextTryOn ?? s.nextOn })}</p>
              {d.on && <LsqSubRetryButton id={s.id} label={t('retry')} busyLabel={t('busy')} failLabel={t('failed')} />}
            </section>
          ))}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
