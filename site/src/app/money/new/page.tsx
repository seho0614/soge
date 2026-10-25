import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { SuccessStats } from '@/components/market/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { photoSrc } from '@/components/gwan/gw';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forms.win'))('title') };
}

type Props = { searchParams: Promise<{ tab?: string; period?: string; region?: string }> };

/**
 * SB-MNY-WIN-010 퀵메뉴 ① — 시안 「성공현황」(scWin · winTabAll/Mem/Prd/Reg) 그대로.
 *
 * v10.31 (w2 · 10/10 「시안 기준」) — 서버 집계(GET /market/success · 성사 확정 거래 v_success_deals)로 그립니다. 숫자를 지어내지 않습니다.
 *   · 탭 4종(전체 · 회원 · 상품 · 지역 성공 — 주소 ?tab=) · 오늘 기준 날짜 · 기간 선택(전체 · 최근 7일 · 이번 달 · 올해 — ?period=)
 *   · 숫자 5칸 · 최근 7일 추이(건수 · 소개 수익 두 선 — 단위가 달라 만나는 점에 뜻이 없다는 시안 안내 그대로) · 분류별 비중(원) ·
 *     Top 소개왕(이름 첫 글자 · 업체명 · 수익은 본인 공개 시만) · 최근 성공 사례 · 회원/상품/지역 표.
 *   · v10.32 — 시안 맨 위 빨간 띠는 실제 규칙(부동산은 소개비 불가 · 노출료로 셈)으로, 아래 「다른 탭 선택 시」 4칸은 같은 서버 집계로 넣었습니다.
 */
/* v10.101 (2-5b) — 탭 · 기간 이름은 사전 forms.win.tabs · periods */
const TABS = ['all', 'mem', 'prd', 'reg'] as const;
const PERIODS = ['all', '7d', 'month', 'year'] as const;
type Period = (typeof PERIODS)[number];
const SCOL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const wonFmt = (n: number) => `₩ ${Math.round(n).toLocaleString('ko-KR')}`;
const pct = (v: number | null) => (v == null ? '' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%`);

/** 보기 좋은 눈금 최댓값 */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 5 ? 5 : 10) * p;
}
/** 금액 눈금 — 1억 이상이면 「억」, 아니면 「만」 */
function feeUnit(max: number): [number, string] { return max >= 100000000 ? [100000000, '억'] : [10000, '만']; }

function DualLine({ s }: { s: SuccessStats['trend'] }) {
  const w = useTranslations('forms.win');
  const W = 470, h = 236, PL = 48, PR = 52, PT = 30, PB = 26;
  const iw = W - PL - PR, ih = h - PT - PB;
  const lmax = niceMax(Math.max(...s.counts, 3));
  const [div, unit] = feeUnit(Math.max(...s.fees, 0));
  const fees = s.fees.map((f) => Math.round((f / div) * 10) / 10);
  const rmax = niceMax(Math.max(...fees, 1));
  const X = (i: number) => PL + (iw * i) / Math.max(1, s.days.length - 1);
  const YL = (v: number) => PT + ih - (ih * v) / lmax;
  const YR = (v: number) => PT + ih - (ih * v) / rmax;
  const ticks = [0, 1, 2, 3].map((k) => k / 3);
  const line = (vals: number[], Y: (v: number) => number, col: string, u: string) => (
    <>
      <path d={vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {vals.map((v, i) => <circle key={i} cx={X(i).toFixed(1)} cy={Y(v).toFixed(1)} r="4" fill={col} stroke="var(--card)" strokeWidth="2"><title>{`${s.days[i]} · ${v}${u}`}</title></circle>)}
      <text x={(X(vals.length - 1) - 6).toFixed(1)} y={(Y(vals[vals.length - 1] ?? 0) - 11).toFixed(1)} textAnchor="end" style={{ fill: col, fontWeight: 700 }}>{vals[vals.length - 1]}{u}</text>
    </>
  );
  return (
    <svg className="gw-cvs" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={w('trendAria')}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gw-gl" x1={PL} y1={YL(lmax * t).toFixed(1)} x2={W - PR} y2={YL(lmax * t).toFixed(1)} />
          <text x={PL - 8} y={(YL(lmax * t) + 3.5).toFixed(1)} textAnchor="end" style={{ fill: 'var(--s1)' }}>{w('cnt', { n: String(Math.round(lmax * t)) })}</text>
          <text x={W - PR + 8} y={(YR(rmax * t) + 3.5).toFixed(1)} textAnchor="start" style={{ fill: 'var(--s2)' }}>{t ? `${Math.round(rmax * t * 10) / 10}${unit}` : '0'}</text>
        </g>
      ))}
      {line(s.counts, YL, 'var(--s1)', w('unitCnt'))}
      {line(fees, YR, 'var(--s2)', unit)}
      {s.days.map((l, i) => <text key={l} x={X(i).toFixed(1)} y={h - 7} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

function Donut({ cats, total }: { cats: SuccessStats['categories']; total: number }) {
  const w = useTranslations('forms.win');
  const R = 62, r = 40, C = 78, circ = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg className="gw-cvs" style={{ width: 156, flex: 'none' }} viewBox="0 0 156 156" role="img" aria-label={w('donutAria')}>
      <defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--card)" strokeWidth="2.4" /></pattern></defs>
      {total === 0 && <circle cx={C} cy={C} r={R} fill="none" stroke="var(--g200)" strokeWidth={R - r} />}
      {cats.map((c, i) => {
        const len = circ * (c.pct / 100), gap = cats.length > 1 ? 2 : 0;
        const el = (
          <g key={c.name}>
            <circle cx={C} cy={C} r={R} fill="none" stroke={SCOL[i] ?? 'var(--s6)'} strokeWidth={R - r}
              strokeDasharray={`${Math.max(0, len - gap).toFixed(2)} ${(circ - len + gap).toFixed(2)}`} strokeDashoffset={(-acc).toFixed(2)} transform={`rotate(-90 ${C} ${C})`}>
              <title>{`${c.name} · ${c.pct}% · ${w('cnt', { n: String(c.count) })}`}</title></circle>
            {i === 5 && <circle cx={C} cy={C} r={R} fill="none" stroke="url(#hatch)" strokeWidth={R - r} strokeDasharray={`${Math.max(0, len - gap).toFixed(2)} ${(circ - len + gap).toFixed(2)}`} strokeDashoffset={(-acc).toFixed(2)} transform={`rotate(-90 ${C} ${C})`} pointerEvents="none" />}
          </g>
        );
        acc += len;
        return el;
      })}
      <text x="78" y="72" textAnchor="middle" style={{ fill: 'var(--ink3)', fontSize: 10 }}>{w('total')}</text>
      <text x="78" y="90" textAnchor="middle" style={{ fill: 'var(--ink)', fontSize: 15, fontWeight: 800 }}>{w('cnt', { n: total.toLocaleString('ko-KR') })}</text>
    </svg>
  );
}

const Bar = ({ v, mx, col }: { v: number; mx: number; col: string }) => <span className="gw-bbar" style={{ width: Math.max(4, Math.round((120 * v) / Math.max(mx, 1))), background: col }} />;

export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const w = await getTranslations('forms.win');
  const cnt = (n: number | string) => w('cnt', { n: String(n) });
  const tab = TABS.some((k) => k === q.tab) ? q.tab! : 'all';
  const period = (PERIODS.some((k) => k === q.period) ? q.period! : 'all') as Period;
  const D = await apiGet<SuccessStats>(`/market/success?gwanCode=MNY&period=${period}`, 30).catch(() => null);
  const href = (p: Record<string, string>) => {
    const u = new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), ...(period !== 'all' ? { period } : {}), ...p });
    for (const [k, v] of [...u.entries()]) if (!v || (k === 'tab' && v === 'all') || (k === 'period' && v === 'all')) u.delete(k);
    const s = u.toString(); return `/money/new${s ? `?${s}` : ''}`;
  };
  const totalN = D?.categories.reduce((a, c) => a + c.count, 0) ?? 0;
  const K = D?.kpi;
  const kpi: [string, string, string, string, string][] = K ? [
    ['🤝', w('kpi.total'), cnt(K.total.value.toLocaleString('ko-KR')), w('kpi.todayCnt', { n: String(K.total.deltaToday), pct: K.total.deltaPct != null && K.total.deltaToday ? ` (${K.total.deltaPct}%)` : '' }), '#DBEAFE'],
    ['🪙', w('kpi.fee'), wonFmt(K.fee.value), w('kpi.today', { v: wonFmt(K.fee.deltaToday) }), '#D1FAE5'],
    ['⏳', w('kpi.inProgress'), cnt(K.inProgress.value.toLocaleString('ko-KR')), w('kpi.newToday', { n: String(K.inProgress.newToday) }), '#FEF3C7'],
    ['📊', w('kpi.month'), cnt(K.month.value.toLocaleString('ko-KR')), K.month.deltaPct != null ? w('kpi.vsPrev', { v: pct(K.month.deltaPct) }) : w('kpi.prev', { v: cnt(K.month.prevMonth) }), '#EDE9FE'],
    ['💰', w('kpi.monthFee'), wonFmt(K.monthFee.value), K.monthFee.deltaPct != null ? w('kpi.vsPrev', { v: pct(K.monthFee.deltaPct) }) : w('kpi.prev', { v: wonFmt(K.monthFee.prevMonth) }), '#FFE4E6'],
  ] : [];
  const mxc = Math.max(1, ...(D?.categories.map((c) => c.count) ?? [1]));
  const mxr = Math.max(1, ...(D?.regions.map((r) => r.count) ?? [1]));

  return (
    <><QuickFrame active="new" title={w('title')} sub={w('sub')}>
      {/* v10.32 — 시안 맨 위 빨간 띠(.wwarn). 시안의 견본 숫자 대신 실제 규칙을 적습니다 — 이 화면 집계에서 부동산은 소개 수익에 넣지 않음 */}
      <div className="gw-wwarn" data-win-warn="">{w.rich('warn', { b: (c) => <b>{c}</b> })}</div>
      <div className="gw-wtabs">
        {TABS.map((k) => <Link key={k} className={`gw-wt${tab === k ? ' gw-on' : ''}`} href={href({ tab: k })} aria-current={tab === k ? 'page' : undefined} data-wtab={k}>{w(`tabs.${k}`)}</Link>)}
        <span className="gw-rt">{w('asOf', { d: D?.asOf ?? '—' })}
          <form action="/money/new" method="get" className="gw-wper">
            {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
            <select aria-label={w('periodAria')} name="period" defaultValue={period}>{PERIODS.map((k) => <option key={k} value={k}>{w(`periods.${k}`)}</option>)}</select>
            <button type="submit" className="gw-bo gw-sm">{w('view')}</button>
          </form>
        </span>
      </div>

      {!D ? <div className="gw-panel gw-empty">{w('fail')}</div>
        : tab === 'all' ? (
        <>
          <div className="gw-kpi">{kpi.map(([ic, l, v, d, bg]) => (
            <div key={l} className="gw-kc"><span className="gw-ki" style={{ background: bg }}>{ic}</span>
              <span className="gw-kb"><span className="gw-kl">{l}</span><span className="gw-kvn">{v}</span><span className="gw-kd">{d}</span></span></div>
          ))}</div>
          <div className="gw-wgrid">
            <div className="gw-wp"><div className="gw-wt2"><b>{w('trendTitle')}</b><span>{w('periods.7d')}</span></div>
              <div className="gw-clg" style={{ justifyContent: 'center' }}>
                <span><i style={{ background: 'var(--s1)' }} />{w('legendCnt')}</span><span><i style={{ background: 'var(--s2)' }} />{w('legendFee')}</span></div>
              <DualLine s={D.trend} />
              <div className="gw-wnote">{w.rich('trendNote', { b: (c) => <b>{c}</b> })}</div>
            </div>
            <div className="gw-wp"><div className="gw-wt2"><b>{w('catTitle')}</b><span>{w('byCount')}</span></div>
              <div className="gw-dnw"><Donut cats={D.categories} total={totalN} />
                <div className="gw-dnl">{D.categories.length === 0 ? <div><span className="gw-nm3">{w('none')}</span></div>
                  : D.categories.map((c, i) => (
                    <div key={c.name}><i style={{ width: 9, height: 9, borderRadius: 2, flex: 'none', background: SCOL[i] ?? 'var(--s6)' }} /><span className="gw-nm3">{c.name}</span><span className="gw-pct">{c.pct}%</span></div>
                  ))}</div></div>
            </div>
            <div className="gw-wp"><div className="gw-wt2"><b>{w('top')}</b><Link href={href({ tab: 'mem' })}>{w('more')}</Link></div>
              <div className="gw-rank">{D.top.length === 0 ? <p className="gw-ls">{w('topEmpty')}</p>
                : D.top.slice(0, 5).map((t) => (
                  <div key={t.rank} className="gw-rw"><span className="gw-md">{t.rank}</span><span className="gw-av">🏢</span>
                    <span className="gw-rb"><span className="gw-rn">{w('sir', { name: t.name })}</span><span className="gw-rc">{t.company}</span></span>
                    <span className="gw-rv"><b>{t.fee != null ? wonFmt(t.fee) : w('private')}</b>{w('dealsN', { n: String(t.deals) })}</span></div>
                ))}</div>
            </div>
          </div>
          <div className="gw-wp" style={{ marginTop: 13 }}><div className="gw-wt2"><b>{w('recent')}</b><Link href="/money/list">{w('more')}</Link></div>
            {D.recent.length === 0 ? <p className="gw-ls">{w('noneDot')}</p> : (
              <div className="gw-rcar">{D.recent.slice(0, 5).map((r, i) => (
                <div key={`${r.listingId}-${i}`} className="gw-rcd">
                  <div className="gw-rimg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="gw-thp" src={photoSrc(r.categoryName, r.thumbUrl ? [r.thumbUrl] : null)} alt="" loading="lazy" />
                    <span className="gw-rcat">{r.categoryName ?? w('etc')}</span></div>
                  <div className="gw-rbd"><div className="gw-rtt">{r.listingId ? <Link href={`/money/${r.listingId}`}>{r.title}</Link> : r.title}</div>
                    <div className="gw-rrw"><span>{w('col.fee')}</span><b>{wonFmt(r.fee)}</b></div>
                    <div className="gw-rrw"><span>{w('col.trade')}</span><b>{r.tradeAmount != null ? wonFmt(r.tradeAmount) : w('private')}</b></div>
                    <div className="gw-rrw"><span>{w('col.date')}</span><b>{r.date}</b></div></div>
                </div>
              ))}</div>
            )}
          </div>
        </>
      ) : tab === 'mem' ? (
        <div className="gw-wp"><div className="gw-wt2"><b>{w('memTitle')}</b><span>{w('memSub', { period: w(`periods.${period}`) })}</span></div>
          <table className="gw-wtab"><thead><tr><th>{w('col.member')}</th><th>{w('col.company')}</th><th style={{ textAlign: 'right' }}>{w('col.totalCnt')}</th><th style={{ textAlign: 'right' }}>{w('col.totalFee')}</th><th>{w('recent')}</th></tr></thead>
            <tbody>{D.top.length === 0 ? <tr><td colSpan={5} className="gw-ls">{w('noneRef')}</td></tr>
              : D.top.map((t) => (
                <tr key={t.rank}><td className="gw-nm4">{w('sir', { name: t.name })}</td><td>{t.company}</td><td className="gw-n">{cnt(t.deals)}</td>
                  <td className="gw-n">{t.fee != null ? wonFmt(t.fee) : w('private')}</td><td>{t.lastTitle ?? '—'}</td></tr>
              ))}</tbody></table>
          <div className="gw-wnote">{w.rich('memNote', { b: (c) => <b>{c}</b> })}</div></div>
      ) : tab === 'prd' ? (
        <div className="gw-wp"><div className="gw-wt2"><b>{w('prdTitle')}</b><span>{w('byCount')}</span></div>
          <table className="gw-wtab"><thead><tr><th>{w('col.prdCat')}</th><th>{w('col.succCnt')}</th><th style={{ textAlign: 'right' }}>{w('col.cnt')}</th><th style={{ textAlign: 'right' }}>{w('col.fee')}</th></tr></thead>
            <tbody>{D.categories.length === 0 ? <tr><td colSpan={4} className="gw-ls">{w('noneDot')}</td></tr>
              : D.categories.map((c, i) => (
                <tr key={c.name}><td className="gw-nm4">{c.name}</td><td><span className="gw-bwrap"><Bar v={c.count} mx={mxc} col={SCOL[i] ?? 'var(--s6)'} /></span></td>
                  <td className="gw-n">{cnt(c.count)}</td><td className="gw-n">{wonFmt(c.fee)}</td></tr>
              ))}</tbody></table>
          <div className="gw-wnote">{w.rich('prdNote', { b: (c) => <b>{c}</b> })}</div></div>
      ) : (
        <div className="gw-wgrid" style={{ gridTemplateColumns: '1fr 1.1fr' }}>
          <div className="gw-wp"><div className="gw-wt2"><b>{w('regMap')}</b><span>{w('bySucc')}</span></div>
            <svg className="gw-cvs" style={{ maxWidth: 300, margin: '0 auto' }} viewBox="0 0 220 260" role="img" aria-label={w('regAria')}>
              <path d="M104 16 L142 28 L156 58 L148 92 L162 116 L152 152 L128 190 L104 232 L80 210 L68 172 L52 136 L60 100 L50 68 L72 36 Z" fill="var(--g100)" stroke="var(--line)" strokeWidth="1.5" />
              {D.regions.slice(0, 6).map((r, i) => {
                const pos = ([[104, 74], [86, 56], [70, 86], [118, 132], [96, 196], [128, 166]] as [number, number][])[i] ?? [104, 74];
                const lft = [0, 0, 1, 0, 1, 0][i];
                const rad = 6 + (13 * r.count) / mxr;
                const lx = lft ? pos[0] - rad - 6 : pos[0] + rad + 6;
                return (
                  <g key={r.name}><circle cx={pos[0]} cy={pos[1]} r={rad.toFixed(1)} fill="var(--s4)" fillOpacity="0.18" stroke="var(--s4)" strokeWidth="1.4"><title>{`${r.name} · ${cnt(r.count)}`}</title></circle>
                    <circle cx={pos[0]} cy={pos[1]} r="2.6" fill="var(--s4)" />
                    <text x={lx.toFixed(1)} y={pos[1] + 3.5} textAnchor={lft ? 'end' : 'start'} style={{ fill: 'var(--ink2)', fontSize: 9 }}>{r.name} {r.count}</text></g>
                );
              })}
            </svg>
            <div className="gw-wnote">{w.rich('regNote', { b: (c) => <b>{c}</b> })}</div></div>
          <div className="gw-wp"><div className="gw-wt2"><b>{w('regTitle')}</b><span>{w('regSub')}</span></div>
            <table className="gw-wtab"><thead><tr><th>{w('col.region')}</th><th>{w('col.succCnt')}</th><th style={{ textAlign: 'right' }}>{w('col.cnt')}</th><th style={{ textAlign: 'right' }}>{w('col.fee')}</th></tr></thead>
              <tbody>{D.regions.length === 0 ? <tr><td colSpan={4} className="gw-ls">{w('noneDot')}</td></tr>
                : D.regions.map((r) => (
                  <tr key={r.name}><td className="gw-nm4">{r.name}</td><td><span className="gw-bwrap"><Bar v={r.count} mx={mxr} col="var(--s4)" /></span></td>
                    <td className="gw-n">{cnt(r.count)}</td><td className="gw-n">{wonFmt(r.fee)}</td></tr>
                ))}</tbody></table></div>
        </div>
      )}
      {/* v10.32 — 시안 하단 「다른 탭 선택 시」 4칸(winPreview). 같은 서버 집계(top · categories · regions)로 그립니다 */}
      {D && tab === 'all' && (
        <div className="gw-pvwrap" data-win-preview=""><div className="gw-pvgrid">
          <div className="gw-pv"><b>{w('pv.mem')}</b>
            <table className="gw-pvt"><thead><tr><th>{w('col.member')}</th><th>{w('col.totalCnt')}</th><th>{w('col.totalFee')}</th><th>{w('recent')}</th></tr></thead>
              <tbody>{D.top.length === 0 ? <tr><td colSpan={4}>{w('pv.none')}</td></tr>
                : D.top.slice(0, 5).map((t) => <tr key={t.rank}><td>{w('sir', { name: t.name })}</td><td>{cnt(t.deals)}</td><td>{t.fee != null ? wonFmt(t.fee) : w('private')}</td><td>{t.lastTitle ?? '—'}</td></tr>)}</tbody></table></div>
          <div className="gw-pv"><b>{w('pv.prd')}</b>
            <table className="gw-pvt"><thead><tr><th>{w('col.prdCat')}</th><th>{w('col.succCnt')}</th><th>{w('legendFee')}</th></tr></thead>
              <tbody>{D.categories.length === 0 ? <tr><td colSpan={3}>{w('pv.none')}</td></tr>
                : D.categories.slice(0, 6).map((c, i) => <tr key={c.name}><td>{c.name}</td>
                  <td><span className="gw-pvb" style={{ width: Math.max(6, Math.round((52 * c.count) / mxc)), background: SCOL[i] ?? 'var(--s6)' }} /> {cnt(c.count)}</td><td>{wonFmt(c.fee)}</td></tr>)}</tbody></table></div>
          <div className="gw-pv"><b>{w('pv.reg')}</b>
            <div className="gw-pvmap">
              <svg viewBox="0 0 120 96" aria-hidden="true">{D.regions.slice(0, 5).map((r, i) => {
                const pos = ([[46, 30], [36, 22], [30, 40], [62, 60], [48, 78]] as [number, number][])[i] ?? [46, 30];
                return <circle key={r.name} cx={pos[0]} cy={pos[1]} r={(5 + (9 * r.count) / mxr).toFixed(1)} fill="var(--s4)" fillOpacity="0.2" stroke="var(--s4)" strokeWidth="1" />;
              })}</svg>
              <table className="gw-pvt"><thead><tr><th>{w('col.region')}</th><th>{w('col.succCnt')}</th><th>{w('legendFee')}</th></tr></thead>
                <tbody>{D.regions.length === 0 ? <tr><td colSpan={3}>{w('pv.none')}</td></tr>
                  : D.regions.slice(0, 6).map((r) => <tr key={r.name}><td>{r.name}</td><td>{cnt(r.count)}</td><td>{wonFmt(r.fee)}</td></tr>)}</tbody></table></div></div>
          <div className="gw-pv gw-pvi"><b>{w('pv.info')}</b><div className="gw-pvic" aria-hidden="true">👆</div>
            <p>{w.rich('pv.infoBody', { br: () => <br /> })}</p></div>
        </div></div>
      )}
      {D && <ul className="gw-winnotes">{D.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </QuickFrame><i hidden data-root-end="" /></>
  );
}
