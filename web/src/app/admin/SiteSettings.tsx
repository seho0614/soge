import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Setting {
  key: string; value: string | null; description: string | null; isRequiredForOpen: boolean; valueExample?: string | null;
  hasIssue?: boolean; issue?: string | null; secret?: boolean; hasValue?: boolean; updatedAt?: string | null; updatedBy?: string | null;
}
interface Change { id: string; key: string; before: string | null; after: string | null; secret: boolean; via: 'APP' | 'DB'; reason: string | null; at: string; who: string | null; description: string | null }
interface History { items: Change[]; total: number; page: number; pageSize: number }

const group = (k: string) => k.split('.')[0] ?? k;
const short = (v: string | null | undefined) => (v == null || v === '' ? '(빈 값)' : v.length > 80 ? `${v.slice(0, 80)}…` : v);

/**
 * SB-ADM-SET-010 전체 설정 (v10.287 · D214 · docs/413 · 관리자 · 최고 관리자)
 *
 * 사이트 설정 모두를 한 화면에서 찾고 고침 — 키 · 설명 찾기 · 묶음(키 앞부분) · 오픈 필수 · 문제 있는 것.
 * 고치기는 기존 PATCH /admin/site-settings 그대로(권한 · 형식 · 켜기 전 점검은 서버가) · 사유는 기록에 남음.
 * 아래 「바뀐 기록」은 DB 트리거가 남긴 전 · 후(화면 · 서버 스크립트 · psql 모두) — 비밀 값은 가린 값만.
 */
export function SiteSettings() {
  const sets = useApi<Setting[]>('/admin/site-settings');
  const [text, setText] = useState('');
  const [grp, setGrp] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyIssue, setOnlyIssue] = useState(false);
  const [ed, setEd] = useState<null | { key: string; value: string; reason: string; secret: boolean }>(null);
  const [hKey, setHKey] = useState('');
  const [hFrom, setHFrom] = useState('');
  const [hTo, setHTo] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...(hKey ? { key: hKey } : {}), ...(hFrom ? { from: hFrom } : {}), ...(hTo ? { to: hTo } : {}), page: String(page) }).toString();
  const hist = useApi<History>(`/admin/site-settings/history?${qs}`);
  const a = useAct();

  const all = sets.data ?? [];
  const groups = useMemo(() => Array.from(new Set(all.map((s) => group(s.key)))).sort(), [all]);
  const t = text.trim().toLowerCase();
  const rows = all.filter((s) => (!grp || group(s.key) === grp)
    && (!onlyOpen || s.isRequiredForOpen) && (!onlyIssue || s.hasIssue)
    && (!t || s.key.toLowerCase().includes(t) || (s.description ?? '').toLowerCase().includes(t)));

  const save = () => {
    if (!ed) return;
    if (ed.secret && !ed.value.trim()) { a.setErr('비밀 값은 새 값을 적어야 바뀝니다(지금 값은 가려져 있습니다).'); return; }
    void a.run(`save:${ed.key}`, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: ed.key, value: ed.value, ...(ed.reason.trim() ? { reason: ed.reason.trim() } : {}) }) }),
      () => { setEd(null); sets.reload(); hist.reload(); }, '설정을 바꿨습니다 — 아래 「바뀐 기록」에 남습니다.');
  };
  const showHist = (key: string) => { setHKey(key); setPage(1); };
  const h = hist.data;
  const pages = h ? Math.max(1, Math.ceil(h.total / h.pageSize)) : 1;

  return (
    <section data-site-settings={all.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts" data-site-settings-filter>
        <input type="search" aria-label="키 · 설명 찾기" placeholder="키 · 설명 찾기" value={text} onChange={(e) => setText(e.target.value)} data-site-settings-search />
        <select aria-label="묶음" value={grp} onChange={(e) => setGrp(e.target.value)} data-site-settings-group>
          <option value="">모든 묶음</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <label><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 오픈 필수만</label>
        <label><input type="checkbox" checked={onlyIssue} onChange={(e) => setOnlyIssue(e.target.checked)} data-site-settings-issue /> 문제 있는 것만</label>
        <span className="dim" data-site-settings-count={rows.length}>{rows.length} / {all.length}개</span>
        <button className="btn-plain btn-sm" onClick={sets.reload}>새로 보기</button>
      </div>
      {sets.error ? <ErrorView error={sets.error} onRetry={sets.reload} /> : !sets.data ? <p className="muted">불러오는 중…</p> : rows.length === 0 ? <p className="muted">맞는 설정이 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>키</th><th>설명</th><th>값</th><th>바꾼 때 · 사람</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key} data-site-setting-row={s.key}>
                <td>
                  <code>{s.key}</code>
                  {s.isRequiredForOpen && <span className="badge"> 오픈 필수</span>}
                  {s.secret && <span className="badge"> 비밀 값</span>}
                  {s.hasIssue && <span className="badge badge-urgent" title={s.issue ?? ''}> 문제</span>}
                </td>
                <td className="dim">{s.description ?? ''}{s.valueExample ? ` (예: ${s.valueExample})` : ''}</td>
                <td>
                  {ed?.key === s.key ? (
                    <div data-site-setting-edit={s.key}>
                      <input value={ed.value} placeholder={ed.secret ? '새 값(지금 값은 가려져 있음)' : ''} onChange={(e) => setEd({ ...ed, value: e.target.value })} aria-label="새 값" data-site-setting-input />
                      <input value={ed.reason} placeholder="바꾸는 까닭(선택 · 기록에 남음)" maxLength={300} onChange={(e) => setEd({ ...ed, reason: e.target.value })} aria-label="까닭" data-site-setting-reason />
                      <div className="acts">
                        <button className="btn-ok btn-sm" disabled={a.busy === `save:${s.key}`} onClick={save} data-site-setting-save>저장</button>
                        <button className="btn-sm" onClick={() => setEd(null)}>그만</button>
                      </div>
                    </div>
                  ) : <span title={s.value ?? ''} data-site-setting-value>{short(s.value)}</span>}
                </td>
                <td className="dim">{s.updatedAt ? ymdhm(s.updatedAt) : ''}{s.updatedBy ? ` · ${s.updatedBy}` : ''}</td>
                <td className="acts">
                  {ed?.key !== s.key && <button className="btn-sm" onClick={() => setEd({ key: s.key, value: s.secret ? '' : (s.value ?? ''), reason: '', secret: !!s.secret })} data-site-setting-open={s.key}>고치기</button>}
                  <button className="btn-plain btn-sm" onClick={() => showHist(s.key)} data-site-setting-history={s.key}>기록</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">권한 · 형식 · 켜기 전 점검은 서버가 합니다(최고 관리자만 바꾸는 설정은 막힘 글자가 뜹니다). 주문 받기 켜기처럼 확인 문구가 필요한 스위치는 그 화면(노출 › 메인 운영 등)에서 켜십시오.</p>

      <div className="card pad" data-site-settings-changes={h?.total ?? ''}>
        <h3>바뀐 기록</h3>
        <div className="acts">
          <input aria-label="키" placeholder="키 또는 앞부분(예: mall)" value={hKey} onChange={(e) => { setHKey(e.target.value.trim()); setPage(1); }} data-site-settings-hkey />
          <label><span>시작</span> <input type="date" value={hFrom} onChange={(e) => { setHFrom(e.target.value); setPage(1); }} /></label>
          <label><span>끝</span> <input type="date" value={hTo} onChange={(e) => { setHTo(e.target.value); setPage(1); }} /></label>
          {hKey && <button className="btn-sm" onClick={() => { setHKey(''); setPage(1); }}>모든 설정</button>}
          <button className="btn-plain btn-sm" onClick={hist.reload}>새로 보기</button>
        </div>
        {hist.error ? <ErrorView error={hist.error} onRetry={hist.reload} /> : !h ? <p className="muted">불러오는 중…</p> : h.items.length === 0 ? <p className="muted">바뀐 기록이 없습니다.</p> : (
          <table className="tbl">
            <thead><tr><th>때</th><th>키</th><th>전</th><th>후</th><th>누가</th><th>까닭</th></tr></thead>
            <tbody>
              {h.items.map((c) => (
                <tr key={c.id} data-site-setting-change={c.key}>
                  <td className="dim">{ymdhm(c.at)}</td>
                  <td><code>{c.key}</code>{c.secret && <span className="badge"> 가림</span>}</td>
                  <td title={c.before ?? ''}>{short(c.before)}</td>
                  <td title={c.after ?? ''}>{short(c.after)}</td>
                  <td className="dim">{c.who ?? (c.via === 'DB' ? '서버 · DB 직접' : '—')}</td>
                  <td className="dim">{c.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {h && pages > 1 && (
          <div className="acts" data-site-settings-pages={pages}>
            <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button>
            <span className="dim">{page} / {pages}(모두 {h.total})</span>
            <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>뒤</button>
          </div>
        )}
        <p className="hint">설정 값이 바뀔 때마다 DB 가 저절로 남깁니다(운영 화면 · 정기 작업 · 서버 스크립트 모두). 비밀 값은 가린 값만 남고, 기록은 고치거나 지울 수 없습니다.</p>
      </div>
    </section>
  );
}
