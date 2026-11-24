import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { siteHref } from '../../lib/siteUrl';
import { BlockList, GwanPageEditor, ImageField, SeoPreview, checkPage } from './gwans/GwanPages';

/* ---------------------------------------------------------------------
 * SB-ADM-PAGE-020 페이지 목록 · 꾸밀 페이지 — v10.696 ~ 700 (D321 · docs/804 ~ 808)
 *   대표 11/24 「수정 가능한 페이지: hero · 각 관 메인 · 소개몰(메인 및 구성) · 페이지 목록 관리」 → 구역 편집 · 한 화면에 모두
 *   지금 디자인은 그대로 — 구역 보이기 · 순서 · 글자 · 그림 · (소개몰) 고른 상품 · 구역 사이 블록(관 페이지 블록)
 *   초안 저장 ADMIN · SUPER / 게시 · 예약 · 되돌리기 SUPER(서버가 막음) · 게시 전에는 사용자 웹이 그대로
 * ------------------------------------------------------------------- */

type Block = Record<string, any>;
interface Spec { key: string; name: string; path: string; sections: Array<[string, string]>; texts: Array<[string, string, number]>;
  slides?: Array<[string, string]>; picks?: Array<[string, string, number]>; inserts: 'each' | 'edge' }
interface Slide { show: boolean; tag?: string; title?: string; desc?: string; cta?: string; href?: string; image?: string }
interface Layout { sections: Array<{ key: string; show: boolean }>; texts: Record<string, string>; slides?: Record<string, Slide>; picks?: Record<string, string[]>; inserts: Record<string, Block[]>;
  i18n?: Record<string, Record<string, string>>; i18nSig?: Record<string, string> }   // v10.708 언어별 글자 · v10.764 번역 지문
interface Row { key: string; name: string; path: string; status: string; publishedVersion: number | null; publishedAt: string | null; publishedByName: string | null;
  draftUpdatedAt: string | null; draftUpdatedByName: string | null; draftChanged: boolean; scheduledAt: string | null; scheduledByName: string | null;
  editable: boolean; gwanCode: string | null; gwanOpen: boolean; views7?: number; staleLangs?: string[] }   // v10.701 (D322) 수정 가능 · 관 열림 · v10.722 7일 방문 · v10.764 다시 번역 필요
interface Detail extends Omit<Row, 'name' | 'path' | 'status'> { spec: Spec; draft: Layout; published: Layout | null;
  versions: Array<{ version: number; how: string; reason: string | null; publishedAt: string; publishedByName: string | null }>;
  previews: Array<{ token: string; expiresAt: string; createdByName: string | null }>; lockReason: string | null; canPublish?: boolean }
interface PageRow { id: number; gwanCode: string; gwanName: string; slug: string; lang: string; title: string; status: string; publishedVersion: number | null;
  publishedAt: string | null; draftUpdatedAt: string; draftUpdatedByName: string | null; scheduledAt: string | null; visibility: string; views7: number;
  editable: boolean; gwanOpen: boolean }

/* v10.738 · 739 · 743 파일 내려받기 — 글을 파일로 저장(서버가 준 CSV · JSON 그대로) */
const saveText = (name: string, text: string, type = 'text/csv;charset=utf-8') => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
const when = (s: string | null | undefined) => (s ? s.slice(0, 16).replace('T', ' ') : '—');
const HOW: Record<string, string> = { PUBLISH: '게시', SCHEDULE: '예약 게시', ROLLBACK: '되돌림' };
const PSTATUS: Record<string, string> = { DRAFT: '초안', PUBLISHED: '게시됨', HIDDEN: '숨김' };

/* v10.703 (docs/811) 초안 ↔ 게시 판 차이 — 게시하면 무엇이 바뀌는지 줄마다(게시한 판이 없으면 처음 배치와 견줌) */
export function layoutDiff(sp: Spec, a: Layout, b: Layout): string[] {
  const nm = Object.fromEntries(sp.sections);
  const out: string[] = [];
  const ka = a.sections.map((s) => s.key).join(','), kb = b.sections.map((s) => s.key).join(',');
  if (ka !== kb) out.push(`구역 순서: ${b.sections.map((s) => nm[s.key]).join(' → ')}`);
  for (const s of b.sections) { const o = a.sections.find((x) => x.key === s.key); if (o && o.show !== s.show) out.push(`「${nm[s.key]}」 ${s.show ? '보이기' : '숨기기'}`); }
  for (const [tk, tn] of sp.texts) if ((a.texts[tk] ?? '') !== (b.texts[tk] ?? '')) out.push(`${tn}: 「${a.texts[tk] || '처음 글'}」 → 「${b.texts[tk] || '처음 글'}」`);
  for (const [sk, sn] of sp.slides ?? []) {
    const x = a.slides?.[sk] ?? { show: true }, y = b.slides?.[sk] ?? { show: true };
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`안내 장 「${sn}」 ${x.show !== y.show ? (y.show ? '보이기' : '숨기기') : '글 · 주소 · 그림 바뀜'}`);
  }
  for (const [pk, pn] of sp.picks ?? []) if (JSON.stringify(a.picks?.[pk] ?? []) !== JSON.stringify(b.picks?.[pk] ?? [])) out.push(`${pn}: ${(a.picks?.[pk] ?? []).length}개 → ${(b.picks?.[pk] ?? []).length}개`);
  const spots = new Set([...Object.keys(a.inserts), ...Object.keys(b.inserts)]);
  for (const at of spots) {
    const x = JSON.stringify(a.inserts[at] ?? []), y = JSON.stringify(b.inserts[at] ?? []);
    if (x !== y) out.push(`블록 자리 「${at === '_top' || at === 'top' ? '맨 위' : at === 'bottom' ? '맨 아래' : `${nm[at] ?? at} 뒤`}」: ${(a.inserts[at] ?? []).length}개 → ${(b.inserts[at] ?? []).length}개${(a.inserts[at] ?? []).length === (b.inserts[at] ?? []).length ? '(내용 바뀜)' : ''}`);
  }
  return out;
}

/* v10.712 (docs/820) 꾸밀 페이지 게시 전 점검 — 결과만 알려 주고 게시는 막지 않음(관 페이지 「페이지 점검」과 같은 규칙 + 배치 규칙) */
interface LayFinding { level: 'warn' | 'info'; at: string; msg: string }
export function checkLayout(sp: Spec, l: Layout, langs: string[]): LayFinding[] {
  const out: LayFinding[] = [];
  const nm = Object.fromEntries(sp.sections);
  const shown = l.sections.filter((x) => x.show);
  if (!shown.length) out.push({ level: 'warn', at: '구역', msg: '모든 구역을 숨겼습니다 — 머리 띠와 블록만 보입니다.' });
  else if (shown.length <= Math.ceil(sp.sections.length / 3)) out.push({ level: 'info', at: '구역', msg: `구역 ${sp.sections.length}개 가운데 ${shown.length}개만 보입니다.` });
  if (sp.slides && l.slides && sp.slides.every(([k2]) => l.slides?.[k2]?.show === false)) out.push({ level: 'warn', at: 'hero 안내 장', msg: '안내 장을 모두 숨겼습니다 — hero 오른쪽이 비어 보일 수 있습니다(광고가 있으면 광고만).' });
  for (const [k2, sn] of sp.slides ?? []) { const x = l.slides?.[k2]; if (x?.show !== false && x?.image && !/^(\/(?!\/)|https:\/\/)/.test(x.image)) out.push({ level: 'warn', at: `안내 장 「${sn}」`, msg: '그림 주소는 /… 또는 https://… 여야 합니다.' }); }
  for (const [tk, tn, max] of sp.texts) { const v = l.texts[tk] ?? ''; if (v && v.length > Math.round(max * 0.8)) out.push({ level: 'info', at: tn, msg: `${v.length}자 — 휴대폰에서 두 줄 넘게 꺾일 수 있습니다.` }); }
  for (const [at, blocks] of Object.entries(l.inserts)) {
    const where = at === '_top' || at === 'top' ? '맨 위' : at === 'bottom' ? '맨 아래' : `「${nm[at] ?? at}」 뒤`;
    if (at !== '_top' && at !== 'top' && at !== 'bottom' && l.sections.find((x) => x.key === at)?.show === false) out.push({ level: 'warn', at: `블록 ${where}`, msg: '숨긴 구역 뒤 블록 — 구역은 안 보여도 블록은 보입니다.' });
    checkPage('-', blocks, 'lay').filter((f) => f.at !== '제목').forEach((f) => out.push({ level: f.level, at: `블록 ${where} · ${f.at}`, msg: f.msg }));
  }
  /* v10.730 (docs/838) 접근성 — 큰 제목(머리 띠 블록)은 한 화면에 하나 · 이미 큰 제목이 있는 페이지에 머리 띠를 끼우면 둘이 됨 */
  const heroN = Object.values(l.inserts).reduce((n, b) => n + b.filter((x) => x.type === 'HERO').length, 0);
  if (heroN > 1) out.push({ level: 'warn', at: '블록', msg: `머리 띠(큰 제목) 블록이 ${heroN}개입니다 — 화면 읽기 프로그램은 큰 제목을 하나로 봅니다.` });
  else if (heroN === 1 && sp.inserts === 'each') out.push({ level: 'info', at: '블록', msg: '이 페이지는 이미 큰 제목이 있습니다 — 머리 띠 블록을 끼우면 큰 제목이 둘이 됩니다(글 블록 제목을 쓰는 편이 낫습니다).' });
  for (const [at, blocks] of Object.entries(l.inserts)) blocks.forEach((b, i) => { if (b.from && b.until && String(b.until) < new Date().toISOString().slice(0, 10)) out.push({ level: 'info', at: `블록 ${at} ${i + 1}번`, msg: `보이는 기간이 끝났습니다(${b.until}) — 빼도 됩니다.` }); });
  const koKeys = sp.texts.map(([tk]) => tk).filter((tk) => l.texts[tk]);
  for (const lg of langs.filter((x) => x !== 'ko')) {
    const miss = koKeys.filter((tk) => !l.i18n?.[lg]?.[tk]);
    if (koKeys.length && miss.length) out.push({ level: 'info', at: `${lg} 글자`, msg: `한국어로 바꾼 글 ${miss.length}개가 ${lg} 칸에 없습니다 — ${lg} 화면에는 사전 글이 나옵니다(「AI 번역 초안」).` });
  }
  return out;
}

function Editor({ k, isSuper: isSuperRole, onBack }: { k: string; isSuper: boolean; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [l, setL] = useState<Layout | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [prods, setProds] = useState<Array<{ code: string; name: string }> | null>(null);
  const [frame, setFrame] = useState<{ token: string; mobile: boolean; tick: number; both?: boolean } | null>(null);   // v10.703 운영 화면 안 미리보기 · v10.732 나란히
  const [cmp, setCmp] = useState<{ a: string; b: string; out: string[] | null }>({ a: '', b: '', out: null });   // v10.717 판 비교
  const [copyFrom, setCopyFrom] = useState('');   // v10.733 배치 복사
  const [base0, setBase0] = useState<Layout | null>(null);   // 처음 배치(차이 보기 — 게시한 판이 없을 때)
  const [lang, setLang] = useState('ko');   // v10.708 언어별 글자
  const [langs, setLangs] = useState<string[]>([]);
  const [log, setLog] = useState<Array<{ at: string; byName: string | null; changes: string[] }> | null>(null);   // v10.709 초안 고친 기록
  useEffect(() => { void api<{ items: Array<{ code: string }> }>('/admin/i18n/langs').then((r) => setLangs((r.items ?? []).map((x) => x.code))).catch(() => setLangs([])); }, []);
  useEffect(() => { void api<Array<{ at: string; byName: string | null; changes: string[] }>>(`/admin/site-layouts/${k}/draft-log`).then(setLog).catch(() => setLog([])); }, [k, saved]);
  const fill = (x: Detail) => { setD(x); setL(x.draft); setSaved(JSON.stringify(x.draft)); };
  useEffect(() => { api<Detail>(`/admin/site-layouts/${k}`).then(fill).catch((e) => setErr(msgOf(e))); }, [k]);
  useEffect(() => { if (d && !d.published && !base0) setBase0({ sections: d.spec.sections.map(([key]) => ({ key, show: true })), texts: {}, inserts: {}, ...(d.spec.slides ? { slides: Object.fromEntries(d.spec.slides.map(([x]) => [x, { show: true }])) } : {}), ...(d.spec.picks ? { picks: {} } : {}) }); }, [d, base0]);
  useEffect(() => { if (k === 'HLT' && !prods) void api<Array<{ code: string; name: string }>>('/health/products').then((r) => setProds(Array.isArray(r) ? r : [])).catch(() => setProds([])); }, [k, prods]);
  const dirty = !!l && JSON.stringify(l) !== saved;
  /* v10.745 (docs/853) 임시 저장 — 저장 안 한 고침을 이 브라우저에 1초마다 남김 · 다시 열면 「되살리기」(서버에는 저장 안 함 · 저장하면 지움) */
  const tmpKey = `slay-tmp:${k}`;
  const [tmp, setTmp] = useState<{ at: string; layout: Layout } | null>(null);
  useEffect(() => { try { const t = localStorage.getItem(tmpKey); if (t) setTmp(JSON.parse(t)); } catch { /* 저장소 못 씀 */ } }, [tmpKey]);
  useEffect(() => {
    if (!l) return;
    const h = setTimeout(() => { try { if (dirty) localStorage.setItem(tmpKey, JSON.stringify({ at: new Date().toISOString(), layout: l })); else localStorage.removeItem(tmpKey); } catch { /* 저장소 못 씀 */ } }, 1000);
    return () => clearTimeout(h);
  }, [l, dirty, tmpKey]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const run = async (key: string, fn: () => Promise<Detail>, ok: string) => {
    setBusy(key); setErr(null); setMsg(null);
    try { fill(await fn()); setMsg(ok); setFrame((f) => (f ? { ...f, tick: f.tick + 1 } : f)); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
  };
  if (!d || !l) return err ? <p className="form-error">{err}</p> : <p className="muted">불러오는 중…</p>;
  const sp = d.spec;
  const isSuper = isSuperRole || !!d.canPublish;   // v10.771 (docs/879) 게시 · 예약 · 되돌리기 = SUPER 또는 「관 UI/UX」 승인 권한(서버가 다시 봄)
  const stale = new Set(d.staleLangs ?? []);   // v10.764 다시 번역 필요
  const nm = Object.fromEntries(sp.sections);
  const set = (p: Partial<Layout>) => setL({ ...l, ...p });
  const move = (i: number, dir: number) => { const j = i + dir; if (j < 0 || j >= l.sections.length) return; const n = [...l.sections]; [n[i], n[j]] = [n[j]!, n[i]!]; set({ sections: n }); };
  const ins = (at2: string) => l.inserts[at2] ?? [];
  const setIns = (at2: string, b: Block[]) => { const n = { ...l.inserts }; if (b.length) n[at2] = b; else delete n[at2]; set({ inserts: n }); };
  const total = Object.values(l.inserts).reduce((s, b) => s + b.length, 0);
  const allSpots: Array<[string, string]> = sp.inserts === 'each' ? [['_top', '맨 위'], ...sp.sections.map(([x, n]) => [x, `「${n}」 뒤`] as [string, string])] : [['top', '위'], ['bottom', '아래']];   // v10.746
  const spot = (a: string, label: string) => (
    <div style={{ margin: '4px 0 10px 24px' }}>
      <button className="btn-sm btn-plain" onClick={() => setOpen(open === a ? null : a)} data-lay-spot={a}>{open === a ? '▾' : '▸'} {label} 블록 {ins(a).length ? `(${ins(a).length})` : ''}</button>
      {open === a && <BlockList blocks={ins(a)} onChange={(b) => setIns(a, b)} max={10}
        spots={allSpots.filter(([x]) => x !== a)} onMoveOut={(i, to) => { const from = [...ins(a)]; const [blk] = from.splice(i, 1); const n = { ...l.inserts }; if (from.length) n[a] = from; else delete n[a]; n[to] = [...(n[to] ?? []), blk!].slice(0, 10); set({ inserts: n }); setOpen(to); }} />}
    </div>
  );
  const locked = !!d.lockReason;   // v10.701 (D322) 수정 불가 · 관이 열려 있음 — 서버도 막음(422)
  const diff = layoutDiff(sp, d.published ?? base0 ?? l, l);
  const found = checkLayout(sp, l, langs);   // v10.712
  const warnN = found.filter((x) => x.level === 'warn').length;
  const compare = async () => {   // v10.717 (docs/825) 판 두 개 — '0' 은 처음 배치 · 'draft' 는 지금 초안
    const get = async (v: string): Promise<Layout> => v === 'draft' ? l : v === '0' ? (base0 ?? { sections: sp.sections.map(([key]) => ({ key, show: true })), texts: {}, inserts: {} }) : (await api<{ layout: Layout }>(`/admin/site-layouts/${k}/versions/${v}`)).layout;
    try { const [x, y] = await Promise.all([get(cmp.a), get(cmp.b)]); setCmp({ ...cmp, out: layoutDiff(sp, x, y) }); } catch (e) { setErr(msgOf(e)); }
  };
  const openFrame = async (mobile: boolean, both = false) => {
    let tok = d.previews[0]?.token;
    if (!tok) { try { tok = (await api<{ token: string }>(`/admin/site-layouts/${k}/previews`, { method: 'POST', body: JSON.stringify({ hours: 24 }) })).token; setD(await api<Detail>(`/admin/site-layouts/${k}`)); } catch (e) { setErr(msgOf(e)); return; } }
    setFrame({ token: tok!, mobile, tick: Date.now(), both });
  };
  const save = () => run('save', () => api<Detail>(`/admin/site-layouts/${k}`, { method: 'PATCH', body: JSON.stringify({ layout: l }) }), '초안을 저장했습니다 — 게시 전까지 사용자 웹은 그대로입니다.');
  return (
    <div data-site-layout-editor={k}>
      <p><button className="btn-sm btn-plain" onClick={() => { if (!dirty || confirm('저장하지 않은 고침이 있습니다. 그래도 나가시겠습니까?')) onBack(); }}>← 페이지 목록</button>{' '}
        <b>{sp.name}</b> <span className="dim">({sp.path})</span> · {d.publishedVersion ? `게시 ${d.publishedVersion}판(${when(d.publishedAt)} · ${d.publishedByName ?? '—'})` : '게시한 판 없음 — 사용자 웹은 처음 배치'}
        {d.draftChanged && <b className="warn-text"> · 게시 안 한 초안 있음</b>}{dirty && <b className="warn-text" data-site-layout-dirty> · 저장 안 한 고침</b>}
        {' '}<a href={siteHref(sp.path)} target="_blank" rel="noreferrer">사용자 웹 열기 ↗</a></p>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      {tmp && !dirty && JSON.stringify(tmp.layout) !== saved && <p className="warn-text" data-site-layout-tmp>저장하지 않은 고침이 이 브라우저에 남아 있습니다({when(tmp.at)}).{' '}
        <button className="btn-sm" onClick={() => { setL(tmp.layout); setMsg('남은 고침을 되살렸습니다 — 「초안 저장」을 눌러야 저장됩니다.'); }} data-site-layout-tmp-restore>되살리기</button>{' '}
        <button className="btn-sm btn-plain" onClick={() => { try { localStorage.removeItem(tmpKey); } catch { /* 무시 */ } setTmp(null); }}>버리기</button></p>}
      {/* v10.701 (D322 · docs/809) 수정 가능 스위치 · 관 열림 규칙 */}
      <div className={`card pad${locked ? ' warn' : ''}`} data-site-layout-lock={d.lockReason ?? 'open'}>
        <b>{d.editable ? '수정 가능' : '수정 불가'}</b>{d.gwanCode && <> · 관 {d.gwanCode} {d.gwanOpen ? '열림' : '닫힘'}</>}
        {d.lockReason === 'SITE_LAYOUT_LOCKED' && <span className="warn-text"> — 최고 관리자(SUPER)가 「수정 가능」으로 바꿔야 고칠 수 있습니다.</span>}
        {d.lockReason === 'SITE_LAYOUT_GWAN_OPEN' && <span className="warn-text"> — 관이 열려 있어 고칠 수 없습니다. 관 관리 › 관 설정에서 관을 닫은(중지) 뒤 고치고, 다 고친 뒤 다시 여십시오. 또는 페이지 목록 맨 위 「관 점검 시간」을 예약하면 그 시간에 닫혔다가 다시 열립니다.</span>}
        {isSuperRole && <> <button className="btn-sm" disabled={!!busy} data-site-layout-editable onClick={() => void run('ed', () => api<Detail>(`/admin/site-layouts/${k}/editable`, { method: 'POST', body: JSON.stringify({ editable: !d.editable }) }), d.editable ? '수정 불가로 바꿨습니다.' : '수정 가능으로 바꿨습니다.')}>{d.editable ? '수정 불가로' : '수정 가능으로'}</button></>}
        <span className="dim"> · 엔진 기능(검색 · 목록 · 주문 · 정산)은 고칠 수 없고, 글자 · 그림 · 순서 · 숨기기 · 블록 같은 디자인만 고칩니다.</span>
      </div>

      {sp.texts.length > 0 && (
        <div className="card pad" data-site-layout-texts={lang}><h3 style={{ marginTop: 0 }}>글자 <span className="dim" style={{ fontWeight: 400 }}>— 비우면 {lang === 'ko' ? '처음 글' : '그 언어 사전 글'}</span></h3>
          {/* v10.708 (docs/816) 언어별 글자 — 한국어 글은 한국어 화면에만 · 다른 언어는 그 언어 칸(비우면 그 언어 사전 글) */}
          <div className="acts" data-site-layout-langs>{['ko', ...langs.filter((x) => x !== 'ko')].map((x) => (
            <button key={x} className={`btn-sm${x === lang ? ' btn-ok' : ''}`} onClick={() => setLang(x)} data-lay-lang={x}>{x === 'ko' ? '한국어' : x}{x !== 'ko' && l.i18n?.[x] ? ` (${Object.keys(l.i18n[x]!).length})` : ''}{stale.has(x) && <b className="warn-text" data-lay-lang-stale={x}> · 다시 번역 필요</b>}</button>))}
            {lang === 'ko' && <button className="btn-sm" disabled={!!busy} data-site-layout-suggest title="관 이름 · 설명으로 한국어 글을 제안합니다(칸만 채움 · 저장은 직접)"
              onClick={() => { if (!confirm('AI 로 이 페이지 글자를 제안받아 빈 칸에 채웁니다(AI 비용 · 월 상한). 채운 뒤 읽어 보고 「초안 저장」을 누르십시오.')) return; setBusy('sg'); setErr(null); setMsg(null);
                void api<{ texts: Record<string, string> }>(`/admin/site-layouts/${k}/suggest`, { method: 'POST' }).then((r) => { const n = Object.fromEntries(Object.entries(r.texts).filter(([tk]) => !l.texts[tk])); set({ texts: { ...l.texts, ...n } }); setMsg(`빈 칸 ${Object.keys(n).length}개를 AI 제안으로 채웠습니다 — 읽어 보고 저장하십시오.`); }).catch((e) => setErr(msgOf(e))).finally(() => setBusy('')); }}>AI 글자 초안</button>}   {/* v10.741 (docs/849) */}
            {lang !== 'ko' && <button className="btn-sm" disabled={!!busy || locked || dirty} data-site-layout-translate title={dirty ? '저장한 뒤 누르십시오' : ''}
              onClick={() => { if (confirm(`한국어 글을 AI 로 ${lang} 에 옮겨 이 언어 칸에 넣습니다(AI 비용 · 월 상한). 게시 전에 꼭 읽어 보십시오.`)) void run('tr', () => api<Detail>(`/admin/site-layouts/${k}/translate`, { method: 'POST', body: JSON.stringify({ lang }) }), `${lang} 번역 초안을 넣었습니다 — 읽어 보고 고친 뒤 게시하십시오.`); }}>AI 번역 초안</button>}</div>
          <div className="form-grid">{(lang === 'ko' ? sp.texts : [...sp.texts, ...(sp.slides ?? []).flatMap(([sk, sn]) => (([['tag', 20], ['title', 40], ['desc', 120], ['cta', 20]] as Array<[string, number]>).map(([f, mx]) => [`slide.${sk}.${f}`, `${sn} ${f}`, mx] as [string, string, number])))]).map(([tk, tn, max]) => {
            const v = lang === 'ko' ? l.texts[tk] ?? '' : l.i18n?.[lang]?.[tk] ?? '';
            const put = (val: string) => lang === 'ko' ? set({ texts: { ...l.texts, [tk]: val } }) : set({ i18n: { ...(l.i18n ?? {}), [lang]: { ...(l.i18n?.[lang] ?? {}), [tk]: val } } });
            return <label key={tk}><span>{tn}({max}자)</span><input value={v} maxLength={max} onChange={(e) => put(e.target.value)} data-lay-text={tk} placeholder={lang !== 'ko' ? l.texts[tk] ?? '' : undefined} /></label>; })}</div></div>)}

      {sp.slides && l.slides && (
        <div className="card pad" data-site-layout-slides><h3 style={{ marginTop: 0 }}>hero 오른쪽 안내 장 <span className="dim" style={{ fontWeight: 400 }}>— 비우면 처음 글 · 관이 꺼져 있으면 그 장은 안 나옴</span></h3>
          {sp.slides.map(([sk, sn]) => { const s = l.slides![sk] ?? { show: true }; const put = (p: Partial<Slide>) => set({ slides: { ...l.slides!, [sk]: { ...s, ...p } } }); return (
            <div key={sk} className="form-grid" style={{ borderTop: '1px solid var(--sgb-line, #e5e7eb)', paddingTop: 8 }} data-lay-slide={sk}>
              <label><span><b>{sn}</b> 보이기</span><input type="checkbox" checked={s.show} onChange={(e) => put({ show: e.target.checked })} /></label>
              <label><span>꼬리표(20자)</span><input value={s.tag ?? ''} maxLength={20} onChange={(e) => put({ tag: e.target.value })} /></label>
              <label><span>제목(40자)</span><input value={s.title ?? ''} maxLength={40} onChange={(e) => put({ title: e.target.value })} /></label>
              <label><span>설명(120자)</span><input value={s.desc ?? ''} maxLength={120} onChange={(e) => put({ desc: e.target.value })} /></label>
              <label><span>단추 글(20자)</span><input value={s.cta ?? ''} maxLength={20} onChange={(e) => put({ cta: e.target.value })} /></label>
              <label><span>단추 주소(/… 또는 https)</span><input value={s.href ?? ''} maxLength={300} onChange={(e) => put({ href: e.target.value })} /></label>
              <ImageField label="그림(올리기 또는 주소 · 비우면 처음 그림)" v={s.image ?? ''} on={(v) => put({ image: v })} />   {/* v10.718 (docs/826) 그림 올리기 */}
            </div>); })}</div>)}

      <div className="card pad" data-site-layout-sections><h3 style={{ marginTop: 0 }}>구역 — 보이기 · 순서{sp.inserts === 'each' ? ' · 구역 뒤 블록' : ''} <span className="dim" style={{ fontWeight: 400 }}>끼운 블록 {total} / 30</span></h3>
        {sp.inserts === 'each' ? spot('_top', '맨 위(머리 띠 바로 아래)') : spot('top', '위(머리 띠 아래)')}
        {l.sections.map((s, i) => (
          <div key={s.key}>
            <p style={{ margin: '6px 0' }} data-lay-sec={s.key}>
              <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${nm[s.key]} 위로`}>↑</button>{' '}
              <button className="btn-sm" disabled={i === l.sections.length - 1} onClick={() => move(i, 1)} aria-label={`${nm[s.key]} 아래로`}>↓</button>{' '}
              <label><input type="checkbox" checked={s.show} onChange={(e) => set({ sections: l.sections.map((x, j) => (j === i ? { ...x, show: e.target.checked } : x)) })} /> <b style={s.show ? undefined : { textDecoration: 'line-through', opacity: 0.6 }}>{i + 1}. {nm[s.key] ?? s.key}</b></label>
              {sp.picks?.some(([pk]) => pk === s.key) && <span className="dim"> · 상품 고르기 아래</span>}
            </p>
            {sp.inserts === 'each' && spot(s.key, `「${nm[s.key]}」 뒤`)}
          </div>
        ))}
        {sp.inserts === 'edge' && spot('bottom', '아래(맨 끝)')}
        {sp.inserts === 'edge' && <p className="dim">이 페이지는 구역 안 배치가 촘촘해 블록은 위 · 아래 두 자리에만 넣습니다. 머리 띠가 필요하면 위 자리에 「머리 띠」 블록을 넣으십시오.</p>}
      </div>

      {sp.picks && (
        <div className="card pad" data-site-layout-picks><h3 style={{ marginTop: 0 }}>상품 고르기 <span className="dim" style={{ fontWeight: 400 }}>— 비우면 자동(처음 규칙) · 고른 차례대로 나옴 · 품절은 빠짐</span></h3>
          {sp.picks.map(([pk, pn, max]) => { const cur = l.picks?.[pk] ?? []; const put = (c: string[]) => { const n = { ...(l.picks ?? {}) }; if (c.length) n[pk] = c; else delete n[pk]; set({ picks: n }); }; return (
            <div key={pk} data-lay-pick={pk}><b>{pn}</b> <span className="dim">{cur.length} / {max}</span>
              <div className="acts">{cur.map((c, i) => <span key={c} className="chip">{prods?.find((p) => p.code === c)?.name ?? c}{' '}
                <button className="btn-sm" disabled={i === 0} onClick={() => { const n = [...cur]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; put(n); }} aria-label="앞으로">←</button>
                <button className="btn-sm btn-no" onClick={() => put(cur.filter((x) => x !== c))} aria-label="빼기">×</button></span>)}</div>
              <select value="" disabled={cur.length >= max} onChange={(e) => { if (e.target.value) put([...cur, e.target.value]); }} aria-label={`${pn} 상품 더하기`}>
                <option value="">상품 더하기…</option>{(prods ?? []).filter((p) => !cur.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}</select>
            </div>); })}</div>)}

      <div className="acts">
        <button className="btn-ok" disabled={!!busy || locked} onClick={() => void save()} data-site-layout-save>초안 저장</button>
        {isSuper && <button className="btn-ok" disabled={!!busy || locked} data-site-layout-publish onClick={() => {
          if (dirty) { alert('저장하지 않은 고침이 있습니다 — 「초안 저장」을 먼저 누르십시오.'); return; }
          if (!confirm(`지금 저장된 초안을 사용자 웹(${sp.path})에 게시합니다.\n\n바뀌는 것:\n${diff.length ? diff.slice(0, 15).join('\n') : '(게시된 판과 같음)'}${warnN ? `\n\n게시 전 점검: 고칠 것 ${warnN}개가 남아 있습니다.` : ''}`)) return;
          void run('pub', () => api<Detail>(`/admin/site-layouts/${k}/publish`, { method: 'POST' }), '게시했습니다 — 사용자 웹에 1분 안에 보입니다.');
        }}>게시</button>}
        {!isSuper && <><button className="btn-ok" disabled={!!busy || dirty || !d.draftChanged} data-site-layout-request title={dirty ? '저장한 뒤 누르십시오' : !d.draftChanged ? '게시된 판과 같습니다' : ''} onClick={() => {   /* v10.711 (D324 · docs/819) 게시 요청 */
          const note = prompt('최고 관리자(SUPER)에게 게시를 요청합니다. 한 줄 메모(비워도 됨):');
          if (note === null) return;
          setBusy('rq'); setErr(null); setMsg(null);
          void api('/admin/publish-requests', { method: 'POST', body: JSON.stringify({ kind: 'LAYOUT', ref: k, note: note.trim() || undefined }) }).then(() => setMsg('게시를 요청했습니다 — 최고 관리자가 승인하면 사용자 웹에 나갑니다. 요청 뒤 초안을 고치면 다시 요청해야 합니다.')).catch((e) => setErr(msgOf(e))).finally(() => setBusy(''));
        }}>게시 요청</button> <span className="dim">게시는 최고 관리자(SUPER)가 합니다.</span></>}
        <button className="btn-sm" disabled={!!busy || locked} onClick={() => { if (confirm('처음 배치(코드에 있는 배치)로 초안을 바꿉니다. 게시는 따로입니다.')) void run('def', () => api<Detail>(`/admin/site-layouts/${k}/restore`, { method: 'POST', body: JSON.stringify({ version: 0 }) }), '처음 배치로 초안을 만들었습니다.'); }} data-site-layout-default>처음 배치로 초안</button>
      </div>

      {isSuper && (
        <div className="card pad" data-site-layout-schedule><b>예약 게시</b> <span className="dim">— 지금 저장된 초안을 떠 두고 그 시각에 게시(5분 뒤 ~ 90일)</span>
          {d.scheduledAt ? <p>예약: <b>{when(d.scheduledAt)}</b>(UTC) · {d.scheduledByName ?? '—'} <button className="btn-sm btn-no" disabled={!!busy} onClick={() => void run('sch0', () => api<Detail>(`/admin/site-layouts/${k}/schedule`, { method: 'POST', body: JSON.stringify({ at: null }) }), '예약을 취소했습니다.')}>예약 취소</button></p>
            : <div className="acts"><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="예약 시각" />
              <button className="btn-sm" disabled={!!busy || !at || dirty || locked} onClick={() => void run('sch', () => api<Detail>(`/admin/site-layouts/${k}/schedule`, { method: 'POST', body: JSON.stringify({ at: new Date(at).toISOString() }) }), '예약했습니다.')}>예약</button>
              {dirty && <span className="dim">저장한 뒤 예약합니다</span>}</div>}
        </div>)}

      {/* v10.763 (docs/871) 검색 결과 미리 보기 */}
      <SeoPreview title={(l.texts.title || l.texts.heroTitleA || sp.name).slice(0, 80)} desc={l.texts.seoDesc || l.texts.desc || l.texts.lead || l.texts.heroLeadA || l.texts.band || ''} path={sp.path} />
      {/* v10.778 (D329 · docs/886) 검색 · 공유 설명 · 공유 그림 — 게시하면 사용자 웹 description · openGraph 에 */}
      <div className="card pad form-grid" data-site-layout-seo>
        <label><span>검색 · 공유 설명(160자 · 비우면 처음 설명)</span><textarea maxLength={160} rows={2} value={l.texts.seoDesc ?? ''} disabled={locked} onChange={(e) => set({ texts: { ...l.texts, seoDesc: e.target.value } })} data-site-layout-seo-desc /></label>
        <ImageField label="공유 그림(카카오톡 · 검색 공유 · 비우면 없음)" v={l.texts.ogImage ?? ''} on={(v) => set({ texts: { ...l.texts, ogImage: v } })} />
      </div>
      {k === 'MALL_ITEM' && <MallItemOverrides canPublish={isSuper} />}   {/* v10.780 (D329 · docs/888) 분류 · 상품마다 덮어쓰기 */}
      {/* v10.760 (D328 · docs/868) A/B 비교 */}
      <AbCard k={k} canRun={isSuper && !locked} published={!!d.published} draftChanged={d.draftChanged} dirty={dirty} onMsg={(m, e) => { setMsg(m); setErr(e); }} />
      {/* v10.703 (docs/811) 초안 ↔ 게시 판 차이 · 운영 화면 안 미리보기 */}
      <div className="card pad" data-site-layout-diff={diff.length}><b>게시하면 바뀌는 것</b> <span className="dim">— {d.published ? `게시된 ${d.publishedVersion}판` : '처음 배치'}과 견줌{dirty ? ' · 저장 안 한 고침 포함' : ''}</span>
        {diff.length ? <ul>{diff.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="dim">바뀌는 것이 없습니다.</p>}</div>
      {/* v10.712 (docs/820) 게시 전 점검 */}
      <div className="card pad" data-site-layout-check={warnN}><b>게시 전 점검</b> <span className="dim">— 알려 주기만 하고 게시는 막지 않음</span>
        {found.length ? <ul>{found.map((x, i) => <li key={i} className={x.level === 'warn' ? 'warn-text' : undefined}>{x.level === 'warn' ? '고칠 것' : '참고'} · {x.at} — {x.msg}</li>)}</ul> : <p className="dim">걸리는 것이 없습니다.</p>}</div>
      {/* v10.709 (docs/817) 초안 고친 기록 */}
      <div className="card pad" data-site-layout-draft-log={log?.length ?? 0}><b>초안 고친 기록</b> <span className="dim">— 최근 50줄 · 누가 · 언제 · 바뀐 곳</span>
        {log && log.length ? <table className="tbl"><tbody>{log.map((x, i) => <tr key={i}><td>{when(x.at)}</td><td>{x.byName ?? '—'}</td><td>{(x.changes ?? []).join(' · ')}</td></tr>)}</tbody></table> : <p className="dim">아직 기록이 없습니다.</p>}</div>
      <div className="card pad" data-site-layout-frame={frame ? (frame.mobile ? 'mobile' : 'pc') : 'off'}><b>옆에서 보기</b> <span className="dim">— 저장된 초안을 사용자 웹 그대로(미리보기 링크 · 저장하면 다시 그림)</span>
        <div className="acts"><button className="btn-sm" onClick={() => void openFrame(false)} data-site-layout-frame-pc>PC 폭</button>
          <button className="btn-sm" onClick={() => void openFrame(true)} data-site-layout-frame-mobile>휴대폰 폭(375)</button>
          {frame && <button className="btn-sm btn-plain" onClick={() => setFrame(null)}>닫기</button>}</div>
          <button className="btn-sm" onClick={() => void openFrame(true, true)} data-site-layout-frame-both>나란히(게시된 화면 · 초안 · 휴대폰 폭)</button>   {/* v10.732 (docs/840) */}
        {frame && !frame.both && <div style={{ overflow: 'auto', border: '1px solid var(--sgb-line, #e5e7eb)', borderRadius: 8 }}>
          <iframe key={frame.tick} title="사용자 웹 미리보기" src={siteHref(`${sp.path}${sp.path.includes('?') ? '&' : '?'}lp=${frame.token}`)}
                  style={{ width: frame.mobile ? 375 : 1280, height: 760, border: 0, display: 'block', margin: frame.mobile ? '0 auto' : undefined }} /></div>}
        {frame?.both && <div style={{ display: 'flex', gap: 12, overflow: 'auto' }} data-site-layout-side>
          <div><b>지금 사용자 웹(게시된 판)</b><iframe key={`p${frame.tick}`} title="게시된 화면" src={siteHref(sp.path)} style={{ width: 375, height: 760, border: '1px solid var(--sgb-line, #e5e7eb)', display: 'block' }} /></div>
          <div><b>저장된 초안</b><iframe key={`d${frame.tick}`} title="초안 화면" src={siteHref(`${sp.path}${sp.path.includes('?') ? '&' : '?'}lp=${frame.token}`)} style={{ width: 375, height: 760, border: '1px solid var(--sgb-line, #e5e7eb)', display: 'block' }} /></div>
        </div>}
      </div>

      <div className="card pad" data-site-layout-previews><b>미리보기 링크</b> <span className="dim">— 로그인 없이 저장된 초안을 봄(24시간 · 페이지마다 5개)</span>
        <div className="acts"><button className="btn-sm" disabled={!!busy} onClick={() => { setBusy('pv'); void api(`/admin/site-layouts/${k}/previews`, { method: 'POST', body: JSON.stringify({ hours: 24 }) })
          .then(() => api<Detail>(`/admin/site-layouts/${k}`)).then((x) => { setD(x); setMsg('미리보기 링크를 만들었습니다.'); }).catch((e) => setErr(msgOf(e))).finally(() => setBusy('')); }} data-site-layout-preview-new>링크 만들기</button></div>
        {d.previews.map((p) => { const u = siteHref(`${sp.path}${sp.path.includes('?') ? '&' : '?'}lp=${p.token}`); return (
          <p key={p.token}><a href={u} target="_blank" rel="noreferrer">{u.slice(0, 80)}…</a> · {when(p.expiresAt)} 까지 · {p.createdByName ?? '—'}{' '}
            <button className="btn-sm" onClick={() => void navigator.clipboard?.writeText(u)}>복사</button>{' '}
            <button className="btn-sm btn-no" onClick={() => void api(`/admin/site-layouts/${k}/previews/${p.token}`, { method: 'DELETE' }).then(() => api<Detail>(`/admin/site-layouts/${k}`)).then(setD).catch((e) => setErr(msgOf(e)))}>끊기</button></p>); })}
      </div>

      {/* v10.739 (docs/847) 판 내려받기 · 올리기(백업 · 다른 서버로 옮기기) */}
      <div className="card pad" data-site-layout-file><b>판 파일</b> <span className="dim">— 지금 초안을 JSON 으로 내려받기 · 이 페이지에서 받은 파일을 초안으로 올리기(게시는 따로)</span>
        <div className="acts"><button className="btn-sm" data-site-layout-export onClick={() => void api<unknown>(`/admin/site-layouts/${k}/export`).then((j) => saveText(`꾸밀페이지_${k}_초안.json`, JSON.stringify(j, null, 2), 'application/json')).catch((e) => setErr(msgOf(e)))}>초안 내려받기</button>
          <label className="btn-sm" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>파일 올리기<input type="file" accept="application/json,.json" hidden disabled={locked || !!busy} data-site-layout-import
            onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (!fl) return; void fl.text().then((t) => { let j: unknown; try { j = JSON.parse(t); } catch { setErr('JSON 파일이 아닙니다.'); return; }
              if (confirm('이 파일로 지금 초안을 덮어씁니다(게시는 따로).')) void run('im', () => api<Detail>(`/admin/site-layouts/${k}/import`, { method: 'POST', body: JSON.stringify({ file: j }) }), '파일의 판을 초안으로 올렸습니다 — 확인 뒤 게시하십시오.'); }); }} /></label></div></div>
      {/* v10.733 (docs/841) 다른 꾸밀 페이지에서 배치 복사 */}
      <div className="card pad" data-site-layout-copy><b>다른 페이지에서 배치 복사</b> <span className="dim">— 같은 이름의 구역 차례 · 보이기 · 글자 · 위 · 아래 블록만 가져와 초안으로(게시는 따로)</span>
        <div className="acts"><select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="가져올 페이지"><option value="">고르기</option>
          {['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN', 'COMM', 'HELP', 'PARTNER', 'MALL_ITEM'].filter((x) => x !== k).map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <button className="btn-sm" disabled={!copyFrom || !!busy || locked || dirty} onClick={() => { if (confirm(`${copyFrom} 의 배치를 이 페이지 초안으로 가져옵니다(지금 초안을 덮어씀).`)) void run('cp', () => api<Detail>(`/admin/site-layouts/${k}/copy-from`, { method: 'POST', body: JSON.stringify({ from: copyFrom }) }), `${copyFrom} 배치를 초안으로 가져왔습니다 — 확인 뒤 게시하십시오.`); }} data-site-layout-copy-go>가져오기</button></div></div>
      {/* v10.717 (docs/825) 판 비교 */}
      <div className="card pad" data-site-layout-compare><b>판 비교</b> <span className="dim">— 두 판을 골라 차이를 봄</span>
        <div className="acts">{(['a', 'b'] as const).map((w) => (
          <select key={w} value={cmp[w]} onChange={(e) => setCmp({ ...cmp, [w]: e.target.value, out: null })} aria-label={w === 'a' ? '앞 판' : '뒤 판'}><option value="">{w === 'a' ? '앞 판' : '뒤 판'}</option>
            <option value="0">처음 배치</option>{d.versions.map((v) => <option key={v.version} value={String(v.version)}>{v.version}판</option>)}<option value="draft">지금 초안</option></select>))}
          <button className="btn-sm" disabled={!cmp.a || !cmp.b} onClick={() => void compare()} data-site-layout-compare-go>비교</button></div>
        {cmp.out && (cmp.out.length ? <ul>{cmp.out.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="dim">두 판이 같습니다.</p>)}</div>

      {d.versions.length > 0 && (
        <div className="card pad"><h3 style={{ marginTop: 0 }}>게시 판 기록</h3>
          <table className="tbl"><thead><tr><th>판</th><th>어떻게</th><th>언제</th><th>누가</th><th>사유</th><th></th></tr></thead><tbody>
            {d.versions.map((v) => (<tr key={v.version} data-site-layout-ver={v.version}><td>{v.version}{v.version === d.publishedVersion ? ' (지금)' : ''}</td><td>{HOW[v.how] ?? v.how}</td><td>{when(v.publishedAt)}</td><td>{v.publishedByName ?? '—'}</td><td>{v.reason ?? ''}</td>
              <td><button className="btn-sm" disabled={!!busy || locked} onClick={() => void run('rs', () => api<Detail>(`/admin/site-layouts/${k}/restore`, { method: 'POST', body: JSON.stringify({ version: v.version }) }), `${v.version}판으로 초안을 만들었습니다 — 게시는 따로입니다.`)}>이 판으로 초안</button>
                {isSuper && v.version !== d.publishedVersion && <> <button className="btn-sm btn-no" disabled={!!busy || locked} data-site-layout-rollback={v.version} onClick={() => {
                  const why = prompt(`${v.version}판을 바로 다시 게시합니다(초안은 그대로).\n되돌리는 사유(2자 이상):`);
                  if (!why || why.trim().length < 2) return;
                  void run('rb', () => api<Detail>(`/admin/site-layouts/${k}/rollback`, { method: 'POST', body: JSON.stringify({ version: v.version, reason: why.trim() }) }), `${v.version}판으로 되돌려 게시했습니다.`);
                }}>바로 되돌리기</button></>}</td></tr>))}
          </tbody></table></div>)}
    </div>
  );
}

/* v10.760 (D328 · docs/868) A/B 비교 — A = 게시된 판 · B = 지금 저장된 초안 · 방문자 반반(쿠키) · 1 ~ 31일 · 끝낼 때 B 를 고르면 B 를 새 판으로 게시 */
interface AbRow { id: number; status: string; winner: string | null; startsAt: string; endsAt: string; createdByName: string | null; viewsA: number; viewsB: number;
  clicksA?: number; clicksB?: number; yesA?: number; noA?: number; yesB?: number; noB?: number }   // v10.781 누름 · 의견
function AbCard({ k, canRun, published, draftChanged, dirty, onMsg }: { k: string; canRun: boolean; published: boolean; draftChanged: boolean; dirty: boolean; onMsg: (m: string | null, e: string | null) => void }) {
  const q = useApi<{ items: AbRow[] }>(`/admin/site-layouts/${k}/ab`);
  const [days, setDays] = useState(7);
  const run = q.data?.items.find((x) => x.status === 'RUNNING');
  const go = (path: string, body: unknown, ok: string) => void api(path, { method: 'POST', body: JSON.stringify(body) }).then(() => { q.reload(); onMsg(ok, null); }).catch((e) => onMsg(null, msgOf(e)));
  return (
    <div className="card pad" data-site-layout-ab={run ? 'running' : 'off'}><b>A/B 비교</b> <span className="dim">— A = 게시된 판 · B = 저장된 초안 · 방문자를 반반(처음 방문 화면은 A) · 방문 수로 비교</span>
      {run ? <p>진행 중: {when(run.startsAt)} ~ {when(run.endsAt)}(UTC) · 방문 A <b>{run.viewsA}</b> · B <b>{run.viewsB}</b>
        <span data-site-layout-ab-more> · 누름 A {run.clicksA ?? 0} · B {run.clicksB ?? 0} · 도움됨/아님 A {run.yesA ?? 0}/{run.noA ?? 0} · B {run.yesB ?? 0}/{run.noB ?? 0}</span>{' '}
        {canRun && <><button className="btn-sm" onClick={() => { if (confirm('A(지금 게시된 판)를 그대로 두고 비교를 끝냅니다.')) go(`/admin/site-layouts/${k}/ab/end`, { winner: 'A' }, 'A/B 비교를 끝냈습니다 — A 그대로.'); }} data-site-layout-ab-end-a>A 로 끝내기</button>{' '}
          <button className="btn-sm btn-ok" onClick={() => { if (confirm('B 판을 새 판으로 게시하고 비교를 끝냅니다.')) go(`/admin/site-layouts/${k}/ab/end`, { winner: 'B' }, 'B 판을 게시하고 비교를 끝냈습니다.'); }} data-site-layout-ab-end-b>B 로 끝내기(게시)</button></>}</p>
        : canRun && <div className="acts"><label>기간 <input type="number" min={1} max={31} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 70 }} />일</label>
          <button className="btn-sm" disabled={!published || !draftChanged || dirty} title={!published ? '게시된 판이 있어야 합니다' : !draftChanged ? '초안이 게시된 판과 같습니다' : dirty ? '저장한 뒤 누르십시오' : ''}
            onClick={() => { if (confirm(`지금 저장된 초안을 B 로 ${days}일 동안 방문자 절반에게 보입니다.`)) go(`/admin/site-layouts/${k}/ab`, { days }, 'A/B 비교를 시작했습니다.'); }} data-site-layout-ab-start>비교 시작</button></div>}
      {(q.data?.items ?? []).filter((x) => x.status === 'ENDED').slice(0, 3).map((x) => <p key={x.id} className="dim">지난 비교 {when(x.startsAt)} ~ {when(x.endsAt)} · A {x.viewsA} · B {x.viewsB} · {x.winner === 'B' ? 'B 게시' : 'A 그대로'}</p>)}
    </div>
  );
}

/* v10.706 (D323 · docs/814) 관 점검 시간 — 시작에 관을 닫고(열려 있던 관만) · 그 사이 예약 게시 · 끝에 다시 엶 · 최대 2시간 · SUPER */
interface MaintRow { id: number; gwanCode: string; gwanName: string; startsAt: string; endsAt: string; note: string | null; createdByName: string | null; announce?: boolean;
  wasOpen: boolean | null; reopenError: string | null; status: string }
const MSTATUS: Record<string, string> = { SCHEDULED: '예약', RUNNING: '점검 중(관 닫힘)', DONE: '끝', CANCELED: '취소' };
/* v10.780 (D329 · docs/888) 소개몰 상품 상세 — 분류마다 · 상품마다 덮어쓰기(상품 > 분류 > 모든 상품) · 같은 규칙(수정 가능 · 소개몰 닫힘) */
interface ItemRow { scope: string; ref: string; label: string; published: boolean; draftChanged: boolean; publishedAt: string | null; updatedByName: string | null }
interface ItemDetail extends ItemRow { draft: Layout; publishedLayout: Layout | null }
function MallItemOverrides({ canPublish }: { canPublish: boolean }) {
  const rows = useApi<ItemRow[]>('/admin/mall-item-layouts');
  const [scope, setScope] = useState('CATEGORY');
  const [ref, setRef] = useState('');
  const [d, setD] = useState<ItemDetail | null>(null);
  const [l, setL] = useState<Layout | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (p: Promise<ItemDetail>, ok: string) => { setErr(null); setMsg(null); void p.then((x) => { setD(x); setL(x.draft); setMsg(ok); rows.reload(); }).catch((e) => setErr(msgOf(e))); };
  const open = (s: string, r: string) => { setScope(s); setRef(r); go(api<ItemDetail>(`/admin/mall-item-layouts/${s}/${encodeURIComponent(r)}`), ''); };
  const path = d ? `/admin/mall-item-layouts/${d.scope}/${encodeURIComponent(d.ref)}` : '';
  return (
    <div className="card pad" data-mall-item-overrides={(rows.data ?? []).length}>
      <b>분류 · 상품마다 덮어쓰기</b> <span className="dim">— 게시된 덮어쓰기가 있으면 그 상품은 「상품 &gt; 분류 &gt; 모든 상품」 차례로 하나만 보입니다</span>
      {(rows.data ?? []).length > 0 && <table className="tbl"><tbody>{rows.data!.map((r) => (
        <tr key={`${r.scope}${r.ref}`}><td>{r.scope === 'CATEGORY' ? '분류' : '상품'}</td><td>{r.label} <span className="dim mono">{r.ref}</span></td>
          <td>{r.published ? '게시됨' : '초안만'}{r.draftChanged ? ' · 초안 바뀜' : ''}</td><td><button className="btn-sm" onClick={() => open(r.scope, r.ref)}>열기</button></td></tr>))}</tbody></table>}
      <p className="acts"><select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="범위" data-mall-item-scope><option value="CATEGORY">분류 코드</option><option value="PRODUCT">상품 코드</option></select>
        <input value={ref} onChange={(e) => setRef(e.target.value.trim())} placeholder={scope === 'CATEGORY' ? '예 VITAMIN' : '예 P-0001'} aria-label="코드" data-mall-item-ref />
        <button className="btn-sm" disabled={!ref} onClick={() => open(scope, ref)} data-mall-item-open>열기 · 새로</button></p>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      {d && l && (
        <div data-mall-item-editor={d.scope}>
          <p><b>{d.label}</b> <span className="dim">({d.scope === 'CATEGORY' ? '분류' : '상품'} {d.ref}) · {d.published ? `게시 ${when(d.publishedAt)}` : '게시 안 함'}</span></p>
          <label className="form-grid"><span>안내 띠 글(120자)</span><input maxLength={120} value={l.texts.band ?? ''} onChange={(e) => setL({ ...l, texts: { ...l.texts, band: e.target.value } })} /></label>
          {(['top', 'bottom'] as const).map((at) => <div key={at}><p className="dim">{at === 'top' ? '위' : '아래'} 블록</p><BlockList blocks={l.inserts[at] ?? []} max={10} onChange={(b) => setL({ ...l, inserts: { ...l.inserts, [at]: b } })} /></div>)}
          <p className="acts"><button className="btn-sm" onClick={() => go(api<ItemDetail>(path, { method: 'PUT', body: JSON.stringify({ layout: l }) }), '초안을 저장했습니다.')} data-mall-item-save>초안 저장</button>
            {canPublish && <button className="btn-sm btn-ok" disabled={JSON.stringify(l) !== JSON.stringify(d.draft)} onClick={() => { if (confirm('이 덮어쓰기를 게시합니다.')) go(api<ItemDetail>(`${path}/publish`, { method: 'POST' }), '게시했습니다.'); }} data-mall-item-publish>게시</button>}
            {canPublish && d.published && <button className="btn-sm btn-no" onClick={() => { if (confirm('게시를 내리면 이 상품 · 분류는 모든 상품 배치로 돌아갑니다(초안은 남음).')) go(api<ItemDetail>(`${path}/publish`, { method: 'DELETE' }), '게시를 내렸습니다.'); }} data-mall-item-unpublish>게시 내리기</button>}</p>
        </div>
      )}
    </div>
  );
}

function Maint({ isSuper }: { isSuper: boolean }) {
  const rows = useApi<MaintRow[]>('/admin/gwan-maintenances');
  const gw = useApi<Array<{ code: string; name: string; isActive: boolean }>>('/admin/gwans/manage');
  const [f, setF] = useState({ gwanCode: '', start: '', minutes: 30, note: '', announce: true, notifyMembers: false, lead: 0 });
  /* v10.753 (docs/861) 예약하려는 날의 예약 게시 · 다른 점검 미리 보기 */
  const day = f.start ? new Date(f.start).toISOString().slice(0, 10) : '';
  const near = useApi<{ items: Array<{ type: string; at: string; end: string | null; label: string }> }>(day ? `/admin/site-schedules?from=${day}&to=${day}` : '/admin/site-schedules?from=2000-01-01&to=2000-01-01', [day]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = (p: Promise<unknown>, ok: string) => { setErr(null); setMsg(null); void p.then(() => { setMsg(ok); rows.reload(); }).catch((e) => setErr(msgOf(e))); };
  return (
    <details className="card pad" data-gwan-maint-box={rows.data?.filter((r) => r.status === 'SCHEDULED' || r.status === 'RUNNING').length ?? 0} open={!!rows.data?.some((r) => r.status === 'RUNNING') || undefined}>
      <summary><b>관 점검 시간</b> <span className="dim">— 관이 열려 있으면 페이지를 고칠 수 없으므로, 정한 시간에 관을 닫았다가(열려 있던 관만) 끝나면 다시 엽니다 · 그 사이 시각이 된 예약 게시를 내보냄 · 손님에게는 「잠시 점검 중 · ○시에 다시 엽니다」 · 최대 2시간</span></summary>
      {msg && <p className="form-ok">{msg}</p>}{err && <p className="form-error">{err}</p>}
      {isSuper ? (
        <div className="form-grid" data-gwan-maint-form>
          <label><span>관</span><select value={f.gwanCode} onChange={(e) => setF({ ...f, gwanCode: e.target.value })}><option value="">고르기</option>
            {(gw.data ?? []).map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code}){g.isActive ? '' : ' · 닫힘'}</option>)}</select></label>
          <label><span>시작(내 컴퓨터 시각)</span><input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label><span>길이</span><select value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })}>{[15, 30, 60, 90, 120].map((m) => <option key={m} value={m}>{m}분</option>)}</select></label>
          <label style={{ gridColumn: '1 / -1' }}><span>손님 안내 글(200자 · 비워도 됨)</span><input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="예: 안내 페이지를 새로 꾸미는 중입니다." /></label>
          {/* v10.710 (D324 · docs/818) 손님 미리 알림 — 상단 고정 공지(메인 공지 띠 · 소개광장 › 공지 · 지금 ~ 점검 끝) · 회원 알림은 공지 알림 길 */}
          <label><input type="checkbox" checked={f.announce} onChange={(e) => setF({ ...f, announce: e.target.checked, notifyMembers: e.target.checked && f.notifyMembers })} data-gwan-maint-announce /> 손님에게 미리 알림(상단 고정 공지)</label>
          <label><input type="checkbox" checked={f.notifyMembers} disabled={!f.announce} onChange={(e) => setF({ ...f, notifyMembers: e.target.checked })} data-gwan-maint-notify /> 회원 알림도(내 알림)</label>
          <label><span>공지 올리는 때</span><select value={f.lead} disabled={!f.announce} onChange={(e) => setF({ ...f, lead: Number(e.target.value) })} data-gwan-maint-lead>   {/* v10.748 (docs/856) */}
            <option value={0}>지금</option><option value={1440}>하루 전</option><option value={60}>한 시간 전</option></select></label>
          {day && <div style={{ gridColumn: '1 / -1' }} data-gwan-maint-near={near.data?.items.length ?? 0}><span className="dim">그날 일정: </span>{(near.data?.items ?? []).length ? (near.data!.items.map((x, i) => <span key={i} className="chip">{new Date(new Date(x.at).getTime() + 9 * 3_600_000).toISOString().slice(11, 16)} {x.label}</span>)) : <span className="dim">없음</span>}</div>}
          <div className="acts"><button className="btn-ok" disabled={!f.gwanCode || !f.start} data-gwan-maint-create onClick={() => {
            const s0 = new Date(f.start);
            act(api('/admin/gwan-maintenances', { method: 'POST', body: JSON.stringify({ gwanCode: f.gwanCode, startsAt: s0.toISOString(), endsAt: new Date(s0.getTime() + f.minutes * 60_000).toISOString(), note: f.note || undefined, announce: f.announce, notifyMembers: f.announce && f.notifyMembers, noticeLeadMin: f.announce ? f.lead : 0 }) }), '점검 시간을 예약했습니다 — 시작 시각에 관이 닫힙니다(1분 안).');
          }}>예약</button></div>
        </div>) : <p className="dim">점검 시간 예약은 최고 관리자(SUPER)가 합니다.</p>}
      <Repeats isSuper={isSuper} gws={gw.data ?? []} />
      <table className="tbl"><thead><tr><th>관</th><th>시작 ~ 끝</th><th>상태</th><th>안내 글</th><th>누가</th><th></th></tr></thead><tbody>
        {(rows.data ?? []).map((r) => (
          <tr key={r.id} data-gwan-maint-row={r.status}><td>{r.gwanName}({r.gwanCode})</td><td>{when(r.startsAt)} ~ {when(r.endsAt).slice(11)} UTC</td>
            <td>{MSTATUS[r.status] ?? r.status}{r.status === 'DONE' && r.wasOpen === false ? ' · 원래 닫힌 관' : ''}{r.reopenError && <b className="warn-text"> · 다시 열지 못함 — 관 설정에서 여십시오</b>}</td>
            <td>{r.note ?? ''}{r.announce && <span className="dim"> · 공지함</span>}</td><td>{r.createdByName ?? '—'}</td>
            <td>{isSuper && r.status === 'SCHEDULED' && <button className="btn-sm btn-no" onClick={() => act(api(`/admin/gwan-maintenances/${r.id}/cancel`, { method: 'POST' }), '취소했습니다.')}>취소</button>}
              {isSuper && r.status === 'RUNNING' && <button className="btn-sm" data-gwan-maint-end onClick={() => { if (confirm('지금 점검을 끝내고 관을 다시 엽니다(예약 게시는 먼저 내보냄).')) act(api(`/admin/gwan-maintenances/${r.id}/end`, { method: 'POST' }), '점검을 끝냈습니다.'); }}>지금 끝내기</button>}</td></tr>))}
        {rows.data?.length === 0 && <tr><td colSpan={6} className="muted">예약한 점검 시간이 없습니다.</td></tr>}
      </tbody></table>
    </details>
  );
}

/* v10.711 (D324 · docs/819) 게시 요청 — ADMIN 요청 → SUPER 승인(그 초안 게시) · 되돌려 보냄(사유) · 요청한 사람 철회 · 요청 뒤 초안이 바뀌면 승인 막힘 */
interface ReqRow { id: number; kind: string; ref: string; label: string; note: string | null; status: string; reason: string | null; requestedAt: string; requestedByName: string | null; decidedAt: string | null; decidedByName: string | null; stale: boolean;
  firstApprovedAt?: string | null; firstApprovedByName?: string | null }   // v10.772 두 사람 승인
const RSTATUS: Record<string, string> = { OPEN: '요청 대기', APPROVED: '승인(게시함)', REJECTED: '되돌려 보냄', WITHDRAWN: '철회' };
function Requests({ isSuper, onOpen }: { isSuper: boolean; onOpen: (kind: string, ref: string) => void }) {
  const rows = useApi<ReqRow[]>('/admin/publish-requests');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = (p: Promise<unknown>, ok: string) => { setErr(null); setMsg(null); void p.then(() => { setMsg(ok); rows.reload(); }).catch((e) => setErr(msgOf(e))); };
  const open = (rows.data ?? []).filter((r) => r.status === 'OPEN');
  return (
    <details className="card pad" data-publish-requests={open.length} open={open.length > 0 || undefined}>
      <summary><b>게시 요청</b> {open.length > 0 && <b className="warn-text">{open.length}건 대기</b>} <span className="dim">— 운영자(ADMIN)가 초안을 다 고치면 요청 · 최고 관리자(SUPER)가 열어 보고 승인(게시) 또는 되돌려 보냄</span></summary>
      {msg && <p className="form-ok">{msg}</p>}{err && <p className="form-error">{err}</p>}
      <table className="tbl"><thead><tr><th>페이지</th><th>메모</th><th>요청</th><th>상태</th><th></th></tr></thead><tbody>
        {(rows.data ?? []).map((r) => (
          <tr key={r.id} data-publish-request={r.status}><td>{r.label}</td><td>{r.note ?? ''}</td><td>{when(r.requestedAt)} · {r.requestedByName ?? '—'}</td>
            <td>{RSTATUS[r.status] ?? r.status}{r.stale && <b className="warn-text"> · 요청 뒤 초안 바뀜</b>}{r.status === 'OPEN' && r.firstApprovedAt && <b data-publish-request-first> · 1차 승인 {r.firstApprovedByName ?? ''} — 다른 SUPER 의 2차 승인 대기</b>}{r.reason ? ` · ${r.reason}` : ''}{r.decidedByName ? ` · ${r.decidedByName}` : ''}</td>
            <td>{r.status === 'OPEN' && <>
              <button className="btn-sm" onClick={() => onOpen(r.kind, r.ref)}>열어 보기</button>{' '}
              {isSuper && <button className="btn-sm btn-ok" disabled={r.stale} data-publish-request-approve onClick={() => { if (confirm(`「${r.label}」 요청 초안을 사용자 웹에 게시합니다.`)) act(api(`/admin/publish-requests/${r.id}/approve`, { method: 'POST' }), '승인했습니다 — 게시했습니다.'); }}>승인(게시)</button>}{' '}
              {isSuper && <button className="btn-sm btn-no" onClick={() => { const why = prompt('되돌려 보내는 사유(2자 이상):'); if (why && why.trim().length >= 2) act(api(`/admin/publish-requests/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: why.trim() }) }), '되돌려 보냈습니다.'); }}>되돌려 보냄</button>}{' '}
              <button className="btn-sm btn-plain" onClick={() => act(api(`/admin/publish-requests/${r.id}/withdraw`, { method: 'POST' }), '철회했습니다.')}>철회</button></>}</td></tr>))}
        {rows.data?.length === 0 && <tr><td colSpan={5} className="muted">게시 요청이 없습니다.</td></tr>}
      </tbody></table>
    </details>
  );
}

/* v10.735 · 736 (docs/843 · 844) 달력 — 한 달 · 예약 게시(꾸밀 페이지 · 관 안 페이지) · 관 점검 시간(한국 날짜) */
const TYPE_KO: Record<string, string> = { LAYOUT: '예약 게시', PAGE: '관 페이지 예약', MAINT: '관 점검' };
function Calendar() {
  const now = new Date(Date.now() + 9 * 3_600_000);
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [show, setShow] = useState<Record<string, boolean>>({ LAYOUT: true, PAGE: true, MAINT: true });
  const first = new Date(Date.UTC(ym.y, ym.m, 1)), last = new Date(Date.UTC(ym.y, ym.m + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const d = useApi<{ items: Array<{ type: string; at: string; end: string | null; label: string; status?: string }> }>(`/admin/site-schedules?from=${iso(first)}&to=${iso(last)}`, [ym.y, ym.m]);
  const kday = (s: string) => new Date(new Date(s).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const ktime = (s: string) => new Date(new Date(s).getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  const items = (d.data?.items ?? []).filter((x) => show[x.type]);
  const byDay: Record<string, typeof items> = {};
  for (const x of items) (byDay[kday(x.at)] ??= []).push(x);
  const cells: Array<string | null> = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: last.getUTCDate() }, (_, i) => iso(new Date(Date.UTC(ym.y, ym.m, i + 1))))];
  const mv = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <details className="card pad" data-site-calendar={items.length}><summary><b>달력</b> <span className="dim">— 예약 게시 · 관 점검 시간(한국 날짜 · 시각)</span></summary>
      <div className="acts"><button className="btn-sm" onClick={() => mv(-1)} aria-label="지난달">←</button><b>{ym.y}년 {ym.m + 1}월</b><button className="btn-sm" onClick={() => mv(1)} aria-label="다음 달">→</button>
        {Object.keys(TYPE_KO).map((t) => <label key={t}><input type="checkbox" checked={show[t]} onChange={(e) => setShow({ ...show, [t]: e.target.checked })} data-site-calendar-type={t} /> {TYPE_KO[t]}</label>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => <b key={w} style={{ textAlign: 'center' }}>{w}</b>)}
        {cells.map((c, i) => <div key={i} style={{ minHeight: 64, border: '1px solid var(--sgb-line, #e5e7eb)', borderRadius: 6, padding: 4, fontSize: 12 }} data-site-calendar-day={c ?? ''}>
          {c && <><b>{Number(c.slice(8))}</b>{(byDay[c] ?? []).map((x, k) => <div key={k} title={x.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ktime(x.at)}{x.end ? `~${ktime(x.end)}` : ''} {TYPE_KO[x.type]}{x.status === 'RUNNING' ? '(지금)' : ''} · {x.label}</div>)}</>}
        </div>)}
      </div>
    </details>
  );
}

/* v10.744 (docs/852) 내 할 일 — SUPER 승인 대기 · 내 열린 요청 · 되돌려 받은 요청 */
function MyTasks() {
  const t = useApi<{ isSuper: boolean; waiting: number; mineOpen: number; mineRejected: number }>('/admin/my-page-tasks');
  if (!t.data || (!t.data.waiting && !t.data.mineOpen && !t.data.mineRejected)) return null;
  return (
    <p className="card pad warn" data-my-page-tasks={t.data.waiting + t.data.mineRejected}><b>내 할 일</b>{' '}
      {t.data.isSuper && t.data.waiting > 0 && <span>· 승인 기다리는 게시 요청 <b>{t.data.waiting}</b>건 </span>}
      {t.data.mineRejected > 0 && <span>· 되돌려 받은 내 요청 <b>{t.data.mineRejected}</b>건(30일) </span>}
      {t.data.mineOpen > 0 && <span>· 내가 낸 요청 대기 {t.data.mineOpen}건 </span>}
      <span className="dim">— 아래 「게시 요청」에서 봅니다.</span></p>
  );
}

/* v10.727 (D325 · docs/835) 관 열기 · 닫기 기록 */
function OpenLog() {
  const rows = useApi<Array<{ id: number; gwanName: string; gwanCode: string; opened: boolean; source: string; byName: string | null; maintId: number | null; at: string }>>('/admin/gwan-open-log');
  return (
    <details className="card pad" data-gwan-open-log={rows.data?.length ?? 0}><summary><b>관 열기 · 닫기 기록</b> <span className="dim">— 최근 200줄 · 운영 화면에서 · 점검 시간에</span></summary>
      <table className="tbl"><thead><tr><th>언제</th><th>관</th><th>무엇</th><th>어디서</th><th>누가</th></tr></thead><tbody>
        {(rows.data ?? []).map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.gwanName}({r.gwanCode})</td><td>{r.opened ? '열기' : '닫기'}</td><td>{r.source === 'MAINT' ? `점검 시간 #${r.maintId ?? ''}` : '운영 화면'}</td><td>{r.byName ?? (r.source === 'MAINT' ? '정기 작업' : '—')}</td></tr>)}
        {rows.data?.length === 0 && <tr><td colSpan={5} className="muted">기록이 없습니다.</td></tr>}
      </tbody></table></details>
  );
}
/* v10.729 (D325 · docs/837) 손님 한 줄 의견 모아 보기 */
function Feedback() {
  const d = useApi<{ pages: Array<{ kind: string; ref: string; yes: number; no: number; lastAt: string }>; recent: Array<{ id: number; kind: string; ref: string; helpful: boolean; comment: string; at: string; checkedAt: string | null; checkedByName: string | null }> }>('/admin/page-feedback?days=30');
  return (
    <details className="card pad" data-page-feedback-box={d.data?.pages.length ?? 0}><summary><b>손님 한 줄 의견</b> <span className="dim">— 「손님 한 줄 의견」 블록을 넣은 페이지 · 30일</span></summary>
      <p><button className="btn-sm" data-page-feedback-csv onClick={() => void api<{ csv: string; filename: string }>('/admin/page-feedback.csv?days=90').then((r) => saveText(r.filename, r.csv)).catch(() => undefined)}>CSV 내려받기(90일)</button></p>   {/* v10.738 (docs/846) */}
      <table className="tbl"><thead><tr><th>페이지</th><th>도움됨</th><th>아쉬움</th><th>마지막</th></tr></thead><tbody>
        {(d.data?.pages ?? []).map((r) => <tr key={`${r.kind}${r.ref}`}><td>{r.kind === 'LAYOUT' ? `꾸밀 페이지 ${r.ref}` : r.ref}</td><td>{r.yes}</td><td>{r.no}</td><td>{when(r.lastAt)}</td></tr>)}
        {d.data?.pages.length === 0 && <tr><td colSpan={4} className="muted">아직 의견이 없습니다.</td></tr>}
      </tbody></table>
      {(d.data?.recent ?? []).length > 0 && <><b>최근 한 줄</b><ul>{d.data!.recent.map((r, i) => <li key={i} data-page-feedback-row={r.checkedAt ? 'checked' : 'new'}>{when(r.at)} · {r.ref} · {r.helpful ? '도움됨' : '아쉬움'} — {r.comment}
        {r.checkedAt ? <span className="dim"> · 확인함 {r.checkedByName ?? ''}</span> : <> <button className="btn-sm" onClick={() => void api(`/admin/page-feedback/${r.id}/check`, { method: 'POST' }).then(() => d.reload())} data-page-feedback-check>확인함</button></>}</li>)}</ul></>}   {/* v10.749 (docs/857) */}
    </details>
  );
}
/* v10.721 (D325 · docs/829) 점검 시간 반복 */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function Repeats({ isSuper, gws }: { isSuper: boolean; gws: Array<{ code: string; name: string }> }) {
  const rows = useApi<Array<{ id: number; gwanCode: string; gwanName: string; dow: number; atKst: string; minutes: number; note: string | null; isActive: boolean }>>('/admin/gwan-maint-repeats');
  const [f, setF] = useState({ gwanCode: '', dow: 2, atKst: '03:00', minutes: 30, note: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div data-gwan-maint-repeats={rows.data?.filter((r) => r.isActive).length ?? 0}><b>매주 반복</b> <span className="dim">— 요일 · 한국 시각마다 7일 앞까지 점검을 만들어 둠(겹치면 건너뜀)</span>
      {err && <p className="form-error">{err}</p>}
      {isSuper && <div className="acts">
        <select value={f.gwanCode} onChange={(e) => setF({ ...f, gwanCode: e.target.value })} aria-label="반복 관"><option value="">관</option>{gws.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</select>
        <select value={f.dow} onChange={(e) => setF({ ...f, dow: Number(e.target.value) })} aria-label="요일">{DOW.map((x, i) => <option key={i} value={i}>{x}요일</option>)}</select>
        <input type="time" value={f.atKst} onChange={(e) => setF({ ...f, atKst: e.target.value })} aria-label="한국 시각" />
        <select value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} aria-label="길이">{[15, 30, 60, 90, 120].map((m) => <option key={m} value={m}>{m}분</option>)}</select>
        <input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="안내 글(선택)" aria-label="반복 안내 글" />
        <button className="btn-sm" disabled={!f.gwanCode} data-gwan-maint-repeat-create onClick={() => { setErr(null); void api('/admin/gwan-maint-repeats', { method: 'POST', body: JSON.stringify({ ...f, note: f.note || undefined }) }).then(() => rows.reload()).catch((e) => setErr(msgOf(e))); }}>반복 만들기</button></div>}
      <ul>{(rows.data ?? []).map((r) => <li key={r.id}>{r.gwanName} · 매주 {DOW[r.dow]}요일 {r.atKst}(한국) · {r.minutes}분{r.note ? ` · ${r.note}` : ''} · {r.isActive ? '켜짐' : '멈춤'}
        {isSuper && r.isActive && <> <button className="btn-sm btn-no" onClick={() => { void api(`/admin/gwan-maint-repeats/${r.id}/stop`, { method: 'POST' }).then(() => rows.reload()).catch((e) => setErr(msgOf(e))); }}>멈춤</button></>}</li>)}</ul>
    </div>
  );
}

/** v10.700 (docs/808) 페이지 목록 — 꾸밀 페이지 6 · 관 안 페이지 한 표 */
export function SitePages({ isSuper, onGo }: { isSuper: boolean; onGo?: (tab: string) => void }) {
  const { data, error, loading, reload } = useApi<{ layouts: Row[]; pages: PageRow[] }>('/admin/site-pages');
  const [edit, setEdit] = useState<string | null>(null);
  const [pageEdit, setPageEdit] = useState<number | null>(null);   // v10.704 (docs/812) 관 안 페이지 그 자리에서 편집
  const [q, setQ] = useState(''); const [fl, setFl] = useState('');   // v10.723 (docs/831) 찾기 · 거르기
  const [logMonth, setLogMonth] = useState(() => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7));   // v10.773
  const [pick, setPick] = useState<string[]>([]); const [bat, setBat] = useState(''); const [batMsg, setBatMsg] = useState<string | null>(null);   // v10.716 한꺼번에 예약
  if (pageEdit) return <GwanPageEditor id={pageEdit} isSuper={isSuper} onBack={() => { setPageEdit(null); reload(); }} />;
  if (edit) return <Editor k={edit} isSuper={isSuper} onBack={() => { setEdit(null); reload(); }} />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;
  const qq = q.trim().toLowerCase();
  const lays = data.layouts.filter((r) => (!qq || `${r.name} ${r.path} ${r.key}`.toLowerCase().includes(qq))
    && (!fl || (fl === 'draft' && r.draftChanged) || (fl === 'editable' && r.editable) || (fl === 'open' && r.gwanOpen) || (fl === 'sched' && r.scheduledAt) || (fl === 'stale' && (r.staleLangs ?? []).length > 0)));
  const pgs = data.pages.filter((p) => (!qq || `${p.gwanName} ${p.gwanCode} ${p.slug} ${p.title}`.toLowerCase().includes(qq))
    && (!fl || (fl === 'draft' && p.status !== 'PUBLISHED') || (fl === 'editable' && p.editable) || (fl === 'open' && p.gwanOpen) || (fl === 'sched' && p.scheduledAt)) && fl !== 'stale');
  return (
    <div data-site-pages={data.layouts.length + data.pages.length}>
      <MyTasks />
      <Maint isSuper={isSuper} />
      <Requests isSuper={isSuper} onOpen={(kind, ref) => (kind === 'LAYOUT' ? setEdit(ref) : setPageEdit(Number(ref)))} />
      <Calendar />
      {/* v10.723 (docs/831) 찾기 · 거르기 · v10.743 (docs/851) 목록 CSV */}
      <div className="search-row" data-site-pages-filter><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="페이지 · 관 · 주소 찾기" aria-label="페이지 찾기" />
        <select value={fl} onChange={(e) => setFl(e.target.value)} aria-label="거르기"><option value="">모두</option><option value="draft">게시 안 한 초안</option><option value="editable">수정 가능</option><option value="open">관 열림</option><option value="sched">예약 있음</option><option value="stale">다시 번역 필요</option></select>   {/* v10.764 */}
        <button className="btn-sm" data-site-pages-csv onClick={() => void api<{ csv: string; filename: string }>('/admin/site-pages.csv').then((r) => saveText(r.filename, r.csv)).catch(() => undefined)}>목록 CSV</button>
        {/* v10.773 (docs/881) 게시 기록 CSV(감사 · 달마다) */}
        <input type="month" value={logMonth} onChange={(e) => setLogMonth(e.target.value)} aria-label="게시 기록 달" />
        <button className="btn-sm" data-site-pages-publish-log onClick={() => void api<{ csv: string; filename: string }>(`/admin/site-pages/publish-log.csv?month=${logMonth}`).then((r) => saveText(r.filename, r.csv)).catch(() => undefined)}>게시 기록 CSV</button></div>
      <div className="card pad"><h3 style={{ marginTop: 0 }}>메인 · 관 메인 · 소개몰 메인 <span className="dim" style={{ fontWeight: 400 }}>— 구역 보이기 · 순서 · 글자 · 그림 · 블록(게시 전에는 사용자 웹 그대로)</span></h3>
        <table className="tbl"><thead><tr>{isSuper && <th></th>}<th>페이지</th><th>주소</th><th>상태</th><th>수정</th><th>7일 방문</th><th>마지막 초안</th><th>예약</th><th></th></tr></thead><tbody>
          {lays.map((r) => (
            <tr key={r.key} data-site-page-layout={r.key}>{isSuper && <td><input type="checkbox" aria-label={`${r.name} 고르기`} checked={pick.includes(r.key)} onChange={(e) => setPick(e.target.checked ? [...pick, r.key] : pick.filter((x) => x !== r.key))} data-site-page-pick={r.key} /></td>}<td><b>{r.name}</b>{(r.staleLangs ?? []).length > 0 && <small className="warn-text" data-site-page-stale={r.key}> · 다시 번역 필요({r.staleLangs!.join(', ')})</small>}</td><td className="mono">{r.path}</td>
              <td>{r.status === 'PUBLISHED' ? `게시 ${r.publishedVersion}판(${when(r.publishedAt)})` : '처음 배치'}{r.draftChanged && <b className="warn-text"> · 게시 안 한 초안</b>}</td>
              <td data-site-page-editable={r.editable ? (r.gwanOpen ? 'open' : 'on') : 'off'}>{r.editable ? (r.gwanOpen ? <span className="warn-text">가능 · 관 열림(닫아야 편집)</span> : '가능') : '불가'}
                {isSuper && <> <button className="btn-sm" onClick={() => void api(`/admin/site-layouts/${r.key}/editable`, { method: 'POST', body: JSON.stringify({ editable: !r.editable }) }).then(reload)} data-site-page-editable-toggle={r.key}>{r.editable ? '불가로' : '가능으로'}</button></>}</td>
              <td className="num-cell">{r.views7 ?? 0}</td>
              <td>{when(r.draftUpdatedAt)} · {r.draftUpdatedByName ?? '—'}</td><td>{r.scheduledAt ? `${when(r.scheduledAt)} UTC` : '—'}</td>
              <td><button className="btn-sm btn-ok" onClick={() => setEdit(r.key)} data-site-page-edit={r.key}>편집</button>{' '}
                <a className="btn-sm btn-plain" href={siteHref(r.path)} target="_blank" rel="noreferrer">보기 ↗</a></td></tr>))}
        </tbody></table>
        {/* v10.716 (docs/824) 여러 페이지 한꺼번에 예약 게시(SUPER) — 고른 페이지마다 같은 규칙 */}
        {isSuper && <div className="acts" data-site-pages-batch><span>고른 {pick.length}개를</span>
          <input type="datetime-local" value={bat} onChange={(e) => setBat(e.target.value)} aria-label="한꺼번에 예약 시각" />
          <button className="btn-sm" disabled={!pick.length || !bat} onClick={() => { setBatMsg(null); void api<{ scheduled: number; items: Array<{ key: string; ok: boolean; error?: string }> }>('/admin/site-layouts/schedule-batch', { method: 'POST', body: JSON.stringify({ keys: pick, at: new Date(bat).toISOString() }) })
            .then((r) => { setBatMsg(`예약 ${r.scheduled}개${r.items.filter((x) => !x.ok).length ? ` · 못 함: ${r.items.filter((x) => !x.ok).map((x) => `${x.key}(${x.error})`).join(' · ')}` : ''}`); setPick([]); reload(); }).catch((e) => setBatMsg(msgOf(e))); }} data-site-pages-batch-go>한꺼번에 예약 게시</button>
          {batMsg && <span className="dim">{batMsg}</span>}</div>}
      </div>
      <div className="card pad"><h3 style={{ marginTop: 0 }}>관 안 페이지 · 새 관 첫 화면 <span className="dim" style={{ fontWeight: 400 }}>— 「편집」은 이 자리에서(관 관리 › 관 하나 › 「관 페이지」와 같은 편집 화면)</span></h3>
        <table className="tbl"><thead><tr><th>관</th><th>페이지</th><th>상태</th><th>공개</th><th>수정</th><th>7일 방문</th><th>마지막 초안</th><th>예약</th><th></th></tr></thead><tbody>
          {pgs.map((p) => { const path = p.slug === 'home' ? `/g/${p.gwanCode.toLowerCase()}` : null; return (
            <tr key={p.id} data-site-page-row={p.id}><td>{p.gwanName}({p.gwanCode})</td><td>{p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`}{p.lang !== 'ko' ? ` · ${p.lang}` : ''} 「{p.title}」</td>
              <td>{PSTATUS[p.status] ?? p.status}{p.publishedVersion ? ` ${p.publishedVersion}판` : ''}</td><td>{p.visibility === 'MEMBER' ? '회원만' : '누구나'}</td>
              <td data-site-page-row-editable={p.editable ? (p.gwanOpen ? 'open' : 'on') : 'off'}>{p.editable ? (p.gwanOpen ? <span className="warn-text">가능 · 관 열림(닫아야 편집)</span> : '가능') : '불가'}{isSuper && <> <button className="btn-sm" onClick={() => void api(`/admin/gwan-pages/${p.id}/editable`, { method: 'POST', body: JSON.stringify({ editable: !p.editable }) }).then(reload)}>{p.editable ? '불가로' : '가능으로'}</button></>}</td>
              <td>{p.views7}</td>
              <td>{when(p.draftUpdatedAt)} · {p.draftUpdatedByName ?? '—'}</td><td>{p.scheduledAt ? `${when(p.scheduledAt)} UTC` : '—'}</td>
              <td><button className="btn-sm btn-ok" onClick={() => setPageEdit(p.id)} data-site-page-row-edit={p.id}>편집</button>{onGo && <> <button className="btn-sm btn-plain" onClick={() => onGo('gwans')}>관 관리로</button></>}{path && p.status === 'PUBLISHED' && <> <a className="btn-sm btn-plain" href={siteHref(path)} target="_blank" rel="noreferrer">보기 ↗</a></>}</td></tr>); })}
          {data.pages.length === 0 && <tr><td colSpan={9} className="muted">아직 관 안 페이지가 없습니다.</td></tr>}
        </tbody></table></div>
      <OpenLog />
      <Feedback />
      {!isSuper && <p className="dim">초안은 저장할 수 있고, 게시 · 예약 · 되돌리기는 최고 관리자(SUPER)가 합니다.</p>}
    </div>
  );
}
