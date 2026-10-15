import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

interface Item { view: string; count: number; ok: boolean; note: string | null }
interface Res { total: number; ok: number; broken: number; items: Item[]; note: string | null }

/**
 * SB-ADM-INV-010 불변식 현황
 *
 * 감시 뷰를 한 번에 훑습니다. **전부 0이어야 정상입니다** —
 * 숫자가 있으면 그것이 지금 잘못돼 있다는 뜻입니다.
 * 검정(배포 전)과 다릅니다. 이 화면은 **지금 이 순간의 상태**입니다.
 */
export function Invariants() {
  const r = useApi<Res>('/admin/invariants');
  const [all, setAll] = useState(false);
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const bad = d.items.filter((i) => !i.ok);
  const good = d.items.filter((i) => i.ok);

  return (
    <section>
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <div className="kpi4">
        <div><b>{n(d.total)}</b><span>감시 항목</span></div>
        <div><b className="good">{n(d.ok)}</b><span>정상</span></div>
        <div><b className={d.broken > 0 ? 'bad' : ''}>{n(d.broken)}</b><span>확인 필요</span></div>
        <div><b>{bad.reduce((s, i) => s + Number(i.count), 0)}</b><span>걸린 건수 합</span></div>
      </div>
      <p className="card"><b>전부 0이어야 정상입니다.</b> 숫자가 있으면 그것이 지금 잘못돼 있다는 뜻입니다.{d.note && <> {d.note}</>}</p>

      <h3 className="sec">확인 필요 <em>{bad.length}</em></h3>
      {bad.length === 0 ? <p className="muted">걸린 항목이 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>감시 항목</th><th>건수</th><th>무엇이 잘못됐나</th></tr></thead>
          <tbody>
            {bad.map((i) => (
              <tr key={i.view}><td className="mono">{i.view}</td><td className="num-cell"><b className="warn-text">{n(i.count)}</b></td><td>{i.note}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card warn">
        <b>간주 모드(assume) 때문에 걸린 항목은 계약이 끝나면 자동으로 풀립니다</b> — v_assumed_on · v_bank_assumed · v_company_account 가 그 예입니다.
        그 밖의 항목은 지금 고쳐야 할 상태입니다.
      </p>

      <h3 className="sec">정상 <em>{good.length}</em>{' '}
        <button className="linkbtn" onClick={() => setAll(!all)}>{all ? '접기' : '모두 보기'}</button></h3>
      <table className="tbl">
        <thead><tr><th>감시 항목</th><th>무엇을 보나</th></tr></thead>
        <tbody>
          {(all ? good : good.slice(0, 8)).map((i) => <tr key={i.view}><td className="mono">{i.view}</td><td className="muted">{i.note}</td></tr>)}
        </tbody>
      </table>
    </section>
  );
}
