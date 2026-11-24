import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.315 (docs/439) — 오픈 체크리스트 › 「간주 모드 끄는 순서」(관리자 스위치 바로 위 · 읽기만)
 *
 *   간주 4개마다 서버가 끌 때 실제로 보는 조건(SWITCH_RULES · 세금계산서 업체 주소 · 키 · 7일 시험 · 수금 계좌)과
 *   업체 진행표(신청 · 키 · 시험 · 연결 날짜) · 키 등록을 한 줄로 — 「끌 수 있음」 / 「아직 — 빠진 것」 (GET /admin/assume-readiness).
 *   키 · 주소 값은 받지 않음(있음 / 없음만). 끄기는 아래 「관리자 스위치」(서버가 같은 조건을 다시 봄).
 *
 * v10.786 (docs/895) — 줄마다 「끄면 달라지는 것」 펼침(간주 끄기 리허설 · 읽기만): 간주로 남은 기록 수 · 바뀌는 동작 · 끈 뒤 할 일 ·
 *   연결 어댑터 REAL / STUB · 외부 연동 상태 경고. 끄지 않고 미리 봄.
 */
interface Step { label: string; ok: boolean; must: boolean; now: string }
interface Rehearsal {
  adapter: { code: string; name: string; adapter: string; status: string } | null;
  records: { label: string; n: number }[]; changes: string[]; after: string[]; warn: string[];
}
interface Row { order: number; key: string; label: string; value: string; off: boolean; ready: boolean; missing: string[]; steps: Step[]; rehearsal?: Rehearsal }

function RehearsalView({ k, h }: { k: string; h: Rehearsal }) {
  const total = h.records.reduce((a, r) => a + r.n, 0);
  return (
    <details data-assume-rehearsal={k} data-rehearsal-records={total} data-rehearsal-warn={h.warn.length} style={{ marginTop: 6 }}>
      <summary>끄면 달라지는 것 — 간주 기록 {total}건{h.warn.length ? ` · 경고 ${h.warn.length}` : ''}</summary>
      {h.adapter && (
        <div className="dim" data-rehearsal-adapter={`${h.adapter.code}:${h.adapter.adapter}`}>
          연결 어댑터 {h.adapter.name}({h.adapter.code}) — {h.adapter.adapter === 'REAL' ? '실제 구현 있음(REAL)' : `${h.adapter.adapter}(실제 구현 없음)`} · 외부 연동 상태 {h.adapter.status}
        </div>
      )}
      {h.warn.map((w) => <div key={w} className="warn-text" data-rehearsal-warn-line>⚠ {w}</div>)}
      <div><b>바뀌는 동작</b></div>
      <ul style={{ margin: '2px 0 4px 18px' }}>{h.changes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div><b>간주로 남은 기록</b></div>
      <ul style={{ margin: '2px 0 4px 18px' }}>
        {h.records.length === 0 ? <li className="muted">해당 표 없음</li>
          : h.records.map((r) => <li key={r.label} data-rehearsal-rec={r.n}>{r.label} — <b>{r.n}</b>건</li>)}
      </ul>
      <div><b>끈 뒤 할 일</b></div>
      <ul style={{ margin: '2px 0 0 18px' }}>{h.after.map((a) => <li key={a}>{a}</li>)}</ul>
    </details>
  );
}

export function AssumeReadiness() {
  const q = useApi<{ rows: Row[]; note: string }>('/admin/assume-readiness');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  return (
    <section className="card" data-assume-readiness={q.data.rows.map((r) => `${r.key}:${r.off ? 'off' : r.ready ? 'ready' : 'wait'}`).join('|')} style={{ margin: '10px 0' }}>
      <b>간주 모드 끄는 순서</b> <small className="dim">{q.data.note}</small>
      <table className="tbl" style={{ marginTop: 6 }}>
        <thead><tr><th>#</th><th>간주</th><th>지금</th><th>끌 수 있나</th><th>조건 · 지금 상태</th></tr></thead>
        <tbody>
          {q.data.rows.map((r) => (
            <tr key={r.key} data-assume-row={r.key} data-assume-state={r.off ? 'off' : r.ready ? 'ready' : 'wait'}>
              <td>{r.order}</td>
              <td>{r.label}<br /><span className="mono dim">{r.key}</span></td>
              <td>{r.off ? <b>꺼짐(실제로 돎)</b> : '켜짐(간주)'}</td>
              <td>{r.off ? <span className="muted">이미 끔</span> : r.ready ? <b className="form-ok">끌 수 있음</b>
                : <span className="warn-text">아직 — {r.missing.join(' · ')}</span>}</td>
              <td>
                {r.steps.map((s) => (
                  <div key={s.label} data-assume-step={`${s.ok ? 'ok' : s.must ? 'todo' : 'info'}`}>
                    <span className={s.ok ? 'form-ok' : s.must ? 'warn-text' : 'muted'}>{s.ok ? '✓' : s.must ? '✗' : '·'}</span> {s.label}{s.must ? '' : '(참고)'} — <span className="dim">{s.now}</span>
                  </div>
                ))}
                {r.rehearsal && <RehearsalView k={r.key} h={r.rehearsal} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
