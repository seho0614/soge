import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { PlazaHero, PlazaTabs } from '@/components/community/Plaza';
import { RankPref } from '@/components/community/RankPref';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('rankTitle') };
}

interface RankRow { rank: number; name: string; score: number; posts: number; answers: number; comments: number; helpful: number; badges: string[] }
interface Ranking { on: boolean; month: string; computedAt?: string | null; closed?: boolean; items: RankRow[] }
interface Activity { on: boolean; month: string; hideRank: boolean; rank: number | null; score: { score: number }; badges: Array<{ month: string; badge: string }> }
const shift = (m: string, add: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y!, (mo! - 1) + add, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * SB-HOM-MLX-010 소개광장 활동 랭킹 (v10.507 · D274 · docs/645)
 *   GET /community/ranking?month=  공개(누가 봐도 같음 · apiGet 60초) — 노출을 끈 회원 빼고 · 이름 가림 · 그 달 배지
 *   GET /me/community/activity     로그인이면 내 점수 · 순위 · 배지 · 노출 설정(apiGetPersonal)
 * plaza.ranking 이 꺼져 있으면 안내만.
 */
export default async function PlazaRankingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : '';
  const t = await getTranslations('plaza');
  const r = await apiGet<Ranking>(`/community/ranking${month ? `?month=${month}` : ''}`, 60).catch(() => null);
  const principal = await me().catch(() => null);
  const mine = principal && r?.on ? await apiGetPersonal<Activity>('/me/community/activity').catch(() => null) : null;
  const BADGE_T: Record<string, string> = { TOP1: t('badgeTOP1'), TOP3: t('badgeTOP3'), TOP10: t('badgeTOP10'), HELPER: t('badgeHELPER'), ANSWERER: t('badgeANSWERER'), WRITER: t('badgeWRITER') };
  const badge = (b: string) => BADGE_T[b] ?? b;

  return (
    <div className="plz" data-screen="SB-HOM-MLX-010">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur="none" />
        <div className="plz-narrow"><Msgs ns={['plaza']}>
          <h1>{t('rankTitle')}</h1>
          {!r?.on ? <p className="plz-empty">{t('rankOff')}</p> : <>
            <p className="plz-meta">
              <span>{t('rankLead', { month: r.month })}</span>
              {r.computedAt && <span>{t('rankComputed', { at: new Date(r.computedAt).toLocaleString('ko-KR') })}</span>}
            </p>
            <p className="plz-meta">
              <Link href={`/community/ranking?month=${shift(r.month, -1)}`}>{t('rankPrev')}</Link>
              {r.month < new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7) && <Link href={`/community/ranking?month=${shift(r.month, 1)}`}>{t('rankNext')}</Link>}
            </p>
            {mine && (
              <div className="card p2pad" data-rank-mine="">
                <p>{mine.score.score > 0 ? t('rankMine', { score: String(mine.score.score), rank: mine.rank == null ? '—' : String(mine.rank) }) : t('rankMineNone')}</p>
                {mine.badges.length > 0 && <p className="dim">{t('rankMyBadges')}: {mine.badges.slice(0, 6).map((b) => `${b.month} ${badge(b.badge)}`).join(' · ')}</p>}
                <RankPref hidden={mine.hideRank} />
              </div>
            )}
            {r.items.length === 0 ? <p className="plz-empty">{t('rankEmpty')}</p> : (
              <table className="tbl" data-rank-rows={r.items.length}>
                <thead><tr><th>{t('rankColRank')}</th><th>{t('rankColName')}</th><th>{t('rankColScore')}</th><th>{t('rankColPosts')}</th><th>{t('rankColAnswers')}</th><th>{t('rankColHelpful')}</th><th>{t('rankColBadges')}</th></tr></thead>
                <tbody>{r.items.map((x) => (
                  <tr key={x.rank}><td>{x.rank}</td><td>{x.name}</td><td>{x.score}</td><td>{x.posts}</td><td>{x.answers}</td><td>{x.helpful}</td><td>{x.badges.map(badge).join(' · ')}</td></tr>))}</tbody>
              </table>
            )}
          </>}
          <p className="plz-backw"><Link className="plz-back" href="/community">{t('rankBack')}</Link></p>
        </Msgs></div>
      </div>
    </div>
  );
}
