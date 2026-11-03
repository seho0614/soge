import { useApi } from '../../lib/useApi';
import { n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

interface Row { at: string; method: string; path: string; status: number; code: string; detail: string | null; requestId: string | null }
interface Data { items: Row[]; hour: number; top: Array<{ path: string; n: number }>; note: string }

/**
 * SB-ADM-ERR-010 최근 서버 오류 (v10.182 · D171 · docs/285 · ADMIN · SUPER)
 *
 * API 가 지난 1시간 보낸 5xx 최근 50건 — 시각 · 방법 · 주소(물음표 뒤 없음 · 숫자 · uuid 지움) · 응답 번호 · 오류 종류 · 요청 번호 · 가린 설명.
 * 요청 내용 · 개인정보는 남기지 않고, API 를 다시 띄우면 지워집니다. 문제가 생기면 이 화면을 찍어 알려 주시면 원인을 찾을 수 있습니다.
 */
export function ServerErrors() {
  const q = useApi<Data>('/admin/launch-watch/server-errors');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-server-errors="">
      <p className="muted" data-server-errors-hour={String(d.hour)}>
        지난 1시간 서버 오류 <b className={d.hour ? 'warn-text' : ''}>{n(d.hour)}</b>건
        {d.top.length > 0 && <> · 많이 난 곳 {d.top.map((t) => `${t.path} ${t.n}`).join(' · ')}</>}{' '}
        <button className="btn-plain btn-sm" onClick={q.reload} data-server-errors-reload="">새로 보기</button>
      </p>
      {d.items.length === 0 ? <p className="muted">지난 1시간 서버 오류가 없습니다.</p> : (
        <table className="tbl" data-server-errors-rows="">
          <thead><tr><th>때</th><th>요청</th><th>응답</th><th>오류 종류</th><th>설명(값은 가림)</th><th>요청 번호</th></tr></thead>
          <tbody>{d.items.map((r, i) => (
            <tr key={`${r.at}-${i}`}>
              <td className="muted">{ymdhm(r.at)}</td>
              <td className="mono" style={{ fontSize: 12 }}>{r.method} {r.path}</td>
              <td className="num-cell">{r.status}</td>
              <td>{r.code}</td>
              <td className="mono" style={{ fontSize: 12, maxWidth: 420 }}>{r.detail ?? '—'}</td>
              <td className="mono dim" style={{ fontSize: 11 }}>{r.requestId ?? '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      <div className="ad-nt info">{d.note}</div>
    </section>
  );
}
