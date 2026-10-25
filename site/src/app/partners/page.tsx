import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { AffiliateApply } from '@/components/partners/AffiliateApply';
import { P2Promo } from '@/components/partner/P2Promo';
import { ymd, ORDER_STATE, codeText } from '@/components/partners/fmt';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';
import type { AffDashboard, AffLink, AffProduct, Notice } from '@/components/partners/types';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('dash.title') };
}

interface LeadDash { applied: boolean; status?: string; note?: string }

/**
 * SB-AFC-DSH-010 대시보드
 *
 * v10.31 (W5 · 10/10 시안 기준 scP2Dsh) — 숫자 6칸을 시안 그대로(모두 실제 값 · 서버 계산):
 *   오늘 소개수익(어제보다) · 이번 달 누적수익(지난 달 같은 기간 대비) · 정산 예정금액(익월 지급일) · 소개 고객 수(어제보다) ·
 *   거래 건수(어제보다) · 파트너 등급(다음 등급까지 — 기준은 운영이 정하며 비면 그렇게 적음).
 *   추천상품의 「🔥인기 · ❤고수익」 표지와 사진(운영 · 인기는 최근 7일 주문으로도 셈) · 「지금, 이런 성과가 있어요!」 구매 소식(이름 없이 시 · 도만).
 *   개발에만 있던 오늘 클릭 · 이번 달 클릭 · 사용 중 링크는 숫자 칸 아래 한 줄로 남깁니다.
 *
 * 이번 달 클릭 · 주문 · 수익 · 정산 예정, 목표 달성률, 최근 주문.
 * ★ 목표는 운영이 정합니다 — 없으면 "아직 정해지지 않았습니다" 로 둡니다(0% 로 보이면 오해합니다).
 * v10.100 (다국어 2-5a) — 글자는 사전 affiliate.dash(tr). v10.102 (2-5c) — 금액 · 날짜 · 「○분 전」은 getFmt(fm) — 한국어는 그대로, 다른 언어는 ₩ 전체 숫자 · 영어 날짜.
 * ★ 제휴수수료는 회사가 지급합니다. 소개비(당사자끼리)와 헷갈리지 않게 note 를 항상 띄웁니다.
 */
export default async function PartnersDashboard() {
  const p = await me();
  if (!p) redirect('/login');
  const tr = await getTranslations('affiliate');
  const fm = await getFmt();

  const d = await apiGetPersonal<AffDashboard>('/partner/affiliate/dashboard').catch(() => null);

  if (!d) {
    return (
      <><div className="p2body"><div className="page-head"><h1>{tr('dash.h1')}</h1></div><p className="form-error">{tr('dash.loadFail')}</p></div><i hidden data-root-end="" /></>
    );
  }

  /* ── 파트너가 아닌 계정: 신청 방법 ─────────────────────────── */
  if (!d.ok) {
    const lead = await apiGetPersonal<LeadDash>('/partner/dashboard').catch(() => null);
    /* v10.38 (D096 · P2P) — 본인인증 개인도 파트너가 됩니다(사업자 인증은 선택) */
    const actorOk = !!(p.identityVerifiedAt || p.businessVerifiedAt);
    const applied = !!lead?.applied;
    return (
      <div className="p2body">
        <div className="page-head"><h1>{tr('dash.title')}</h1></div>
        <p className="lead">
          {tr.rich('dash.apply.lead', { b: (c) => <b>{c}</b> })}
        </p>
        <h2 id="apply" className="sec-title">{tr('dash.apply.title')}</h2>
        <ol className="p2steps">
          <li className={actorOk ? 'done' : 'now'}>
            <strong>{tr('dash.apply.s1')}</strong> <span className="dim">{p.businessVerifiedAt ? tr('dash.apply.s1Biz') : actorOk ? tr('dash.apply.s1Personal') : tr('dash.apply.s1Need')}</span>
            <p>{tr('dash.apply.s1Desc')}</p>
            {!actorOk && <Link className="btn-sm" href="/verify">{tr('common.verifyNow')}</Link>}
          </li>
          <li className={applied ? 'done' : actorOk ? 'now' : ''}>
            <strong>{tr('dash.apply.s2')}</strong> <span className="dim">{applied ? tr('dash.apply.applied') : tr('dash.apply.waiting')}</span>
            <p>{tr('dash.apply.s2Desc')}</p>
            {actorOk && !applied && <AffiliateApply />}
          </li>
          <li className={applied ? 'now' : ''}>
            <strong>{tr('dash.apply.s3')}</strong>{' '}
            <span className="dim">{applied ? (lead?.status === 'ACTIVE' ? tr('dash.apply.approved') : tr('dash.apply.reviewing')) : tr('dash.apply.waiting')}</span>
            <p>{tr('dash.apply.s3Desc')}</p>
          </li>
        </ol>
        <p className="hint">{tr.rich('dash.apply.hint', { a: (c) => <Link href="/partners/guides">{c}</Link> })}</p>
      </div>
    );
  }

  /* ── 파트너: 이번 달 현황 (v10.29 시안 배치) ─────────────────────── */
  const [links, products, notices] = await Promise.all([
    apiGetPersonal<AffLink[]>('/partner/affiliate/links').catch(() => [] as AffLink[]),
    apiGetPersonal<AffProduct[]>('/partner/affiliate/products').catch(() => [] as AffProduct[]),
    apiGet<Notice[]>('/notices', 60).catch(() => [] as Notice[]),
  ]);
  const m = d.month ?? { clicks: 0, orders: 0, earned: 0, payable: 0 };
  const firstLink = links.find((l) => l.isActive);
  const rate = d.goal?.rate ?? null;
  const todayClicks = links.reduce((a, l) => a + (l.clicksToday ?? 0), 0);
  const activeLinks = links.filter((l) => l.isActive).length;
  const origin = await siteOrigin();
  const shareUrl = firstLink ? origin + (firstLink.sharePath ?? `/r/${firstLink.code}`) : null;
  const n = (v: number | string) => Number(v || 0).toLocaleString('ko-KR');

  const DELTA = { won: ['dash.delta.upWon', 'dash.delta.downWon'], people: ['dash.delta.upPeople', 'dash.delta.downPeople'], count: ['dash.delta.upCount', 'dash.delta.downCount'] } as const;
  const delta = (v: number | undefined, unit: keyof typeof DELTA) => v == null ? null
    : v > 0 ? <span className="up">{tr(DELTA[unit][0], { n: unit === 'won' ? fm.wonOf(n(v)) : n(v) })}</span> : v < 0 ? <span className="dn">{tr(DELTA[unit][1], { n: unit === 'won' ? fm.wonOf(n(-v)) : n(-v) })}</span> : <span>{tr('dash.delta.same')}</span>;
  const t = d.today;
  const tier = d.tier;
  const GR = (g: string) => codeText(tr, 'dash.grade', g);
  const pay = d.payoutDate ? fm.mdNum(Number(d.payoutDate.slice(5, 7)), Number(d.payoutDate.slice(8, 10)), `${Number(d.payoutDate.slice(5, 7))}월 ${Number(d.payoutDate.slice(8, 10))}일`) : null;
  const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  const kpi = (color: string, icon: ReactNode, label: string, value: string, unit: string, sub?: ReactNode) => (
    <div className="p2kpi">
      <span className="ic" style={{ background: color }}>{icon}</span>
      <div>
        <div className="k">{label}</div>
        <div className="v">{value}<small>{unit}</small></div>
        {sub ? <div className="n">{sub}</div> : null}
      </div>
    </div>
  );
  const svg = (d2: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" aria-hidden>{d2}</svg>;

  return (
    <div className="p2dgrid">
      <div className="p2dl">
        <div className="p2kpis6">
          {kpi('var(--sgb-mall)', <b style={{ color: '#fff', fontSize: 16 }}>₩</b>, tr('dash.kpi.todayEarned'), fm.ko ? n(t?.earned ?? 0) : fm.wonOf(n(t?.earned ?? 0)), fm.ko ? '원' : '', delta(t?.earnedDelta, 'won'))}
          {kpi('var(--sgb-link)', svg(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>), tr('dash.kpi.monthEarned'), fm.ko ? n(m.earned) : fm.wonOf(n(m.earned)), fm.ko ? '원' : '',
            m.deltaPct != null ? (m.deltaPct >= 0 ? <span className="up">{tr('dash.kpi.momUp', { pct: String(m.deltaPct) })}</span> : <span className="dn">{tr('dash.kpi.momDown', { pct: String(-m.deltaPct) })}</span>) : tr('dash.kpi.confirmedSettled'))}
          {kpi('var(--sgb-biz)', svg(<><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /></>), tr('dash.kpi.payable'), fm.ko ? n(m.payable) : fm.wonOf(n(m.payable)), fm.ko ? '원' : '', pay ? <>{tr.rich('dash.kpi.payOn', { date: pay, a: (c) => <Link href="/partners/settlements">{c}</Link> })}</> : <Link href="/partners/settlements">{tr('dash.kpi.settlementsLink')}</Link>)}
          {kpi('var(--sgb-link)', svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>), tr('dash.kpi.customers'), n(d.customers?.today ?? 0), tr('dash.kpi.unitPeople'), delta(d.customers?.delta, 'people'))}
          {kpi('var(--sgb-navy)', svg(<><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>), tr('dash.kpi.orders'), n(t?.orders ?? 0), tr('dash.kpi.unitCount'), delta(t?.ordersDelta, 'count'))}
          <div className="p2kpi">
            <span className="ic" style={{ background: 'var(--sgb-or-text)' }}>{svg(<path d="M2 7l5 3 5-6 5 6 5-3-2 12H4z" />)}</span>
            <div style={{ flex: 1 }}>
              <div className="k">{tr('dash.kpi.grade')}</div>
              <div className="v tier">{tier?.grade ? tr('dash.kpi.gradeName', { grade: GR(tier.grade) }) : '—'}</div>
              <div className="p2bar" aria-hidden style={{ marginTop: 6 }}><i style={{ width: `${tier?.progress ?? 0}%` }} /></div>
              <div className="n">{tier?.remaining != null && tier.next ? tr('dash.kpi.nextRemain', { grade: GR(tier.next), amount: fm.wonOf(n(tier.remaining)) }) : tier?.next ? (tier.note ?? tr('dash.kpi.nextNote')) : tr('dash.kpi.top')}</div>
            </div>
          </div>
        </div>
        <p className="p2sub" data-p2-devkpi>{tr.rich('dash.kpi.devLine', { today: n(todayClicks), month: n(m.clicks), links: n(activeLinks), a: (c) => <Link href="/partners/links">{c}</Link> })}</p>

        <section className="p2card2">
          <div className="p2sechd"><h2>{tr('dash.rec.title')} <span aria-hidden>🚀</span></h2><Link href="/partners/products">{tr('dash.rec.all')}</Link></div>
          <p className="p2sub">{tr('dash.rec.sub')}</p>
          {products.length ? (
            <div className="p2pcards">
              {products.slice(0, 3).map((x) => (
                <div key={x.id} className="p2pc">
                  {x.imagePath ? (
                    <div className="ph">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={x.imagePath} alt="" loading="lazy" />
                    </div>
                  ) : null}
                  <div className="bd">
                    {x.tag ? <span className={`tag ${x.tag === 'HOT' ? 'hot' : 'high'}`}>{x.tag === 'HOT' ? tr('dash.rec.tagHot') : tr('dash.rec.tagHigh')}</span> : null}
                    <strong>{x.name}</strong>
                    <p>{x.description ?? x.advertiser ?? ''}</p>
                    <div className="earn">{tr('dash.rec.earn', { amount: fm.won(x.commission, '—') })}</div>
                    <Link className="bt" href="/partners/products">{tr('dash.rec.introduce')}</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="empty">{tr('common.noProductsOnSale')}</p>}
        </section>

        <section className="p2card2">
          <h2>{tr('dash.promo.title')}</h2>
          <p className="p2sub">{tr('dash.promo.sub')}</p>
          <P2Promo url={shareUrl} label={firstLink?.product ?? null} />
        </section>
      </div>

      <div className="p2dr">
        <section className="p2card2 sm">
          <div className="p2sechd"><h2>{tr('dash.goal.title')}</h2><Link href="/partners/revenues">{tr('dash.goal.detail')}</Link></div>
          {d.goal ? (
            <>
              <div className="p2rate"><b>{rate ?? 0}%</b><span>{fm.won(m.earned, '—')} / {fm.won(d.goal.target, '—')}</span></div>
              <div className="p2bar" aria-hidden><i style={{ width: `${Math.min(rate ?? 0, 100)}%` }} /></div>
              {d.goalCheer ? <p className="p2sub">💬 &quot;{d.goalCheer}&quot;</p> : null}
              {d.goal.reward != null && <p className="p2sub">{tr('dash.goal.reward', { amount: fm.won(d.goal.reward, '—'), source: String(d.goal.source) })}</p>}
            </>
          ) : (
            <p className="p2sub">{tr('dash.goal.none')}</p>
          )}
        </section>

        <section className="p2card2 sm">
          <div className="p2sechd"><h2>{tr('dash.feed.title')} <span aria-hidden>🔥</span></h2><Link href="/partners/orders">{tr('common.more')}</Link></div>
          {d.feed?.length ? (
            <div className="p2feed" data-p2-feed>
              {d.feed.map((f, i) => (
                <div key={i} className="rw">
                  <span className="t">{fm.ago(f.at, ago(f.at), true)}</span> {tr.rich(f.kind === 'MALL' ? 'dash.feed.mall' : 'dash.feed.service', { area: f.area || 'none', product: f.product, b: (c) => <b>{c}</b> })}{' '}
                  {f.amount > 0 ? <em>+{fm.won(f.amount, '—')}</em> : null}
                </div>
              ))}
            </div>
          ) : <p className="p2sub">{tr('dash.feed.empty')}</p>}
          {d.recent?.length ? (
            <details className="p2mine"><summary>{tr('dash.feed.mine', { n: String(d.recent.length) })}</summary>
              <div className="p2feed">
                {d.recent.map((o) => (
                  <div key={o.orderNo} className="rw">
                    <span className="t">{ymd(o.orderedAt)}</span> <b>{o.product}</b>{' '}
                    <span className={'state ' + (ORDER_STATE[o.state]?.c ?? '')}>{codeText(tr, 'orderState', o.state)}</span>{' '}
                    <em>+{fm.won(o.commission, '—')}</em>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <p className="p2sub" style={{ marginTop: 6 }}>{tr('dash.feed.privacy')}</p>
        </section>

        <Link className="p2navy" href="/partners/guides">
          <div className="p2nhd"><b><span aria-hidden>🚀</span> {tr('dash.navy.brand')}</b><span aria-hidden>›</span></div>
          <p>{tr.rich('dash.navy.text', { br: () => <br /> })}</p>
          <ul>
            <li>{tr('dash.navy.li1')}</li>
            <li>{tr('dash.navy.li2')}</li>
            <li>{tr('dash.navy.li3')}</li>
          </ul>
          <div className="go">{tr('dash.navy.go')}</div>
        </Link>

        <section className="p2card2 sm">
          <div className="p2sechd"><h2>{tr('dash.notices.title')}</h2><Link href="/partners/notices">{tr('common.more')}</Link></div>
          {notices.length ? (
            <ul className="p2ntc">
              {notices.slice(0, 3).map((x) => (
                <li key={x.id}><Link href={`/partners/notices#n-${x.id}`}>{x.isPinned ? tr('dash.notices.pinned') : ''}{x.title}</Link><span>{ymd(x.publishedAt)}</span></li>
              ))}
            </ul>
          ) : <p className="p2sub">{tr('common.noNotices')}</p>}
        </section>

        {d.note && <p className="p2note">{d.note}</p>}
      </div>
    </div>
  );
}

/** 공유 주소의 도메인 — 내 소개링크 화면과 같은 방식(SITE_ORIGIN 또는 지금 요청의 호스트) */
async function siteOrigin(): Promise<string> {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
