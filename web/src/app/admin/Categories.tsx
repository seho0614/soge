import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { label } from '../../lib/codes';

interface Cat {
  id: string; gwanCode: string; code: string; name: string; status: string;
  laborLawFlag: string | null; gradeCode: string; listingCount: number; restrictedCode?: string | null;
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

  async function decide(c: Cat, status: string, flag: string) {
    setBusy(c.id); setErr(null);
    try {
      await api(`/admin/categories/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, laborLawFlag: flag, gradeCode: c.gradeCode }),
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

      <h3 className="sec">승인 대기 <em>{pending.length}</em></h3>
      {pending.length === 0 && <p className="muted">대기 중인 업종이 없습니다.</p>}
      {pending.map((c) => (
        <div key={c.id} className="card row">
          <div className="row-main">
            <strong>{c.name}</strong>
            <span className="dim">{c.gwanCode} · {c.code} · 매물 {c.listingCount}</span>
            {c.restrictedCode && <span style={{ color: 'var(--danger)', fontSize: 12.5 }}>제한업종 여부 확인 필요 ({c.restrictedCode})</span>}
          </div>
          <div className="row-act">
            <select defaultValue="" id={`f-${c.id}`}>
              <option value="" disabled>직업안정법 판정</option>
              {LABOR.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <button
              className="btn-ok" disabled={busy === c.id}
              onClick={() => {
                const el = document.getElementById(`f-${c.id}`) as HTMLSelectElement;
                if (!el.value) { setErr('직업안정법 판정을 먼저 선택하십시오.'); return; }
                decide(c, 'APPROVED', el.value);
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
