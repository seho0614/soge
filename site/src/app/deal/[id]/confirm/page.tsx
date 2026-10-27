import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst } from '@/lib/format';
import { DealConfirm } from '@/components/DealConfirm';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('confirm') };
}

/**
 * SB-HOM-DEL-030 성사 확정 — v10.31 시안 scDealConfirm: 3단계 띠 · 거래 정보 표 · 확인 n/2 목록 · 7일 자동 안내 · 정산 신청으로 / 이전 — 결제.
 *   확정 경로는 둘입니다 (2026-10-01 결정 Q3) — ① 양측이 여기서 각각 「거래 성사 확인」 ② 계약서 양측 서명(A-15). 버튼(DealConfirm)은 그대로.
 */
export default async function ConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await me())) redirect('/login');
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const t = await getTranslations('deal');
  const conf = (p: string) => d.confirmations.find((c) => c.party === p);
  const parties: Array<[string, string, string]> = [['BUYER', t('confirm.buyer'), d.buyer], ['SELLER', t('confirm.seller'), d.seller]];
  const done = parties.filter(([p]) => conf(p)).length;
  const all = ['CONFIRMED', 'SETTLED'].includes(d.status) || done === 2;
  const mine = d.myRole !== 'INTRODUCER' && !conf(d.myRole) && !all;
  return (
    <DealShell d={d} step={2} title={t('confirm.title')} sub={t('confirm.sub')}>
      <div className="w1-cfm">
        <div className="cn"><b>{t('confirm.count', { n: String(all ? 2 : done) })}</b><span className={`w1-bg ${all ? 'ok' : 'wait'}`}>{all ? t('confirm.title') : t('confirm.waiting')}</span></div>
        {parties.map(([p, role, name]) => {
          const c = conf(p);
          return (
            <div key={p} className="cw">
              <div><b>{role} · {name}</b>{d.myRole === p ? t('common.me') : ''}
                <div className="w1-ls">{c ? `${dtKst(c.confirmedAt)}${c.isAuto ? t('confirm.auto') : ''}` : all ? t('confirm.bySign') : t('confirm.notYet')}</div></div>
              {c || all ? <span className="w1-bg ok">{t('confirm.checked')}</span> : <span className="w1-bg wait">{t('common.wait')}</span>}
            </div>
          );
        })}
      </div>
      <div className="w1-nt warn" style={{ marginTop: 10 }}>{t.rich('confirm.autoNote', { b: (c) => <b>{c}</b> })}</div>
      {all
        ? <div className="w1-nt ok" style={{ marginTop: 8 }}>{withCodes(t.rich('confirm.allDone', { b: (c) => <b>{c}</b> }))}{d.confirmedAt ? t('confirm.confirmedAt', { at: dtKst(d.confirmedAt) }) : ''}</div>
        : <div className="w1-nt" style={{ marginTop: 8 }}>{t.rich('confirm.notReady', { n: String(done), b: (c) => <b>{c}</b> })}</div>}
      {/* 거래 당사자에게는 늘 둡니다 — 확인한 뒤(mine 이 거짓)에도 같은 자리에 남아 결과 글이 지워지지 않음(단추만 빠짐) */}
      {d.myRole !== 'INTRODUCER' && <Msgs ns={['deal']}><DealConfirm dealId={d.id} done={!mine} /></Msgs>}
      <div className="w1-dact">
        {all ? <Link className="w1-bp" href="/my/settlement">{t('confirm.settle')}</Link>
          : <button className="w1-bp" disabled title={t('confirm.settleTitle')}>{t('confirm.settle')}</button>}
        <Link className="w1-bo" href={`/deal/${d.id}/payment`}>{t('confirm.prev')}</Link>
        {all && d.myRole !== 'INTRODUCER' && <Link className="w1-bo" href={`/deal/${d.id}/review`}>{t('confirm.review')}</Link>}
      </div>
    </DealShell>
  );
}
