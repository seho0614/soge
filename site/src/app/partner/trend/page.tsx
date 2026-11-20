import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Empty, Note, Pgh, S2, Tile, won } from '@/components/partner/ui';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';
import '@/styles/slx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('slx.perf'))('title') };
}

interface Pt { bucket: string; received: number; viewed: number; viewMinAvg: number | null; viewMinP50: number | null; confirmed: number; feeBilled: number | null; paidOut: number | null }
interface Sum { received: number; viewed: number; viewRate: number | null; viewMinAvg: number | null; viewMinP50: number | null; viewedIn1h: number; in1hRate: number | null;
  confirmed: number; convRate: number | null; feeBilled: number | null; paidOut: number | null }
interface Trend { range: { period: string; unit: 'day' | 'week' | 'month'; from: string; to: string }; series: Pt[]; summary: Sum; prev: Sum; money: boolean; note: string }
const PERIODS = ['30d', '90d', '12m'] as const;

/**
 * SB-PTC-SLX-010 성과 추이 — v10.534 (D281 · docs/672) · GET /partner/perf-trend?period=
 *   기간(30일 날마다 · 90일 주마다 · 12개월 달마다) 숫자 4칸 → 막대(받은 리드) · 점(성사) 그래프 → 기간 표 → 안내
 *   내 파트너 것만(서버가 로그인한 사람의 파트너로 잡음) · 돈 칸(이용료 · 정산)은 대표 · 정산 권한 직원만(서버가 비움)
 *   그림은 서버에서 SVG 로(브라우저 스크립트 없음) · 색은 토큰(slx.css)
 */
export default async function PartnerTrendPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('slx.perf');
  const tp = await getTranslations('partner');
  const f = await getFmt();
  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(sp.period ?? '') ? String(sp.period) : '30d';
  const d = await apiGet<Trend>(`/partner/perf-trend?period=${period}`, 0).catch(() => null);
  if (!d) return <><Pgh title={t('title')} /><Empty>{tp('common.notPartner')}</Empty><i hidden data-root-end="" /></>;
  const s = d.summary, pv = d.prev;
  const unit = tp('common.unit.case');
  const chg = (a: number, b: number) => (b > 0 ? t('vsPrev', { v: `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 1000) / 10}%` }) : undefined);
  const W = 640, H = 200, P = 30;
  const pts = d.series;
  const max = Math.max(1, ...pts.map((x) => x.received));
  const bw = (W - P * 2) / Math.max(1, pts.length);
  const y = (v: number) => H - 22 - (v / max) * (H - 40);
  const every = Math.max(1, Math.ceil(pts.length / 7));
  const lab = (b: string) => (d.range.unit === 'month' ? b.slice(0, 7) : b.slice(5));
  const unitLabel = d.range.unit === 'day' ? t('unitDay') : d.range.unit === 'week' ? t('unitWeek') : t('unitMonth');
  const periodLabel = (k: string) => (k === '90d' ? t('p90d') : k === '12m' ? t('p12m') : t('p30d'));

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      <div className="slx-periods" data-slx-periods={period}>
        {PERIODS.map((k) => <Link key={k} className={k === period ? 'pt-bp' : 'pt-bo'} href={`/partner/trend?period=${k}`}>{periodLabel(k)}</Link>)}
      </div>
      <p className="slx-hint">{d.range.from} ~ {d.range.to} · {unitLabel}</p>
      <div className="pt-tiles" data-slx-trend-tiles="">
        <Tile label={t('received')} value={s.received.toLocaleString('ko-KR')} unit={unit} sub={chg(s.received, pv.received)} href="/partner/leads" />
        <Tile label={t('resp')} value={s.viewMinP50 ?? '—'} unit={s.viewMinP50 != null ? t('minUnit') : undefined}
          sub={t('respSub', { avg: String(s.viewMinAvg ?? '—'), rate: String(s.in1hRate ?? '—') })} />
        <Tile label={t('conv')} value={s.confirmed.toLocaleString('ko-KR')} unit={unit} sub={t('convSub', { rate: String(s.convRate ?? '—') })} href="/partner/performance" />
        <Tile label={t('fee')} value={d.money ? f.wonOf(won(s.feeBilled ?? 0)) : '—'} sub={d.money ? t('paidSub', { amt: f.wonOf(won(s.paidOut ?? 0)) }) : t('moneyHidden')} href={d.money ? '/partner/settlement' : undefined} />
      </div>

      <S2>{t('chart')}</S2>
      <figure className="slx-chart" data-slx-trend-chart={pts.length}>
        <figcaption><span className="slx-key-bar">■ {t('received')}</span><span className="slx-key-dot">● {t('confirmed')}</span></figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('chart')}>
          <line className="axis" x1={P} x2={W - P} y1={y(0)} y2={y(0)} />
          <text className="lbl" x={2} y={y(max) + 4}>{max}</text>
          {pts.map((x, i) => (
            <g key={x.bucket}>
              <rect className="bar" x={P + i * bw + bw * 0.15} width={bw * 0.7} y={y(x.received)} height={Math.max(0, y(0) - y(x.received))}>
                <title>{`${x.bucket} · ${t('received')} ${x.received} · ${t('viewed')} ${x.viewed} · ${t('confirmed')} ${x.confirmed}`}</title>
              </rect>
              {x.confirmed > 0 && <circle className="dot" cx={P + i * bw + bw / 2} cy={y(x.confirmed)} r={3.5} />}
              {(i % every === 0 || i === pts.length - 1) && <text className="lbl" x={P + i * bw + bw / 2} y={H - 4} textAnchor="middle">{lab(x.bucket)}</text>}
            </g>
          ))}
        </svg>
      </figure>

      <S2>{t('table')}</S2>
      <div className="pt-tw">
        <table className="pt-tb2" data-slx-trend-rows={pts.length}>
          <thead><tr><th>{t('thBucket')}</th><th className="num">{t('received')}</th><th className="num">{t('viewed')}</th><th className="num">{t('thResp')}</th><th className="num">{t('confirmed')}</th>
            {d.money ? <><th className="num">{t('fee')}</th><th className="num">{t('paid')}</th></> : null}</tr></thead>
          <tbody>
            {[...pts].reverse().filter((x) => x.received || x.confirmed || (d.money && (x.feeBilled || x.paidOut))).map((x) => (
              <tr key={x.bucket}>
                <td>{lab(x.bucket)}</td><td className="num">{x.received}</td><td className="num">{x.viewed}</td><td className="num">{x.viewMinP50 ?? '—'}</td><td className="num">{x.confirmed}</td>
                {d.money ? <><td className="num">{f.wonOf(won(x.feeBilled ?? 0))}</td><td className="num">{f.wonOf(won(x.paidOut ?? 0))}</td></> : null}
              </tr>
            ))}
            {s.received === 0 && s.confirmed === 0 && <tr><td colSpan={d.money ? 7 : 5}>{t('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <Note kind="info">{f.srv(d.note, t('note'))}</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/stats">{t('toStats')}</Link>
        <Link className="pt-bo" href="/partner/performance">{t('toPerf')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
