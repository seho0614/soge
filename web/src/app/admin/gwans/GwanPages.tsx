import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';
import type { Manage } from './shared';
import { uploadFile } from '../../../lib/files';
import { blocksFile, blocksToBody, blocksToHtml, DATA_IMG, dataUrlToFile, htmlToBlocks, readBlocksFile, saveFile } from './pageHtml';   // v10.655

/* ---------------------------------------------------------------------
 * SB-ADM-PAGE-010 관 페이지 — v10.651 (D311 · docs/793)
 *   관을 고르고 → 첫 화면(home · 운영 화면에서 만든 새 관만) · 관 안 페이지(이용 안내 등)를 만들고 블록으로 꾸밈
 *   초안 저장은 ADMIN · SUPER · 게시 · 숨김은 SUPER(서버가 막음) · 게시하면 판이 쌓이고 예전 판으로 초안을 다시 만들 수 있음
 *   블록 8종: 머리 띠 · 글 · 바로가기 단추 · 사진 · 매물 목록 · 업종 칩 · 공지 · 자주 묻는 질문
 * ------------------------------------------------------------------- */

type Block = Record<string, any>;
interface PageRow { id: number; gwanCode: string; slug: string; title: string; showInMenu: boolean; sortOrder: number; status: string;
  publishedVersion: number | null; publishedAt: string | null; draftUpdatedAt: string; draftUpdatedByName: string | null; draftChanged: boolean }
interface PageDetail extends PageRow { blocks: Block[]; versions: Array<{ version: number; title: string; publishedAt: string; publishedByName: string | null }> }

const KINDS: Array<[string, string]> = [['HERO', '머리 띠'], ['TEXT', '글'], ['BUTTONS', '바로가기 단추'], ['IMAGE', '사진'],
  ['GALLERY', '사진 묶음'], ['LISTINGS', '매물 목록'], ['CATEGORIES', '업종 칩'], ['NOTICES', '공지'], ['FAQ', '자주 묻는 질문']];
const KIND = Object.fromEntries(KINDS);
const STATUS: Record<string, string> = { DRAFT: '초안(안 보임)', PUBLISHED: '게시됨', HIDDEN: '숨김' };
const blank = (t: string): Block => ({
  HERO: { type: 'HERO', title: '', sub: '', image: '', button: { label: '', href: '' } },
  TEXT: { type: 'TEXT', title: '', body: '' },
  BUTTONS: { type: 'BUTTONS', items: [{ label: '', href: '' }] },
  IMAGE: { type: 'IMAGE', src: '', alt: '', caption: '' },
  GALLERY: { type: 'GALLERY', title: '', cols: 3, items: [] },
  LISTINGS: { type: 'LISTINGS', title: '', limit: 8, sort: 'RECENT', categoryId: '' },
  CATEGORIES: { type: 'CATEGORIES', title: '' },
  NOTICES: { type: 'NOTICES', title: '', limit: 5 },
  FAQ: { type: 'FAQ', title: '', items: [{ q: '', a: '' }] },
}[t] ?? { type: t });
const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');

function F({ label, v, on, max, area }: { label: string; v: string; on: (s: string) => void; max: number; area?: boolean }) {
  return (
    <label style={area ? { gridColumn: '1 / -1' } : undefined}><span>{label}</span>
      {area ? <textarea rows={5} value={v ?? ''} maxLength={max} onChange={(e) => on(e.target.value)} />
        : <input value={v ?? ''} maxLength={max} onChange={(e) => on(e.target.value)} />}
    </label>
  );
}

/* v10.653 (D312 · docs/793 7절) 편집 화면 안에서 그림 올리기 — JPG · PNG 5MB · 올리면 공개 주소(/api/v1/site/page-images/<번호>)가 칸에 들어감 */
const PAGE_IMG = (id: string) => `/api/v1/site/page-images/${id}`;
function ImageField({ label, v, on }: { label: string; v: string; on: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    if (!/^image\/(jpeg|png)$/.test(f.type) && !/\.(jpe?g|png)$/i.test(f.name)) { setErr('JPG · PNG 만 올릴 수 있습니다.'); return; }
    if (f.size > 5 * 1024 * 1024) { setErr('그림은 5MB 까지입니다.'); return; }
    setBusy(true);
    try { const u = await uploadFile(f, 'PAGE_IMAGE'); on(PAGE_IMG(u.fileId)); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  }
  return (
    <label style={{ gridColumn: '1 / -1' }}><span>{label}</span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={v ?? ''} maxLength={300} placeholder="그림 올리기를 누르거나 주소(/… · https://…)" onChange={(e) => on(e.target.value)} style={{ flex: '1 1 260px' }} />
        <input type="file" accept="image/jpeg,image/png" disabled={busy} aria-label={`${label} 올리기`} data-gwan-page-upload onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        {busy && <span className="dim">올리는 중…</span>}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {v && /^(\/|https:\/\/)/.test(v) && <img src={v} alt="" style={{ maxHeight: 60, borderRadius: 4 }} />}
      </span>
      {err && <span className="form-error">{err}</span>}
    </label>
  );
}

/* v10.654 (docs/793 8절) 사진 여러 장 올리기 — JPG · PNG 5MB · 하나씩 올려 공개 주소 목록으로 · 설명 처음 값은 파일 이름 */
type Pic = { src: string; alt: string };
async function uploadPics(files: File[], onErr: (m: string) => void): Promise<Pic[]> {
  const out: Pic[] = [];
  for (const f of files.slice(0, 30)) {
    if (!/^image\/(jpeg|png)$/.test(f.type) && !/\.(jpe?g|png)$/i.test(f.name)) { onErr(`${f.name}: JPG · PNG 만 올릴 수 있습니다.`); continue; }
    if (f.size > 5 * 1024 * 1024) { onErr(`${f.name}: 5MB 까지입니다.`); continue; }
    try { const u = await uploadFile(f, 'PAGE_IMAGE'); out.push({ src: PAGE_IMG(u.fileId), alt: f.name.replace(/\.[^.]+$/, '').slice(0, 100) || '사진' }); }
    catch (e) { onErr(`${f.name}: ${msgOf(e)}`); }
  }
  return out;
}

/** 「+ 사진 추가」 — 블록 사이 · 맨 아래. 여러 장 고르기 또는 끌어 놓기 → 그 자리에 사진 블록으로 */
function AddPhotos({ onAdd }: { onAdd: (pics: Pic[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(files: File[]) {
    if (!files.length) return;
    setBusy(true); setErr(null);
    const errs: string[] = [];
    const pics = await uploadPics(files, (m) => errs.push(m));
    setBusy(false);
    if (errs.length) setErr(errs.join(' / '));
    if (pics.length) onAdd(pics);
  }
  return (
    <div className={`gp-add${over ? ' on' : ''}`} data-gwan-page-addphotos
         style={{ border: '1px dashed var(--line, #c9d3e0)', borderRadius: 8, padding: '6px 10px', margin: '6px 0', background: over ? 'var(--bg-soft, #eef4ff)' : undefined }}
         onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
         onDrop={(e) => { e.preventDefault(); setOver(false); void go(Array.from(e.dataTransfer.files ?? [])); }}>
      <label style={{ cursor: 'pointer' }}><b>+ 사진 추가</b> <span className="dim">(여러 장 · 여기로 끌어 놓아도 됨 · JPG · PNG 5MB)</span>
        <input type="file" accept="image/jpeg,image/png" multiple disabled={busy} style={{ display: 'none' }} data-gwan-page-addphotos-input
               onChange={(e) => { void go(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label>
      {busy && <span className="dim"> 올리는 중…</span>}
      {err && <span className="form-error"> {err}</span>}
    </div>
  );
}

/** 글 블록 — 커서 자리에 사진 끼워 넣기(![설명](주소) 한 줄) */
function TextBody({ v, on }: { v: string; on: (s: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function put(files: File[]) {
    if (!files.length) return;
    setBusy(true); setErr(null);
    const errs: string[] = [];
    const pics = await uploadPics(files, (m) => errs.push(m));
    setBusy(false);
    if (errs.length) setErr(errs.join(' / '));
    if (!pics.length) return;
    const el = ref.current; const s = v ?? ''; const at = el ? el.selectionStart : s.length;
    const ins = `\n${pics.map((x) => `![${x.alt.replace(/[\[\]]/g, '')}](${x.src})`).join('\n')}\n`;
    on(s.slice(0, at) + ins + s.slice(at));
  }
  return (
    <label style={{ gridColumn: '1 / -1' }}><span>글(5,000자 · **굵게** · 줄 앞 - 목록 · [글자](주소) 링크 · 사진은 아래 단추 · HTML 은 안 됨)</span>
      <textarea ref={ref} rows={8} value={v ?? ''} maxLength={5000} onChange={(e) => on(e.target.value)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); void put(Array.from(e.dataTransfer.files)); } }} />
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="btn-sm" style={{ cursor: 'pointer' }}>글에 사진 넣기(커서 자리)
          <input type="file" accept="image/jpeg,image/png" multiple disabled={busy} style={{ display: 'none' }} data-gwan-page-textphoto
                 onChange={(e) => { void put(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label>
        {busy && <span className="dim">올리는 중…</span>}{err && <span className="form-error">{err}</span>}
      </span>
    </label>
  );
}

function BlockForm({ b, set }: { b: Block; set: (b: Block) => void }) {
  const p = (k: string) => (s: string) => set({ ...b, [k]: s });
  const items: Block[] = Array.isArray(b.items) ? b.items : [];
  const setItem = (i: number, k: string, s: string) => set({ ...b, items: items.map((x, j) => (j === i ? { ...x, [k]: s } : x)) });
  switch (b.type) {
    case 'HERO': return (<div className="form-grid">
      <F label="제목(80자)" v={b.title} on={p('title')} max={80} /><F label="한 줄 설명(200자)" v={b.sub} on={p('sub')} max={200} />
      <ImageField label="배경 그림(선택)" v={b.image} on={p('image')} />
      <F label="단추 글자(20자 · 비우면 단추 없음)" v={b.button?.label ?? ''} on={(s) => set({ ...b, button: { ...(b.button ?? {}), label: s } })} max={20} />
      <F label="단추 주소" v={b.button?.href ?? ''} on={(s) => set({ ...b, button: { ...(b.button ?? {}), href: s } })} max={300} /></div>);
    case 'TEXT': return (<div className="form-grid">
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      <TextBody v={b.body} on={p('body')} /></div>);
    case 'BUTTONS': return (<div className="form-grid">
      {items.map((x, i) => (<div key={i} style={{ display: 'contents' }}>
        <F label={`${i + 1}번 글자`} v={x.label} on={(s) => setItem(i, 'label', s)} max={20} />
        <F label={`${i + 1}번 주소`} v={x.href} on={(s) => setItem(i, 'href', s)} max={300} /></div>))}
      <div className="acts">{items.length < 4 && <button className="btn-sm" onClick={() => set({ ...b, items: [...items, { label: '', href: '' }] })}>단추 더하기</button>}
        {items.length > 1 && <button className="btn-sm btn-plain" onClick={() => set({ ...b, items: items.slice(0, -1) })}>마지막 빼기</button>}</div></div>);
    case 'IMAGE': return (<div className="form-grid">
      <ImageField label="그림(꼭)" v={b.src} on={p('src')} /><F label="그림 설명(대체 글 · 꼭)" v={b.alt} on={p('alt')} max={100} />
      <F label="그림 아래 글(선택)" v={b.caption} on={p('caption')} max={200} /></div>);
    case 'GALLERY': return (<div className="form-grid">
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      <label><span>한 줄에 몇 장</span><select value={b.cols ?? 3} onChange={(e) => set({ ...b, cols: Number(e.target.value) })}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
      {items.map((x, i) => (<div key={i} style={{ display: 'contents' }}>
        <ImageField label={`${i + 1}번 사진`} v={x.src} on={(s) => setItem(i, 'src', s)} />
        <F label={`${i + 1}번 설명(꼭)`} v={x.alt} on={(s) => setItem(i, 'alt', s)} max={100} />
        <F label={`${i + 1}번 아래 글`} v={x.caption} on={(s) => setItem(i, 'caption', s)} max={200} />
        <div className="acts"><button className="btn-sm btn-plain" onClick={() => set({ ...b, items: items.filter((_, j) => j !== i) })}>{i + 1}번 빼기</button></div>
      </div>))}
      <div style={{ gridColumn: '1 / -1' }}><AddPhotos onAdd={(pics) => set({ ...b, items: [...items, ...pics.map((x) => ({ ...x, caption: '' }))].slice(0, 30) })} /></div></div>);
    case 'LISTINGS': return (<div className="form-grid">
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      <label><span>개수</span><input type="number" min={1} max={20} value={b.limit ?? 8} onChange={(e) => set({ ...b, limit: Number(e.target.value) })} /></label>
      <label><span>정렬</span><select value={b.sort ?? 'RECENT'} onChange={(e) => set({ ...b, sort: e.target.value })}>
        <option value="RECENT">최신</option><option value="POPULAR">인기</option><option value="FEE_DESC">소개비 높은 순</option><option value="DEADLINE">마감 임박</option></select></label>
      <F label="업종 번호(선택 · 그 업종만)" v={b.categoryId} on={p('categoryId')} max={36} /></div>);
    case 'CATEGORIES': return <div className="form-grid"><F label="제목(선택)" v={b.title} on={p('title')} max={80} /></div>;
    case 'NOTICES': return (<div className="form-grid"><F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      <label><span>개수</span><input type="number" min={1} max={10} value={b.limit ?? 5} onChange={(e) => set({ ...b, limit: Number(e.target.value) })} /></label></div>);
    case 'FAQ': return (<div className="form-grid">
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      {items.map((x, i) => (<div key={i} style={{ display: 'contents' }}>
        <F label={`${i + 1}번 질문`} v={x.q} on={(s) => setItem(i, 'q', s)} max={200} />
        <F label={`${i + 1}번 답`} v={x.a} on={(s) => setItem(i, 'a', s)} max={2000} area /></div>))}
      <div className="acts">{items.length < 20 && <button className="btn-sm" onClick={() => set({ ...b, items: [...items, { q: '', a: '' }] })}>질문 더하기</button>}
        {items.length > 1 && <button className="btn-sm btn-plain" onClick={() => set({ ...b, items: items.slice(0, -1) })}>마지막 빼기</button>}</div></div>);
    default: return <p className="muted">모르는 블록</p>;
  }
}

/** 미리보기 — 사용자 웹과 같은 순서 · 글만(모양은 사용자 웹에서 확인) */
function Preview({ title, blocks }: { title: string; blocks: Block[] }) {
  return (
    <div className="card pad" data-gwan-page-preview>
      <p className="dim" style={{ marginTop: 0 }}>미리보기(글 · 순서만 — 실제 모양은 게시 뒤 사용자 웹)</p>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {blocks.map((b, i) => (
        <div key={i} style={{ borderTop: '1px dashed var(--line, #ddd)', padding: '8px 0' }}>
          <small className="dim">{i + 1}. {KIND[b.type] ?? b.type}</small>
          {b.title && <h3 style={{ margin: '4px 0' }}>{b.title}</h3>}
          {b.sub && <p>{b.sub}</p>}
          {b.body && <p style={{ whiteSpace: 'pre-wrap' }}>{b.body}</p>}
          {b.alt && <p>[그림] {b.alt}{b.caption ? ` — ${b.caption}` : ''}</p>}
          {b.type === 'GALLERY' && <p>[사진 묶음 {(b.items ?? []).length}장 · 한 줄 {b.cols ?? 3}장]</p>}
          {b.type === 'IMAGE' && b.src && <img src={b.src} alt="" style={{ maxHeight: 80 }} />}
          {b.type === 'BUTTONS' && <p>{(b.items ?? []).map((x: Block) => `[${x.label}]`).join(' ')}</p>}
          {b.type === 'FAQ' && <ul>{(b.items ?? []).map((x: Block, k: number) => <li key={k}><b>{x.q}</b> — {x.a}</li>)}</ul>}
          {b.type === 'LISTINGS' && <p>매물 {b.limit ?? 8}개 · {b.sort}</p>}
          {b.type === 'NOTICES' && <p>공지 {b.limit ?? 5}개</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * v10.655 (docs/793 9절) 불러오기 · 내려받기 · HTML 로 편집 · 다른 페이지 복사 · 판 비교
 *   모두 초안(편집 화면)에만 넣음 — 「초안 저장」 · 「게시」는 그대로. HTML 은 블록으로 바꿔 넣고 저장되는 것은 늘 블록(서버가 다시 검사)
 * ------------------------------------------------------------------- */
type Apply = (title: string | null, blocks: Block[], how: 'replace' | 'append', note: string) => void;
async function uploadDataImages(blocks: Block[], data: string[], onErr: (m: string) => void): Promise<Block[]> {
  if (!data.length) return blocks;
  let s = JSON.stringify(blocks);
  for (let n = 0; n < data.length; n++) {
    try { const u = await uploadFile(dataUrlToFile(data[n]!, `page-${n + 1}.${/png/i.test(data[n]!.slice(0, 30)) ? 'png' : 'jpg'}`), 'PAGE_IMAGE'); s = s.split(DATA_IMG(n)).join(PAGE_IMG(u.fileId)); }
    catch (e) { onErr(`박힌 그림 ${n + 1}: ${msgOf(e)}`); s = s.split(DATA_IMG(n)).join(''); }
  }
  return JSON.parse(s) as Block[];
}

function PageTools({ p, title, blocks, apply }: { p: PageDetail; title: string; blocks: Block[]; apply: Apply }) {
  const [tool, setTool] = useState<'' | 'import' | 'html' | 'copy' | 'diff'>('');
  const [how, setHow] = useState<'replace' | 'append'>('replace');
  const [paste, setPaste] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cg, setCg] = useState(p.gwanCode);
  const [cps, setCps] = useState<PageRow[]>([]);
  const [ver, setVer] = useState<number | ''>('');
  const [diff, setDiff] = useState<string[] | null>(null);
  const gwans = useApi<Manage[]>('/admin/gwans/manage');
  const base = `${p.gwanCode.toLowerCase()}-${p.slug}`;
  useEffect(() => { if (tool === 'copy' && cg) api<PageRow[]>(`/admin/gwans/${cg}/pages`).then((r) => setCps(r.filter((x) => x.id !== p.id))).catch(() => setCps([])); }, [tool, cg, p.id]);

  async function fromHtml(html: string, mode: 'replace' | 'append', what: string) {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = htmlToBlocks(html);
      const errs: string[] = [];
      const bl = await uploadDataImages(r.blocks, r.dataImages, (m) => errs.push(m));
      if (!bl.length) { setErr('바꿀 수 있는 내용이 없습니다(글 · 제목 · 그림 · 목록 · 질문만 바꿈).'); return; }
      apply(mode === 'replace' ? r.title : null, bl, mode, `${what}: 블록 ${bl.length}개${r.dataImages.length ? ` · 박힌 그림 ${r.dataImages.length}장 올림` : ''}`);
      const drop = [...r.dropped, ...errs];
      setNote(drop.length ? `바꾸지 못하고 뺀 것 — ${drop.join(' · ')}` : '모두 바꿨습니다.');
      if (mode === 'replace') setTool('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function readFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setErr('파일은 2MB 까지입니다.'); return; }
    const text = await f.text();
    if (/\.json$/i.test(f.name)) {
      try { const r = readBlocksFile(text); apply(how === 'replace' ? r.title : null, r.blocks, how, `블록 파일 ${f.name}: 블록 ${r.blocks.length}개`); setNote('불러왔습니다 — 서버가 저장할 때 다시 검사합니다.'); }
      catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    } else await fromHtml(text, how, `HTML 파일 ${f.name}`);
  }
  async function versionBlocks(v: number) { return api<{ title: string; blocks: Block[] }>(`/admin/gwan-pages/${p.id}/versions/${v}`); }
  async function download(kind: 'html' | 'json', src: 'draft' | number) {
    setErr(null);
    try {
      const d = src === 'draft' ? { title, blocks } : await versionBlocks(src);
      const tag = src === 'draft' ? 'draft' : `v${src}`;
      if (kind === 'html') saveFile(`${base}-${tag}.html`, blocksToHtml(d.title, d.blocks, window.location.origin), 'text/html;charset=utf-8');
      else saveFile(`${base}-${tag}.json`, blocksFile(d.title, d.blocks, `${p.gwanCode}/${p.slug}/${tag}`), 'application/json');
    } catch (e) { setErr(msgOf(e)); }
  }
  async function compare(v: number) {
    setErr(null);
    try {
      const d = await versionBlocks(v);
      const out: string[] = [];
      if (d.title !== title) out.push(`제목: 「${d.title}」 → 「${title}」`);
      const n = Math.max(d.blocks.length, blocks.length);
      for (let i = 0; i < n; i++) {
        const a = d.blocks[i]; const b = blocks[i];
        if (!a) out.push(`${i + 1}번 더함 — ${KIND[b!.type] ?? b!.type}`);
        else if (!b) out.push(`${i + 1}번 뺌 — ${KIND[a.type] ?? a.type}`);
        else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${i + 1}번 바뀜 — ${KIND[a.type] ?? a.type}${a.type !== b.type ? ` → ${KIND[b.type] ?? b.type}` : ''}`);
      }
      setDiff(out.length ? out : ['다른 곳 없음']);
    } catch (e) { setErr(msgOf(e)); }
  }
  const vers = p.versions ?? [];
  return (
    <div className="card pad" data-gwan-page-tools>
      <p style={{ marginTop: 0 }}><b>불러오기 · 내려받기</b>{' '}
        {(['import', 'html', 'copy', 'diff'] as const).map((k) => (
          <button key={k} className={`btn-sm${tool === k ? ' btn-ok' : ''}`} onClick={() => { setTool(tool === k ? '' : k); setNote(null); setErr(null); if (k === 'html') setCode(blocksToBody(blocks)); }} data-gwan-page-tool={k}>
            {{ import: 'HTML · 블록 파일 불러오기', html: 'HTML 로 편집', copy: '다른 페이지 복사', diff: '판 비교' }[k]}</button>))}
        {' '}<button className="btn-sm" onClick={() => void download('html', 'draft')} data-gwan-page-dl="html">HTML 내려받기(초안)</button>
        {' '}<button className="btn-sm" onClick={() => void download('json', 'draft')} data-gwan-page-dl="json">블록 파일 내려받기(초안)</button>
        {vers.length > 0 && <>{' '}<select aria-label="게시 판 내려받기" value="" onChange={(e) => { const [k, v] = e.target.value.split(':'); if (k && v) void download(k as 'html' | 'json', Number(v)); }}>
          <option value="">게시 판 내려받기…</option>
          {vers.map((v) => [<option key={`h${v.version}`} value={`html:${v.version}`}>{v.version}판 HTML</option>, <option key={`j${v.version}`} value={`json:${v.version}`}>{v.version}판 블록 파일</option>])}
        </select></>}
      </p>
      {note && <p className="form-ok">{note}</p>}
      {err && <p className="form-error">{err}</p>}
      {tool === 'import' && (<div>
        <p className="dim">HTML(.html) 이나 블록 파일(.json)을 고르거나 HTML 을 붙여 넣으십시오. HTML 은 <b>블록으로 바꿔</b> 넣습니다 — 제목 · 문단 · 목록 · 링크 · 그림 · 접는 질문만 · 스크립트 · 스타일 · 표 · 입력 칸은 뺍니다(뺀 것은 알려 드림).</p>
        <label><input type="radio" checked={how === 'replace'} onChange={() => setHow('replace')} /> 지금 초안을 바꿈</label>{' '}
        <label><input type="radio" checked={how === 'append'} onChange={() => setHow('append')} /> 지금 블록 뒤에 붙임</label>
        <p><input type="file" accept=".html,.htm,.json,text/html,application/json" disabled={busy} data-gwan-page-import-file onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></p>
        <textarea rows={6} style={{ width: '100%' }} value={paste} maxLength={500000} placeholder="또는 HTML 을 여기 붙여 넣기" onChange={(e) => setPaste(e.target.value)} data-gwan-page-import-paste />
        <div className="acts"><button className="btn-ok" disabled={busy || !paste.trim()} onClick={() => void fromHtml(paste, how, '붙여 넣은 HTML')}>붙여 넣은 HTML 바꿔 넣기</button>{busy && <span className="dim"> 바꾸는 중…</span>}</div>
      </div>)}
      {tool === 'html' && (<div>
        <p className="dim"><b>HTML 로 편집</b> — 지금 블록을 HTML 코드로 보여 줍니다. 고친 뒤 「적용」하면 다시 블록으로 바뀝니다(저장되는 것은 늘 블록 · 스크립트 · 스타일 · 표는 빠짐). <code>data-block</code> 표시는 블록 종류이니 남겨 두십시오.</p>
        <textarea rows={18} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={code} maxLength={500000} spellCheck={false} onChange={(e) => setCode(e.target.value)} data-gwan-page-htmledit />
        <div className="acts"><button className="btn-ok" disabled={busy || !code.trim()} onClick={() => void fromHtml(code, 'replace', 'HTML 편집')} data-gwan-page-htmledit-apply>적용(블록으로)</button>
          <button className="btn-sm" onClick={() => setCode(blocksToBody(blocks))}>지금 블록으로 다시</button></div>
      </div>)}
      {tool === 'copy' && (<div>
        <p className="dim">다른 페이지(이 관 · 다른 관)의 <b>초안</b>을 이 페이지 초안으로 가져옵니다. 사진은 같은 주소를 같이 씁니다.</p>
        <label>관 <select value={cg} onChange={(e) => setCg(e.target.value)}>{(gwans.data ?? []).filter((g) => !g.isHub).map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}</select></label>
        <table className="tbl"><tbody>{cps.length === 0 && <tr><td className="muted">가져올 페이지가 없습니다.</td></tr>}
          {cps.map((r) => (<tr key={r.id}><td>{r.title}</td><td className="mono">{r.slug === 'home' ? '첫 화면' : `/info/${r.slug}`}</td><td>
            <button className="btn-sm" onClick={() => { void api<PageDetail>(`/admin/gwan-pages/${r.id}`).then((d) => { apply(how === 'replace' ? d.title : null, d.blocks ?? [], how, `${cg} · ${d.title} 에서 블록 ${(d.blocks ?? []).length}개`); setNote('가져왔습니다 — 「초안 저장」을 누르십시오.'); }).catch((e) => setErr(msgOf(e))); }}>가져오기</button></td></tr>))}
        </tbody></table>
        <label><input type="radio" checked={how === 'replace'} onChange={() => setHow('replace')} /> 바꿈</label>{' '}
        <label><input type="radio" checked={how === 'append'} onChange={() => setHow('append')} /> 뒤에 붙임</label>
      </div>)}
      {tool === 'diff' && (<div>
        {vers.length === 0 ? <p className="muted">게시된 판이 없습니다.</p> : <>
          <label>견줄 판 <select value={ver} onChange={(e) => { const v = Number(e.target.value); setVer(v || ''); setDiff(null); if (v) void compare(v); }} data-gwan-page-diff>
            <option value="">고르기</option>{vers.map((v) => <option key={v.version} value={v.version}>{v.version}판 ({v.publishedAt?.slice(0, 10)})</option>)}</select></label>
          {diff && <ul data-gwan-page-diff-out>{diff.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <p className="dim">그 판 ↔ 지금 편집 중인 초안(저장 전 고침 포함)</p></>}
      </div>)}
    </div>
  );
}

function Editor({ id, isSuper, onBack }: { id: number; isSuper: boolean; onBack: () => void }) {
  const [p, setP] = useState<PageDetail | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [title, setTitle] = useState('');
  const [menu, setMenu] = useState(true);
  const [sort, setSort] = useState(0);
  const [add, setAdd] = useState('TEXT');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /* v10.655 편집 보강 — 실행 취소(20단계) · 저장 안 한 고침 경고 · 휴대폰 폭 미리보기 */
  const [hist, setHist] = useState<Block[][]>([]);
  const [saved, setSaved] = useState('');
  const [mobile, setMobile] = useState(false);
  const fill = (d: PageDetail) => { setP(d); setBlocks(d.blocks ?? []); setTitle(d.title); setMenu(d.showInMenu); setSort(d.sortOrder); setSaved(JSON.stringify([d.title, d.blocks ?? []])); setHist([]); };
  useEffect(() => { api<PageDetail>(`/admin/gwan-pages/${id}`).then(fill).catch((e) => setErr(msgOf(e))); }, [id]);
  const dirty = !!p && JSON.stringify([title, blocks]) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const change = (nb: Block[]) => { setHist((h) => [...h.slice(-19), blocks]); setBlocks(nb.slice(0, 30)); };
  const undo = () => { setHist((h) => { const last = h[h.length - 1]; if (last) setBlocks(last); return h.slice(0, -1); }); };
  const apply: Apply = (t2, nb, how, note) => { change(how === 'replace' ? nb : [...blocks, ...nb]); if (t2) setTitle(t2.slice(0, 60)); setMsg(`${note} — 「초안 저장」을 눌러야 저장됩니다.`); setErr(null); };
  const run = async (k: string, fn: () => Promise<PageDetail>, ok: string) => {
    setBusy(k); setErr(null); setMsg(null);
    try { fill(await fn()); setMsg(ok); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
  };
  if (!p) return err ? <p className="form-error">{err}</p> : <p className="muted">불러오는 중…</p>;
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j]!, n[i]!]; change(n); };
  const save = () => run('save', () => api<PageDetail>(`/admin/gwan-pages/${id}`, { method: 'PATCH', body: JSON.stringify({ title, showInMenu: menu, sortOrder: sort, blocks }) }), '초안을 저장했습니다 — 게시 전까지 사용자 웹은 그대로입니다.');
  return (
    <div data-gwan-page-editor={p.slug}>
      <p><button className="btn-sm btn-plain" onClick={() => { if (!dirty || confirm('저장하지 않은 고침이 있습니다. 그래도 나가시겠습니까?')) onBack(); }}>← 페이지 목록</button>{' '}
        {dirty && <b className="warn-text" data-gwan-page-dirty>저장 안 한 고침 있음 · </b>}
        <b>{p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`}</b> · {STATUS[p.status] ?? p.status}{p.publishedVersion ? ` · 게시 ${p.publishedVersion}판` : ''}{p.draftChanged ? ' · 게시 안 된 초안 있음' : ''}</p>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      <div className="card pad"><div className="form-grid">
        <F label="페이지 제목(60자)" v={title} on={setTitle} max={60} />
        {p.slug !== 'home' && <label><span>관 메뉴에 보임</span><input type="checkbox" checked={menu} onChange={(e) => setMenu(e.target.checked)} /></label>}
        {p.slug !== 'home' && <label><span>메뉴 순서</span><input type="number" min={0} max={999} value={sort} onChange={(e) => setSort(Number(e.target.value))} /></label>}
      </div></div>
      <PageTools p={p} title={title} blocks={blocks} apply={apply} />
      {blocks.map((b, i) => (
        <div key={i} className="card pad" data-gwan-page-block={b.type}>
          <p style={{ marginTop: 0 }}><b>{i + 1}. {KIND[b.type] ?? b.type}</b>{' '}
            <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>{' '}
            <button className="btn-sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>{' '}
            <button className="btn-sm" disabled={blocks.length >= 30} onClick={() => change([...blocks.slice(0, i + 1), JSON.parse(JSON.stringify(b)), ...blocks.slice(i + 1)])} data-gwan-page-dup>복제</button>{' '}
            <button className="btn-sm btn-no" onClick={() => change(blocks.filter((_, j) => j !== i))}>빼기</button></p>
          <BlockForm b={b} set={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb : x)))} />
          <AddPhotos onAdd={(pics) => change([...blocks.slice(0, i + 1), ...pics.map((x) => ({ type: 'IMAGE', src: x.src, alt: x.alt, caption: '' })), ...blocks.slice(i + 1)].slice(0, 30))} />
        </div>
      ))}
      {blocks.length === 0 && <AddPhotos onAdd={(pics) => change(pics.map((x) => ({ type: 'IMAGE', src: x.src, alt: x.alt, caption: '' })).slice(0, 30))} />}
      <div className="acts">
        <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="더할 블록">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn-sm" disabled={blocks.length >= 30} onClick={() => change([...blocks, blank(add)])} data-gwan-page-add>블록 더하기</button>
        <button className="btn-sm" disabled={!hist.length} onClick={undo} data-gwan-page-undo>실행 취소{hist.length ? `(${hist.length})` : ''}</button>
      </div>
      <div className="acts">
        <button className="btn-ok" disabled={!!busy} onClick={() => void save()} data-gwan-page-save>초안 저장</button>
        {isSuper && <button className="btn-ok" disabled={!!busy} data-gwan-page-publish onClick={() => {
          if (!confirm('지금 저장된 초안을 사용자 웹에 게시합니다.\n(저장하지 않은 고침은 먼저 「초안 저장」을 누르십시오)')) return;
          void run('pub', () => api<PageDetail>(`/admin/gwan-pages/${id}/publish`, { method: 'POST' }), '게시했습니다 — 사용자 웹에 바로 보입니다.');
        }}>게시</button>}
        {isSuper && p.status !== 'DRAFT' && <button className="btn-sm" disabled={!!busy} onClick={() => void run('hide', () => api<PageDetail>(`/admin/gwan-pages/${id}/hide`, { method: 'POST', body: JSON.stringify({ hidden: p.status !== 'HIDDEN' }) }), p.status === 'HIDDEN' ? '다시 보이게 했습니다.' : '숨겼습니다.')}>{p.status === 'HIDDEN' ? '다시 보이기' : '숨기기'}</button>}
        {!isSuper && <span className="dim">게시는 최고 관리자(SUPER)가 합니다.</span>}
      </div>
      <p><label><input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} data-gwan-page-mobile /> 휴대폰 폭(375px)으로 미리보기</label></p>
      <div style={mobile ? { maxWidth: 375, border: '8px solid #222', borderRadius: 18, margin: '0 auto', overflow: 'auto', maxHeight: 700 } : undefined}><Preview title={title} blocks={blocks} /></div>
      {p.versions.length > 0 && (
        <div className="card pad"><h3 style={{ marginTop: 0 }}>게시 판 기록</h3>
          <table className="tbl"><thead><tr><th>판</th><th>제목</th><th>게시</th><th>누가</th><th></th></tr></thead><tbody>
            {p.versions.map((v) => (<tr key={v.version}><td>{v.version}</td><td>{v.title}</td><td>{v.publishedAt?.slice(0, 16).replace('T', ' ')}</td><td>{v.publishedByName ?? '—'}</td>
              <td><button className="btn-sm" disabled={!!busy} onClick={() => void run('rs', () => api<PageDetail>(`/admin/gwan-pages/${id}/restore`, { method: 'POST', body: JSON.stringify({ version: v.version }) }), `${v.version}판으로 초안을 만들었습니다 — 게시는 따로.`)}>이 판으로 초안</button></td></tr>))}
          </tbody></table></div>
      )}
    </div>
  );
}

export function GwanPages({ isSuper }: { isSuper: boolean }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [code, setCode] = useState('');
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const gws = (manage.data ?? []).filter((g) => !g.isHub);
  useEffect(() => { if (!code && gws[0]) setCode(gws[0].code); }, [gws.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => { if (code) api<PageRow[]>(`/admin/gwans/${code}/pages`).then(setRows).catch((e) => setErr(msgOf(e))); };
  useEffect(load, [code]);
  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (open) return <Editor id={open} isSuper={isSuper} onBack={() => { setOpen(null); load(); }} />;
  const hasHome = rows?.some((r) => r.slug === 'home');
  async function create(s: string, t: string) {
    setErr(null);
    try { const d = await api<PageDetail>(`/admin/gwans/${code}/pages`, { method: 'POST', body: JSON.stringify({ slug: s, title: t }) }); setSlug(''); setTitle(''); setOpen(d.id); }
    catch (e) { setErr(msgOf(e)); }
  }
  return (
    <>
      <p className="lead">관마다 <b>첫 화면</b>(운영 화면에서 만든 새 관만)과 <b>관 안 페이지</b>(이용 안내 · 소개 등)를 블록으로 꾸밉니다. 초안은 관리자 누구나 · <b>게시는 최고 관리자</b>.</p>
      <div className="search-row">
        <label>관 <select value={code} onChange={(e) => { setCode(e.target.value); setRows(null); }} data-gwan-pages-gwan>
          {gws.map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}</select></label>
      </div>
      {err && <p className="form-error">{err}</p>}
      {rows && (
        <table className="tbl" data-gwan-pages>
          <thead><tr><th>페이지</th><th>주소</th><th>상태</th><th>게시 판</th><th>초안 고친 때</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">아직 페이지가 없습니다.</td></tr>}
            {rows.map((r) => (<tr key={r.id}>
              <td>{r.title}{r.draftChanged && <span className="dim"> · 게시 안 된 초안</span>}</td>
              <td className="mono">{r.slug === 'home' ? '첫 화면' : `/info/${r.slug}`}</td><td>{STATUS[r.status] ?? r.status}</td>
              <td>{r.publishedVersion ?? '—'}</td><td>{r.draftUpdatedAt?.slice(0, 16).replace('T', ' ')} {r.draftUpdatedByName ?? ''}</td>
              <td><button className="btn-sm" onClick={() => setOpen(r.id)} data-gwan-page-open={r.slug}>편집</button></td></tr>))}
          </tbody>
        </table>
      )}
      <div className="card pad" data-gwan-page-new>
        <h3 style={{ marginTop: 0 }}>새 페이지</h3>
        <div className="form-grid">
          <label><span>주소(영문 소문자 · 숫자 · - · 2 ~ 40자)</span><input value={slug} maxLength={40} placeholder="예) guide" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></label>
          <label><span>제목</span><input value={title} maxLength={60} placeholder="예) 이용 안내" onChange={(e) => setTitle(e.target.value)} /></label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug) || slug === 'home' || !title.trim()} onClick={() => void create(slug, title.trim())} data-gwan-page-create>만들기</button>
          {!hasHome && <button className="btn-sm" onClick={() => void create('home', '첫 화면')} data-gwan-page-home>첫 화면 만들기(새 관만)</button>}
        </div>
      </div>
    </>
  );
}
