import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lpx.stats'))('title') };
}

interface StatsRes {
  enabled: boolean; gwan?: string; category?: string; sido?: string; sigungu?: string; lastYm?: string | null; min: number;
  months: Array<{ ym: string; n: number; median: string | null; p25: string | null; p75: string | null }>;
  children: Array<{ key: string; n: number; median: string }>; hidden: number;
  options: { categories: Array<{ id: string; name: string }>; sidos: string[] }; note: string;
}

const GWANS = ['MNY', 'MAL', 'BIZ'] as const;
const won = (v: string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));

/**
 * v10.552 (D286 · docs/690) SB-HOM-LPX-010 지역별 시세 — 로그인 없이(공개 GET /site/lpx/price-stats · 집계만 · 5분 캐시)
 *   관 · 업종 · 시 · 도 · 시 · 구를 골라 달별 거래(희망) 금액 가운데값 · 아래 지역 최근 달 — 매물 lpx.stats_min(5) 개 미만 칸은 숨김
 *   스위치(lpx.stats · 처음 off)가 꺼져 있으면 「준비 중」만 · JS 없이 GET 폼 · 막대는 폭만(토큰 색)
 */
export default async function PriceStatsPage({ searchParams }: { searchParams: Promise<{ gwan?: string; category?: string; sido?: string; sigungu?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations('lpx.stats');
  const gwan = (GWANS as readonly string[]).includes(String(sp.gwan ?? '')) ? String(sp.gwan) : 'MNY';
  const q = new URLSearchParams({ gwan, category: sp.category || 'ALL', sido: sp.sido || '', sigungu: sp.sido ? (sp.sigungu || '') : '' });
  const d = await apiGet<StatsRes>(`/site/lpx/price-stats?${q.toString()}`, 300).catch(() => null);
  const max = Math.max(1, ...(d?.months ?? []).map((m) => Number(m.median ?? 0)));
  const link = (o: Record<string, string>) => `/price-stats?${new URLSearchParams({ gwan, category: sp.category || 'ALL', ...o }).toString()}`;
  return (
    <Msgs ns={['lpx']}>
      <div className="gw-wrap lpx-page" data-screen="SB-HOM-LPX-010" data-lpx-stats-page={d?.enabled ? 'on' : 'off'}>
        <h1 className="lpx-h1">{t('title')}</h1>
        <p className="lpx-note">{t('sub')}</p>
        {!d || !d.enabled ? <p className="lpx-empty">{t('off')}</p> : (
          <>
            <form className="lpx-row" method="get" action="/price-stats">
              <select name="gwan" defaultValue={gwan} aria-label={t('gwan')}>{GWANS.map((g) => <option key={g} value={g}>{t(`g${g}`)}</option>)}</select>
              <select name="category" defaultValue={d.category ?? 'ALL'} aria-label={t('category')}>
                <option value="ALL">{t('allCategories')}</option>
                {d.options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select name="sido" defaultValue={d.sido ?? ''} aria-label={t('sido')}>
                <option value="">{t('nation')}</option>
                {d.options.sidos.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {d.sigungu ? <input type="hidden" name="sigungu" value={d.sigungu} /> : null}
              <button className="lpx-btn pri" type="submit">{t('show')}</button>
            </form>
            <h2 className="lpx-h2">{[d.sido || t('nation'), d.sigungu].filter(Boolean).join(' ')}</h2>
            {d.months.length === 0 ? <p className="lpx-empty">{t('none', { min: d.min })}</p> : (
              <table className="lpx-tbl" data-lpx-months={d.months.length}>
                <thead><tr><th>{t('ym')}</th><th>{t('median')}</th><th>{t('range')}</th><th>{t('count')}</th></tr></thead>
                <tbody>{d.months.map((m) => (
                  <tr key={m.ym}><td>{m.ym}</td>
                    <td><span className="lpx-bar" style={{ width: `${Math.round((Number(m.median ?? 0) / max) * 100)}%` }} aria-hidden="true" />{won(m.median)}</td>
                    <td>{won(m.p25)} ~ {won(m.p75)}</td><td>{m.n}</td></tr>
                ))}</tbody>
              </table>
            )}
            {d.children.length > 0 && (
              <>
                <h2 className="lpx-h2">{t('children', { ym: d.lastYm ?? '' })}</h2>
                <ul className="lpx-list" data-lpx-children={d.children.length}>
                  {d.children.map((c) => (
                    <li key={c.key}><span className="t">{d.sido
                      ? <Link href={link({ sido: d.sido, sigungu: c.key })}>{c.key}</Link>
                      : <Link href={link({ sido: c.key })}>{c.key}</Link>}</span>
                      <span className="m">{t('childLine', { won: won(c.median), n: c.n })}</span></li>
                  ))}
                </ul>
              </>
            )}
            {d.hidden > 0 && <p className="lpx-note">{t('hidden', { n: d.hidden, min: d.min })}</p>}
            <p className="lpx-note">{d.note}</p>
          </>
        )}
      </div>
    </Msgs>
  );
}
