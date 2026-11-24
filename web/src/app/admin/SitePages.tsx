import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { siteHref } from '../../lib/siteUrl';
import { BlockList, GwanPageEditor } from './gwans/GwanPages';

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
interface Layout { sections: Array<{ key: string; show: boolean }>; texts: Record<string, string>; slides?: Record<string, Slide>; picks?: Record<string, string[]>; inserts: Record<string, Block[]> }
interface Row { key: string; name: string; path: string; status: string; publishedVersion: number | null; publishedAt: string | null; publishedByName: string | null;
  draftUpdatedAt: string | null; draftUpdatedByName: string | null; draftChanged: boolean; scheduledAt: string | null; scheduledByName: string | null;
  editable: boolean; gwanCode: string | null; gwanOpen: boolean }   // v10.701 (D322) 수정 가능 · 관 열림
interface Detail extends Omit<Row, 'name' | 'path' | 'status'> { spec: Spec; draft: Layout; published: Layout | null;
  versions: Array<{ version: number; how: string; reason: string | null; publishedAt: string; publishedByName: string | null }>;
  previews: Array<{ token: string; expiresAt: string; createdByName: string | null }>; lockReason: string | null }
interface PageRow { id: number; gwanCode: string; gwanName: string; slug: string; lang: string; title: string; status: string; publishedVersion: number | null;
  publishedAt: string | null; draftUpdatedAt: string; draftUpdatedByName: string | null; scheduledAt: string | null; visibility: string; views7: number;
  editable: boolean; gwanOpen: boolean }

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

function Editor({ k, isSuper, onBack }: { k: string; isSuper: boolean; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [l, setL] = useState<Layout | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [prods, setProds] = useState<Array<{ code: string; name: string }> | null>(null);
  const [frame, setFrame] = useState<{ token: string; mobile: boolean; tick: number } | null>(null);   // v10.703 운영 화면 안 미리보기
  const [base0, setBase0] = useState<Layout | null>(null);   // 처음 배치(차이 보기 — 게시한 판이 없을 때)
  const fill = (x: Detail) => { setD(x); setL(x.draft); setSaved(JSON.stringify(x.draft)); };
  useEffect(() => { api<Detail>(`/admin/site-layouts/${k}`).then(fill).catch((e) => setErr(msgOf(e))); }, [k]);
  useEffect(() => { if (d && !d.published && !base0) setBase0({ sections: d.spec.sections.map(([key]) => ({ key, show: true })), texts: {}, inserts: {}, ...(d.spec.slides ? { slides: Object.fromEntries(d.spec.slides.map(([x]) => [x, { show: true }])) } : {}), ...(d.spec.picks ? { picks: {} } : {}) }); }, [d, base0]);
  useEffect(() => { if (k === 'HLT' && !prods) void api<Array<{ code: string; name: string }>>('/health/products').then((r) => setProds(Array.isArray(r) ? r : [])).catch(() => setProds([])); }, [k, prods]);
  const dirty = !!l && JSON.stringify(l) !== saved;
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
  const nm = Object.fromEntries(sp.sections);
  const set = (p: Partial<Layout>) => setL({ ...l, ...p });
  const move = (i: number, dir: number) => { const j = i + dir; if (j < 0 || j >= l.sections.length) return; const n = [...l.sections]; [n[i], n[j]] = [n[j]!, n[i]!]; set({ sections: n }); };
  const ins = (at2: string) => l.inserts[at2] ?? [];
  const setIns = (at2: string, b: Block[]) => { const n = { ...l.inserts }; if (b.length) n[at2] = b; else delete n[at2]; set({ inserts: n }); };
  const total = Object.values(l.inserts).reduce((s, b) => s + b.length, 0);
  const spot = (a: string, label: string) => (
    <div style={{ margin: '4px 0 10px 24px' }}>
      <button className="btn-sm btn-plain" onClick={() => setOpen(open === a ? null : a)} data-lay-spot={a}>{open === a ? '▾' : '▸'} {label} 블록 {ins(a).length ? `(${ins(a).length})` : ''}</button>
      {open === a && <BlockList blocks={ins(a)} onChange={(b) => setIns(a, b)} max={10} />}
    </div>
  );
  const locked = !!d.lockReason;   // v10.701 (D322) 수정 불가 · 관이 열려 있음 — 서버도 막음(422)
  const diff = layoutDiff(sp, d.published ?? base0 ?? l, l);
  const openFrame = async (mobile: boolean) => {
    let tok = d.previews[0]?.token;
    if (!tok) { try { tok = (await api<{ token: string }>(`/admin/site-layouts/${k}/previews`, { method: 'POST', body: JSON.stringify({ hours: 24 }) })).token; setD(await api<Detail>(`/admin/site-layouts/${k}`)); } catch (e) { setErr(msgOf(e)); return; } }
    setFrame({ token: tok!, mobile, tick: Date.now() });
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
      {/* v10.701 (D322 · docs/809) 수정 가능 스위치 · 관 열림 규칙 */}
      <div className={`card pad${locked ? ' warn' : ''}`} data-site-layout-lock={d.lockReason ?? 'open'}>
        <b>{d.editable ? '수정 가능' : '수정 불가'}</b>{d.gwanCode && <> · 관 {d.gwanCode} {d.gwanOpen ? '열림' : '닫힘'}</>}
        {d.lockReason === 'SITE_LAYOUT_LOCKED' && <span className="warn-text"> — 최고 관리자(SUPER)가 「수정 가능」으로 바꿔야 고칠 수 있습니다.</span>}
        {d.lockReason === 'SITE_LAYOUT_GWAN_OPEN' && <span className="warn-text"> — 관이 열려 있어 고칠 수 없습니다. 관 관리 › 관 설정에서 관을 닫은(중지) 뒤 고치고, 다 고친 뒤 다시 여십시오.</span>}
        {isSuper && <> <button className="btn-sm" disabled={!!busy} data-site-layout-editable onClick={() => void run('ed', () => api<Detail>(`/admin/site-layouts/${k}/editable`, { method: 'POST', body: JSON.stringify({ editable: !d.editable }) }), d.editable ? '수정 불가로 바꿨습니다.' : '수정 가능으로 바꿨습니다.')}>{d.editable ? '수정 불가로' : '수정 가능으로'}</button></>}
        <span className="dim"> · 엔진 기능(검색 · 목록 · 주문 · 정산)은 고칠 수 없고, 글자 · 그림 · 순서 · 숨기기 · 블록 같은 디자인만 고칩니다.</span>
      </div>

      {sp.texts.length > 0 && (
        <div className="card pad" data-site-layout-texts><h3 style={{ marginTop: 0 }}>글자 <span className="dim" style={{ fontWeight: 400 }}>— 비우면 처음 글</span></h3>
          <div className="form-grid">{sp.texts.map(([tk, tn, max]) => (
            <label key={tk}><span>{tn}({max}자)</span><input value={l.texts[tk] ?? ''} maxLength={max} onChange={(e) => set({ texts: { ...l.texts, [tk]: e.target.value } })} data-lay-text={tk} /></label>))}</div></div>)}

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
              <label><span>그림 주소(비우면 처음 그림)</span><input value={s.image ?? ''} maxLength={300} onChange={(e) => put({ image: e.target.value })} placeholder="/api/v1/page-images/… 또는 https://…" /></label>
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
          if (!confirm(`지금 저장된 초안을 사용자 웹(${sp.path})에 게시합니다.\n\n바뀌는 것:\n${diff.length ? diff.slice(0, 15).join('\n') : '(게시된 판과 같음)'}`)) return;
          void run('pub', () => api<Detail>(`/admin/site-layouts/${k}/publish`, { method: 'POST' }), '게시했습니다 — 사용자 웹에 1분 안에 보입니다.');
        }}>게시</button>}
        {!isSuper && <span className="dim">게시는 최고 관리자(SUPER)가 합니다.</span>}
        <button className="btn-sm" disabled={!!busy || locked} onClick={() => { if (confirm('처음 배치(코드에 있는 배치)로 초안을 바꿉니다. 게시는 따로입니다.')) void run('def', () => api<Detail>(`/admin/site-layouts/${k}/restore`, { method: 'POST', body: JSON.stringify({ version: 0 }) }), '처음 배치로 초안을 만들었습니다.'); }} data-site-layout-default>처음 배치로 초안</button>
      </div>

      {isSuper && (
        <div className="card pad" data-site-layout-schedule><b>예약 게시</b> <span className="dim">— 지금 저장된 초안을 떠 두고 그 시각에 게시(5분 뒤 ~ 90일)</span>
          {d.scheduledAt ? <p>예약: <b>{when(d.scheduledAt)}</b>(UTC) · {d.scheduledByName ?? '—'} <button className="btn-sm btn-no" disabled={!!busy} onClick={() => void run('sch0', () => api<Detail>(`/admin/site-layouts/${k}/schedule`, { method: 'POST', body: JSON.stringify({ at: null }) }), '예약을 취소했습니다.')}>예약 취소</button></p>
            : <div className="acts"><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="예약 시각" />
              <button className="btn-sm" disabled={!!busy || !at || dirty || locked} onClick={() => void run('sch', () => api<Detail>(`/admin/site-layouts/${k}/schedule`, { method: 'POST', body: JSON.stringify({ at: new Date(at).toISOString() }) }), '예약했습니다.')}>예약</button>
              {dirty && <span className="dim">저장한 뒤 예약합니다</span>}</div>}
        </div>)}

      {/* v10.703 (docs/811) 초안 ↔ 게시 판 차이 · 운영 화면 안 미리보기 */}
      <div className="card pad" data-site-layout-diff={diff.length}><b>게시하면 바뀌는 것</b> <span className="dim">— {d.published ? `게시된 ${d.publishedVersion}판` : '처음 배치'}과 견줌{dirty ? ' · 저장 안 한 고침 포함' : ''}</span>
        {diff.length ? <ul>{diff.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="dim">바뀌는 것이 없습니다.</p>}</div>
      <div className="card pad" data-site-layout-frame={frame ? (frame.mobile ? 'mobile' : 'pc') : 'off'}><b>옆에서 보기</b> <span className="dim">— 저장된 초안을 사용자 웹 그대로(미리보기 링크 · 저장하면 다시 그림)</span>
        <div className="acts"><button className="btn-sm" onClick={() => void openFrame(false)} data-site-layout-frame-pc>PC 폭</button>
          <button className="btn-sm" onClick={() => void openFrame(true)} data-site-layout-frame-mobile>휴대폰 폭(375)</button>
          {frame && <button className="btn-sm btn-plain" onClick={() => setFrame(null)}>닫기</button>}</div>
        {frame && <div style={{ overflow: 'auto', border: '1px solid var(--sgb-line, #e5e7eb)', borderRadius: 8 }}>
          <iframe key={frame.tick} title="사용자 웹 미리보기" src={siteHref(`${sp.path}${sp.path.includes('?') ? '&' : '?'}lp=${frame.token}`)}
                  style={{ width: frame.mobile ? 375 : 1280, height: 760, border: 0, display: 'block', margin: frame.mobile ? '0 auto' : undefined }} /></div>}
      </div>

      <div className="card pad" data-site-layout-previews><b>미리보기 링크</b> <span className="dim">— 로그인 없이 저장된 초안을 봄(24시간 · 페이지마다 5개)</span>
        <div className="acts"><button className="btn-sm" disabled={!!busy} onClick={() => { setBusy('pv'); void api(`/admin/site-layouts/${k}/previews`, { method: 'POST', body: JSON.stringify({ hours: 24 }) })
          .then(() => api<Detail>(`/admin/site-layouts/${k}`)).then((x) => { setD(x); setMsg('미리보기 링크를 만들었습니다.'); }).catch((e) => setErr(msgOf(e))).finally(() => setBusy('')); }} data-site-layout-preview-new>링크 만들기</button></div>
        {d.previews.map((p) => { const u = siteHref(`${sp.path}${sp.path.includes('?') ? '&' : '?'}lp=${p.token}`); return (
          <p key={p.token}><a href={u} target="_blank" rel="noreferrer">{u.slice(0, 80)}…</a> · {when(p.expiresAt)} 까지 · {p.createdByName ?? '—'}{' '}
            <button className="btn-sm" onClick={() => void navigator.clipboard?.writeText(u)}>복사</button>{' '}
            <button className="btn-sm btn-no" onClick={() => void api(`/admin/site-layouts/${k}/previews/${p.token}`, { method: 'DELETE' }).then(() => api<Detail>(`/admin/site-layouts/${k}`)).then(setD).catch((e) => setErr(msgOf(e)))}>끊기</button></p>); })}
      </div>

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

/** v10.700 (docs/808) 페이지 목록 — 꾸밀 페이지 6 · 관 안 페이지 한 표 */
export function SitePages({ isSuper, onGo }: { isSuper: boolean; onGo?: (tab: string) => void }) {
  const { data, error, loading, reload } = useApi<{ layouts: Row[]; pages: PageRow[] }>('/admin/site-pages');
  const [edit, setEdit] = useState<string | null>(null);
  const [pageEdit, setPageEdit] = useState<number | null>(null);   // v10.704 (docs/812) 관 안 페이지 그 자리에서 편집
  if (pageEdit) return <GwanPageEditor id={pageEdit} isSuper={isSuper} onBack={() => { setPageEdit(null); reload(); }} />;
  if (edit) return <Editor k={edit} isSuper={isSuper} onBack={() => { setEdit(null); reload(); }} />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;
  return (
    <div data-site-pages={data.layouts.length + data.pages.length}>
      <div className="card pad"><h3 style={{ marginTop: 0 }}>메인 · 관 메인 · 소개몰 메인 <span className="dim" style={{ fontWeight: 400 }}>— 구역 보이기 · 순서 · 글자 · 그림 · 블록(게시 전에는 사용자 웹 그대로)</span></h3>
        <table className="tbl"><thead><tr><th>페이지</th><th>주소</th><th>상태</th><th>수정</th><th>마지막 초안</th><th>예약</th><th></th></tr></thead><tbody>
          {data.layouts.map((r) => (
            <tr key={r.key} data-site-page-layout={r.key}><td><b>{r.name}</b></td><td className="mono">{r.path}</td>
              <td>{r.status === 'PUBLISHED' ? `게시 ${r.publishedVersion}판(${when(r.publishedAt)})` : '처음 배치'}{r.draftChanged && <b className="warn-text"> · 게시 안 한 초안</b>}</td>
              <td data-site-page-editable={r.editable ? (r.gwanOpen ? 'open' : 'on') : 'off'}>{r.editable ? (r.gwanOpen ? <span className="warn-text">가능 · 관 열림(닫아야 편집)</span> : '가능') : '불가'}
                {isSuper && <> <button className="btn-sm" onClick={() => void api(`/admin/site-layouts/${r.key}/editable`, { method: 'POST', body: JSON.stringify({ editable: !r.editable }) }).then(reload)} data-site-page-editable-toggle={r.key}>{r.editable ? '불가로' : '가능으로'}</button></>}</td>
              <td>{when(r.draftUpdatedAt)} · {r.draftUpdatedByName ?? '—'}</td><td>{r.scheduledAt ? `${when(r.scheduledAt)} UTC` : '—'}</td>
              <td><button className="btn-sm btn-ok" onClick={() => setEdit(r.key)} data-site-page-edit={r.key}>편집</button>{' '}
                <a className="btn-sm btn-plain" href={siteHref(r.path)} target="_blank" rel="noreferrer">보기 ↗</a></td></tr>))}
        </tbody></table></div>
      <div className="card pad"><h3 style={{ marginTop: 0 }}>관 안 페이지 · 새 관 첫 화면 <span className="dim" style={{ fontWeight: 400 }}>— 「편집」은 이 자리에서(관 관리 › 관 하나 › 「관 페이지」와 같은 편집 화면)</span></h3>
        <table className="tbl"><thead><tr><th>관</th><th>페이지</th><th>상태</th><th>공개</th><th>수정</th><th>7일 방문</th><th>마지막 초안</th><th>예약</th><th></th></tr></thead><tbody>
          {data.pages.map((p) => { const path = p.slug === 'home' ? `/g/${p.gwanCode.toLowerCase()}` : null; return (
            <tr key={p.id} data-site-page-row={p.id}><td>{p.gwanName}({p.gwanCode})</td><td>{p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`}{p.lang !== 'ko' ? ` · ${p.lang}` : ''} 「{p.title}」</td>
              <td>{PSTATUS[p.status] ?? p.status}{p.publishedVersion ? ` ${p.publishedVersion}판` : ''}</td><td>{p.visibility === 'MEMBER' ? '회원만' : '누구나'}</td>
              <td data-site-page-row-editable={p.editable ? (p.gwanOpen ? 'open' : 'on') : 'off'}>{p.editable ? (p.gwanOpen ? <span className="warn-text">가능 · 관 열림(닫아야 편집)</span> : '가능') : '불가'}{isSuper && <> <button className="btn-sm" onClick={() => void api(`/admin/gwan-pages/${p.id}/editable`, { method: 'POST', body: JSON.stringify({ editable: !p.editable }) }).then(reload)}>{p.editable ? '불가로' : '가능으로'}</button></>}</td>
              <td>{p.views7}</td>
              <td>{when(p.draftUpdatedAt)} · {p.draftUpdatedByName ?? '—'}</td><td>{p.scheduledAt ? `${when(p.scheduledAt)} UTC` : '—'}</td>
              <td><button className="btn-sm btn-ok" onClick={() => setPageEdit(p.id)} data-site-page-row-edit={p.id}>편집</button>{onGo && <> <button className="btn-sm btn-plain" onClick={() => onGo('gwans')}>관 관리로</button></>}{path && p.status === 'PUBLISHED' && <> <a className="btn-sm btn-plain" href={siteHref(path)} target="_blank" rel="noreferrer">보기 ↗</a></>}</td></tr>); })}
          {data.pages.length === 0 && <tr><td colSpan={9} className="muted">아직 관 안 페이지가 없습니다.</td></tr>}
        </tbody></table></div>
      {!isSuper && <p className="dim">초안은 저장할 수 있고, 게시 · 예약 · 되돌리기는 최고 관리자(SUPER)가 합니다.</p>}
    </div>
  );
}
