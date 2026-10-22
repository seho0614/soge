import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { AffiliateApply } from '@/components/partners/AffiliateApply';
import { P2Promo } from '@/components/partner/P2Promo';
import { krw, ymd, ORDER_STATE } from '@/components/partners/fmt';
import type { AffDashboard, AffLink, AffProduct, Notice } from '@/components/partners/types';

export const metadata: Metadata = { title: '파트너센터' };

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
 * ★ 제휴수수료는 회사가 지급합니다. 소개비(당사자끼리)와 헷갈리지 않게 note 를 항상 띄웁니다.
 */
export default async function PartnersDashboard() {
  const p = await me();
  if (!p) redirect('/login');

  const d = await apiGetPersonal<AffDashboard>('/partner/affiliate/dashboard').catch(() => null);

  if (!d) {
    return (
      <><div className="p2body"><div className="page-head"><h1>대시보드</h1></div><p className="form-error">대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.</p></div><i hidden data-root-end="" /></>
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
        <div className="page-head"><h1>파트너센터</h1></div>
        <p className="lead">
          제휴상품 링크를 뿌리고, 링크로 들어온 주문이 확정되면 <b>건당 정해진 수수료</b>를 소개뱅크가 지급합니다.
        </p>
        <h2 id="apply" className="sec-title">파트너 신청 방법</h2>
        <ol className="p2steps">
          <li className={actorOk ? 'done' : 'now'}>
            <strong>1. 본인 · 사업자 확인</strong> <span className="dim">{p.businessVerifiedAt ? '사업자 인증 완료' : actorOk ? '본인인증 완료 · 개인' : '필요'}</span>
            <p>본인인증을 하면 개인으로 파트너가 됩니다(수수료는 원천징수 3.3% 뒤 지급). 사업자로 받으시려면 사업자 인증을 하십시오 — 선택입니다.</p>
            {!actorOk && <Link className="btn-sm" href="/verify">본인인증하기</Link>}
          </li>
          <li className={applied ? 'done' : actorOk ? 'now' : ''}>
            <strong>2. 파트너 신청</strong> <span className="dim">{applied ? '신청함' : '대기'}</span>
            <p>입점 신청과 같은 절차입니다. 한 번 신청하시면 됩니다.</p>
            {actorOk && !applied && <AffiliateApply />}
          </li>
          <li className={applied ? 'now' : ''}>
            <strong>3. 운영 승인</strong>{' '}
            <span className="dim">{applied ? (lead?.status === 'ACTIVE' ? '승인됨' : '심사 중') : '대기'}</span>
            <p>사람이 봅니다 — 자동 승인은 두지 않았습니다. 승인되면 이 화면에 수익 현황이 나옵니다.</p>
          </li>
        </ol>
        <p className="hint">처음이시면 <Link href="/partners/guides">파트너가이드</Link>를 먼저 보십시오.</p>
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

  const delta = (v: number | undefined, unit: string, base = '어제보다') => v == null ? null
    : v > 0 ? <span className="up">▲ {base} {n(v)}{unit} 증가</span> : v < 0 ? <span className="dn">▼ {base} {n(-v)}{unit} 감소</span> : <span>{base.replace('보다', '와')} 같음</span>;
  const t = d.today;
  const tier = d.tier;
  const GR: Record<string, string> = { BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘' };
  const pay = d.payoutDate ? `${Number(d.payoutDate.slice(5, 7))}월 ${Number(d.payoutDate.slice(8, 10))}일` : null;
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
          {kpi('var(--sgb-mall)', <b style={{ color: '#fff', fontSize: 16 }}>₩</b>, '오늘 소개수익', n(t?.earned ?? 0), '원', delta(t?.earnedDelta, '원'))}
          {kpi('var(--sgb-link)', svg(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>), '이번 달 누적수익', n(m.earned), '원',
            m.deltaPct != null ? (m.deltaPct >= 0 ? <span className="up">▲ 지난 달 같은 기간 대비 {m.deltaPct}% ↑</span> : <span className="dn">▼ 지난 달 같은 기간 대비 {-m.deltaPct}% ↓</span>) : '확정 · 정산된 주문')}
          {kpi('var(--sgb-biz)', svg(<><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /></>), '정산 예정금액', n(m.payable), '원', pay ? <>🕐 {pay} 정산 예정 · <Link href="/partners/settlements">정산내역 ›</Link></> : <Link href="/partners/settlements">정산내역 ›</Link>)}
          {kpi('var(--sgb-link)', svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>), '소개 고객 수', n(d.customers?.today ?? 0), '명', delta(d.customers?.delta, '명'))}
          {kpi('var(--sgb-navy)', svg(<><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>), '거래 건수', n(t?.orders ?? 0), '건', delta(t?.ordersDelta, '건'))}
          <div className="p2kpi">
            <span className="ic" style={{ background: 'var(--sgb-or-text)' }}>{svg(<path d="M2 7l5 3 5-6 5 6 5-3-2 12H4z" />)}</span>
            <div style={{ flex: 1 }}>
              <div className="k">파트너 등급 ⓘ</div>
              <div className="v tier">{tier?.grade ? `${GR[tier.grade] ?? tier.grade} 파트너` : '—'}</div>
              <div className="p2bar" aria-hidden style={{ marginTop: 6 }}><i style={{ width: `${tier?.progress ?? 0}%` }} /></div>
              <div className="n">{tier?.remaining != null && tier.next ? `다음 등급(${GR[tier.next] ?? tier.next})까지 ${n(tier.remaining)}원 남음` : tier?.next ? (tier.note ?? '다음 등급 기준은 운영이 정합니다.') : '가장 높은 등급입니다'}</div>
            </div>
          </div>
        </div>
        <p className="p2sub" data-p2-devkpi>오늘 클릭 {n(todayClicks)}회 · 이번 달 클릭 {n(m.clicks)}회 · 사용 중 링크 {n(activeLinks)}개 <Link href="/partners/links">내 소개링크 ›</Link></p>

        <section className="p2card2">
          <div className="p2sechd"><h2>오늘의 추천상품 <span aria-hidden>🚀</span></h2><Link href="/partners/products">전체 상품 보기 ›</Link></div>
          <p className="p2sub">지금 가장 반응이 좋은 인기 상품이에요. 소개하고 추가 수익을 만들어보세요!</p>
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
                    {x.tag ? <span className={`tag ${x.tag === 'HOT' ? 'hot' : 'high'}`}>{x.tag === 'HOT' ? '🔥 인기' : '❤ 고수익'}</span> : null}
                    <strong>{x.name}</strong>
                    <p>{x.description ?? x.advertiser ?? ''}</p>
                    <div className="earn">1건 판매 시 소개수익 {krw(x.commission)}</div>
                    <Link className="bt" href="/partners/products">상품 소개하기 ›</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="empty">지금 판매 중인 제휴상품이 없습니다.</p>}
        </section>

        <section className="p2card2">
          <h2>빠른 홍보하기</h2>
          <p className="p2sub">내 소개링크로 지금 바로 공유하고 수익을 만들어보세요!</p>
          <P2Promo url={shareUrl} label={firstLink?.product ?? null} />
        </section>
      </div>

      <div className="p2dr">
        <section className="p2card2 sm">
          <div className="p2sechd"><h2>이번 달 목표 달성률</h2><Link href="/partners/revenues">상세보기 ›</Link></div>
          {d.goal ? (
            <>
              <div className="p2rate"><b>{rate ?? 0}%</b><span>{krw(m.earned)} / {krw(d.goal.target)}</span></div>
              <div className="p2bar" aria-hidden><i style={{ width: `${Math.min(rate ?? 0, 100)}%` }} /></div>
              {d.goalCheer ? <p className="p2sub">💬 &quot;{d.goalCheer}&quot;</p> : null}
              {d.goal.reward != null && <p className="p2sub">달성 시 보상 {krw(d.goal.reward)} · {d.goal.source} 목표</p>}
            </>
          ) : (
            <p className="p2sub">이번 달 목표가 아직 정해지지 않았습니다. 목표는 운영이 정합니다.</p>
          )}
        </section>

        <section className="p2card2 sm">
          <div className="p2sechd"><h2>지금, 이런 성과가 있어요! <span aria-hidden>🔥</span></h2><Link href="/partners/orders">더보기 ›</Link></div>
          {d.feed?.length ? (
            <div className="p2feed" data-p2-feed>
              {d.feed.map((f, i) => (
                <div key={i} className="rw">
                  <span className="t">{ago(f.at)}</span> {f.area ? `${f.area} ` : ''}회원님이 <b>{f.product}</b>{f.kind === 'MALL' ? '을(를) 구매했어요!' : '을(를) 신청했어요!'}{' '}
                  {f.amount > 0 ? <em>+{krw(f.amount)}</em> : null}
                </div>
              ))}
            </div>
          ) : <p className="p2sub">최근 7일 동안 제휴 링크로 들어온 구매 소식이 없습니다.</p>}
          {d.recent?.length ? (
            <details className="p2mine"><summary>내 링크의 최근 주문 {d.recent.length}건</summary>
              <div className="p2feed">
                {d.recent.map((o) => (
                  <div key={o.orderNo} className="rw">
                    <span className="t">{ymd(o.orderedAt)}</span> <b>{o.product}</b>{' '}
                    <span className={'state ' + (ORDER_STATE[o.state]?.c ?? '')}>{ORDER_STATE[o.state]?.t ?? o.state}</span>{' '}
                    <em>+{krw(o.commission)}</em>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <p className="p2sub" style={{ marginTop: 6 }}>다른 회원의 이름은 보이지 않습니다 — 시 · 도와 상품만 알려 드립니다.</p>
        </section>

        <Link className="p2navy" href="/partners/guides">
          <div className="p2nhd"><b><span aria-hidden>🚀</span> 소개뱅크 PARTNERS</b><span aria-hidden>›</span></div>
          <p>지금, 더 큰 수익의 기회가<br />기다리고 있습니다.</p>
          <ul>
            <li>좋은 제품을 소개하고</li>
            <li>누군가의 일상을 더 좋게 만들고</li>
            <li>당신의 수익도 함께 성장합니다.</li>
          </ul>
          <div className="go">함께, 더 멀리! ↗</div>
        </Link>

        <section className="p2card2 sm">
          <div className="p2sechd"><h2>공지사항</h2><Link href="/partners/notices">더보기 ›</Link></div>
          {notices.length ? (
            <ul className="p2ntc">
              {notices.slice(0, 3).map((x) => (
                <li key={x.id}><Link href={`/partners/notices#n-${x.id}`}>{x.isPinned ? '[필독] ' : ''}{x.title}</Link><span>{ymd(x.publishedAt)}</span></li>
              ))}
            </ul>
          ) : <p className="p2sub">등록된 공지가 없습니다.</p>}
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
