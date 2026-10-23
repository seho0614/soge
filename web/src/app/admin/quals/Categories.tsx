import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { CategoryMaster } from './CategoryMaster';

interface Rule {
  categoryCode: string; categoryName: string;
  requiredDoc: string; legalBasis: string; needsLookup?: boolean; pending: number;
}

interface Property {
  listingId: string; title: string; company: string | null;
  brokerRegNo: string | null; sido: string | null; sigungu: string | null;
  dealType: string | null; price: string | null; brokerOk: boolean;
}

export function Categories() {
  const rules = useApi<Rule[]>('/admin/qualifications/rules');
  const props = useApi<Property[]>('/admin/qualifications/properties');
  const a = useAct();

  async function decideProp(listingId: string, approve: boolean) {
    const reason = approve ? undefined : prompt('반려 사유 — 무엇이 부족한지까지 적어 주십시오') ?? '';
    if (!approve && !reason?.trim()) return;
    await a.run(listingId, () => api(`/admin/qualifications/properties/${listingId}/decide`, {
      method: 'POST', body: JSON.stringify({ approve, reason }),
    }), props.reload, approve ? '매물을 공개했습니다.' : '반려했습니다.');
  }

  if (rules.error) return <ErrorView error={rules.error} onRetry={rules.reload} />;

  return (
    <>
      {/* v10.32 — 제목 · 설명은 위 제목 줄(SUB_PAGE 'quals/cats') */}
      <CategoryMaster />

      <h2>규제 분야 기준 <em>{(rules.data ?? []).length}</em></h2>
      <p className="lead">카테고리가 필요한 자격을 정합니다 — 자격 심사(T-21)의 기준입니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>분야</th><th>필요 서류</th><th>근거</th><th>발급처 조회</th><th>대기</th></tr></thead>
        <tbody>
          {(rules.data ?? []).map((r) => (
            <tr key={r.categoryCode}>
              <td><b>{r.categoryName}</b> <span className="mono">{r.categoryCode}</span></td>
              <td className="muted">{r.requiredDoc}</td>
              <td className="muted">{r.legalBasis.includes('불가') ? <b className="warn-text">{r.legalBasis}</b> : r.legalBasis}</td>
              <td>{r.needsLookup ? '필수' : '—'}</td>
              <td className="num-cell">{r.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>대부 · 다단계는 심사 대상이 아니라 등록 금지입니다.</b> 승인하려 해도 DB 가 막습니다.
      </p>

      <h2>매물 심사 <em>{(props.data ?? []).length}</em></h2>
      <p className="card warn">
        <b>자격 없는 사람이 매물을 올리고 중개하면 무등록 중개입니다.</b> 개설등록번호와 자격 심사 통과가
        모두 있어야 공개됩니다 — DB 가 막습니다.
      </p>
      {props.error ? <ErrorView error={props.error} onRetry={props.reload} /> : null}
      {props.data && props.data.length === 0 && <p className="muted">심사 대기 중인 매물이 없습니다.</p>}
      {(props.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>매물</th><th>중개사</th><th>등록번호</th><th>지역</th><th>자격</th><th>처리</th></tr></thead>
          <tbody>
            {(props.data ?? []).map((p) => (
              <tr key={p.listingId}>
                <td><b>{p.title}</b></td>
                <td className="muted">{p.company ?? '—'}</td>
                <td className="muted">{p.brokerRegNo ?? <span className="warn-text">미제출</span>}</td>
                <td className="muted">{[p.sido, p.sigungu].filter(Boolean).join(' ')}</td>
                <td>{p.brokerOk ? <span className="badge badge-verified">통과</span> : <span className="badge badge-urgent">미통과</span>}</td>
                <td>
                  <button className="btn-sm" disabled={!p.brokerOk || !p.brokerRegNo || a.busy === p.listingId}
                          onClick={() => void decideProp(p.listingId, true)}>공개</button>{' '}
                  <button className="btn-no" disabled={a.busy === p.listingId}
                          onClick={() => void decideProp(p.listingId, false)}>반려</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>매물 주소는 시 · 군 · 구까지만 받습니다.</b> 상세주소는 그 자체로 특정 건물을 가리키고,
        공개 전 매물의 위치가 새면 분쟁이 됩니다.
      </p>
    </>
  );
}
