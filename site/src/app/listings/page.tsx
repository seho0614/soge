import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { GWAN_PATH, safeSort } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import type { ListingCardData, ListingListData } from '@/lib/types';
import { BackBar } from '@/components/common/BackBar';
import { getLocale, getTranslations } from 'next-intl/server';
import { isGwanKey } from '@/i18n/keys';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forms.all'))('title') };
}

const GCLS: Record<string, string> = { MNY: 'g-mny', MAL: 'g-mal', BIZ: 'g-biz', HLT: 'g-hlt' };

/**
 * SB-HOM-LST-010 전체 목록 — v10.31 시안 scAllList: ← 메인 · 제목(n건) · 3단추(소개하기 · 소개받고 싶어요 · 소개받기) ·
 *   관 고르기 카드(소개장터 · 안심소개 · 소개창업 · 소개몰 — 그 관 목록으로) · 표(구분 · 상품/서비스 · 업종 · 등급 · 등록자 · 소개비).
 * 개발에만 있던 정렬(최신순 · 소개비순) · 더 보기는 시안 모양 안에 남깁니다(지시 ③). 광고 줄은 「광고」 표시를 달아 따로 위에(전상법 · INV-11).
 */
export default async function AllListings({ searchParams }: {
  searchParams: Promise<{ cursor?: string; sort?: string }>;
}) {
  const q0 = await searchParams;
  const sort = safeSort(q0.sort);
  const qs = new URLSearchParams({ limit: '20' });
  if (q0.cursor) qs.set('cursor', q0.cursor);
  if (sort) qs.set('sort', sort);
  const [data, gwans] = await Promise.all([
    apiGet<ListingListData>(`/listings?${qs}`).catch(() => ({ promoted: [], organic: [], nextCursor: null, adNotice: '' }) as ListingListData),
    apiGet<Array<{ code: string; name: string; isActive: boolean; listingCount?: number }>>('/gwans', 300).catch(() => []),
  ]);
  const t = await getTranslations('forms.all');
  const th = await getTranslations('header.gwan');
  const f = await getFmt();
  const ko = (await getLocale()) === 'ko';
  /* 관 이름 — 한국어는 서버 이름 그대로 · 다른 언어만 사전(header.gwan.*) */
  const gname = (code: string, name: string) => (!ko && isGwanKey(code) ? th(code) : name);
  const GN: Record<string, string> = Object.fromEntries(gwans.map((g) => [g.code, gname(g.code, g.name)]));
  const nav = gwans.filter((g) => g.isActive && GWAN_PATH[g.code]);
  const rows: Array<ListingCardData & { ad?: boolean }> = [...data.promoted.map((r) => ({ ...r, ad: true })), ...data.organic];
  const total = gwans.filter((g) => GWAN_PATH[g.code] && g.code !== 'HLT').reduce((n, g) => n + (g.listingCount ?? 0), 0);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-LST-010">
      <BackBar href="/" label={t('back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{t('title')}</h1>
        {total > 0 && <span className="w1-bg off">{t('count', { n: total.toLocaleString('ko-KR') })}</span>}
        <p style={{ flexBasis: '100%', margin: '4px 0 0' }}>{t('sub')}</p>
      </div>

      <div className="w1-cta3">
        <Link className="c3 c3a" href="/register"><b>{t('cta.give')}</b><span>{t('cta.giveSub')}</span></Link>
        <Link className="c3 c3b" href="/request/new"><b>{t('cta.want')}</b><span>{t('cta.wantSub')}</span></Link>
        <Link className="c3 c3c" href="/request"><b>{t('cta.get')}</b><span>{t('cta.getSub')}</span></Link>
      </div>

      <div className="w1-gcards">
        {nav.map((g) => (
          <Link key={g.code} className={`gcard ${GCLS[g.code] ?? ''}`} href={`/${GWAN_PATH[g.code]}`}>
            <b>{gname(g.code, g.name)}</b><span>{t('toList', { code: g.code })}</span>
          </Link>
        ))}
      </div>

      <div className="w1-lsth">
        <span className="w1-ls">{data.adNotice || ''}</span>
        <span className="srt" aria-label={t('sort')}>
          {([['', 'latest'], ['FEE_DESC', 'fee']] as const).map(([v, k]) => (
            <Link key={k} href={v ? `/listings?sort=${v}` : '/listings'} className={(sort ?? '') === v ? 'on' : undefined}
              aria-current={(sort ?? '') === v ? 'true' : undefined}>{t(`sorts.${k}`)}</Link>
          ))}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="w1-empty">{t('empty')}</div>
      ) : (
        <div className="w1-tbw">
          <table className="w1-tb">
            <thead><tr><th>{t('th.gwan')}</th><th>{t('th.item')}</th><th>{t('th.cat')}</th><th>{t('th.grade')}</th><th>{t('th.owner')}</th><th>{t('th.fee')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ad ? 'ad' : 'o'}-${r.id}`} data-listing={r.id}>
                  <td><span className={`w1-gt ${GCLS[r.gwanCode] ?? ''}`}>{GN[r.gwanCode] ?? r.gwanCode}</span>
                    {r.ad && <span className="w1-bg wait" style={{ marginLeft: 4 }}>{r.adLabel ?? t('ad')}</span>}</td>
                  <td><Link href={`/listings/${r.id}`}><b>{r.title}</b></Link></td>
                  <td>{r.categoryName}</td>
                  <td>{r.gradeLabel ? <span className={`w1-bg ${r.gradeCode === 'G1' ? 'ok' : 'off'}`}>{r.gradeLabel}</span> : '—'}</td>
                  <td>{r.owner.companyName}{r.owner.verified ? ' ✓' : ''}</td>
                  <td>{r.desiredFee ? f.won(r.desiredFee) : t('nego')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.nextCursor && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Link className="w1-bo" href={`/listings?${new URLSearchParams({ ...(sort ? { sort } : {}), cursor: data.nextCursor })}`}>{t('more')}</Link>
        </div>
      )}
    </div>
  );
}
