/* ---------------------------------------------------------------------
 * v10.655 (docs/793 9절) 관 페이지 ↔ HTML · 블록 파일
 *   blocksToHtml — 블록을 HTML 파일 하나로(글자는 모두 이스케이프 · 스크립트 없음) — 내려받기 · 「HTML 로 편집」의 시작 글
 *   htmlToBlocks — 브라우저 DOMParser 로 읽어 블록으로 바꿈(HTML 은 저장하지 않음 · 서버가 블록을 다시 검사)
 *     h1 → 머리 띠 · h2 ~ h4 → 글 블록 제목 · p · blockquote · 목록 → 글 · img · figure → 사진 · details → 자주 묻는 질문
 *     script · style · iframe · form · table · 이벤트 속성 · 위험한 주소는 버리고 「바꾸지 못한 것」 목록으로 알림
 *   blocksFile · readBlocksFile — 블록 파일(JSON · format sgb-gwan-page) 내려받기 · 불러오기
 * ------------------------------------------------------------------- */

export type Block = Record<string, any>;
export const SAFE_URL = (u: string) => /^\/(?!\/)/.test(u) || /^https:\/\//i.test(u);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!);
const escAttr = (u: string) => (SAFE_URL(u) ? esc(u) : '#');

/** 글 블록 한 줄 안 — **굵게** · [글자](주소) */
function inlineHtml(s: string): string {
  let out = ''; let last = 0;
  const re = /\*\*([^*]+)\*\*|\[([^\]]{1,80})\]\(([^)\s]{1,300})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    out += m[1] != null ? `<strong>${esc(m[1])}</strong>` : `<a href="${escAttr(m[3]!)}">${esc(m[2])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
function textHtml(body: string): string {
  const out: string[] = []; let list: string[] = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((x) => `<li>${inlineHtml(x)}</li>`).join('')}</ul>`); list = []; } };
  for (const line of String(body ?? '').split('\n')) {
    if (/^\s*-\s+/.test(line)) { list.push(line.replace(/^\s*-\s+/, '')); continue; }
    flush();
    const pic = /^\s*!\[([^\]]{0,100})\]\(([^)\s]{1,300})\)\s*$/.exec(line);
    if (pic) { out.push(`<figure><img src="${escAttr(pic[2]!)}" alt="${esc(pic[1])}"></figure>`); continue; }
    if (line.trim()) out.push(`<p>${inlineHtml(line)}</p>`);
  }
  flush();
  return out.join('\n');
}

/** 블록 → HTML 조각(본문만) — 「HTML 로 편집」 · 내려받기 공통 */
export function blocksToBody(blocks: Block[]): string {
  return blocks.map((b) => {
    const h = b.title ? `<h2>${esc(b.title)}</h2>\n` : '';
    switch (b.type) {
      case 'HERO': return `<header data-block="HERO"${b.image ? ` data-image="${escAttr(b.image)}"` : ''}>\n<h1>${esc(b.title)}</h1>\n${b.sub ? `<p>${esc(b.sub)}</p>\n` : ''}${b.button?.label ? `<p><a class="button" href="${escAttr(b.button.href ?? '')}">${esc(b.button.label)}</a></p>\n` : ''}</header>`;
      case 'TEXT': return `<section data-block="TEXT">\n${h}${textHtml(b.body)}\n</section>`;
      case 'BUTTONS': return `<nav data-block="BUTTONS">\n${(b.items ?? []).map((x: Block) => `<a class="button" href="${escAttr(x.href ?? '')}">${esc(x.label)}</a>`).join('\n')}\n</nav>`;
      case 'IMAGE': return `<figure data-block="IMAGE"><img src="${escAttr(b.src ?? '')}" alt="${esc(b.alt)}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
      case 'GALLERY': return `<section data-block="GALLERY" data-cols="${Number(b.cols ?? 3)}">\n${h}${(b.items ?? []).map((x: Block) => `<figure><img src="${escAttr(x.src ?? '')}" alt="${esc(x.alt)}">${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('\n')}\n</section>`;
      case 'FAQ': return `<section data-block="FAQ">\n${h}${(b.items ?? []).map((x: Block) => `<details><summary>${esc(x.q)}</summary>\n${textHtml(x.a)}\n</details>`).join('\n')}\n</section>`;
      case 'LISTINGS': return `<section data-block="LISTINGS" data-limit="${Number(b.limit ?? 8)}" data-sort="${esc(b.sort ?? 'RECENT')}"${b.categoryId ? ` data-category="${esc(b.categoryId)}"` : ''}>${h}<p>(매물 목록 ${Number(b.limit ?? 8)}개 — 사용자 웹에서 채워짐)</p></section>`;
      case 'CATEGORIES': return `<section data-block="CATEGORIES">${h}<p>(업종 칩 — 사용자 웹에서 채워짐)</p></section>`;
      case 'NOTICES': return `<section data-block="NOTICES" data-limit="${Number(b.limit ?? 5)}">${h}<p>(공지 ${Number(b.limit ?? 5)}개 — 사용자 웹에서 채워짐)</p></section>`;
      default: return '';
    }
  }).filter(Boolean).join('\n\n');
}

/** 내려받을 HTML 파일 하나(스크립트 없음 · 글꼴 · 색은 기본) */
export function blocksToHtml(title: string, blocks: Block[], origin = ''): string {
  const abs = (h: string) => h.replace(/(src|href)="\/(?!\/)/g, `$1="${origin}/`);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:860px;margin:24px auto;padding:0 16px;line-height:1.6;color:#1f2a37}
img{max-width:100%;border-radius:6px}a.button{display:inline-block;padding:8px 14px;border-radius:8px;background:#1f4fbf;color:#fff;text-decoration:none;margin:2px}
section[data-block=GALLERY]{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}details{border-top:1px solid #e5e7eb;padding:6px 0}</style>
</head><body>
<!-- sgb-gwan-page · 소개뱅크 관 페이지 · 이 파일을 「HTML 불러오기」로 다시 넣을 수 있음 -->
<h1 class="page-title">${esc(title)}</h1>
${abs(blocksToBody(blocks))}
</body></html>
`;
}

/* ── HTML → 블록 ─────────────────────────────────────────────── */
/** dataImages — HTML 안에 박힌 그림(data:image/png · jpeg) · 블록에는 자리표 __DATA_IMG_<n>__ 가 들어가고 편집 화면이 올린 뒤 주소로 바꿈 */
export interface Imported { title: string | null; blocks: Block[]; dropped: string[]; dataImages: string[] }
export const DATA_IMG = (n: number) => `__DATA_IMG_${n}__`;

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
/** 내려받은 HTML 을 다시 불러올 때 — 이 사이트 주소(https://sogaebank.com/… · 지금 화면 주소)는 관 안 주소(/…)로 */
const local = (u: string) => {
  let s = u.replace(/^https:\/\/(www\.)?sogaebank\.com(?=\/)/i, '');
  const o = typeof window !== 'undefined' ? window.location.origin : '';
  if (o && s.startsWith(o + '/')) s = s.slice(o.length);
  return s;
};
function inlineMd(el: Node, dropped: string[]): string {
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) { s += (n.textContent ?? '').replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement; const tag = e.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') { const t = clip(e.textContent ?? '', 200); if (t) s += `**${t.replace(/\*/g, '')}**`; return; }
    if (tag === 'a') {
      const href = local((e.getAttribute('href') ?? '').trim()); const t = clip(e.textContent ?? '', 80).replace(/[[\]]/g, '');
      if (t && SAFE_URL(href)) s += `[${t}](${href})`; else { s += t; if (href && !SAFE_URL(href)) dropped.push(`링크 주소 ${href.slice(0, 60)}(관 안 주소나 https 만)`); }
      return;
    }
    if (tag === 'br') { s += ' '; return; }
    if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'canvas'].includes(tag)) { dropped.push(`<${tag}>`); return; }
    s += inlineMd(e, dropped);
  });
  return s;
}

export function htmlToBlocks(html: string): Imported {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const dropped: string[] = []; const blocks: Block[] = []; const dataImages: string[] = [];
  let title: string | null = clip(doc.querySelector('h1.page-title')?.textContent ?? doc.title ?? '', 60) || null;
  doc.querySelector('h1.page-title')?.remove();
  let cur: Block | null = null;
  const text = () => { if (!cur || cur.type !== 'TEXT') { cur = { type: 'TEXT', title: '', body: '' }; blocks.push(cur); } return cur; };
  const addLine = (l: string) => { const t = text(); const add = (t.body ? '\n' : '') + l; if ((t.body + add).length > 5000) { cur = null; text().body = l; } else t.body += add; };
  const img = (e: Element): { src: string; alt: string } | null => {
    const src = local((e.getAttribute('src') ?? '').trim()); const alt = clip(e.getAttribute('alt') ?? '', 100) || '사진';
    if (/^data:image\/(png|jpeg);base64,/i.test(src)) { dataImages.push(src); return { src: DATA_IMG(dataImages.length - 1), alt }; }
    if (!SAFE_URL(src)) { dropped.push(`그림 주소 ${src.slice(0, 60) || '(없음)'}`); return null; }
    return { src, alt };
  };
  const walk = (root: Element) => {
    Array.from(root.children).forEach((e) => {
      const tag = e.tagName.toLowerCase(); const kind = e.getAttribute('data-block');
      if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'svg', 'canvas', 'link', 'meta'].includes(tag)) { dropped.push(`<${tag}>`); return; }
      if (tag === 'table') { dropped.push('표(table) — 글로 옮겨 적으십시오'); return; }
      if (kind === 'HERO' || (tag === 'header' && e.querySelector('h1'))) {
        const btn = e.querySelector('a');
        const image = e.getAttribute('data-image') ?? '';
        blocks.push({ type: 'HERO', title: clip(e.querySelector('h1')?.textContent ?? '', 80), sub: clip(Array.from(e.querySelectorAll('p')).find((p) => !p.querySelector('a'))?.textContent ?? '', 200),
          image: SAFE_URL(image) ? image : '', button: btn && SAFE_URL(btn.getAttribute('href') ?? '') ? { label: clip(btn.textContent ?? '', 20), href: btn.getAttribute('href') } : { label: '', href: '' } });
        cur = null; return;
      }
      if (kind === 'BUTTONS' || tag === 'nav') {
        const items = Array.from(e.querySelectorAll('a')).map((a) => ({ label: clip(a.textContent ?? '', 20), href: (a.getAttribute('href') ?? '').trim() })).filter((x) => x.label && SAFE_URL(x.href)).slice(0, 4);
        if (items.length) blocks.push({ type: 'BUTTONS', items }); cur = null; return;
      }
      if (kind === 'GALLERY') {
        const items: Block[] = [];
        e.querySelectorAll('figure').forEach((f) => { const im = f.querySelector('img'); if (!im) return; const r = img(im); if (r) items.push({ ...r, caption: clip(f.querySelector('figcaption')?.textContent ?? '', 200) }); });
        blocks.push({ type: 'GALLERY', title: clip(e.querySelector('h2,h3')?.textContent ?? '', 80), cols: Math.min(4, Math.max(2, Number(e.getAttribute('data-cols') ?? 3) || 3)), items: items.slice(0, 30) });
        cur = null; return;
      }
      if (kind === 'LISTINGS' || kind === 'CATEGORIES' || kind === 'NOTICES') {
        const b: Block = { type: kind, title: clip(e.querySelector('h2,h3')?.textContent ?? '', 80) };
        if (kind === 'LISTINGS') { b.limit = Number(e.getAttribute('data-limit') ?? 8) || 8; b.sort = e.getAttribute('data-sort') ?? 'RECENT'; b.categoryId = e.getAttribute('data-category') ?? ''; }
        if (kind === 'NOTICES') b.limit = Number(e.getAttribute('data-limit') ?? 5) || 5;
        blocks.push(b); cur = null; return;
      }
      if (kind === 'FAQ' || e.querySelector(':scope > details')) {
        const items = Array.from(e.querySelectorAll('details')).map((d) => { const q = clip(d.querySelector('summary')?.textContent ?? '', 200); d.querySelector('summary')?.remove(); return { q, a: clip(inlineMd(d, dropped), 2000) }; }).filter((x) => x.q && x.a).slice(0, 20);
        if (items.length) blocks.push({ type: 'FAQ', title: clip(e.querySelector(':scope > h2, :scope > h3')?.textContent ?? '', 80), items });
        cur = null; return;
      }
      if (tag === 'details') {
        const q = clip(e.querySelector('summary')?.textContent ?? '', 200); e.querySelector('summary')?.remove();
        const a = clip(inlineMd(e, dropped), 2000);
        const last = blocks[blocks.length - 1];
        if (q && a) { if (last?.type === 'FAQ' && last.items.length < 20) last.items.push({ q, a }); else blocks.push({ type: 'FAQ', title: '', items: [{ q, a }] }); }
        cur = null; return;
      }
      if (tag === 'h1') { blocks.push({ type: 'HERO', title: clip(e.textContent ?? '', 80), sub: '', image: '', button: { label: '', href: '' } }); cur = null; return; }
      if (/^h[2-6]$/.test(tag)) { cur = { type: 'TEXT', title: clip(e.textContent ?? '', 80), body: '' }; blocks.push(cur); return; }
      if (tag === 'figure' || tag === 'img') {
        const im = tag === 'img' ? e : e.querySelector('img'); if (!im) return;
        const r = img(im);
        if (r) blocks.push({ type: 'IMAGE', src: r.src, alt: r.alt, caption: clip(e.querySelector('figcaption')?.textContent ?? '', 200) });
        cur = null; return;
      }
      if (tag === 'ul' || tag === 'ol') { e.querySelectorAll(':scope > li').forEach((li) => { const t = clip(inlineMd(li, dropped), 1000); if (t) addLine(`- ${t}`); }); return; }
      if (tag === 'p' || tag === 'blockquote' || tag === 'pre') {
        const pic = e.querySelector('img');
        if (pic && !clip(e.textContent ?? '', 10)) { const r = img(pic); if (r) { blocks.push({ type: 'IMAGE', src: r.src, alt: r.alt, caption: '' }); cur = null; } return; }
        const t = clip(inlineMd(e, dropped), 5000);
        const last = blocks[blocks.length - 1];
        if (t && !cur && last?.type === 'HERO' && !last.sub && tag === 'p' && t.length <= 200 && !/\]\(/.test(t)) { last.sub = t.replace(/\*\*/g, ''); return; }   // 제목 바로 아래 짧은 문단 = 머리 띠 설명
        if (t) addLine(t); return;
      }
      if (['section', 'article', 'main', 'div', 'header', 'footer', 'aside', 'body'].includes(tag)) { walk(e); return; }
      const t = clip(inlineMd(e, dropped), 5000); if (t) addLine(t);
    });
  };
  walk(doc.body);
  if (!title) title = (blocks.find((b) => b.type === 'HERO')?.title as string | undefined) ?? null;
  return { title, blocks: blocks.filter((b) => b.type !== 'TEXT' || b.body || b.title).map((b) => (b.type === 'TEXT' && !b.body ? { ...b, body: b.title, title: '' } : b)).slice(0, 30), dropped: [...new Set(dropped)].slice(0, 30), dataImages };
}

/* ── 블록 파일(JSON) ─────────────────────────────────────────── */
export const blocksFile = (title: string, blocks: Block[], from: string) =>
  JSON.stringify({ format: 'sgb-gwan-page', v: 1, from, title, exportedAt: new Date().toISOString(), blocks }, null, 2);
export function readBlocksFile(text: string): { title: string; blocks: Block[] } {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error('블록 파일(JSON)이 아닙니다.'); }
  if (d?.format !== 'sgb-gwan-page' || !Array.isArray(d.blocks)) throw new Error('소개뱅크 관 페이지 블록 파일이 아닙니다(format sgb-gwan-page).');
  return { title: String(d.title ?? '').slice(0, 60), blocks: d.blocks.slice(0, 30) };
}

/** 파일로 내려받기(브라우저) */
export function saveFile(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/png';
  const bin = atob(b64 ?? ''); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new File([buf], name, { type });
}
