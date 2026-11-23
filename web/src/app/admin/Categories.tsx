import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { label } from '../../lib/codes';

interface Cat {
  id: string; gwanCode: string; code: string; name: string; status: string;
  laborLawFlag: string | null; gradeCode: string; listingCount: number; restrictedCode?: string | null;
  feeBearer?: string | null; requestedBy?: string | null; requestedByName?: string | null; axis?: string | null;   // v10.643 (D308)
}

/* v10.643 (D308 · docs/787) 새 업종 추가 · 승인 칸 부담 주체 */
interface GwanRow { code: string; name: string; isHub: boolean }
const BEARER = [['SELLER', '판매자(등록자)'], ['BUYER', '구매자(요청자)'], ['NEGOTIABLE', '협의']] as const;
const AXIS = [['EQUIP', '기계 · 설비 · 시설'], ['RE', '부동산'], ['SOLAR', '태양광'], ['CONSULT', '생활 · 금융 상담']] as const;

function NewCategory({ onDone }: { onDone: () => void }) {
  const gw = useApi<GwanRow[]>('/admin/gwans/manage');
  const [f, setF] = useState({ gwanCode: '', code: '', name: '', laborLawFlag: '', laborLawMemo: '', feeBearer: '', axis: '', restrictedCode: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pick = (gw.data ?? []).filter((g) => !g.isHub && g.code !== 'LED');   // 허브 관 · 소개리드는 업종을 따로 두지 않음(DB 도 막음)
  async function save() {
    setErr(null); setMsg(null);
    if (!f.gwanCode || !f.code || !f.name.trim() || !f.laborLawFlag) { setErr('관 · 코드 · 이름 · 직업안정법 판정은 꼭 넣습니다.'); return; }
    setBusy(true);
    try {
      const body: Record<string, string> = { gwanCode: f.gwanCode, code: f.code.trim().toUpperCase(), name: f.name.trim(), laborLawFlag: f.laborLawFlag };
      for (const k of ['laborLawMemo', 'feeBearer', 'axis', 'restrictedCode'] as const) if (f[k].trim()) body[k] = f[k].trim();
      await api('/admin/categories', { method: 'POST', body: JSON.stringify(body) });
      setMsg(`「${body.name}」을(를) 승인 대기로 만들었습니다 — 다른 관리자가 승인합니다.`);
      setF({ ...f, code: '', name: '', laborLawMemo: '', restrictedCode: '' });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '만들지 못했습니다.');
    } finally { setBusy(false); }
  }
  return (
    <details className="card pad" data-cat-new>
      <summary><b>새 업종 추가</b> <span className="dim">— 승인 대기로 만들고, 만든 사람이 아닌 다른 관리자가 승인합니다 · 관은 만든 뒤 바꿀 수 없습니다</span></summary>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      <div className="form-grid">
        {gw.error
          ? /* 관 목록(/admin/gwans/manage)은 SUPER 만 — ADMIN 은 관 코드를 직접 넣음(허브 · 소개리드는 서버가 막음) */
            <label>관 코드 <input value={f.gwanCode} onChange={(e) => setF({ ...f, gwanCode: e.target.value.toUpperCase() })} placeholder="예: MNY" maxLength={4} data-cat-new-gwan /></label>
          : <label>관 <select value={f.gwanCode} onChange={set('gwanCode')} data-cat-new-gwan>
              <option value="">고르기</option>
              {pick.map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}
            </select></label>}
        <label>업종 코드 <input value={f.code} onChange={set('code')} placeholder="예: MNY_CLEANING (대문자 · 숫자 · 밑줄)" maxLength={40} /></label>
        <label>업종 이름 <input value={f.name} onChange={set('name')} placeholder="예: 청소" maxLength={40} /></label>
        <label>직업안정법 판정 <select value={f.laborLawFlag} onChange={set('laborLawFlag')}>
          <option value="">고르기</option>
          {LABOR.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select></label>
        <label>판정 근거 메모 <input value={f.laborLawMemo} onChange={set('laborLawMemo')} maxLength={500} /></label>
        <label>소개비 부담 주체 <select value={f.feeBearer} onChange={set('feeBearer')}>
          <option value="">나중에(승인 때)</option>
          {BEARER.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select></label>
        {f.gwanCode === 'MAL' && (
          <label>안심소개 축 <select value={f.axis} onChange={set('axis')}>
            <option value="">고르기</option>
            {AXIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select></label>
        )}
        <label>제한업종 코드(있으면) <input value={f.restrictedCode} onChange={set('restrictedCode')} placeholder="예: INSURANCE" /></label>
      </div>
      <button className="btn-ok" disabled={busy} onClick={save} data-cat-new-save>승인 대기로 만들기</button>
    </details>
  );
}

/* v10.646 (D309 · docs/791) 다른 관 업종 가져오기 — 옮기지 않고 같은 이름 · 판정 · 부담 주체로 넣을 관에 「승인 대기」 복사(다른 관리자가 승인) */
function CopyCategory({ cats, onDone }: { cats: Cat[]; onDone: () => void }) {
  const gw = useApi<GwanRow[]>('/admin/gwans/manage');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [axis, setAxis] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const targets = (gw.data ?? []).filter((g) => !g.isHub && g.code !== 'LED');
  const have = new Set(cats.filter((c) => c.gwanCode === to).map((c) => c.name));
  const src = cats.filter((c) => c.gwanCode !== to && c.status === 'APPROVED' && (!q.trim() || c.name.includes(q.trim()) || c.code.includes(q.trim().toUpperCase())));
  async function run() {
    setErr(null); setMsg(null);
    if (!to || picked.length === 0) { setErr('넣을 관과 가져올 업종을 고르십시오.'); return; }
    if (to === 'MAL' && !axis) { setErr('안심소개(MAL)로 가져올 때는 축을 고릅니다.'); return; }
    setBusy(true);
    const done: string[] = []; const fail: string[] = [];
    for (const id of picked) {
      const c = cats.find((x) => x.id === id);
      try { await api('/admin/categories/copy', { method: 'POST', body: JSON.stringify({ fromId: id, gwanCode: to, ...(to === 'MAL' ? { axis } : {}) }) }); done.push(c?.name ?? id); }
      catch (e) { fail.push(`${c?.name ?? id}: ${e instanceof ApiFailure ? e.body.message : '실패'}`); }
    }
    setBusy(false); setPicked([]);
    if (done.length) setMsg(`${done.length}개를 승인 대기로 가져왔습니다(${done.join(' · ')}) — 다른 관리자가 승인합니다.`);
    if (fail.length) setErr(fail.join(' / '));
    onDone();
  }
  return (
    <details className="card pad" data-cat-copy>
      <summary><b>다른 관 업종 가져오기</b> <span className="dim">— 이미 있는 업종을 옮기지 않고, 같은 이름 · 판정 · 부담 주체로 넣을 관에 「승인 대기」로 만듭니다</span></summary>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
      <div className="form-grid">
        {gw.error
          ? <label>넣을 관 코드 <input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} maxLength={4} data-cat-copy-to /></label>
          : <label>넣을 관 <select value={to} onChange={(e) => { setTo(e.target.value); setPicked([]); }} data-cat-copy-to>
              <option value="">고르기</option>
              {targets.map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}
            </select></label>}
        <label>찾기 <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업종 이름 · 코드" /></label>
        {to === 'MAL' && <label>안심소개 축 <select value={axis} onChange={(e) => setAxis(e.target.value)}>
          <option value="">고르기</option>{AXIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>}
      </div>
      {to && (
        <div className="ad-tw" style={{ maxHeight: 280, overflow: 'auto' }}><table className="tbl">
          <thead><tr><th></th><th>업종</th><th>지금 관</th><th>판정</th></tr></thead>
          <tbody>
            {src.slice(0, 200).map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" aria-label={`${c.name} 가져오기`} disabled={have.has(c.name)} checked={picked.includes(c.id)}
                           onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} data-cat-copy-pick={c.code} /></td>
                <td>{c.name} <span className="dim">{c.code}</span>{have.has(c.name) && <span className="dim"> · 이미 있음</span>}</td>
                <td>{c.gwanCode}</td><td>{c.laborLawFlag ? label('category.labor_law', c.laborLawFlag) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <button className="btn-ok" disabled={busy || !to || picked.length === 0} onClick={() => void run()} data-cat-copy-save>
        {picked.length ? `${picked.length}개 승인 대기로 가져오기` : '가져오기'}
      </button>
    </details>
  );
}

const LABOR = [
  ['NOT_APPLICABLE', '해당 없음'],
  ['REVIEW_REQUIRED', '검토 필요'],
  ['APPLICABLE', '등록 대상 — 승인 불가'],
] as const;

/**
 * SB-ADM-CAT-010 업종 승인
 *
 * ★ 승인 전 직업안정법 판정이 필수입니다 (A-14).
 *   판정이 없거나 APPLICABLE 이면 DB 가 승인을 거부합니다.
 *   승인 담당자가 무심코 등록 의무를 발생시키는 것을 막는 지점입니다.
 */
export function Categories() {
  const { data, error, loading, reload } = useApi<Cat[]>('/admin/categories');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  async function decide(c: Cat, status: string, flag: string, feeBearer?: string) {
    setBusy(c.id); setErr(null);
    try {
      await api(`/admin/categories/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, laborLawFlag: flag, gradeCode: c.gradeCode, ...(feeBearer ? { feeBearer } : {}) }),
      });
      reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
    } finally { setBusy(null); }
  }

  if (error) return <ErrorView error={error} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;

  const pending = data.filter((c) => c.status === 'PENDING');

  return (
    <>
      <div className="ad-nt info">
        <b>업종은 고정 목록이 아닙니다. 신청 → 승인 → 노출입니다 (A-02).</b> 승인 전에는 어디에도 나타나지 않습니다. 등급은 카테고리가 결정합니다 (A-11).
        승인하려면 <b>직업안정법 해당 여부</b>를 먼저 판정해야 합니다 — 등록 대상 업종은 승인할 수 없습니다.
      </div>
      {err && <p className="form-error">{err}</p>}

      <NewCategory onDone={reload} />
      <CopyCategory cats={data} onDone={reload} />

      <h3 className="sec">승인 대기 <em>{pending.length}</em></h3>
      {pending.length === 0 && <p className="muted">대기 중인 업종이 없습니다.</p>}
      {pending.map((c) => (
        <div key={c.id} className="card row">
          <div className="row-main">
            <strong>{c.name}</strong>
            <span className="dim">{c.gwanCode} · {c.code} · 매물 {c.listingCount}{c.axis ? ` · 축 ${c.axis}` : ''}{c.requestedByName ? ` · 만든 사람 ${c.requestedByName}(이 분은 승인할 수 없음)` : ''}</span>
            {c.restrictedCode && <span style={{ color: 'var(--danger)', fontSize: 12 }}>제한업종 여부 확인 필요 ({c.restrictedCode})</span>}
          </div>
          <div className="row-act">
            <select defaultValue="" id={`f-${c.id}`}>
              <option value="" disabled>직업안정법 판정</option>
              {LABOR.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <select defaultValue={c.feeBearer ?? ''} id={`b-${c.id}`} data-cat-bearer aria-label="소개비 부담 주체">
              <option value="">부담 주체(비우면 그대로)</option>
              {BEARER.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <button
              className="btn-ok" disabled={busy === c.id}
              onClick={() => {
                const el = document.getElementById(`f-${c.id}`) as HTMLSelectElement;
                if (!el.value) { setErr('직업안정법 판정을 먼저 선택하십시오.'); return; }
                const b = (document.getElementById(`b-${c.id}`) as HTMLSelectElement | null)?.value || undefined;
                decide(c, 'APPROVED', el.value, b);
              }}
            >승인</button>
            <button
              className="btn-no" disabled={busy === c.id}
              onClick={() => decide(c, 'REJECTED', 'REVIEW_REQUIRED')}
            >반려</button>
          </div>
        </div>
      ))}

      {/* v10.31 — 시안 「승인된 업종 N종」 표(업종 · 관 · 등급 · 등록 건수). 「전체」 보기(상태 · 직업안정법)는 개발에만 */}
      <div className="ad-flt sm" style={{ marginTop: 18 }}>
        <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>승인된 업종 {data.filter((c) => c.status === 'APPROVED').length}종</button>
        <button className={all ? 'on' : ''} onClick={() => setAll(true)}>전체 {data.length}</button>
      </div>
      <div className="ad-tw"><table className="tbl" data-cat-table>
        <thead><tr><th>업종</th><th>관</th><th>등급</th><th>상태</th><th>직업안정법</th><th>등록 건수</th></tr></thead>
        <tbody>
          {data.filter((c) => all || c.status === 'APPROVED').map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.gwanCode}</td>
              <td>{c.gradeCode ?? '—'}</td>
              <td>{label('category.status', c.status)}</td>
              <td>{c.laborLawFlag ? label('category.labor_law', c.laborLawFlag) : '—'}</td>
              <td className="num-cell">{c.listingCount}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>제한업종은 등록되지 않습니다.</b> 검수에서 제한업종 사유(RESTRICTED)로 반려되고, 같은 등록자가 3회 걸리면 등록이 7일 정지됩니다. 목록은 「정책」 · 「자동검수 규칙」에서 봅니다.</div>
    </>
  );
}
