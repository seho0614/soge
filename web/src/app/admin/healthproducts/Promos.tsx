import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface Promo {
  id: string; tag: string; title: string; titleEm: string | null; body: string | null; linkUrl: string; cta: string;
  isSample: boolean; isActive: boolean; startsAt: string | null; endsAt: string | null; sortOrder: number; live: boolean;
}

const EMPTY_PROMO = { tag: '', title: '', titleEm: '', body: '', linkUrl: '/health', cta: '지금 바로 보기', startsAt: '', endsAt: '', sortOrder: '0', isSample: true };

const dt = (s: string) => (s ? new Date(s).toISOString() : null);

/** v10.31 (합침) — 소개몰 「오늘의 건강상품」 특가 배너(hlt_promos). 켬 · 기간 안인 것이 사용자 웹에 나옵니다(최대 5개 · 순서대로). */
export function Promos() {
  const list = useApi<Promo[]>('/admin/health/promos');
  const a = useAct();
  const [nw, setNw] = useState(EMPTY_PROMO);
  const patch = (p: Promo, body: Record<string, unknown>, ok: string) =>
    void a.run(p.id, () => api(`/admin/health/promos/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }), list.reload, ok);
  const add = () => void a.run('add', () => api('/admin/health/promos', { method: 'POST', body: JSON.stringify({
    tag: nw.tag.trim(), title: nw.title.trim(), titleEm: nw.titleEm.trim() || null, body: nw.body.trim() || null, linkUrl: nw.linkUrl.trim(),
    cta: nw.cta.trim() || undefined, isSample: nw.isSample, startsAt: dt(nw.startsAt), endsAt: dt(nw.endsAt), sortOrder: Number(nw.sortOrder) || 0 }) }),
    () => { setNw(EMPTY_PROMO); list.reload(); }, '배너를 더했습니다.');
  return (
    <div data-screen="SB-ADM-HPR-010" data-hlt-promos="">
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">특가 배너 <em>{(list.data ?? []).filter((p) => p.live).length}</em> 노출 중</h3>
      <div className="word-add" style={{ flexWrap: 'wrap' }}>
        <input value={nw.tag} onChange={(e) => setNw({ ...nw, tag: e.target.value })} placeholder="머리 글(30자)" aria-label="머리 글" maxLength={30} />
        <input value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} placeholder="제목(40자)" aria-label="제목" maxLength={40} />
        <input value={nw.titleEm} onChange={(e) => setNw({ ...nw, titleEm: e.target.value })} placeholder="제목 강조(선택)" aria-label="제목 강조" maxLength={40} />
        <input value={nw.body} onChange={(e) => setNw({ ...nw, body: e.target.value })} placeholder="설명(80자 · 선택)" aria-label="설명" maxLength={80} />
        <input value={nw.linkUrl} onChange={(e) => setNw({ ...nw, linkUrl: e.target.value })} placeholder="/health/…" aria-label="이동 주소" />
        <input value={nw.cta} onChange={(e) => setNw({ ...nw, cta: e.target.value })} placeholder="단추 글" aria-label="단추 글" maxLength={20} />
        <label className="muted">시작 <input type="datetime-local" value={nw.startsAt} onChange={(e) => setNw({ ...nw, startsAt: e.target.value })} aria-label="시작" /></label>
        <label className="muted">끝 <input type="datetime-local" value={nw.endsAt} onChange={(e) => setNw({ ...nw, endsAt: e.target.value })} aria-label="끝" /></label>
        <input value={nw.sortOrder} onChange={(e) => setNw({ ...nw, sortOrder: e.target.value })} aria-label="순서" style={{ width: 60 }} />
        <label className="muted"><input type="checkbox" checked={nw.isSample} onChange={(e) => setNw({ ...nw, isSample: e.target.checked })} /> 견본 문구(광고 심의 확인 전)</label>
        <button className="btn-sm btn-ok" disabled={a.busy === 'add' || !nw.tag.trim() || !nw.title.trim() || !/^\/health(\/|$)/.test(nw.linkUrl.trim())} onClick={add}>+ 배너 더하기</button>
      </div>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <table className="tbl" data-promos>
        <thead><tr><th>순서</th><th>머리 글 · 제목</th><th>이동</th><th>기간</th><th>견본 문구</th><th>상태</th><th /></tr></thead>
        <tbody>
          {(list.data ?? []).map((p) => (
            <tr key={p.id} data-promo={p.id}>
              <td className="num-cell">{p.sortOrder}</td>
              <td><span className="muted">{p.tag}</span><br /><b>{p.title}</b>{p.titleEm && <> <em>{p.titleEm}</em></>}{p.body && <div className="dim">{p.body}</div>}</td>
              <td className="mono">{p.linkUrl}<div className="dim">{p.cta}</div></td>
              <td>{p.startsAt ? ymdhm(p.startsAt) : '처음부터'} ~ {p.endsAt ? ymdhm(p.endsAt) : '끝 없음'}</td>
              <td><label><input type="checkbox" checked={p.isSample} disabled={a.busy === p.id}
                onChange={() => patch(p, { isSample: !p.isSample }, p.isSample ? '견본 표시를 뗐습니다(심의 확인 뒤).' : '견본 표시를 붙였습니다.')} /> {p.isSample ? '붙임' : ''}</label></td>
              <td><span className={`st ${p.live ? 'ok' : 'no'}`}>{p.live ? '노출 중' : p.isActive ? '기간 밖' : '꺼짐'}</span></td>
              <td><button className="btn-sm" disabled={a.busy === p.id} onClick={() => patch(p, { isActive: !p.isActive }, p.isActive ? '배너를 껐습니다.' : '배너를 켰습니다.')}>{p.isActive ? '끄기' : '켜기'}</button></td>
            </tr>
          ))}
          {list.data && list.data.length === 0 && <tr><td colSpan={7} className="dim">배너가 없습니다 — 사용자 웹 소개몰 메인의 특가 배너 자리가 비어 보입니다.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 8 }}>건강기능식품 기능성 문구는 인정 범위 · 광고 심의를 확인한 뒤 「견본 문구」 표시를 뗍니다. 주소는 소개몰(/health) 안만 받습니다.</p>
    </div>
  );
}
