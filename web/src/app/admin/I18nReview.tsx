/* ===== v10.523 (D278 · docs/661) 일본어 · 중국어(간체) 검수 — web/src/app/admin/I18nReview.tsx 새 파일 =====
 * 관 관리 › 일본어 · 중국어 검수(SB-ADM-OAPI-030)
 *   ADMIN · SUPER  언어마다 사전 현황(사용자 웹 · 서버 문장 · DB 문구) · 가장 최근 검수 · 켤 수 있는지 · 켜기 · 끄기(기존 POST /admin/i18n/langs/{code})
 *   SUPER          검수 기록 남기기(범위 · 승인 · 반려 · 검수자 · 메모 — 쌓기만)
 *   켜기는 SITE · SERVER 가 둘 다 승인이어야 DB 가 받음(I18N_REVIEW) · 다국어 전체(i18n.enabled)는 「번역」 · 「전체 설정」에서
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Review { id: string; lang: string; scope: string; verdict: string; reviewer: string; dictVersion: string; note: string | null; createdAt: string }
interface LangItem { code: string; native: string; exists: boolean; isActive: boolean;
  site: { state: string; keys: number; koBase: number; namespaces: number; version: string };
  server: { keys: number; enKeys: number; state: string; draftVersion: string; reviewedVersion: string | null };
  db: Record<string, number>; latest: Record<string, Review | null>; reviews: Review[]; canActivate: boolean }
interface View { enabled: boolean; version: string; items: LangItem[]; canRecord: boolean; note: string }

const SCOPE_KO: Record<string, string> = { SITE: '사용자 웹 사전', SERVER: '서버 문장', DB: 'DB 문구' };
const STATE_KO: Record<string, string> = { MACHINE_DRAFT: '기계 번역 초안(검수 전)', REVIEWED: '검수 끝' };

function RecordBox({ code, onDone }: { code: string; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ scope: 'SITE', verdict: 'APPROVED', reviewer: '', note: '' });
  return (
    <div className="card pad" data-i18nr-record={code}>
      <Flash msg={a.msg} err={a.err} />
      <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>{Object.entries(SCOPE_KO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>{' '}
      <select value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })}><option value="APPROVED">승인</option><option value="REJECTED">반려</option></select>{' '}
      <input className="inp" value={f.reviewer} onChange={(e) => setF({ ...f, reviewer: e.target.value })} placeholder="검수자 이름(2 ~ 60자)" />{' '}
      <input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="메모(반려는 꼭)" />{' '}
      <button className="btn-sm" disabled={!!a.busy || f.reviewer.trim().length < 2} onClick={() => void a.run('rc', () => api(`/admin/i18n-review/${code}`, { method: 'POST', body: JSON.stringify({ ...f, note: f.note || undefined }) }), onDone)} data-i18nr-save="">기록</button>
    </div>
  );
}

export function I18nReview() {
  const q = useApi<View>('/admin/i18n-review');
  const a = useAct();
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  return (
    <section data-i18nr="" data-i18nr-enabled={d.enabled ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt info">{d.note} 다국어 전체(i18n.enabled)는 지금 <b>{d.enabled ? '켜짐' : '꺼짐'}</b> — 꺼져 있으면 언어를 켜도 사용자 웹 언어 단추에 나오지 않습니다.</div>
      {d.items.map((l) => (
        <div className="card pad" key={l.code} data-i18nr-lang={l.code} data-i18nr-active={l.isActive ? 'on' : 'off'}>
          <b>{l.native}</b> ({l.code}) · {l.isActive ? '켜짐' : '꺼짐'}{!l.exists ? <span className="warn-text"> · 언어 표에 없음(D278 확인)</span> : null}
          <table className="tbl"><tbody>
            <tr><th>사용자 웹 사전</th><td>{n(l.site.keys)} / 바탕 {n(l.site.koBase)}문장 · 묶음 {l.site.namespaces} · {STATE_KO[l.site.state] ?? l.site.state} · 빠진 문장은 영어로</td></tr>
            <tr><th>서버 문장</th><td>{n(l.server.keys)} / 영어 {n(l.server.enKeys)} · {STATE_KO[l.server.state] ?? l.server.state} · 빠진 문장은 영어로</td></tr>
            <tr><th>DB 문구 번역</th><td>{Object.keys(l.db).length ? Object.entries(l.db).map(([k, v]) => `${k} ${v}`).join(' · ') : '없음'} — 승인은 「번역」 탭</td></tr>
            <tr><th>가장 최근 검수</th><td>{Object.entries(SCOPE_KO).map(([k, t]) => { const r = l.latest[k]; return `${t}: ${r ? `${r.verdict === 'APPROVED' ? '승인' : '반려'}(${r.reviewer} · ${r.dictVersion})` : '없음'}`; }).join(' · ')}</td></tr>
          </tbody></table>
          <p>
            {l.isActive
              ? <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run('off' + l.code, () => api(`/admin/i18n/langs/${l.code}`, { method: 'POST', body: JSON.stringify({ isActive: false }) }), q.reload)} data-i18nr-off="">끄기</button>
              : <button className="btn-sm" disabled={!!a.busy || !l.canActivate} title={l.canActivate ? '' : '사이트 · 서버 문장 검수 승인이 있어야 켤 수 있습니다'} onClick={() => { if (confirm(`${l.native} 를 켭니다. 다국어 전체가 켜져 있으면 바로 언어 단추에 나옵니다.`)) void a.run('on' + l.code, () => api(`/admin/i18n/langs/${l.code}`, { method: 'POST', body: JSON.stringify({ isActive: true }) }), q.reload); }} data-i18nr-on="">켜기</button>}
          </p>
          {d.canRecord && <RecordBox code={l.code} onDone={q.reload} />}
          {!!l.reviews.length && (
            <table className="tbl" data-i18nr-reviews={l.reviews.length}><thead><tr><th>때</th><th>범위</th><th>판정</th><th>검수자</th><th>판</th><th>메모</th></tr></thead>
              <tbody>{l.reviews.map((r) => <tr key={r.id}><td>{ymdhm(r.createdAt)}</td><td>{SCOPE_KO[r.scope] ?? r.scope}</td><td>{r.verdict === 'APPROVED' ? '승인' : '반려'}</td><td>{r.reviewer}</td><td>{r.dictVersion}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table>
          )}
        </div>
      ))}
    </section>
  );
}
