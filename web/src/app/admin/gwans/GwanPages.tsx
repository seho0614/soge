import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';
import type { Manage } from './shared';
import { uploadFile } from '../../../lib/files';
import { siteHref } from '../../../lib/siteUrl';   // v10.666 미리보기 링크
import { blocksFile, blocksToBody, blocksToHtml, DATA_IMG, dataUrlToFile, htmlToBlocks, readBlocksFile, saveFile } from './pageHtml';   // v10.655

/* ---------------------------------------------------------------------
 * SB-ADM-PAGE-010 관 페이지 — v10.651 (D311 · docs/793)
 *   관을 고르고 → 첫 화면(home · 운영 화면에서 만든 새 관만) · 관 안 페이지(이용 안내 등)를 만들고 블록으로 꾸밈
 *   초안 저장은 ADMIN · SUPER · 게시 · 숨김은 SUPER(서버가 막음) · 게시하면 판이 쌓이고 예전 판으로 초안을 다시 만들 수 있음
 *   블록 8종: 머리 띠 · 글 · 바로가기 단추 · 사진 · 매물 목록 · 업종 칩 · 공지 · 자주 묻는 질문
 *   v10.661 ~ 667 (D315 · docs/795) 예약 게시(SUPER) · 번역 초안 채우기(언어판) · 동영상 블록 · 방문 수 · 틀로 시작 · 미리보기 링크
 * ------------------------------------------------------------------- */

type Block = Record<string, any>;
interface PageRow { id: number; gwanCode: string; slug: string; lang?: string; title: string; showInMenu: boolean; sortOrder: number; status: string;
  editable?: boolean;   // v10.701 (D322)
  gwanOpen?: boolean;   // v10.705 관이 열려 있으면 고칠 수 없음
  publishedVersion: number | null; publishedAt: string | null; draftUpdatedAt: string; draftUpdatedByName: string | null; draftChanged: boolean;
  scheduledAt?: string | null; scheduledByName?: string | null; views7?: number;
  visibility?: string; seoDescription?: string | null; seoImage?: string | null; noindex?: boolean }   // v10.691 · 692 (D320)
interface PageDetail extends PageRow { blocks: Block[]; versions: Array<{ version: number; title: string; publishedAt: string; publishedByName: string | null }>;
  previews?: Array<{ token: string; expiresAt: string; createdAt?: string; createdByName?: string | null }> }

const KINDS: Array<[string, string]> = [['HERO', '머리 띠'], ['TEXT', '글'], ['BUTTONS', '바로가기 단추'], ['IMAGE', '사진'],
  ['GALLERY', '사진 묶음'], ['TABLE', '표'], ['VIDEO', '동영상(유튜브)'], ['LISTINGS', '매물 목록'], ['CATEGORIES', '업종 칩'], ['NOTICES', '공지'], ['FAQ', '자주 묻는 질문'], ['INQUIRY', '문의 받기']];   // v10.681
KINDS.push(['FEEDBACK', '손님 한 줄 의견']);   // v10.729 (D325 · docs/837)
const KIND: Record<string, string> = { ...Object.fromEntries(KINDS), FRAGMENT: '공통 조각' };   // v10.674 조각은 「조각 넣기」로만
const STATUS: Record<string, string> = { DRAFT: '초안(안 보임)', PUBLISHED: '게시됨', HIDDEN: '숨김' };
const blank = (t: string): Block => ({
  HERO: { type: 'HERO', title: '', sub: '', image: '', button: { label: '', href: '' } },
  TEXT: { type: 'TEXT', title: '', body: '' },
  BUTTONS: { type: 'BUTTONS', items: [{ label: '', href: '' }] },
  IMAGE: { type: 'IMAGE', src: '', alt: '', caption: '' },
  GALLERY: { type: 'GALLERY', title: '', cols: 3, items: [] },
  TABLE: { type: 'TABLE', title: '', caption: '', head: ['항목', '내용'], rows: [['', '']] },
  VIDEO: { type: 'VIDEO', title: '', url: '', caption: '' },   // v10.664
  INQUIRY: { type: 'INQUIRY', title: '궁금한 점이 있으신가요?', body: '', label: '문의하기', category: 'HOWTO' },   // v10.681
  LISTINGS: { type: 'LISTINGS', title: '', limit: 8, sort: 'RECENT', categoryId: '' },
  CATEGORIES: { type: 'CATEGORIES', title: '' },
  NOTICES: { type: 'NOTICES', title: '', limit: 5 },
  FAQ: { type: 'FAQ', title: '', items: [{ q: '', a: '' }] },
  FEEDBACK: { type: 'FEEDBACK', title: '이 안내가 도움이 됐나요?' },   // v10.729
}[t] ?? { type: t });
/* v10.665 (docs/795) 페이지 틀 — 빈 페이지에서 고르면 블록이 채워짐(글은 예시 · 고쳐서 저장) · 주소는 사용자 웹에 있는 곳만 */
const TEMPLATES: Array<{ key: string; label: string; blocks: Block[] }> = [
  { key: 'guide', label: '안내형(머리 띠 · 글 · 자주 묻는 질문 · 단추)', blocks: [
    { type: 'HERO', title: '이용 안내', sub: '처음 오신 분을 위한 한 줄 설명을 적어 주세요.', image: '', button: null },
    { type: 'TEXT', title: '이렇게 이용합니다', body: '- 첫째, 필요한 것을 찾거나 요청합니다\n- 둘째, 소개를 받고 거래합니다\n- 셋째, 거래가 끝나면 후기를 남깁니다' },
    { type: 'FAQ', title: '자주 묻는 질문', items: [{ q: '누구나 이용할 수 있나요?', a: '네, 회원이면 누구나 이용할 수 있습니다.' }] },
    { type: 'BUTTONS', items: [{ label: '고객센터', href: '/support' }] },
  ] },
  { key: 'recruit', label: '모집형(머리 띠 · 조건 · 일정 표 · 신청 단추)', blocks: [
    { type: 'HERO', title: '함께할 분을 찾습니다', sub: '모집 내용을 한 줄로 적어 주세요.', image: '', button: { label: '요청 올리기', href: '/request/new' } },
    { type: 'TEXT', title: '모집 조건', body: '- 대상:\n- 기간:\n- 지역:' },
    { type: 'TABLE', title: '일정', caption: '', head: ['날짜', '내용'], rows: [['', '접수 시작'], ['', '접수 마감']] },
    { type: 'BUTTONS', items: [{ label: '요청 올리기', href: '/request/new' }, { label: '고객센터', href: '/support' }] },
  ] },
  { key: 'intro', label: '소개형(머리 띠 · 글 · 업종 칩 · 매물 목록 · 공지)', blocks: [
    { type: 'HERO', title: '관 소개', sub: '이 관에서 무엇을 소개하는지 적어 주세요.', image: '', button: null },
    { type: 'TEXT', title: '', body: '이 관의 특징과 좋은 점을 적어 주세요.' },
    { type: 'CATEGORIES', title: '업종' },
    { type: 'LISTINGS', title: '새로 올라온 소개', limit: 8, sort: 'RECENT', categoryId: '' },
    { type: 'NOTICES', title: '공지', limit: 5 },
  ] },
];
/* v10.671 (docs/796) 페이지 점검 — 게시 전에 읽기 쉬움 · 접근성(화면 읽기 프로그램) · 주소를 봄 · 결과만 알려 주고 게시는 막지 않음 */
interface Finding { level: 'warn' | 'info'; at: string; msg: string }
const SITE_PATHS = ['/', '/money', '/mall', '/biz', '/health', '/lead', '/g/', '/community', '/support', '/request', '/search', '/guide', '/terms', '/policy', '/listings', '/register', '/my', '/signup', '/login', '/price-stats', '/supplier', '/safety', '/partners'];
const VAGUE = /^(여기|클릭|이곳|바로가기|더보기|click|here|more)$/i;
const FILEISH = /^(img|image|dsc|photo|사진|그림|kakaotalk|screenshot)[\s_\-]*\d*(\.(jpe?g|png|gif|webp))?$|\.(jpe?g|png|gif|webp)$/i;
export function checkPage(title: string, blocks: Block[], slug: string): Finding[] {
  const out: Finding[] = [];
  const add = (level: Finding['level'], at: string, msg: string) => out.push({ level, at, msg });
  const linkOk = (h: string) => !h.startsWith('/') || SITE_PATHS.some((x) => (x === '/' ? h === '/' || /^\/(\?|#)/.test(h) : h === x || h.startsWith(x.endsWith('/') ? x : `${x}/`) || h.startsWith(`${x}?`) || h.startsWith(`${x}#`)));
  if (!title.trim()) add('warn', '제목', '페이지 제목이 비었습니다.');
  if (!blocks.length) add('warn', '블록', '블록이 없습니다(게시할 수 없음).');
  if (slug === 'home' && blocks[0] && blocks[0].type !== 'HERO') add('info', '1번', '첫 화면은 머리 띠로 시작하면 무엇을 하는 관인지 먼저 보입니다.');
  if (blocks.filter((b) => b.type === 'HERO').length > 1) add('warn', '머리 띠', '머리 띠(큰 제목)가 여러 개입니다 — 화면 읽기 프로그램은 큰 제목을 하나로 봅니다.');
  blocks.forEach((b, i) => {
    const at = `${i + 1}번 ${KIND[b.type] ?? b.type}`;
    const pics: Array<{ alt?: string; src?: string }> = b.type === 'IMAGE' ? [b] : b.type === 'GALLERY' ? (b.items ?? []) : [];
    pics.forEach((x, k) => {
      const alt = String(x.alt ?? '').trim();
      if (!alt) add('warn', at, `${pics.length > 1 ? `${k + 1}번 ` : ''}사진 설명(대체 글)이 비었습니다.`);
      else if (FILEISH.test(alt) || alt.length < 3) add('warn', at, `${pics.length > 1 ? `${k + 1}번 ` : ''}사진 설명 「${alt}」 이 파일 이름 같거나 너무 짧습니다 — 무엇이 보이는지 적으십시오.`);
    });
    if (b.type === 'TEXT') {
      const body = String(b.body ?? '');
      if (body.length > 1500 && !b.title) add('info', at, `글이 ${body.length.toLocaleString()}자인데 제목이 없습니다 — 제목을 달거나 나누면 읽기 쉽습니다.`);
      [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].forEach((m) => { if (!m[1]!.trim()) add('warn', at, '글 속 사진에 설명이 없습니다(「글에 사진 넣기」 뒤 ![설명] 칸).'); });
      [...body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)].forEach((m) => {
        if (VAGUE.test(m[1]!.trim())) add('info', at, `링크 글자 「${m[1]}」 만으로는 어디로 가는지 모릅니다.`);
        if (!linkOk(m[2]!)) add('warn', at, `링크 주소 ${m[2]} 는 사용자 웹에 없는 화면일 수 있습니다.`);
      });
    }
    const btns: Array<{ label?: string; href?: string }> = b.type === 'BUTTONS' ? (b.items ?? []) : b.type === 'HERO' && b.button?.label ? [b.button] : [];
    btns.forEach((x) => {
      if (VAGUE.test(String(x.label ?? '').trim())) add('info', at, `단추 글자 「${x.label}」 만으로는 어디로 가는지 모릅니다.`);
      if (x.href && !linkOk(String(x.href))) add('warn', at, `단추 주소 ${x.href} 는 사용자 웹에 없는 화면일 수 있습니다.`);
    });
    if (b.type === 'TABLE' && (b.head ?? []).some((h: string) => !String(h ?? '').trim())) add('warn', at, '표 머리 칸이 빈 것이 있습니다 — 화면 읽기 프로그램이 칸 이름을 읽습니다.');
    if (b.type === 'VIDEO' && !String(b.title ?? '').trim() && !String(b.caption ?? '').trim()) add('info', at, '동영상에 제목이나 아래 글이 없습니다 — 무엇에 관한 영상인지 적으십시오.');
    if (b.type === 'FAQ' && (b.items ?? []).length === 1) add('info', at, '질문이 하나뿐입니다.');
  });
  return out;
}
function PageCheck({ f }: { f: Finding[] }) {
  const w = f.filter((x) => x.level === 'warn').length;
  return (
    <details className="card pad" data-gwan-page-check open={w > 0}>
      <summary><b>페이지 점검</b> {f.length === 0 ? <span className="dim">— 고칠 것 없음</span> : <span>— 고칠 것 <b className={w ? 'warn-text' : ''}>{w}</b> · 살펴볼 것 {f.length - w}</span>} <span className="dim">(게시는 막지 않음)</span></summary>
      {f.length > 0 && <ul style={{ margin: '6px 0 0' }}>{f.map((x, i) => <li key={i}><b className={x.level === 'warn' ? 'warn-text' : 'dim'}>{x.level === 'warn' ? '고칠 것' : '살펴볼 것'}</b> · {x.at} — {x.msg}</li>)}</ul>}
    </details>
  );
}
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
export function ImageField({ label, v, on }: { label: string; v: string; on: (s: string) => void }) {   // v10.718 (docs/826) 꾸밀 페이지 그림 올리기에도 씀
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

/* v10.656 (docs/794) 표 편집 — 칸(열) 1 ~ 8 · 줄 1 ~ 50 · 엑셀 · 한글에서 복사한 표(탭 구분)를 붙여 넣으면 바뀜(첫 줄 = 머리 칸) */
function TableForm({ b, set }: { b: Block; set: (b: Block) => void }) {
  const head: string[] = Array.isArray(b.head) ? b.head : [];
  const rows: string[][] = Array.isArray(b.rows) ? b.rows : [];
  const [paste, setPaste] = useState('');
  const setCell = (i: number, k: number, v: string) => set({ ...b, rows: rows.map((r, j) => (j === i ? head.map((_, c) => (c === k ? v : r[c] ?? '')) : r)) });
  const addCol = () => head.length < 8 && set({ ...b, head: [...head, ''], rows: rows.map((r) => [...r, '']) });
  const delCol = (k: number) => head.length > 1 && set({ ...b, head: head.filter((_, c) => c !== k), rows: rows.map((r) => r.filter((_, c) => c !== k)) });
  const fromPaste = () => {
    const lines = paste.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t').map((x) => x.trim().slice(0, 200)));
    if (lines.length < 2) return;
    const w = Math.min(8, Math.max(...lines.map((l) => l.length)));
    const fit = (l: string[]) => Array.from({ length: w }, (_, c) => l[c] ?? '');
    set({ ...b, head: fit(lines[0]!), rows: lines.slice(1, 51).map(fit) }); setPaste('');
  };
  return (
    <div style={{ gridColumn: '1 / -1' }} data-gwan-page-table>
      <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr>
        {head.map((h, k) => <th key={k}><input value={h} maxLength={200} aria-label={`머리 ${k + 1}칸`} onChange={(e) => set({ ...b, head: head.map((x, c) => (c === k ? e.target.value : x)) })} style={{ minWidth: 90 }} />
          {head.length > 1 && <button className="btn-sm btn-plain" onClick={() => delCol(k)} aria-label={`${k + 1}칸 빼기`}>×</button>}</th>)}
        <th>{head.length < 8 && <button className="btn-sm" onClick={addCol}>+ 칸</button>}</th></tr></thead>
        <tbody>{rows.map((r, i) => (<tr key={i}>
          {head.map((_, k) => <td key={k}><input value={r[k] ?? ''} maxLength={200} aria-label={`${i + 1}줄 ${k + 1}칸`} onChange={(e) => setCell(i, k, e.target.value)} style={{ minWidth: 90 }} /></td>)}
          <td>{rows.length > 1 && <button className="btn-sm btn-plain" onClick={() => set({ ...b, rows: rows.filter((_, j) => j !== i) })} aria-label={`${i + 1}줄 빼기`}>×</button>}</td></tr>))}</tbody>
      </table></div>
      <div className="acts">{rows.length < 50 && <button className="btn-sm" onClick={() => set({ ...b, rows: [...rows, head.map(() => '')] })}>+ 줄</button>}</div>
      <label><span>엑셀 · 한글 표 붙여 넣기(첫 줄 = 머리 칸 · 지금 표를 바꿈)</span>
        <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="표를 복사해 여기에 붙여 넣고 「표로 바꾸기」" data-gwan-page-table-paste /></label>
      <button className="btn-sm" disabled={!paste.trim()} onClick={fromPaste}>표로 바꾸기</button>
    </div>
  );
}

/* v10.687 (docs/800) 고객센터 FAQ 불러오기 — 운영 화면 FAQ(보이는 것) 중 골라 이 블록 질문 끝에 넣음(질문 200 · 답 2,000자로 자름 · 20개까지) · 관 표시가 있으면 함께 보임 */
type FaqRow = { id: string; question: string; answer: string; gwanCode: string | null; isActive: boolean };
function FaqImport({ have, onAdd }: { have: number; onAdd: (items: Array<{ q: string; a: string }>) => void }) {
  const [rows, setRows] = useState<FaqRow[] | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const load = () => { void api<FaqRow[] | { rows?: FaqRow[]; items?: FaqRow[] }>('/admin/faqs').then((r) => setRows((Array.isArray(r) ? r : (r.rows ?? r.items ?? [])).filter((x) => x.isActive))).catch(() => setRows([])); };
  const list = (rows ?? []).filter((x) => !q.trim() || x.question.includes(q.trim()) || (x.gwanCode ?? '').includes(q.trim().toUpperCase()));
  return (
    <details data-gwan-page-faq-import onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !rows) load(); }} style={{ gridColumn: '1 / -1' }}>
      <summary>고객센터 FAQ 불러오기</summary>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="질문 · 관 코드로 찾기" aria-label="FAQ 찾기" />
      <div style={{ maxHeight: 220, overflow: 'auto' }}>{list.slice(0, 100).map((x) => (
        <label key={x.id} style={{ display: 'block' }}><input type="checkbox" checked={pick.includes(x.id)} onChange={(e) => setPick(e.target.checked ? [...pick, x.id] : pick.filter((y) => y !== x.id))} /> {x.gwanCode && <span className="mono dim">[{x.gwanCode}] </span>}{x.question}</label>))}</div>
      <button className="btn-sm" disabled={!pick.length || have + pick.length > 20} onClick={() => { onAdd((rows ?? []).filter((x) => pick.includes(x.id)).map((x) => ({ q: x.question.slice(0, 200), a: x.answer.slice(0, 2000) }))); setPick([]); }}>
        고른 {pick.length}개 넣기{have + pick.length > 20 ? ' (20개 넘음)' : ''}</button>
    </details>
  );
}

/* v10.715 (docs/823) 블록 기간 보이기 — 모든 블록 아래 「보이는 기간」(한국 날짜 · 끝 날 포함 · 비우면 늘) */
function BlockForm({ b, set }: { b: Block; set: (b: Block) => void }) {
  return (<>
    <BlockFormBody b={b} set={set} />
    <div className="form-grid" data-block-period>
      <label><span>보이기 시작(선택)</span><input type="date" value={b.from ?? ''} onChange={(e) => { const n = { ...b }; if (e.target.value) n.from = e.target.value; else delete n.from; set(n); }} /></label>
      <label><span>보이기 끝(선택 · 그날까지)</span><input type="date" value={b.until ?? ''} onChange={(e) => { const n = { ...b }; if (e.target.value) n.until = e.target.value; else delete n.until; set(n); }} /></label>
    </div>
  </>);
}
function BlockFormBody({ b, set }: { b: Block; set: (b: Block) => void }) {
  const p = (k: string) => (s: string) => set({ ...b, [k]: s });
  const items: Block[] = Array.isArray(b.items) ? b.items : [];
  const setItem = (i: number, k: string, s: string) => set({ ...b, items: items.map((x, j) => (j === i ? { ...x, [k]: s } : x)) });
  switch (b.type) {
    case 'FEEDBACK': return (<div className="form-grid"><F label="질문(80자)" v={b.title} on={p('title')} max={80} />
      <p className="dim">사용자 웹에 「도움이 됐어요 · 아쉬워요」 단추와 한 줄 의견 칸이 나옵니다 — 모은 의견은 관 관리 › 페이지 목록 › 손님 한 줄 의견.</p></div>);
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
    case 'TABLE': return (<div className="form-grid">
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} /><F label="표 아래 글(선택)" v={b.caption} on={p('caption')} max={200} />
      <TableForm b={b} set={set} /></div>);
    case 'VIDEO': return (<div className="form-grid">   {/* v10.664 */}
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} />
      <F label="유튜브 주소(youtube.com/watch?v= · youtu.be/ · shorts/)" v={b.url} on={p('url')} max={300} />
      <F label="동영상 아래 글(선택)" v={b.caption} on={p('caption')} max={200} /></div>);
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
        {items.length > 1 && <button className="btn-sm btn-plain" onClick={() => set({ ...b, items: items.slice(0, -1) })}>마지막 빼기</button>}</div>
      <FaqImport have={items.filter((x) => x.q || x.a).length} onAdd={(add) => set({ ...b, items: [...items.filter((x) => x.q || x.a), ...add].slice(0, 20) })} /></div>);
    case 'INQUIRY': return (<div className="form-grid">   {/* v10.681 (D318) 문의 받기 — 고객센터 1:1 문의로 · 관 · 페이지 출처가 붙고 관 첫째 담당자가 처음 담당 */}
      <F label="제목(선택)" v={b.title} on={p('title')} max={80} /><F label="안내 글(선택 · 300자)" v={b.body} on={p('body')} max={300} area />
      <F label="단추 글자(20자)" v={b.label} on={p('label')} max={20} />
      <label><span>문의 유형</span><select value={b.category ?? 'HOWTO'} onChange={(e) => set({ ...b, category: e.target.value })}>
        <option value="HOWTO">이용 방법</option><option value="LISTING">등록 · 검수</option><option value="FEE">소개비 · 정산</option><option value="BILLING">구독 · 결제</option><option value="REPORT">신고</option><option value="ETC">기타</option></select></label></div>);
    case 'FRAGMENT': return <p data-gwan-fragment-ref={b.fragmentId}>공통 조각 <b>「{b.name || `${b.fragmentId}번`}」</b> <span className="dim">— 게시할 때 그때의 조각 내용으로 펼쳐짐 · 내용은 페이지 목록 아래 「공통 조각」에서 고침</span></p>;   // v10.674
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
          {b.type === 'TABLE' && <p>[표 {(b.head ?? []).length}칸 × {(b.rows ?? []).length}줄 — {(b.head ?? []).join(' · ')}]</p>}
          {b.type === 'VIDEO' && <p>[동영상] {b.url}</p>}
          {b.type === 'FRAGMENT' && <p>[공통 조각] {b.name}</p>}
          {b.type === 'INQUIRY' && <p>[{b.label || '문의하기'}] → 고객센터 1:1 문의</p>}
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

/* v10.691 · 692 (D320 · docs/801) 공개 범위 · 검색엔진 설정 — 바로 반영(게시와 상관없음) */
function PageMeta({ p, onSaved }: { p: PageDetail; onSaved: (d: PageDetail) => void }) {
  const [vis, setVis] = useState(p.visibility ?? 'ALL');
  const [desc, setDesc] = useState(p.seoDescription ?? '');
  const [img, setImg] = useState(p.seoImage ?? '');
  const [ni, setNi] = useState(!!p.noindex);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="card pad" data-gwan-page-meta>
      <summary><b>공개 범위 · 검색엔진</b> <span className="dim">— {vis === 'MEMBER' ? '회원만' : '누구나'}{ni ? ' · 검색엔진에 안 나옴' : ''} · 바로 반영</span></summary>
      {msg && <p className="form-ok">{msg}</p>}{err && <p className="form-error">{err}</p>}
      <div className="form-grid">
        <label><span>공개 범위</span><select value={vis} disabled={p.slug === 'home'} onChange={(e) => setVis(e.target.value)} data-gwan-page-visibility>
          <option value="ALL">누구나</option><option value="MEMBER">로그인한 회원만</option></select></label>
        <label><span>검색엔진에 안 나오게</span><input type="checkbox" checked={ni} onChange={(e) => setNi(e.target.checked)} data-gwan-page-noindex /></label>
        <F label="검색엔진 · 공유 설명(160자 · 비우면 블록에서 자동)" v={desc} on={setDesc} max={160} area />
        <ImageField label="검색엔진 · 공유 그림(비우면 블록에서 자동)" v={img} on={setImg} />
      </div>
      {p.slug === 'home' && <p className="dim">첫 화면은 누구나 보게만 둘 수 있습니다.</p>}
      <div className="acts"><button className="btn-sm btn-ok" data-gwan-page-meta-save onClick={() => { setErr(null); setMsg(null);
        void api<PageDetail>(`/admin/gwan-pages/${p.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: vis, seoDescription: desc.trim(), seoImage: img.trim(), noindex: ni }) })
          .then((d) => { onSaved(d); setMsg('저장했습니다 — 바로 반영됩니다(게시와 상관없음).'); }).catch((e) => setErr(msgOf(e))); }}>저장</button></div>
    </details>
  );
}

/* v10.661 (D315) 예약 게시 — SUPER · 지금 저장된 초안을 떠 둠(예약 뒤 고친 초안은 다시 예약해야 반영) */
function Schedule({ p, isSuper, busy, dirty, run }: { p: PageDetail; isSuper: boolean; busy: boolean; dirty: boolean; run: (k: string, fn: () => Promise<PageDetail>, ok: string) => Promise<void> }) {
  const [at, setAt] = useState('');
  const when = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  return (
    <div className="card pad" data-gwan-page-schedule>
      <b>예약 게시</b>{' '}
      {p.scheduledAt ? <span data-gwan-page-scheduled>— <b>{when(p.scheduledAt)}</b>에 게시 예정{p.scheduledByName ? ` · ${p.scheduledByName}` : ''} <span className="dim">(예약할 때 저장돼 있던 초안)</span></span>
        : <span className="dim">— 정한 시각에 지금 저장된 초안을 게시(5분 뒤 ~ 90일)</span>}
      {isSuper ? (
        <div className="acts">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="게시할 시각" />
          <button className="btn-sm" disabled={busy || !at} onClick={() => {
            if (dirty && !confirm('저장하지 않은 고침은 예약에 들어가지 않습니다. 계속하시겠습니까?')) return;
            void run('sch', () => api<PageDetail>(`/admin/gwan-pages/${p.id}/schedule`, { method: 'POST', body: JSON.stringify({ at: new Date(at).toISOString() }) }), '예약했습니다 — 그 시각에 지금 초안이 게시됩니다.');
          }}>예약</button>
          {p.scheduledAt && <button className="btn-sm btn-plain" disabled={busy} onClick={() => void run('unsch', () => api<PageDetail>(`/admin/gwan-pages/${p.id}/schedule`, { method: 'POST', body: JSON.stringify({ at: null }) }), '예약을 취소했습니다.')}>예약 취소</button>}
        </div>) : <p className="dim" style={{ margin: '4px 0 0' }}>예약은 최고 관리자(SUPER)가 합니다.</p>}
    </div>
  );
}

/* v10.666 (D315) 미리보기 링크 — 로그인 없이 지금 초안을 보는 주소(사용자 웹 /preview/page/…) · 끊기 */
function PreviewLinks({ p, reload }: { p: PageDetail; reload: () => void }) {
  const [hours, setHours] = useState(24);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const url = (t: string) => siteHref(`/preview/page/${t}`);
  const list = p.previews ?? [];
  return (
    <details className="card pad" data-gwan-page-previews>
      <summary><b>미리보기 링크</b> <span className="dim">— 게시 전 초안을 로그인 없이 보여 줌(저장된 초안 · 검색엔진에 안 나옴)</span>{list.length ? ` · 열린 링크 ${list.length}개` : ''}</summary>
      {err && <p className="form-error">{err}</p>}
      <div className="acts">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="열어 둘 시간"><option value={1}>1시간</option><option value={24}>24시간</option><option value={72}>72시간</option></select>
        <button className="btn-sm" disabled={list.length >= 5} data-gwan-page-preview-new onClick={() => { setErr(null); void api(`/admin/gwan-pages/${p.id}/previews`, { method: 'POST', body: JSON.stringify({ hours }) }).then(reload).catch((e) => setErr(msgOf(e))); }}>링크 만들기</button>
      </div>
      {list.length > 0 && <table className="tbl"><thead><tr><th>주소</th><th>끝나는 때</th><th>누가</th><th></th></tr></thead><tbody>
        {list.map((x) => (<tr key={x.token}><td className="mono" style={{ wordBreak: 'break-all' }}>{url(x.token)}</td><td>{new Date(x.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{x.createdByName ?? '—'}</td>
          <td><button className="btn-sm" onClick={() => { void navigator.clipboard?.writeText(url(x.token)).then(() => setCopied(x.token)); }}>{copied === x.token ? '복사됨' : '복사'}</button>{' '}
            <button className="btn-sm btn-no" onClick={() => { void api(`/admin/gwan-pages/${p.id}/previews/${x.token}`, { method: 'DELETE' }).then(reload).catch((e) => setErr(msgOf(e))); }}>끊기</button></td></tr>))}
      </tbody></table>}
    </details>
  );
}

/* v10.684 (D318 · docs/799) 초안 고친 기록 — 저장마다 누가 · 언제 · 블록 수 · 바뀐 블록 수 */
function DraftLog({ id, tick }: { id: number; tick: number }) {
  const [rows, setRows] = useState<Array<{ at: string; byName: string | null; blocks: number; changed: number; titleChanged: boolean }> | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) void api<NonNullable<typeof rows>>(`/admin/gwan-pages/${id}/draft-log`).then(setRows).catch(() => setRows([])); }, [open, id, tick]);
  return (
    <details className="card pad" data-gwan-page-draftlog onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><b>초안 고친 기록</b> <span className="dim">— 저장마다 누가 · 언제 · 바뀐 블록 수(최근 50)</span></summary>
      {rows && (rows.length === 0 ? <p className="muted">기록이 없습니다.</p> : <table className="tbl"><thead><tr><th>때</th><th>누가</th><th>블록</th><th>바뀐 블록</th><th>제목</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}><td>{new Date(r.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{r.byName ?? '—'}</td><td className="num-cell">{r.blocks}</td><td className="num-cell">{r.changed}</td><td>{r.titleChanged ? '바뀜' : ''}</td></tr>)}
      </tbody></table>)}
    </details>
  );
}

/* v10.667 (D315) 방문 수 — 날마다(서울) · 같은 기기 같은 날 한 번 */
function Views({ id }: { id: number }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<{ days: number; total: number; rows: Array<{ day: string; views: number }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = (n = days) => { setErr(null); api<NonNullable<typeof d>>(`/admin/gwan-pages/${id}/views?days=${n}`).then(setD).catch((e) => setErr(msgOf(e))); };
  const max = Math.max(1, ...(d?.rows ?? []).map((r) => r.views));
  return (
    <details className="card pad" data-gwan-page-views onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !d) load(); }}>
      <summary><b>방문 수</b>{d ? ` · 최근 ${d.days}일 ${d.total.toLocaleString()}번` : ''}</summary>
      <p><select value={days} onChange={(e) => { const n = Number(e.target.value); setDays(n); load(n); }} aria-label="기간"><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></p>
      {err && <p className="form-error">{err}</p>}
      {d && <table className="tbl"><tbody>{d.rows.slice().reverse().map((r) => (<tr key={r.day}><td className="mono" style={{ width: 110 }}>{r.day}</td>
        <td><span style={{ display: 'inline-block', height: 10, width: `${(r.views / max) * 100}%`, minWidth: r.views ? 2 : 0, background: 'var(--sgb-link, #156afd)', borderRadius: 3 }} /> {r.views}</td></tr>))}</tbody></table>}
    </details>
  );
}

/* v10.704 (docs/812) 페이지 목록에서도 그 자리에서 편집(GwanPageEditor) */
export function GwanPageEditor({ id, isSuper, onBack }: { id: number; isSuper: boolean; onBack: () => void }) { return <Editor id={id} isSuper={isSuper} onBack={onBack} />; }
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
  const [drag, setDrag] = useState<number | null>(null);   // v10.673 끌어 놓기
  const [over, setOver] = useState<number | null>(null);
  const [frags, setFrags] = useState<FragRow[] | null>(null);   // v10.674 조각 넣기 목록
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
  /* v10.673 (docs/797) 끌어 놓기 — 블록 머리(⠿)를 끌어 다른 블록 위에 놓으면 그 자리로 · 키보드는 블록에서 Alt + ↑ · ↓ */
  const moveTo = (from: number, to: number) => { if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return; const n = [...blocks]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); change(n); };
  const found = checkPage(title, blocks, p.slug);   // v10.671
  const save = () => run('save', () => api<PageDetail>(`/admin/gwan-pages/${id}`, { method: 'PATCH', body: JSON.stringify({ title, showInMenu: menu, sortOrder: sort, blocks }) }), '초안을 저장했습니다 — 게시 전까지 사용자 웹은 그대로입니다.');
  return (
    <div data-gwan-page-editor={p.slug}>
      <p><button className="btn-sm btn-plain" onClick={() => { if (!dirty || confirm('저장하지 않은 고침이 있습니다. 그래도 나가시겠습니까?')) onBack(); }}>← 페이지 목록</button>{' '}
        {dirty && <b className="warn-text" data-gwan-page-dirty>저장 안 한 고침 있음 · </b>}
        <b>{p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`}</b>{p.lang && p.lang !== 'ko' ? <b> · {p.lang} 판</b> : null} · {STATUS[p.status] ?? p.status}{p.publishedVersion ? ` · 게시 ${p.publishedVersion}판` : ''}{p.draftChanged ? ' · 게시 안 된 초안 있음' : ''}</p>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      {/* v10.701 (D322 · docs/809) 수정 가능 스위치 — 수정 불가면 서버가 저장 · 게시를 막음(422 GWAN_PAGE_LOCKED) */}
      <p className={p.editable === false || p.gwanOpen ? 'warn-text' : 'dim'} data-gwan-page-editable={p.editable === false ? 'off' : 'on'}>
        {p.editable === false ? '수정 불가로 둔 페이지입니다 — 고치려면 최고 관리자(SUPER)가 「수정 가능」으로 바꿉니다.' : p.gwanOpen ? '수정 가능 · 관이 열려 있어 지금은 고칠 수 없습니다 — 관 관리 › 관 설정에서 관을 닫은(중지) 뒤 고치고, 다 고친 뒤 다시 여십시오.' : '수정 가능 · 관 닫힘(고칠 수 있음)'}
        {isSuper && <> <button className="btn-sm" disabled={!!busy} data-gwan-page-editable-toggle onClick={() => void run('ed', () => api<PageDetail>(`/admin/gwan-pages/${id}/editable`, { method: 'POST', body: JSON.stringify({ editable: p.editable === false }) }), p.editable === false ? '수정 가능으로 바꿨습니다.' : '수정 불가로 바꿨습니다.')}>{p.editable === false ? '수정 가능으로' : '수정 불가로'}</button></>}</p>
      <div className="card pad"><div className="form-grid">
        <F label="페이지 제목(60자)" v={title} on={setTitle} max={60} />
        {p.slug !== 'home' && <label><span>관 메뉴에 보임</span><input type="checkbox" checked={menu} onChange={(e) => setMenu(e.target.checked)} /></label>}
        {p.slug !== 'home' && <label><span>메뉴 순서</span><input type="number" min={0} max={999} value={sort} onChange={(e) => setSort(Number(e.target.value))} /></label>}
      </div></div>
      <PageTools p={p} title={title} blocks={blocks} apply={apply} />
      {blocks.map((b, i) => (
        <div key={i} className="card pad" data-gwan-page-block={b.type}
             onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver((o) => (o === i ? null : o))}
             onDrop={(e) => { e.preventDefault(); if (drag !== null) moveTo(drag, i); setDrag(null); setOver(null); }}
             onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.target as HTMLElement).dataset.dragHandle !== undefined) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); } }}
             style={over === i && drag !== null && drag !== i ? { outline: '2px dashed var(--sgb-link, #156afd)', outlineOffset: 2 } : drag === i ? { opacity: 0.5 } : undefined}>
          <p style={{ marginTop: 0 }}><span draggable data-drag-handle="" tabIndex={0} role="button" aria-label={`${i + 1}번 블록 옮기기(끌기 또는 Alt + 위 · 아래)`} title="끌어서 옮기기 · Alt + ↑ ↓"
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                style={{ cursor: 'grab', padding: '0 6px', userSelect: 'none' }} data-gwan-page-drag>⠿</span>
            <b>{i + 1}. {KIND[b.type] ?? b.type}</b>{' '}
            <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>{' '}
            <button className="btn-sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>{' '}
            <button className="btn-sm" disabled={blocks.length >= 30} onClick={() => change([...blocks.slice(0, i + 1), JSON.parse(JSON.stringify(b)), ...blocks.slice(i + 1)])} data-gwan-page-dup>복제</button>{' '}
            <button className="btn-sm btn-no" onClick={() => change(blocks.filter((_, j) => j !== i))}>빼기</button>{' '}
            {b.type !== 'FRAGMENT' && <button className="btn-sm btn-plain" data-gwan-page-to-fragment onClick={() => {   /* v10.674 이 블록을 공통 조각으로 */
              const nm = prompt('공통 조각 이름(40자) — 이 블록을 조각으로 저장하고 이 자리는 조각 블록으로 바꿉니다');
              if (!nm?.trim()) return;
              void api<{ id: number; name: string }>('/admin/gwan-fragments', { method: 'POST', body: JSON.stringify({ name: nm.trim().slice(0, 40), blocks: [b] }) })
                .then((f) => { change(blocks.map((x, j) => (j === i ? { type: 'FRAGMENT', fragmentId: f.id, name: f.name } : x))); setFrags(null); setMsg(`「${f.name}」 조각을 만들었습니다 — 「초안 저장」을 눌러야 이 페이지에 저장됩니다.`); })
                .catch((e) => setErr(msgOf(e)));
            }}>조각으로</button>}</p>
          <BlockForm b={b} set={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb : x)))} />
          <AddPhotos onAdd={(pics) => change([...blocks.slice(0, i + 1), ...pics.map((x) => ({ type: 'IMAGE', src: x.src, alt: x.alt, caption: '' })), ...blocks.slice(i + 1)].slice(0, 30))} />
        </div>
      ))}
      {blocks.length === 0 && <AddPhotos onAdd={(pics) => change(pics.map((x) => ({ type: 'IMAGE', src: x.src, alt: x.alt, caption: '' })).slice(0, 30))} />}
      {blocks.length === 0 && (   /* v10.665 틀로 시작 */
        <div className="card pad" data-gwan-page-templates><b>틀로 시작</b> <span className="dim">— 블록이 예시 글로 채워집니다(고쳐서 저장)</span>
          <div className="acts">{TEMPLATES.map((t) => <button key={t.key} className="btn-sm" data-gwan-page-template={t.key} onClick={() => apply('', JSON.parse(JSON.stringify(t.blocks)), 'replace', `「${t.label.split('(')[0]}」 틀을 넣었습니다`)}>{t.label}</button>)}</div>
        </div>)}
      <div className="acts">
        <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="더할 블록">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn-sm" disabled={blocks.length >= 30} onClick={() => change([...blocks, blank(add)])} data-gwan-page-add>블록 더하기</button>
        {/* v10.674 조각 넣기 */}
        <select value="" aria-label="조각 넣기" data-gwan-page-fragment-add onFocus={() => { if (!frags) void api<FragRow[]>('/admin/gwan-fragments').then(setFrags).catch(() => setFrags([])); }}
                onChange={(e) => { const f = (frags ?? []).find((x) => String(x.id) === e.target.value); if (f && blocks.length < 30) change([...blocks, { type: 'FRAGMENT', fragmentId: f.id, name: f.name }]); }}>
          <option value="">조각 넣기…</option>{(frags ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}(블록 {f.blocks})</option>)}</select>
        <button className="btn-sm" disabled={!hist.length} onClick={undo} data-gwan-page-undo>실행 취소{hist.length ? `(${hist.length})` : ''}</button>
      </div>
      <div className="acts">
        <button className="btn-ok" disabled={!!busy || p.editable === false || !!p.gwanOpen} onClick={() => void save()} data-gwan-page-save>초안 저장</button>
        {isSuper && <button className="btn-ok" disabled={!!busy || p.editable === false || !!p.gwanOpen} data-gwan-page-publish onClick={() => {
          const warn = found.filter((x) => x.level === 'warn').length;   // v10.671
          if (!confirm(`지금 저장된 초안을 사용자 웹에 게시합니다.\n(저장하지 않은 고침은 먼저 「초안 저장」을 누르십시오)${warn ? `\n\n페이지 점검: 고칠 것 ${warn}개가 남아 있습니다.` : ''}`)) return;
          void run('pub', () => api<PageDetail>(`/admin/gwan-pages/${id}/publish`, { method: 'POST' }), '게시했습니다 — 사용자 웹에 바로 보입니다.');
        }}>게시</button>}
        {isSuper && p.status !== 'DRAFT' && <button className="btn-sm" disabled={!!busy} onClick={() => void run('hide', () => api<PageDetail>(`/admin/gwan-pages/${id}/hide`, { method: 'POST', body: JSON.stringify({ hidden: p.status !== 'HIDDEN' }) }), p.status === 'HIDDEN' ? '다시 보이게 했습니다.' : '숨겼습니다.')}>{p.status === 'HIDDEN' ? '다시 보이기' : '숨기기'}</button>}
        {!isSuper && <><button className="btn-ok" disabled={!!busy || dirty || !p.draftChanged} data-gwan-page-request onClick={() => {   /* v10.711 (D324 · docs/819) 게시 요청 */
          const note = prompt('최고 관리자(SUPER)에게 게시를 요청합니다. 한 줄 메모(비워도 됨):');
          if (note === null) return;
          setErr(null); setMsg(null);
          void api('/admin/publish-requests', { method: 'POST', body: JSON.stringify({ kind: 'PAGE', ref: String(id), note: note.trim() || undefined }) }).then(() => setMsg('게시를 요청했습니다 — 최고 관리자가 승인하면 사용자 웹에 나갑니다.')).catch((e) => setErr(msgOf(e)));
        }}>게시 요청</button> <span className="dim">게시는 최고 관리자(SUPER)가 합니다.</span></>}
        {p.lang && p.lang !== 'ko' && <button className="btn-sm" disabled={!!busy} data-gwan-page-ai onClick={() => {   /* v10.662 번역 초안 채우기 */
          if (dirty && !confirm('저장하지 않은 고침이 있습니다. 번역 초안이 이 판 초안을 덮어씁니다. 계속하시겠습니까?')) return;
          if (!confirm(`한국어판 초안을 AI 로 ${p.lang} 로 옮겨 이 판 초안을 덮어씁니다(AI 비용 · 월 상한).\n게시 전 꼭 읽어 보십시오.`)) return;
          void run('ai', () => api<PageDetail>(`/admin/gwan-pages/${id}/translate`, { method: 'POST' }), '번역 초안을 채웠습니다 — 읽어 보고 고친 뒤 게시하십시오.');
        }}>번역 초안 채우기(AI)</button>}
      </div>
      <PageCheck f={found} />
      <PageMeta key={`${p.id}-${p.draftUpdatedAt}`} p={p} onSaved={(d) => setP(d)} />
      <Schedule p={p} isSuper={isSuper} busy={!!busy} dirty={dirty} run={run} />
      <PreviewLinks p={p} reload={() => void api<PageDetail>(`/admin/gwan-pages/${id}`).then((d) => setP(d))} />
      <Views id={id} />
      <DraftLog id={id} tick={p.draftUpdatedAt ? new Date(p.draftUpdatedAt).getTime() : 0} />
      <p><label><input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} data-gwan-page-mobile /> 휴대폰 폭(375px)으로 미리보기</label></p>
      <div style={mobile ? { maxWidth: 375, border: '8px solid #222', borderRadius: 18, margin: '0 auto', overflow: 'auto', maxHeight: 700 } : undefined}><Preview title={title} blocks={blocks} /></div>
      {p.versions.length > 0 && (
        <div className="card pad"><h3 style={{ marginTop: 0 }}>게시 판 기록</h3>
          <table className="tbl"><thead><tr><th>판</th><th>제목</th><th>게시</th><th>누가</th><th></th></tr></thead><tbody>
            {p.versions.map((v) => (<tr key={v.version}><td>{v.version}</td><td>{v.title}</td><td>{v.publishedAt?.slice(0, 16).replace('T', ' ')}</td><td>{v.publishedByName ?? '—'}</td>
              <td><button className="btn-sm" disabled={!!busy} onClick={() => void run('rs', () => api<PageDetail>(`/admin/gwan-pages/${id}/restore`, { method: 'POST', body: JSON.stringify({ version: v.version }) }), `${v.version}판으로 초안을 만들었습니다 — 게시는 따로.`)}>이 판으로 초안</button>
                {isSuper && v.version !== p.publishedVersion && <> <button className="btn-sm btn-no" disabled={!!busy} data-gwan-page-rollback={v.version} onClick={() => {   /* v10.679 바로 되돌리기 */
                  const why = prompt(`${v.version}판을 바로 다시 게시합니다(사용자 웹에 곧바로 · 초안은 그대로).\n되돌리는 사유(2자 이상):`);
                  if (!why || why.trim().length < 2) return;
                  void run('rb', () => api<PageDetail>(`/admin/gwan-pages/${id}/rollback`, { method: 'POST', body: JSON.stringify({ version: v.version, reason: why.trim() }) }), `${v.version}판으로 되돌려 게시했습니다 — 초안은 그대로입니다.`);
                }}>이 판으로 바로 되돌리기</button></>}</td></tr>))}
          </tbody></table></div>
      )}
    </div>
  );
}

/* v10.674 (D316 · docs/797) 공통 조각 — 여러 페이지에 넣는 블록 묶음 · 고치면 쓰는 페이지 목록(게시는 페이지마다 다시) */
interface FragRow { id: number; name: string; blocks: number; updatedAt: string; updatedByName: string | null; usedBy: number }
interface FragDetail { id: number; name: string; blocks: Block[]; usedBy: Array<{ id: number; gwanCode: string; gwanName: string; slug: string; lang: string; title: string; status: string; published: boolean }> }
function Fragments({ onOpenPage, isSuper }: { onOpenPage: (id: number) => void; isSuper: boolean }) {
  const [rows, setRows] = useState<FragRow[] | null>(null);
  const [cur, setCur] = useState<FragDetail | null>(null);
  const [name, setName] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [add, setAdd] = useState('BUTTONS');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { api<FragRow[]>('/admin/gwan-fragments').then(setRows).catch((e) => setErr(msgOf(e))); };
  const open = (id: number) => { setMsg(null); setErr(null); api<FragDetail>(`/admin/gwan-fragments/${id}`).then((d) => { setCur(d); setName(d.name); setBlocks(d.blocks ?? []); }).catch((e) => setErr(msgOf(e))); };
  const save = () => { setErr(null); api<FragDetail>(cur ? `/admin/gwan-fragments/${cur.id}` : '/admin/gwan-fragments', { method: cur ? 'PATCH' : 'POST', body: JSON.stringify({ name: name.trim(), blocks }) })
    .then((d) => { setCur(d); setBlocks(d.blocks ?? []); setMsg(cur ? `저장했습니다${d.usedBy.length ? ` — 쓰는 페이지 ${d.usedBy.length}개는 다시 게시해야 화면에 반영됩니다` : ''}.` : '조각을 만들었습니다 — 페이지 편집의 「조각 넣기」에서 고릅니다.'); load(); }).catch((e) => setErr(msgOf(e))); };
  return (
    <details className="card pad" data-gwan-fragments onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !rows) load(); }}>
      <summary><b>공통 조각</b> <span className="dim">— 여러 페이지에 넣는 블록 묶음(문의 단추 · 안내 띠 등) · 블록 10개까지</span>{rows ? ` · ${rows.length}개` : ''}</summary>
      {msg && <p className="form-ok">{msg}</p>}{err && <p className="form-error">{err}</p>}
      {rows && <table className="tbl"><thead><tr><th>이름</th><th>블록</th><th>쓰는 페이지</th><th>고친 때</th><th></th></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={5} className="muted">아직 조각이 없습니다.</td></tr>}
        {rows.map((r) => (<tr key={r.id}><td>{r.name}</td><td>{r.blocks}</td><td>{r.usedBy}</td><td>{r.updatedAt?.slice(0, 16).replace('T', ' ')} {r.updatedByName ?? ''}</td>
          <td><button className="btn-sm" onClick={() => open(r.id)}>고치기</button>{' '}
            {r.usedBy === 0 && <button className="btn-sm btn-no" onClick={() => { if (confirm(`「${r.name}」 조각을 지웁니다.`)) void api(`/admin/gwan-fragments/${r.id}`, { method: 'DELETE' }).then(() => { if (cur?.id === r.id) setCur(null); load(); }).catch((e) => setErr(msgOf(e))); }}>지우기</button>}</td></tr>))}
      </tbody></table>}
      <div className="card pad" data-gwan-fragment-edit>
        <h4 style={{ marginTop: 0 }}>{cur ? `조각 고치기 — ${cur.name}` : '새 조각'} {cur && <button className="btn-sm btn-plain" onClick={() => { setCur(null); setName(''); setBlocks([]); }}>새 조각으로</button>}</h4>
        <F label="조각 이름(40자)" v={name} on={setName} max={40} />
        {blocks.map((b, i) => (<div key={i} className="card pad"><p style={{ marginTop: 0 }}><b>{i + 1}. {KIND[b.type] ?? b.type}</b>{' '}
          <button className="btn-sm btn-no" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>빼기</button></p>
          <BlockForm b={b} set={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb : x)))} /></div>))}
        <div className="acts">
          <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="조각에 더할 블록">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn-sm" disabled={blocks.length >= 10} onClick={() => setBlocks([...blocks, blank(add)])}>블록 더하기</button>
          <button className="btn-ok" disabled={!name.trim()} onClick={save} data-gwan-fragment-save>{cur ? '저장' : '만들기'}</button>
        </div>
        {cur && cur.usedBy.length > 0 && (<>
          <p><b>쓰는 페이지 {cur.usedBy.length}개</b> <span className="dim">— 조각을 고친 뒤 각 페이지를 다시 게시(SUPER)해야 사용자 웹에 반영</span>
            {isSuper && <> <button className="btn-sm btn-ok" data-gwan-fragment-republish onClick={() => {   /* v10.675 한꺼번에 다시 게시 */
              if (!confirm('이 조각을 쓰는 게시된 페이지를 모두 지금 조각 내용으로 다시 게시합니다.\n초안에 다른 고침이 있는 페이지는 건너뜁니다(그 페이지는 직접 확인 뒤 게시).')) return;
              setErr(null);
              void api<{ published: number; skipped: number; items: Array<{ id: number; result: string }> }>(`/admin/gwan-fragments/${cur.id}/republish`, { method: 'POST', body: JSON.stringify({}) })
                .then((r) => { const why: Record<string, string> = { NOT_PUBLISHED: '게시 안 됨', DRAFT_CHANGED: '초안에 다른 고침' };
                  setMsg(`다시 게시 ${r.published}개${r.skipped ? ` · 건너뜀 ${r.skipped}개(${r.items.filter((x) => x.result !== 'PUBLISHED').map((x) => `${cur.usedBy.find((u) => u.id === x.id)?.title ?? x.id}: ${why[x.result] ?? x.result}`).join(' · ')})` : ''}.`); open(cur.id); })
                .catch((e) => setErr(msgOf(e)));
            }}>쓰는 페이지 한꺼번에 다시 게시</button></>}</p>
          <table className="tbl"><tbody>{cur.usedBy.map((u) => (<tr key={u.id}><td>{u.gwanName}({u.gwanCode})</td><td className="mono">{u.slug === 'home' ? '첫 화면' : `/info/${u.slug}`}{u.lang !== 'ko' ? ` · ${u.lang}` : ''}</td><td>{u.title}</td>
            <td>{STATUS[u.status] ?? u.status}{u.published ? '' : <span className="dim"> · 게시 판엔 아직 없음</span>}</td><td><button className="btn-sm" onClick={() => onOpenPage(u.id)}>페이지 열기</button></td></tr>))}</tbody></table>
        </>)}
      </div>
    </details>
  );
}

/* v10.659 (docs/794) 안 쓰는 페이지 그림 — 올린 지 30일 지났고 어느 초안 · 게시 판에도 없는 그림 · 정리는 SUPER(서버가 다시 확인) */
function UnusedImages({ isSuper }: { isSuper: boolean }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<{ days: number; count: number; bytes: number; items: Array<{ id: string; name: string; size: number; createdAt: string; ownerName: string | null }> } | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { setErr(null); api<NonNullable<typeof d>>(`/admin/gwan-pages/images/unused?days=${days}`).then((r) => { setD(r); setPick([]); }).catch((e) => setErr(msgOf(e))); };
  return (
    <details className="card pad" data-gwan-page-unused onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !d) load(); }}>
      <summary><b>안 쓰는 그림</b> <span className="dim">— 편집 중 올렸다가 뺀 그림(어느 초안 · 게시 판에도 없음)</span>{d ? ` · ${d.count}장 · ${(d.bytes / 1048576).toFixed(1)}MB` : ''}</summary>
      <p><label>올린 지 <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 70 }} /> 일 지난 것</label>{' '}<button className="btn-sm" onClick={load}>다시 보기</button></p>
      {msg && <p className="form-ok">{msg}</p>}{err && <p className="form-error">{err}</p>}
      {d && (d.items.length === 0 ? <p className="muted">정리할 그림이 없습니다.</p> : (<>
        <table className="tbl"><thead><tr><th>{isSuper && <input type="checkbox" aria-label="모두 고르기" checked={pick.length === d.items.length} onChange={(e) => setPick(e.target.checked ? d.items.map((x) => x.id) : [])} />}</th><th>그림</th><th>이름</th><th>크기</th><th>올린 때 · 누가</th></tr></thead>
          <tbody>{d.items.map((x) => (<tr key={x.id}>
            <td>{isSuper && <input type="checkbox" aria-label={`${x.name} 고르기`} checked={pick.includes(x.id)} onChange={(e) => setPick(e.target.checked ? [...pick, x.id] : pick.filter((y) => y !== x.id))} />}</td>
            <td><img src={PAGE_IMG(x.id)} alt="" loading="lazy" style={{ maxHeight: 40 }} /></td><td>{x.name}</td><td>{(Number(x.size) / 1024).toFixed(0)}KB</td><td>{x.createdAt?.slice(0, 10)} {x.ownerName ?? ''}</td></tr>))}</tbody></table>
        {isSuper ? <button className="btn-no" disabled={!pick.length} data-gwan-page-purge onClick={() => {
          if (!confirm(`고른 그림 ${pick.length}장을 지웁니다. 되돌릴 수 없습니다.\n(지금 다시 쓰이고 있는 그림은 서버가 건너뜁니다)`)) return;
          void api<{ removed: number; skipped: number }>('/admin/gwan-pages/images/purge', { method: 'POST', body: JSON.stringify({ ids: pick, days }) })
            .then((r) => { setMsg(`${r.removed}장 지웠습니다${r.skipped ? ` · ${r.skipped}장은 쓰이고 있어 건너뜀` : ''}.`); load(); }).catch((e) => setErr(msgOf(e)));
        }}>고른 그림 지우기</button> : <p className="dim">정리는 최고 관리자(SUPER)가 합니다.</p>}
      </>))}
    </details>
  );
}

export function GwanPages({ isSuper, initialCode }: { isSuper: boolean; initialCode?: string }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [code, setCode] = useState(initialCode ?? '');   // v10.668 관 설정 길잡이에서 오면 그 관
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const gws = (manage.data ?? []).filter((g) => !g.isHub);
  /* v10.657 (D313 · docs/794) 언어판 — 사이트 언어 목록(한국어 빼고) · 한국어판 줄에서 「번역판 만들기」 */
  const langs = useApi<{ items: Array<{ code: string; name: string; isActive: boolean }> }>('/admin/i18n/langs');
  const others = (langs.data?.items ?? []).filter((l) => l.code !== 'ko');
  const [tl, setTl] = useState<Record<number, string>>({});
  useEffect(() => { if (!code && gws[0]) setCode(gws[0].code); }, [gws.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => { if (code) api<PageRow[]>(`/admin/gwans/${code}/pages`).then(setRows).catch((e) => setErr(msgOf(e))); };
  const [drag, setDrag] = useState<number | null>(null);   // v10.719 (docs/827) 관 메뉴 순서 끌어 놓기
  const reorder = (from: number, to: number) => {
    if (!rows || from === to) return;
    const ko = rows.filter((r) => (r.lang ?? 'ko') === 'ko' && r.slug !== 'home');
    const a = ko.findIndex((r) => r.id === from), b2 = ko.findIndex((r) => r.id === to);
    if (a < 0 || b2 < 0) return;
    const n = [...ko]; const [x] = n.splice(a, 1); n.splice(b2, 0, x!);
    setErr(null);
    void api<PageRow[]>(`/admin/gwans/${code}/pages/order`, { method: 'POST', body: JSON.stringify({ ids: n.map((r) => r.id) }) }).then(setRows).catch((e) => setErr(msgOf(e)));
  };
  useEffect(load, [code]);
  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (open) return <Editor id={open} isSuper={isSuper} onBack={() => { setOpen(null); load(); }} />;
  const hasHome = rows?.some((r) => r.slug === 'home');
  async function create(s: string, t: string, lang?: string) {
    setErr(null);
    try { const d = await api<PageDetail>(`/admin/gwans/${code}/pages`, { method: 'POST', body: JSON.stringify({ slug: s, title: t, ...(lang ? { lang } : {}) }) }); setSlug(''); setTitle(''); setOpen(d.id); }
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
          <thead><tr><th>페이지</th><th>주소</th><th>언어</th><th>상태</th><th>게시 판</th><th>7일 방문</th><th>초안 고친 때</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">아직 페이지가 없습니다.</td></tr>}
            {rows.map((r) => (<tr key={r.id} draggable={(r.lang ?? 'ko') === 'ko' && r.slug !== 'home'} data-gwan-page-row={r.slug}
                onDragStart={() => setDrag(r.id)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (drag !== null) reorder(drag, r.id); setDrag(null); }}
                style={drag === r.id ? { opacity: 0.5 } : undefined}>
              <td>{(r.lang ?? 'ko') === 'ko' && r.slug !== 'home' && <span title="끌어서 관 메뉴 순서 바꾸기" style={{ cursor: 'grab', paddingRight: 4 }} data-gwan-page-drag-row>⠿</span>}{r.title}{r.draftChanged && <span className="dim"> · 게시 안 된 초안</span>}</td>
              <td className="mono">{r.slug === 'home' ? '첫 화면' : `/info/${r.slug}`}{r.visibility === 'MEMBER' ? <span className="dim"> · 회원만</span> : null}{r.noindex ? <span className="dim"> · 검색 끔</span> : null}</td><td>{r.lang ?? 'ko'}</td><td>{STATUS[r.status] ?? r.status}{r.scheduledAt ? <span className="dim"> · 예약 {new Date(r.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> : null}</td>
              <td>{r.publishedVersion ?? '—'}</td><td className="num-cell">{r.views7 ?? 0}</td><td>{r.draftUpdatedAt?.slice(0, 16).replace('T', ' ')} {r.draftUpdatedByName ?? ''}</td>
              <td><button className="btn-sm" onClick={() => setOpen(r.id)} data-gwan-page-open={r.slug}>편집</button>
                {r.slug !== 'home' && <> <button className="btn-sm btn-plain" data-gwan-page-copy={r.slug} onClick={() => {   /* v10.742 (docs/850) 다른 관으로 복사 */
                  const to = prompt(`「${r.title}」을(를) 복사할 관 코드(영문 대문자 3 ~ 4자 · 받는 관이 닫혀 있어야 함):`, code); if (!to) return;
                  const sl = prompt('새 페이지 주소(영문 소문자 · 숫자 · - 2 ~ 40자):', r.slug); if (!sl) return;
                  setErr(null);
                  void api<PageDetail>(`/admin/gwan-pages/${r.id}/copy`, { method: 'POST', body: JSON.stringify({ gwanCode: to.trim().toUpperCase(), slug: sl.trim() }) }).then((d) => { if (to.trim().toUpperCase() === code) load(); setOpen(d.id); }).catch((e) => setErr(msgOf(e)));
                }}>복사</button></>}
                {(r.lang ?? 'ko') === 'ko' && others.length > 0 && <> <select value={tl[r.id] ?? ''} aria-label="번역판 언어" onChange={(e) => setTl({ ...tl, [r.id]: e.target.value })}>
                  <option value="">번역판…</option>
                  {others.filter((l) => !rows.some((x) => x.slug === r.slug && x.lang === l.code)).map((l) => <option key={l.code} value={l.code}>{l.name}{l.isActive ? '' : '(꺼짐)'}</option>)}</select>
                  <button className="btn-sm" disabled={!tl[r.id]} data-gwan-page-translate={r.slug} onClick={() => void create(r.slug, r.title, tl[r.id])}>번역판 만들기</button></>}</td></tr>))}
          </tbody>
        </table>
      )}
      <Fragments onOpenPage={(id) => setOpen(id)} isSuper={isSuper} />
      <UnusedImages isSuper={isSuper} />
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

/* v10.696 (D321 · docs/804) 꾸밀 페이지에서 쓰는 블록 목록 — 관 페이지와 같은 블록 칸(BlockForm) · 위아래 · 빼기 · 더하기(조각은 받지 않음) */
export function BlockList({ blocks, onChange, max = 10 }: { blocks: Block[]; onChange: (b: Block[]) => void; max?: number }) {
  const [add, setAdd] = useState('TEXT');
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j]!, n[i]!]; onChange(n); };
  return (
    <div data-block-list={blocks.length}>
      {blocks.map((b, i) => (
        <div key={i} className="card pad" data-block-list-item={b.type}>
          <p style={{ marginTop: 0 }}><b>{i + 1}. {KIND[b.type] ?? b.type}</b>{' '}
            <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>{' '}
            <button className="btn-sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>{' '}
            <button className="btn-sm btn-no" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>빼기</button></p>
          <BlockForm b={b} set={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} />
        </div>
      ))}
      <div className="acts">
        <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="더할 블록">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn-sm" disabled={blocks.length >= max} onClick={() => onChange([...blocks, blank(add)])} data-block-list-add>블록 더하기</button>
        <span className="dim">이 자리 {blocks.length} / {max}</span>
      </div>
    </div>
  );
}
