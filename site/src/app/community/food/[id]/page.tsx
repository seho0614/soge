import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { PlazaHero, PlazaTabs, dot } from '@/components/community/Plaza';
import { KakaoMap } from '@/components/map/KakaoMap';
import '@/styles/plaza.css';
import '@/styles/food.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('food.title') };
}

interface FoodPost { id: string; title: string; excerpt: string; menu: string | null; sponsored: boolean; pick: boolean; pending: boolean;
  commentCount: number; createdAt: string; author: string }
interface Place { id: string; kakaoId: string; name: string; category: string | null; phone: string | null; address: string | null;
  jibun: string | null; region: string; lat: number; lng: number; placeUrl: string | null; posts: FoodPost[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SB-HOM-CMU-051 우리동네 맛집 › 가게 — GET /community/food/places/{id} (v10.47 · D100)
 *
 * ★ apiGetPersonal 입니다 — 내 검수 중인 글은 나에게만 보여 사람마다 응답이 다릅니다.
 * 가게는 공개된 영업장이라 정확한 핀을 그립니다(매물의 시 · 구 둘레 원과 다름).
 * 글 하나 보기 · 댓글 · 신고 · 고치기는 소개광장 글 화면(/community/{id})을 그대로 씁니다.
 */
export default async function FoodPlacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const [d, p] = await Promise.all([
    apiGetPersonal<Place>(`/community/food/places/${id}`).catch((e) => {
      if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }),
    me(),
  ]);
  if (!d) notFound();
  const t = await getTranslations('plaza.food');
  const kind = d.category?.split('>').map((x) => x.trim()).filter(Boolean).slice(-2).join(' · ');
  const writeHref = `/community/food/write?kakao=${encodeURIComponent(d.kakaoId)}&name=${encodeURIComponent(d.name)}`;

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur="food" />
        <p className="plz-backw"><Link className="plz-back" href="/community/food">{t('back')}</Link></p>
        {sp.posted && <p className="ok-note" role="status">{sp.posted === 'wait' ? t('postedWait') : t('posted')}</p>}
        <div className="fd-place">
          <div className="fd-info">
            <h1>{d.name}</h1>
            <dl>
              {kind && <><dt>{t('dt.kind')}</dt><dd>{kind}</dd></>}
              <dt>{t('dt.address')}</dt><dd>{d.address ?? '—'}{d.jibun && d.jibun !== d.address ? <><br /><span className="dim">{d.jibun}</span></> : null}</dd>
              {d.phone && <><dt>{t('dt.phone')}</dt><dd>{d.phone}</dd></>}
              <dt>{t('dt.recs')}</dt><dd>{t('recCount', { n: String(d.posts.filter((x) => !x.pending).length) })}</dd>
            </dl>
            {d.placeUrl && <p><a href={d.placeUrl} target="_blank" rel="noopener noreferrer">{t('kakao')}</a> <span className="dim">{t('kakaoSub')}</span></p>}
            <p>{p ? <Link className="fd-cta" href={writeHref}>{t('recommend')}</Link>
                  : <Link className="fd-cta" href={`/login?next=${encodeURIComponent(writeHref)}`}>{t('loginRecommend')}</Link>}</p>
          </div>
          <KakaoMap geo={{ precision: 'EXACT', lat: d.lat, lng: d.lng }} height={260}
            fallback={<p className="fd-note">📍 {d.address}</p>} />
        </div>

        <h2 style={{ marginTop: 24 }}>{t('neighbors')} <span className="dim">{d.posts.length}</span></h2>
        {d.posts.length === 0 ? <p className="plz-empty">{t('noPosts')}</p> : (
          <ul className="fd-posts">
            {d.posts.map((x) => (
              <li key={x.id}>
                <Link href={`/community/${x.id}`}>
                  <b>{x.title}</b>
                  {x.pick && <span className="fd-badge pick">{t('pick')}</span>}
                  {x.sponsored && <span className="fd-badge ad">{t('sponsored')}</span>}
                  {x.pending && <span className="fd-badge wait">{t('pendingMe')}</span>}
                  <div className="fd-ex">{x.excerpt}{x.excerpt.length >= 140 ? '…' : ''}</div>
                  <div className="fd-sub">{x.menu ? `${t('menu', { menu: x.menu })} · ` : ''}{x.author} · {dot(x.createdAt)}{x.commentCount ? ` · ${t('comments', { n: String(x.commentCount) })}` : ''}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div></>
  );
}
