import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ViewLeadButton, ContactButton } from './ViewLeadButton';
import { LeadMemo } from './LeadMemo';
import { dtKst, ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tabs, Tw, won } from '@/components/partner/ui';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.leads'))('title') };
}

interface Lead {
  deliveryId: string; leadId: string; summary: string;
  sido: string | null; sigungu: string | null;
  urgent: boolean; deliveredAt: string; viewedAt: string | null;
  fee: string | null; contact: string | null;
  state?: 'DELIVERED' | 'VIEWED' | 'EXPIRED' | 'REVOKED';
  expiresAt?: string | null; categoryName?: string | null; hasContact?: boolean; note?: string | null;
  /* v10.31 (W5) */
  grade?: string | null; gradeLabel?: string | null; alimState?: string; feeQuote?: string | number | null;
  memo?: string | null; memoCount?: number; disputeState?: string | null; disputeId?: number | null;
}
interface Stats { rates: Array<{ grade: string; rate: string | number; label?: string; alimBand?: string | null }> }
interface Rejects { cap: { month: string; received: number; used: number; cap: number }; note: string }
interface Pricing { myFee: number | null; formType: string | null }

type Tab = 'all' | 'new' | 'done' | 'rej' | 'exp';
const isRej = (l: Lead) => !!l.disputeState && l.disputeState === 'REQUESTED';
const isNew = (l: Lead) => !l.viewedAt && l.state !== 'EXPIRED' && l.state !== 'REVOKED';
const isDone = (l: Lead) => !!l.viewedAt && !isRej(l);
const isExp = (l: Lead) => !l.viewedAt && (l.state === 'EXPIRED' || l.state === 'REVOKED');
/* 알림톡 상태 · 등급 조건 글자는 사전 partnerOps.leads.alim.<코드> · band.<코드> (v10.100 · 2-5a) */
const gcls = (label?: string | null) => (label ? `g${label.replace(/[+\-]/, '')}` : 'miss');

/**
 * SB-PTC-CTR-300 상담 신청 — v10.31 (W5 · 10/10 시안 기준 scPtnLead)
 *   탭(전체 · 확인 전 · 확인 완료 · 반려 신청 + 개발에만 있던 「기한 지남」) → 상담 줄(등급 배지 · 알림톡 · 상태 · 확인비용 · 메모) →
 *   「등급 · 확인비용」 표(등급 · 비율 · 확인비용 · 붙는 조건) → 「반려 한도」 막대(이번 달 받은 리드의 15%) → 반려 · 이의신청 단추.
 *   등급은 알림톡 결과가 정합니다 — 연동 전에는 「미판정」(기준 단가 그대로)으로 보입니다(지어내지 않음).
 *   열람 전에는 요약만 보입니다(시안의 「이**」 가린 이름도 열람 전에는 내지 않음 — 개인정보 보호 유지).
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const tab: Tab = (['all', 'new', 'done', 'rej', 'exp'] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : 'all';

  const [leads, stats, rej, pricing] = await Promise.all([
    apiGet<Lead[]>('/partner/leads', 0).catch(() => [] as Lead[]),
    apiGet<Stats>('/partner/stats', 0).catch(() => null),
    apiGet<Rejects>('/partner/rejects', 0).catch(() => null),
    apiGet<Pricing[]>('/partner/pricing', 0).catch(() => [] as Pricing[]),
  ]);
  const unread = leads.filter(isNew).length;
  const rows = leads.filter((l) => tab === 'all' || (tab === 'new' ? isNew(l) : tab === 'done' ? isDone(l) : tab === 'rej' ? isRej(l) : isExp(l)));
  const href = (t: Tab) => (t === 'all' ? '/partner/leads' : `/partner/leads?tab=${t}`);
  /* 등급표의 「최고 확인비용」 — 내 업종 중 가장 높은 S 단가(시안 grade.top) */
  const top = pricing.reduce((m, r) => Math.max(m, Number(r.myFee ?? 0)), 0);
  const cap = rej?.cap;
  const t = await getTranslations('partnerOps.leads');
  const f = await getFmt();
  const code = (g: 'alim' | 'band', c: string) => (t.has(`${g}.${c}` as never) ? t(`${g}.${c}` as never) : c);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />

      <Tabs cur={tab} items={[
        { key: 'all', label: t('tab.all'), count: leads.length, href: href('all') },
        { key: 'new', label: t('tab.new'), count: unread, href: href('new') },
        { key: 'done', label: t('tab.done'), count: leads.filter(isDone).length, href: href('done') },
        { key: 'rej', label: t('tab.rej'), count: leads.filter(isRej).length, href: href('rej') },
        { key: 'exp', label: t('tab.exp'), count: leads.filter(isExp).length, href: href('exp') },
      ]} />

      {leads.length === 0 ? (
        <Empty>
          {t('emptyAll')}
        </Empty>
      ) : rows.length === 0 ? (
        <Empty>{t('emptyTab')}</Empty>
      ) : rows.map((l) => {
        const done = !!l.viewedAt;
        const exp = isExp(l);
        const rj = isRej(l);
        const label = l.gradeLabel ?? null;
        return (
          <article key={l.deliveryId} data-lead-row={l.deliveryId} data-delivery={l.deliveryId}
                   className={`pt-lrow${exp ? ' read' : ''} req${done || exp ? ' done' : ''}`}>
            <div className="lt">
              <div className="lh">
                <span className={`pt-gbadge ${gcls(label)}`} title={label ? t('gradeTitle', { label }) : t('gradeNone')}>{label ?? t('ungraded')}</span>
                <span className="pt-ck">{t('alimLabel')} {code('alim', l.alimState ?? 'NONE')}</span>
                {l.urgent ? <Bg tone="no">{t('urgent')}</Bg> : null}
                <Bg tone={rj ? 'wait' : done ? 'ok' : exp ? 'off' : 'wait'}>{rj ? t('tab.rej') : done ? t('tab.done') : exp ? t('tab.exp') : t('tab.new')}</Bg>
              </div>
              <b>{l.summary}</b>
              <span className="pt-ls">
                L-{l.leadId.replace(/-/g, '').slice(0, 6).toUpperCase()} · {l.categoryName ? `${l.categoryName} · ` : ''}
                {[l.sido, l.sigungu].filter(Boolean).join(' ')} · {t('receivedOn', { d: ymdKst(l.deliveredAt) })}
                {!l.viewedAt && l.state === 'DELIVERED' && l.expiresAt ? ` · ${t('viewUntil', { d: dtKst(l.expiresAt) })}` : ''}
              </span>
              {exp ? <span className="pt-ls">{l.note ?? t('expiredNote')} {t('noFee')}</span> : null}
              {done ? <LeadMemo deliveryId={l.deliveryId} last={l.memo ?? null} count={l.memoCount ?? 0} /> : null}
            </div>
            <div className="pt-lstat">
              <span>{t('fee')} <b>{l.fee ? f.wonOf(won(l.fee)) : l.feeQuote != null ? f.wonOf(won(l.feeQuote)) : '—'}</b>{!l.fee && !done && !exp ? <span className="pt-ls"> {t('onOpen')}</span> : null}</span>
            </div>
            <div className="pt-lact">
              {rj ? (
                <button className="pt-bo sm off" disabled title={t('reviewingTitle')}>{t('reviewing')}</button>
              ) : done ? (
                l.hasContact === false
                  ? <span className="pt-ls">{t('legacyLead')}</span>
                  : <ContactButton deliveryId={l.deliveryId} />
              ) : exp ? (
                <button className="pt-bo sm off" disabled title={t('expiredTitle')}>{t('tab.exp')}</button>
              ) : (
                <ViewLeadButton deliveryId={l.deliveryId} fee={l.feeQuote ?? null} />
              )}
            </div>
          </article>
        );
      })}

      <S2>{t('gradeH')}</S2>
      <Note kind="info">
        {t.rich('gradeNote', { b: (c) => <b>{c}</b> })}{top ? t.rich('gradeTop', { fee: f.wonOf(won(top)), b: (c) => <b>{c}</b>, a: (c) => <Link href="/partner/pricing">{c}</Link> }) : null}
      </Note>
      {stats?.rates?.length ? (
        <Tw head={[t('th.grade'), t('th.rate'), t('th.fee'), t('th.cond')]} numCols={[1, 2]}>
          {stats.rates.map((r) => (
            <tr key={r.grade}>
              <td><span className={`pt-gbadge ${gcls(r.label ?? r.grade)}`}>{r.label ?? r.grade}</span></td>
              <td className="num">{Math.round(Number(r.rate) * 100)}%</td>
              <td className="num"><b>{top ? f.wonOf(won(Math.round(top * Number(r.rate)))) : '—'}</b></td>
              <td>{r.alimBand ? code('band', r.alimBand) : '—'}</td>
            </tr>
          ))}
        </Tw>
      ) : <Empty>{t('rateFail')}</Empty>}
      <Note kind="warn">
        {t.rich('alimWarn', { b: (c) => <b>{c}</b> })}
      </Note>

      <S2>{t('capH')}</S2>
      {cap ? (
        <div className="pt-cap" data-reject-cap>
          <div className="cb"><div className="cf" style={{ width: `${Math.min(100, Math.round((cap.used / Math.max(1, cap.cap)) * 100))}%` }} /></div>
          <div className="cl"><b>{t('capCount', { used: String(cap.used), cap: String(cap.cap) })}</b><span className="pt-ls">{cap.month} · {t('capOf', { n: String(cap.received) })}</span></div>
        </div>
      ) : <Empty>{t('capFail')}</Empty>}
      <Note kind="info">{t.rich('capNote', { b: (c) => <b>{c}</b> })}</Note>
      <div className="pt-pact"><Link className="pt-bo" href="/partner/leads-rejects">{t('rejLink')}</Link></div>
    <i hidden data-root-end="" /></>
  );
}
