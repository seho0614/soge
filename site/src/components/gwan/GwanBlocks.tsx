import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import type { ListingListData } from '@/lib/types';
import { ListingList } from '@/components/ListingList';
import { FeedbackBlock } from './FeedbackBlock';   // v10.729 (D325) 손님 한 줄 의견

/* ---------------------------------------------------------------------
 * v10.652 (D311 · docs/793) 관 페이지 블록 그리기 — 운영 화면 › 관 관리 › 관 페이지에서 게시한 판(GET /gwans/{code}/pages/{slug})
 *   글은 HTML 없이 그림(React 가 글자를 그대로 씀) — **굵게** · 줄 앞 「- 」 목록 · [글자](주소) 링크만(주소는 /… 또는 https://…)
 *   매물 · 업종 · 공지 블록은 그 자리에서 공개 API 로 읽음(5분 캐시) · 읽지 못하면 그 블록만 비움
 * ------------------------------------------------------------------- */

type Block = Record<string, any>;
export interface GwanPageData { slug: string; lang?: string; title: string; blocks: Block[]; version: number; publishedAt: string;
  visibility?: string; seoDescription?: string | null; seoImage?: string | null; noindex?: boolean }   // v10.691 · 692 (D320)
export interface GwanPageMenuItem { slug: string; title: string }

const SAFE = (u: string) => /^\/(?!\/)/.test(u) || /^https:\/\//.test(u);
const A = ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
  !SAFE(href) ? <span className={className}>{children}</span>
    : href.startsWith('/') ? <Link href={href} className={className}>{children}</Link>
      : <a href={href} className={className} rel="noopener noreferrer nofollow" target="_blank">{children}</a>;

/** 한 줄 안 — **굵게** · [글자](주소) */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]{1,80})\]\(([^)\s]{1,300})\)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] != null ? <b key={k++}>{m[1]}</b> : <A key={k++} href={m[3]!}>{m[2]}</A>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function Text({ body }: { body: string }) {
  const parts: ReactNode[] = []; let list: string[] = []; let k = 0;
  const flush = () => { if (list.length) { parts.push(<ul key={k++}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  for (const line of String(body ?? '').split('\n')) {
    if (/^\s*-\s+/.test(line)) { list.push(line.replace(/^\s*-\s+/, '')); continue; }
    flush();
    /* v10.654 글 속 사진 — 한 줄 ![설명](주소) */
    const pic = /^\s*!\[([^\]]{0,100})\]\(([^)\s]{1,300})\)\s*$/.exec(line);
    if (pic) { if (SAFE(pic[2]!)) parts.push(<figure key={k++} className="gp-img">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={pic[2]} alt={pic[1]} loading="lazy" style={{ maxWidth: '100%' }} /></figure>); continue; }
    if (line.trim()) parts.push(<p key={k++}>{inline(line)}</p>);
  }
  flush();
  return <>{parts}</>;
}

async function Listings({ code, b }: { code: string; b: Block }) {
  const qs = new URLSearchParams({ gwanCode: code, limit: String(b.limit ?? 8), sort: String(b.sort ?? 'RECENT') });
  if (b.categoryId) qs.set('categoryId', String(b.categoryId));
  if (b.regionCode) qs.set('regionCode', String(b.regionCode));   // v10.762 (docs/870) 지역 · 배지 거르기
  if (b.badge) qs.set('badge', String(b.badge));
  if (Number(b.priceMax) > 0) qs.set('priceMax', String(Math.floor(Number(b.priceMax))));   // v10.777 (docs/885) 거래 금액 상한
  const data = await apiGet<ListingListData>(`/listings?${qs}`, 300).catch(() => null);
  return data ? <ListingList data={data} /> : null;
}
async function Cats({ code }: { code: string }) {
  const cats = await apiGet<Array<{ id: string; name: string }>>(`/categories?gwanCode=${code}`, 300).catch(() => []);
  return <div className="quick">{cats.map((c) => <Link key={c.id} href={`/${GWAN_PATH[code]}?cat=${c.id}`}>{c.name}</Link>)}</div>;
}
async function Notices({ code, limit }: { code: string; limit: number }) {
  const rows = await apiGet<Array<{ id: string; title: string; publishedAt?: string | null }>>(`/notices?gwanCode=${code}`, 300).catch(() => []);
  return <ul className="gp-notices">{rows.slice(0, limit).map((n) => <li key={n.id}><Link href={`/community#n-${n.id}`}>{n.title}</Link></li>)}</ul>;
}

export function GwanPageMenu({ code, items, on }: { code: string; items: GwanPageMenuItem[]; on?: string }) {
  if (!items.length) return null;
  return (
    <nav className="quick gp-menu" aria-label="관 안내 페이지" data-gwan-page-menu={code}>
      {items.map((x) => <Link key={x.slug} href={`/${GWAN_PATH[code]}/info/${x.slug}`} className={on === x.slug ? 'on' : ''}>{x.title}</Link>)}
    </nav>
  );
}

/** v10.715 (docs/823) 블록 기간 보이기 — from · until(한국 날짜 · 끝 날 포함) 밖이면 그리지 않음 */
const kstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const inPeriod = (b: Block, d: string) => (!b.from || String(b.from) <= d) && (!b.until || d <= String(b.until));
export function GwanBlocks({ code, page }: { code: string; page: GwanPageData }) {
  const today = kstDay();
  return (
    <div className="gp" data-gwan-page={page.slug} data-gwan-page-version={page.version}>
      {page.blocks.map((b, i) => {
        if (!inPeriod(b, today)) return null;
        const h = b.title ? <h2 className="gp-h">{b.title}</h2> : null;
        switch (b.type) {
          case 'HERO': return (
            <section key={i} className="page-head gp-hero" style={b.image && SAFE(b.image) ? { backgroundImage: `url("${String(b.image).replace(/"/g, '')}")`, backgroundSize: 'cover' } : undefined}>
              <h1>{b.title}</h1>{b.sub && <p>{b.sub}</p>}
              {b.button?.label && b.button?.href && <A href={b.button.href} className="btn-ok">{b.button.label}</A>}
            </section>);
          case 'TEXT': return <section key={i} className="gp-text">{h}<Text body={b.body} /></section>;
          case 'FEEDBACK': return <FeedbackBlock key={i} kind={page.slug.startsWith('lay:') ? 'LAYOUT' : 'PAGE'} refKey={page.slug.startsWith('lay:') ? page.slug.split(':')[1]! : `${code}/${page.slug}`.slice(0, 40)} title={String(b.title ?? '')} />;
          case 'BUTTONS': return <section key={i} className="quick gp-btns">{(b.items ?? []).map((x: Block, k: number) => <A key={k} href={x.href}>{x.label}</A>)}</section>;
          case 'IMAGE': return SAFE(String(b.src ?? '')) ? (
            <figure key={i} className="gp-img">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={b.src} alt={b.alt} loading="lazy" style={{ maxWidth: '100%' }} />{b.caption && <figcaption>{b.caption}</figcaption>}</figure>) : null;
          case 'GALLERY': return (   /* v10.654 사진 묶음 — 격자(2 ~ 4칸) */
            <section key={i} className="gp-gallery">{h}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, Math.max(2, Number(b.cols ?? 3)))}, minmax(0, 1fr))`, gap: 8 }}>
                {(b.items ?? []).filter((x: Block) => SAFE(String(x.src ?? ''))).map((x: Block, k: number) => (
                  <figure key={k} style={{ margin: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={x.src} alt={x.alt} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6 }} />
                    {x.caption && <figcaption className="dim" style={{ fontSize: 13 }}>{x.caption}</figcaption>}</figure>))}
              </div>
            </section>);
          case 'TABLE': return (   /* v10.656 (docs/794) 표 — 글자만(HTML 없이) · 좁은 화면은 옆으로 밀어 봄 */
            <section key={i} className="gp-table">{h}
              <div style={{ overflowX: 'auto' }}><table className="tbl">
                <thead><tr>{(b.head ?? []).map((x: string, k: number) => <th key={k} scope="col">{x}</th>)}</tr></thead>
                <tbody>{(b.rows ?? []).map((r: string[], j: number) => <tr key={j}>{(b.head ?? []).map((_: string, k: number) => <td key={k}>{r[k] ?? ''}</td>)}</tr>)}</tbody>
              </table></div>
              {b.caption && <p className="dim" style={{ fontSize: 13 }}>{b.caption}</p>}
            </section>);
          case 'VIDEO': return /^[\w-]{11}$/.test(String(b.videoId ?? '')) ? (   /* v10.664 (docs/795) 동영상 — 유튜브 개인정보 보호 주소 · 누르기 전엔 재생 안 함 */
            <section key={i} className="gp-video">{h}
              <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                <iframe src={`https://www.youtube-nocookie.com/embed/${b.videoId}?rel=0`} title={b.title || b.caption || '동영상'} loading="lazy"
                        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
              </div>
              {b.caption && <p className="dim" style={{ fontSize: 13 }}>{b.caption}</p>}
            </section>) : null;
          case 'INQUIRY': return (   /* v10.681 (D318 · docs/799) 문의 받기 — 고객센터 1:1 문의로(관 · 페이지 출처가 붙음) */
            <section key={i} className="gp-inquiry card pad" data-gwan-inquiry>{h}
              {b.body && <p>{b.body}</p>}
              <Link className="btn-ok" href={`/support/new?${new URLSearchParams({ type: String(b.category ?? 'HOWTO'), gwan: code, page: page.slug })}`}>{b.label || '문의하기'}</Link>
            </section>);
          case 'LISTINGS': return <section key={i} className="gp-list">{h}<Listings code={code} b={b} /></section>;
          /* v10.761 (docs/869) 이번 주 추천 — 많이 본(인기 순) · 새로 올라온(최신 순) 매물을 그때그때 */
          case 'PICKS': return <section key={i} className="gp-list gp-picks" data-gwan-picks={String(b.mode ?? 'VIEWED')}><h2 className="gp-h">{String(b.title || '이번 주 추천')}</h2><Listings code={code} b={{ limit: b.limit ?? 6, sort: b.mode === 'NEW' ? 'RECENT' : 'POPULAR' }} /></section>;
          case 'CATEGORIES': return <section key={i} className="gp-cats">{h}<Cats code={code} /></section>;
          case 'NOTICES': return <section key={i} className="gp-notice">{h}<Notices code={code} limit={Number(b.limit ?? 5)} /></section>;
          case 'FAQ': return (
            <section key={i} className="gp-faq">{h}{(b.items ?? []).map((x: Block, k: number) => <details key={k}><summary>{x.q}</summary><Text body={x.a} /></details>)}</section>);
          default: return null;
        }
      })}
    </div>
  );
}
