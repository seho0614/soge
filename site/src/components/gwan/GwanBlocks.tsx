import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import type { ListingListData } from '@/lib/types';
import { ListingList } from '@/components/ListingList';

/* ---------------------------------------------------------------------
 * v10.652 (D311 · docs/793) 관 페이지 블록 그리기 — 운영 화면 › 관 관리 › 관 페이지에서 게시한 판(GET /gwans/{code}/pages/{slug})
 *   글은 HTML 없이 그림(React 가 글자를 그대로 씀) — **굵게** · 줄 앞 「- 」 목록 · [글자](주소) 링크만(주소는 /… 또는 https://…)
 *   매물 · 업종 · 공지 블록은 그 자리에서 공개 API 로 읽음(5분 캐시) · 읽지 못하면 그 블록만 비움
 * ------------------------------------------------------------------- */

type Block = Record<string, any>;
export interface GwanPageData { slug: string; title: string; blocks: Block[]; version: number; publishedAt: string }
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

export function GwanBlocks({ code, page }: { code: string; page: GwanPageData }) {
  return (
    <div className="gp" data-gwan-page={page.slug} data-gwan-page-version={page.version}>
      {page.blocks.map((b, i) => {
        const h = b.title ? <h2 className="gp-h">{b.title}</h2> : null;
        switch (b.type) {
          case 'HERO': return (
            <section key={i} className="page-head gp-hero" style={b.image && SAFE(b.image) ? { backgroundImage: `url("${String(b.image).replace(/"/g, '')}")`, backgroundSize: 'cover' } : undefined}>
              <h1>{b.title}</h1>{b.sub && <p>{b.sub}</p>}
              {b.button?.label && b.button?.href && <A href={b.button.href} className="btn-ok">{b.button.label}</A>}
            </section>);
          case 'TEXT': return <section key={i} className="gp-text">{h}<Text body={b.body} /></section>;
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
          case 'LISTINGS': return <section key={i} className="gp-list">{h}<Listings code={code} b={b} /></section>;
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
