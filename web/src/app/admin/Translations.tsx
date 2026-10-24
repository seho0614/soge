import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';

/* ════════════════════════════════════════════════════════════════════
 * SB-ADM-TRN-010 번역 — v10.93 다국어 1단계 기반 (D115 · docs/148 · docs/150)
 *   번역 목록 · 승인 / 번역 넣기(MANUAL) / 언어 켜고 끄기
 *   다국어(i18n.enabled)가 꺼져 있는 동안 손님 화면은 바뀌지 않습니다 — 미리 넣고 승인해 둡니다.
 * ════════════════════════════════════════════════════════════════════ */

type View = 'list' | 'new' | 'langs';
const TABS: SubTab<View>[] = [
  { key: 'list', label: '번역 목록 · 승인', screen: 'SB-ADM-TRN-010' },
  { key: 'new', label: '번역 넣기', screen: 'SB-ADM-TRN-010' },
  { key: 'langs', label: '언어', screen: 'SB-ADM-TRN-010' },
];
const TYPE_KO: Record<string, string> = {
  NOTICE: '공지', FAQ: '자주 묻는 질문', TERM: '약관', LISTING: '매물', REQUEST: '요청', POST: '소개광장 글', COMMENT: '댓글',
};
const FIELDS: Record<string, string[]> = {
  NOTICE: ['title', 'body'], FAQ: ['question', 'answer'], TERM: ['title', 'body'],
  LISTING: ['title', 'body'], REQUEST: ['title', 'body'], POST: ['title', 'body'], COMMENT: ['body'],
};
const FIELD_KO: Record<string, string> = { title: '제목', body: '본문', question: '질문', answer: '답' };
const ST_KO: Record<string, string> = {
  DRAFT: '승인 대기', APPROVED: '승인', AUTO_APPROVED: '자동 승인', MACHINE: '기계 번역', REJECTED: '반려',
};

interface Row {
  id: string; targetType: string; targetId: string; field: string; lang: string; text: string; status: string; engine: string;
  sourceText: string | null; sourceMissing: boolean; isStale: boolean; translatedAt: string; approvedAt: string | null; rejectReason: string | null;
}
interface Page { items: Row[]; total: number; page: number; size: number; pages: number }
interface Lang { code: string; name: string; native: string; rtl: boolean; isActive: boolean; sortOrder: number; translations: number }
interface Langs { enabled: boolean; engine: string | null; items: Lang[] }

export function Translations() {
  const [view, setView] = useState<View>('list');
  const [prefill, setPrefill] = useState<Partial<Row> | null>(null);
  return (
    <>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {view === 'list' && <List onEdit={(r) => { setPrefill(r); setView('new'); }} />}
      {view === 'new' && <NewOne prefill={prefill} onDone={() => { setPrefill(null); setView('list'); }} />}
      {view === 'langs' && <LangList />}
    </>
  );
}

function List({ onEdit }: { onEdit: (r: Row) => void }) {
  const [f, setF] = useState({ status: 'DRAFT', lang: '', targetType: '', stale: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), size: '20' }).filter(([, v]) => v)).toString();
  const r = useApi<Page>(`/admin/i18n/translations?${qs}`);
  const a = useAct();
  const approve = (x: Row) => void a.run('ap:' + x.id, () => api(`/admin/i18n/translations/${x.id}/approve`, { method: 'POST' }), r.reload, '승인했습니다.');
  const reject = (x: Row) => {
    const reason = prompt('반려 사유(2자 이상)');
    if (!reason || reason.trim().length < 2) return;
    void a.run('rj:' + x.id, () => api(`/admin/i18n/translations/${x.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), r.reload, '반려했습니다.');
  };
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };

  return (
    <>
      <h2>번역 목록 · 승인</h2>
      <p className="hint">승인한 번역만 손님 화면에 나갑니다(다국어를 켠 뒤). 원문이 고쳐지면 「낡음」이 되어 나가지 않고, 다시 넣어 승인해야 합니다. 번역문에 차단 금칙어가 있으면 승인되지 않습니다.</p>
      <div className="row-act">
        <select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="상태">
          <option value="">상태 전체</option>{Object.entries(ST_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.targetType} onChange={(e) => set('targetType', e.target.value)} aria-label="대상">
          <option value="">대상 전체</option>{Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={f.lang} onChange={(e) => set('lang', e.target.value.trim().toLowerCase())} placeholder="언어(en)" size={6} aria-label="언어" />
        <select value={f.stale} onChange={(e) => set('stale', e.target.value)} aria-label="낡음">
          <option value="">낡음 상관없이</option><option value="true">낡은 것만</option><option value="false">낡지 않은 것만</option>
        </select>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.items.length === 0 ? (
        <p className="muted">해당하는 번역이 없습니다.</p>
      ) : (
        <>
          <table className="tbl" data-i18n-list>
            <thead><tr><th>대상</th><th>언어</th><th>원문</th><th>번역</th><th>상태</th><th>넣은 때</th><th></th></tr></thead>
            <tbody>{r.data.items.map((x) => (
              <tr key={x.id}>
                <td>{TYPE_KO[x.targetType] ?? x.targetType} · {FIELD_KO[x.field] ?? x.field}<br /><span className="muted">{x.targetId.slice(0, 13)}</span></td>
                <td>{x.lang}</td>
                <td className="wrap">{x.sourceMissing ? <span className="bad">원문 없음</span> : x.sourceText}</td>
                <td className="wrap">{x.text}</td>
                <td>{ST_KO[x.status] ?? x.status}{x.isStale && <><br /><span className="bad">낡음</span></>}
                  {x.rejectReason && <><br /><span className="muted">{x.rejectReason}</span></>}</td>
                <td>{ymdhm(x.translatedAt)}</td>
                <td className="row-act">
                  {x.status !== 'APPROVED' && !x.isStale && !x.sourceMissing && (
                    <button className="btn-sm" disabled={a.busy === 'ap:' + x.id} onClick={() => approve(x)}>승인</button>)}
                  {x.status !== 'REJECTED' && <button className="btn-sm ghost" disabled={a.busy === 'rj:' + x.id} onClick={() => reject(x)}>반려</button>}
                  <button className="btn-sm ghost" onClick={() => onEdit(x)}>고치기</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          <p className="row-act">
            <button className="btn-sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span>{page} / {r.data.pages} · {n(r.data.total)}건</span>
            <button className="btn-sm ghost" disabled={page >= r.data.pages} onClick={() => setPage(page + 1)}>다음</button>
          </p>
        </>
      )}
    </>
  );
}

function NewOne({ prefill, onDone }: { prefill: Partial<Row> | null; onDone: () => void }) {
  const [f, setF] = useState({
    targetType: prefill?.targetType ?? 'NOTICE', targetId: prefill?.targetId ?? '',
    field: prefill?.field ?? 'title', lang: prefill?.lang ?? 'en', text: prefill?.text ?? '',
  });
  const [src, setSrc] = useState<string | null>(prefill?.sourceText ?? null);
  const a = useAct();
  const load = () => void a.run('src', () => api<{ sourceText: string }>(
    `/admin/i18n/source?${new URLSearchParams({ targetType: f.targetType, targetId: f.targetId.trim(), field: f.field })}`),
    undefined, '원문을 불러왔습니다.').then((r) => { if (r) setSrc(r.sourceText); });
  const save = () => {
    if (!f.targetId.trim() || !f.text.trim()) { a.setErr('대상 번호와 번역을 적으십시오.'); return; }
    void a.run('save', () => api('/admin/i18n/translations', { method: 'PUT', body: JSON.stringify({ ...f, targetId: f.targetId.trim(), text: f.text.trim() }) }),
      onDone, '넣었습니다 — 목록에서 승인하십시오.');
  };
  const typeChange = (t: string) => setF({ ...f, targetType: t, field: FIELDS[t]![0]! });

  return (
    <>
      <h2>번역 넣기</h2>
      <p className="hint">지금 엔진은 MANUAL — 운영자가 번역을 직접 넣습니다. 넣거나 고치면 다시 「승인 대기」가 됩니다. 약관의 번호는 「code@version」입니다. 금액 · 수수료 · 날짜는 원문 값 그대로 적으십시오.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="form-grid" data-i18n-form>
        <label>대상<select value={f.targetType} onChange={(e) => typeChange(e.target.value)}>
          {Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>칸<select value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}>
          {FIELDS[f.targetType]!.map((k) => <option key={k} value={k}>{FIELD_KO[k] ?? k}</option>)}</select></label>
        <label>대상 번호<input value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })} placeholder="번호(uuid) · 약관은 code@version" /></label>
        <label>언어<input value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value.trim().toLowerCase() })} size={4} /></label>
      </div>
      <p><button className="btn-sm ghost" disabled={!f.targetId.trim() || a.busy === 'src'} onClick={load}>원문 불러오기</button></p>
      {src !== null && <div className="card wrap"><b>원문</b><br />{src}</div>}
      <label className="block">번역<textarea rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
      <p><button disabled={a.busy === 'save'} onClick={save}>넣기</button> <button className="ghost" onClick={onDone}>취소</button></p>
    </>
  );
}

function LangList() {
  const r = useApi<Langs>('/admin/i18n/langs');
  const a = useAct();
  const toggle = (l: Lang) => void a.run('l:' + l.code, () => api(`/admin/i18n/langs/${l.code}`, { method: 'POST', body: JSON.stringify({ isActive: !l.isActive }) }),
    r.reload, l.isActive ? '껐습니다.' : '켰습니다.');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  return (
    <>
      <h2>언어</h2>
      <div className="kpi4">
        <div><b className={d.enabled ? 'good' : ''}>{d.enabled ? '켜짐' : '꺼짐'}</b><span>다국어(i18n.enabled)</span></div>
        <div><b>{d.engine ?? '—'}</b><span>번역 엔진</span></div>
        <div><b>{d.items.filter((x) => x.isActive).length}</b><span>켜진 언어</span></div>
        <div><b>{n(d.items.reduce((s, x) => s + x.translations, 0))}</b><span>번역 줄</span></div>
      </div>
      <p className="hint">다국어 전체 켜기는 정책(site_settings)의 i18n.enabled 입니다 — 오픈 뒤 켭니다(docs/148). 여기서 켠 언어만 손님이 고를 수 있습니다. 한국어(원문)는 끌 수 없습니다. 아랍어는 화면 좌우 반전 작업 뒤에 켭니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl" data-i18n-langs>
        <thead><tr><th>코드</th><th>이름</th><th>그 언어로</th><th>번역 줄</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((l) => (
          <tr key={l.code}>
            <td>{l.code}</td><td>{l.name}{l.rtl && <span className="muted"> · 좌우 반전</span>}</td><td>{l.native}</td>
            <td className="num-cell">{n(l.translations)}</td><td>{l.isActive ? '켜짐' : '꺼짐'}</td>
            <td>{l.code !== 'ko' && <button className="btn-sm ghost" disabled={a.busy === 'l:' + l.code} onClick={() => toggle(l)}>{l.isActive ? '끄기' : '켜기'}</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
