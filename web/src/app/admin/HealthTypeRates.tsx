import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface TypeRate {
  sellerType: 'BRAND' | 'TENANT'; rate: string | number | null; note: string | null; updatedAt: string;
  sellers: number; ownRate: number; changes: number;
}
export interface RateImpact {
  scope: string; key: string; rate: number | null; days: number;
  lines: number; orders: number; sales: number; recorded: number; nowFee: number; newFee: number; diff: number; note: string;
}

export const TYPE_NAME: Record<string, string> = { BRAND: '브랜드 직영관', TENANT: '일반 입점' };

/**
 * v10.274 (docs/404) — 요율을 바꾸기 전 영향 미리보기(읽기만). 최근 30일 결제된 주문 줄을 지금 요율 · 새 요율로 셈.
 *   바꾸기 단추(갈래 · 입점 유형 · 판매자)가 저장 전에 부르고, 확인 창에 보여 줍니다. 미리보기가 안 되면 그 사실만 알리고 계속할지 묻습니다.
 */
export async function previewImpact(scope: 'SELLER' | 'TYPE' | 'CATEGORY', key: string, rate: number | null, label: string): Promise<boolean> {
  const q = `scope=${scope}&key=${encodeURIComponent(key)}&rate=${rate === null ? '' : rate}`;
  try {
    const r = await api<RateImpact>(`/admin/health/rate-impact?${q}`);
    const sign = r.diff > 0 ? '+' : '';
    const body = r.lines
      ? `최근 ${r.days}일 실제 주문(${n(r.orders)}건 · 판매액 ${n(r.sales)}원)에 적용하면\n`
        + `  지금 요율 수수료 ${n(r.nowFee)}원 → 새 요율 ${n(r.newFee)}원 (${sign}${n(r.diff)}원)\n`
        + '이미 받은 주문의 수수료는 바뀌지 않습니다 — 새 주문부터 적용.'
      : `최근 ${r.days}일 동안 이 요율이 쓰인 주문이 없습니다 — 새 주문부터 적용.`;
    return confirm(`${label} → ${rate === null ? '비움(다음 순서 요율)' : `${rate}%`}\n\n${body}\n\n바꿀까요?`);
  } catch {
    return confirm(`${label} — 영향 미리보기를 불러오지 못했습니다.\n그래도 바꿀까요?`);
  }
}

/**
 * SB-ADM-HST-010 소개몰 정산 › 입점 유형 요율 (v10.272 · D206 · docs/404)
 *   약관 제17조(입점 유형별 요율)와 맞춤 — 순서: 판매자 지정 → 입점 유형 → 갈래 → 기본 → 10%. 비어 있으면 갈래 요율을 씁니다.
 */
export function HealthTypeRates() {
  const q = useApi<TypeRate[]>('/admin/health/type-rates');
  const a = useAct();
  const change = async (t: TypeRate) => {
    const raw = prompt(`${TYPE_NAME[t.sellerType]} 판매수수료율(%) — 0 ~ 50 · 비우면 갈래 요율 · 새 주문부터 적용`, t.rate === null ? '' : String(Number(t.rate)));
    if (raw === null) return;
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && !(v >= 0 && v <= 50)) { alert('0 ~ 50 사이 숫자로 적어 주십시오.'); return; }
    if (!(await previewImpact('TYPE', t.sellerType, v, TYPE_NAME[t.sellerType]!))) return;
    const reason = prompt('바꾸는 사유(2자 이상) — 기록에 남습니다') ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`type:${t.sellerType}`, () => api<{ note: string }>(`/admin/health/type-rates/${t.sellerType}`, { method: 'PATCH', body: JSON.stringify({ rate: v, reason: reason.trim() }) }),
      q.reload, (r) => r.note);
  };
  return (
    <div className="card pad" data-type-rates={(q.data ?? []).map((t) => `${t.sellerType}:${t.rate === null ? '-' : Number(t.rate)}`).join('|')} style={{ margin: '10px 0' }}>
      <b>입점 유형 요율</b> <span className="dim">— 입점 약관 제17조 · 순서: 판매자 지정 → <b>입점 유형</b> → 갈래 → 기본 → 10% · 비어 있으면 갈래 요율</span>
      <Flash msg={a.msg} err={a.err} />
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>입점 유형</th><th>요율</th><th>판매자(판매 중 · 정지)</th><th>판매자 지정 요율 있음</th><th>바꾼 기록</th><th>바꾼 때</th><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map((t) => (
              <tr key={t.sellerType} data-type-rate={t.sellerType}>
                <td>{TYPE_NAME[t.sellerType]} <span className="mono dim">{t.sellerType}</span></td>
                <td className="num-cell">{t.rate === null ? <span className="dim">비어 있음(갈래 요율)</span> : <b>{Number(t.rate)}%</b>}</td>
                <td className="num-cell">{n(t.sellers)}곳</td>
                <td className="num-cell">{t.ownRate ? `${n(t.ownRate)}곳(그 요율이 먼저)` : '—'}</td>
                <td className="num-cell">{t.changes ? `${t.changes}건` : '—'}</td>
                <td className="dim">{t.changes ? ymdhm(t.updatedAt) : '—'}</td>
                <td><button className="btn-plain" disabled={a.busy === `type:${t.sellerType}`} onClick={() => void change(t)} data-type-rate-edit={t.sellerType}>바꾸기</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="dim" style={{ marginTop: 4 }}>바꾸기 전에 최근 30일 실제 주문으로 수수료가 얼마 달라지는지 먼저 보여 줍니다(저장 전 확인 창). 이미 받은 주문은 그대로입니다.</p>
    </div>
  );
}
