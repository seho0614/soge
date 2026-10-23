import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';

/** v10.32 — GET /admin/qualifications/category-master (시안 admptnc 세 구역) */
interface CatMaster {
  consult: Array<{ code: string; name: string; status: string; consultMode: string | null;
    publishMode: 'GATED' | 'OPEN'; state: 'OPEN' | 'PENDING' | 'LISTING_FEE' | 'INACTIVE'; legalBasis: string | null }>;
  forms: Array<{ code: string; name: string; gwanCode: string; form: string | null; formLabel: string | null; steps: number | null;
    axis: { rows: number; cols: number } | null; regulation: string | null; baseFee: number | null; services: number;
    priceInput: boolean; blocked: 'NO_FORM' | 'NO_AXES' | null }>;
  matrices: Array<{ code: string; name: string; rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; base: null }>;
}

/* ── SB-ADM-PTN-060 카테고리 마스터 (T-05 · T-06) ─────────────────────
 * v10.32 — 시안(admptnc) 순서 · 모양대로 위에 세 구역을 실제 자료로 둡니다(GET /admin/qualifications/category-master · 읽기 전용).
 *   ① 안심소개 상담 축 업종 — N종 ② 등록 폼 · 단가 (기존 카테고리) ③ 매트릭스 축
 * 그 아래 개발에만 있던 「규제 분야 기준 · 매물 심사」는 그대로 둡니다(10/10 답: 개발에만 있는 것은 남김). */
const CSL_STATE: Record<CatMaster['consult'][number]['state'], [string, string]> = {
  OPEN: ['ok', '공개'], LISTING_FEE: ['ok', '월 정액 노출형'], PENDING: ['wait', '준비 중'], INACTIVE: ['', '비활성'],
};

const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;

export function CategoryMaster() {
  const m = useApi<CatMaster>('/admin/qualifications/category-master');
  if (m.error) return <ErrorView error={m.error} onRetry={m.reload} />;
  if (!m.data) return <p className="muted">불러오는 중…</p>;
  const { consult, forms, matrices } = m.data;
  const live = consult.filter((c) => c.state !== 'INACTIVE');
  const off = consult.length - live.length;
  return (
    <div data-cat-master>
      <h3 className="ad-s2" data-cm="consult">안심소개 상담 축 업종 — {live.length}종{off ? <small className="muted" style={{ fontWeight: 500 }}> · 비활성 {off}</small> : null}</h3>
      {consult.length === 0 ? <p className="ad-empty">안심소개 상담 축 업종이 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>코드</th><th>업종</th><th>게시 방식</th><th>상태</th></tr></thead>
          <tbody>
            {consult.map((c) => {
              const [cls, label] = CSL_STATE[c.state];
              return (
                <tr key={c.code} data-csl={c.code}>
                  <td><span className="mono">{c.code}</span></td>
                  <td><b>{c.name}</b></td>
                  <td>{c.publishMode === 'GATED'
                    ? <span className="ad-bg wait" title={c.legalBasis ?? undefined}>자격 확인 (GATED)</span>
                    : <span className="ad-bg ok">일반</span>}</td>
                  <td><span className={`ad-bg ${cls}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <div className="ad-nt info"><b>업종 삭제는 비활성으로만 합니다.</b> 진행 중인 상담 신청이나 활동 중인 인증업체가 있으면 막힙니다. 게시 방식(GATED ↔ 일반) 변경은 법무 승인이 필요하고, 보험 · 의료는 일반으로 바꿀 수 없습니다.</div>

      <h3 className="ad-s2" data-cm="forms">등록 폼 · 단가 (기존 카테고리)</h3>
      {forms.length === 0 ? <p className="ad-empty">등록 폼이 걸린 카테고리가 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>카테고리</th><th>등록 폼</th><th>단계</th><th>견적 축</th><th>규제</th><th>단가 입력</th></tr></thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.code} data-form-cat={f.code} title={f.baseFee != null ? `기준 단가 ${won(f.baseFee)} · 노출 중 서비스 ${f.services}개` : undefined}>
                <td><b>{f.name}</b></td>
                <td>{f.formLabel ?? <span className="warn-text">미지정</span>}</td>
                <td>{f.steps ? `${f.steps}단계` : <span className="muted">—</span>}</td>
                <td>{f.axis ? `${f.axis.rows} × ${f.axis.cols} 구간` : f.blocked === 'NO_AXES' ? <span className="warn-text">구간 미정</span> : <span className="muted">—</span>}</td>
                <td>{f.regulation ? <span className="ad-bg wait">{f.regulation}</span> : <span className="muted">—</span>}</td>
                <td>{f.priceInput ? <span className="ad-bg ok">가능</span> : <span className="ad-bg no">막힘</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="ad-nt warn"><b>폼 유형이 지정되지 않은 카테고리는 단가 입력 자체가 막힙니다.</b> 등록 폼은 업종 마스터(categories.service_form)에 있고 DB 가 막습니다 — 파트너센터 등록 화면도 이 값을 그대로 씁니다.</div>

      {matrices.length === 0 ? (
        <>
          <h3 className="ad-s2" data-cm="matrix">매트릭스 축</h3>
          <p className="ad-empty">매트릭스 견적 업종에 구간이 없습니다.</p>
        </>
      ) : matrices.map((x) => (
        <div key={x.code} data-matrix={x.code}>
          <h3 className="ad-s2" data-cm="matrix">매트릭스 축 — {x.name} {x.rows.length}×{x.cols.length}</h3>
          <div className="ad-tw"><table className="tbl">
            <thead><tr><th>구간</th>{x.cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {x.rows.map((r) => (
                <tr key={r.key}><td><b>{r.label}</b></td>{x.cols.map((c) => <td key={c.key} className="muted">—</td>)}</tr>
              ))}
            </tbody>
          </table></div>
        </div>
      ))}
      <div className="ad-nt warn"><b>기준 금액은 아직 없습니다.</b> 축(구간)은 업종 마스터(category_matrix_axes)에 있고, 파트너가 넣는 견적 값은 이 구간만 받습니다(DB 가 막습니다). 칸마다 금액은 파트너가 서비스마다 넣습니다 — 업종 마스터에 기준 금액 칸이 생기면 여기에 보입니다.</div>
    </div>
  );
}
