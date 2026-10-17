import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { PlazaHero, PlazaTabs, dot } from '@/components/community/Plaza';
import { KakaoMap } from '@/components/map/KakaoMap';
import '@/styles/plaza.css';
import '@/styles/food.css';

export const metadata: Metadata = { title: '우리동네 맛집 · 소개광장' };

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
  const kind = d.category?.split('>').map((x) => x.trim()).filter(Boolean).slice(-2).join(' · ');
  const writeHref = `/community/food/write?kakao=${encodeURIComponent(d.kakaoId)}&name=${encodeURIComponent(d.name)}`;

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur="food" />
        <p className="plz-backw"><Link className="plz-back" href="/community/food">← 우리동네 맛집</Link></p>
        {sp.posted && <p className="ok-note" role="status">{sp.posted === 'wait' ? '첫 글이라 확인 후 올라갑니다. 보통 하루 안에 끝납니다.' : '소개 글이 올라갔습니다.'}</p>}
        <div className="fd-place">
          <div className="fd-info">
            <h1>{d.name}</h1>
            <dl>
              {kind && <><dt>분류</dt><dd>{kind}</dd></>}
              <dt>주소</dt><dd>{d.address ?? '—'}{d.jibun && d.jibun !== d.address ? <><br /><span className="dim">{d.jibun}</span></> : null}</dd>
              {d.phone && <><dt>전화</dt><dd>{d.phone}</dd></>}
              <dt>추천</dt><dd>이웃 소개 {d.posts.filter((x) => !x.pending).length}건</dd>
            </dl>
            {d.placeUrl && <p><a href={d.placeUrl} target="_blank" rel="noopener noreferrer">카카오맵에서 보기 ↗</a> <span className="dim">(영업시간 · 메뉴 · 사진)</span></p>}
            <p>{p ? <Link className="fd-cta" href={writeHref}>이 가게 소개하기</Link>
                  : <Link className="fd-cta" href={`/login?next=${encodeURIComponent(writeHref)}`}>로그인하고 이 가게 소개하기</Link>}</p>
          </div>
          <KakaoMap geo={{ precision: 'EXACT', lat: d.lat, lng: d.lng }} height={260}
            fallback={<p className="fd-note">📍 {d.address}</p>} />
        </div>

        <h2 style={{ marginTop: 24 }}>이웃 소개 <span className="dim">{d.posts.length}</span></h2>
        {d.posts.length === 0 ? <p className="plz-empty">아직 공개된 소개 글이 없습니다.</p> : (
          <ul className="fd-posts">
            {d.posts.map((x) => (
              <li key={x.id}>
                <Link href={`/community/${x.id}`}>
                  <b>{x.title}</b>
                  {x.pick && <span className="fd-badge pick">동네픽</span>}
                  {x.sponsored && <span className="fd-badge ad">광고 · 협찬</span>}
                  {x.pending && <span className="fd-badge wait">검수 중 · 나에게만 보임</span>}
                  <div className="fd-ex">{x.excerpt}{x.excerpt.length >= 140 ? '…' : ''}</div>
                  <div className="fd-sub">{x.menu ? `추천 메뉴 ${x.menu} · ` : ''}{x.author} · {dot(x.createdAt)}{x.commentCount ? ` · 댓글 ${x.commentCount}` : ''}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div></>
  );
}
