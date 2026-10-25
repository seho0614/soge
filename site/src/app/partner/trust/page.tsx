import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('trust') };
}

interface T {
  total: number; viewed: number;
  avgViewMin: number | null; viewRate: number | null;
  badges?: Array<{ code: string; name: string; state: string; detail: string | null }>;
}
const BADGE_TONE: Record<string, 'ok' | 'wait' | 'no' | 'off'> = { '달성': 'ok', '심사중': 'wait', '반려': 'no' };

/**
 * SB-PTC-CTR-600 신뢰지표 — v10.29 시안 scPtnTrust 배치(조건 줄 .crow + 상태 배지 → 안내)
 *
 * 리드를 받아 놓고 열어 보지 않으면 **요청자가 그동안 기다립니다.** 숫자를 보여 주어야 고칠 수 있습니다.
 * v10.31 (W5 · 10/10 시안 기준) — 시안의 줄 「배지 이름 · 조건 · 상태」를 서버 배지(fn_partner_badges — 조건이 만들고 사라지면 내려감)로 먼저 두고,
 *   개발에만 있던 실제 지표 3가지(받은 리드 · 열람률 · 평균 열람)는 아래에 그대로 둡니다. 「누적 ○○」 라벨은 업종별입니다.
 */
export default async function TrustPage() {
  const p = await me();
  if (!p) redirect('/login');

  const tr = await getTranslations('partner.trust');
  const tp = await getTranslations('partner');
  const B = (c: React.ReactNode) => <b>{c}</b>;
  const t = await apiGet<T>('/partner/trust', 0).catch(() => null);
  if (!t) return <><Pgh title={tr('title')} /><Empty>{tp('common.notPartner')}</Empty><i hidden data-root-end="" /></>;

  const slow = (t.avgViewMin ?? 0) > 180;
  const low = (t.viewRate ?? 100) < 60;
  const avg = t.avgViewMin == null ? '—' : t.avgViewMin < 60 ? tp('common.min', { n: String(t.avgViewMin) }) : tp('common.hour', { n: String(Math.round(t.avgViewMin / 60)) });

  return (
    <><Pgh title={tr('title')} sub={tr('sub')} />
      {(t.badges ?? []).map((b) => (
        <div className="pt-crow" key={b.code} data-badge={b.code}>
          <div><b>{b.name}</b><span className="pt-ls">{b.detail ?? ''}</span></div>
          <Bg tone={BADGE_TONE[b.state] ?? 'off'}>{b.state}</Bg>
        </div>
      ))}
      <Note kind="info">{tr.rich('badgeNote', { b: B })}</Note>
      {/* v10.32 — 시안의 「업종별 라벨」 노란 띠 자리. 시안 문구(아직 갈리지 않음)는 개발 현황 메모라, 실제 규칙(서버 배지 이름이 업종별)을 적습니다 */}
      <Note kind="warn" data-trust-label="">{tr.rich('labelNote', { b: B, br: () => <br /> })}</Note>
      <h2 className="pt-s2">{tr('resp')}</h2>
      <p className="pt-ls" style={{ margin: '0 0 8px' }}>{tr.rich('respP', { b: B })}</p>

      <div className="pt-crow">
        <div><b>{tr('recv')}</b><span className="pt-ls">{tr('recvSub')}</span></div>
        <div><span className="v">{tr('cases', { n: String(t.total) })}</span></div>
      </div>
      <div className="pt-crow">
        <div><b>{tr('viewRate')}</b><span className="pt-ls">{tr('viewRateSub')}</span></div>
        <div><span className="v">{t.viewRate ?? '—'}{t.viewRate != null ? '%' : ''}</span><Bg tone={low ? 'no' : 'ok'}>{low ? tr('low') : tr('ok')}</Bg></div>
      </div>
      <div className="pt-crow">
        <div><b>{tr('avgView')}</b><span className="pt-ls">{tr('avgViewSub')}</span></div>
        <div><span className="v">{avg}</span><Bg tone={t.avgViewMin == null ? 'off' : slow ? 'no' : 'ok'}>{t.avgViewMin == null ? tr('noRecord') : slow ? tr('slow') : tr('ok')}</Bg></div>
      </div>

      {slow || low ? (
        <Note kind="warn">
          <b>{tr('improve')}</b>
          {slow ? tr('slowNote') : ''}
          {low ? tr('lowNote') : ''}
        </Note>
      ) : (
        <Note kind="ok">{tr.rich('stable', { b: B })}</Note>
      )}

      <Note kind="info">
        {tr.rich('unviewed', { b: B })}
      </Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">{tr('leads')}</Link>
        <Link className="pt-bo" href="/partner/performance">{tr('perf')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
