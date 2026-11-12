import { useApi } from '../../lib/useApi';
import { n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

interface Row { at: string; method: string; path: string; status: number; code: string; detail: string | null; requestId: string | null }
interface WeekTop { method: string; path: string; code: string; status: number; n: number; lastAt: string; detail: string | null; requestId: string | null }
/* v10.250 (D204 · docs/387) — 최근 7일(10분마다 DB 에 모음 · 30일 보관) */
interface Week { days: Array<{ day: string; n: number }>; total: number; top: WeekTop[] }
interface Data { items: Row[]; hour: number; top: Array<{ path: string; n: number }>; note: string; week: Week | null }

/**
 * SB-ADM-ERR-010 최근 서버 오류 (v10.182 · D171 · docs/285 · ADMIN · SUPER)
 *
 * API 가 지난 1시간 보낸 5xx 최근 50건 — 시각 · 방법 · 주소(물음표 뒤 없음 · 숫자 · uuid 지움) · 응답 번호 · 오류 종류 · 요청 번호 · 가린 설명.
 * 요청 내용 · 개인정보는 남기지 않고, API 를 다시 띄우면 지워집니다. 문제가 생기면 이 화면을 찍어 알려 주시면 원인을 찾을 수 있습니다.
 * v10.250 (D204 · docs/387) — 아래 「최근 7일」 표는 10분마다 DB 에 모은 것(30일 보관 · 다시 띄워도 남음).
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
      {d.week && (
        <div data-server-errors-week={String(d.week.total)} style={{ marginTop: 12 }}>
          <p className="muted">최근 7일 서버 오류 <b className={d.week.total ? 'warn-text' : ''}>{n(d.week.total)}</b>건 — {d.week.days.map((x) => `${x.day.slice(5)} ${x.n}`).join(' · ')}</p>
          {d.week.top.length > 0 && (
            <table className="tbl" data-server-errors-week-rows="">
              <thead><tr><th>요청</th><th>응답</th><th>오류 종류</th><th>건수</th><th>마지막</th><th>마지막 설명(값은 가림)</th><th>요청 번호</th></tr></thead>
              <tbody>{d.week.top.map((r, i) => (
                <tr key={`${r.method}-${r.path}-${r.code}-${r.status}-${i}`}>
                  <td className="mono" style={{ fontSize: 12 }}>{r.method} {r.path}</td>
                  <td className="num-cell">{r.status}</td><td>{r.code}</td><td className="num-cell">{n(r.n)}</td>
                  <td className="muted">{ymdhm(r.lastAt)}</td>
                  <td className="mono" style={{ fontSize: 12, maxWidth: 360 }}>{r.detail ?? '—'}</td>
                  <td className="mono dim" style={{ fontSize: 11 }}>{r.requestId ?? '—'}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      <div className="ad-nt info">{d.note}</div>
    </section>
  );
}
