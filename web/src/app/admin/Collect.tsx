import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';

interface Src {
  id: string; code: string; name: string; state: string;
  robotsOk: boolean; legalOk: boolean; intervalMs: number;
  lastRunAt?: string; blocker?: string;
}
interface Health {
  sources: number; ready: number; blocked: number;
  ingredients: number; items: number;
  rates: Array<{ code: string; name: string; items: number; matched: number; unmatched: number }>;
  stuck: Array<{ code: string; name: string; runningMin: number }>;
}

const ST: Record<string, string> = {
  STOPPED: '멈춤', READY: '준비됨', RUNNING: '수집 중', BLOCKED: '차단',
};

/**
 * SB-ADM-COL-010 수집 관리
 *
 * ── 왜 관리자에 두나 ────────────────────────────────────────────────
 * 수집은 **운영이 매일 보는 일이 아니라 가끔 켜고 끄는 일**입니다.
 * 따로 앱을 만들면 그 앱을 켜는 것부터 잊습니다.
 *
 * ── 함부로 하면 안 됩니다 ───────────────────────────────────────────
 * 남의 사이트에서 데이터를 가져오는 일이라, 잘못하면 **저작권
 * 침해이거나 업무방해**가 됩니다.
 */
export function Collect() {
  const { data: srcs, error, reload } = useApi<Src[]>('/admin/collect/sources');
  const { data: h } = useApi<Health>('/admin/collect/health');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <ErrorView error={error} />;
  if (!srcs || !h) return <p className="dim">불러오는 중…</p>;

  async function call(url: string, body: unknown, method = 'PATCH') {
    /* v10.26 (G-178) — 공용 함수 api() 로 보냅니다. 전에는 fetch 로 바로 보내 로그인 토큰(Authorization)이 빠졌고, 서버가 403 으로 거절해 눌러도 처리되지 않았습니다 */
    try {
      await api(url.replace(/^\/api\/v1/, ''), { method, body: JSON.stringify(body) });
    } catch (e) {
      setMsg(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
      return false;
    }
    setMsg(null); reload(); return true;
  }

  return (
    <div>
      {h.stuck.length > 0 && (
        <div className="notice warn">
          <b>2시간 넘게 안 끝난 수집이 {h.stuck.length}건 있습니다.</b>
          멈춘 것일 수 있습니다 — 그대로 두면 다음 실행이 막힙니다.
        </div>
      )}

      <table className="tbl">
        <tbody>
          <tr><th>수집 대상</th><td>{h.sources}곳 · 준비됨 {h.ready} · 차단 {h.blocked}</td></tr>
          <tr><th>성분 마스터</th><td>{h.ingredients}종</td></tr>
          <tr><th>수집한 품목</th><td>{h.items.toLocaleString()}건</td></tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 22 }}>수집 대상</h3>
      {msg && <p className="dim" style={{ color: '#B42318' }}>{msg}</p>}
      <table className="tbl">
        <thead>
          <tr><th>대상</th><th>robots</th><th>법무</th><th>간격</th><th>상태</th><th></th></tr>
        </thead>
        <tbody>
          {srcs.map((s) => (
            <>
              <tr key={s.id}>
                <td><b>{s.name}</b><span className="dim"> {s.code}</span></td>
                <td>{s.robotsOk ? <span className="st ok">확인</span> : <span className="st no">미확인</span>}</td>
                <td>{s.legalOk ? <span className="st ok">회신</span> : <span className="st no">대기</span>}</td>
                <td className="dim">{s.intervalMs}ms</td>
                <td>
                  <span className={`badge ${s.state === 'READY' || s.state === 'RUNNING' ? '' : 'badge-urgent'}`}>
                    {ST[s.state] ?? s.state}
                  </span>
                  {s.blocker && <span className="dim"> · {s.blocker}</span>}
                </td>
                <td>
                  <button className="btn-sm"
                    onClick={() => { setOpen(open === s.id ? null : s.id); setNote(''); setMsg(null); }}>
                    {open === s.id ? '닫기' : '관리'}
                  </button>
                </td>
              </tr>
              {open === s.id && (
                <tr key={s.id + '-f'}>
                  <td colSpan={6} style={{ background: '#FAFBFD' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {!s.robotsOk && (
                        <button className="btn-sm"
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/gate`, { kind: 'ROBOTS' })}>
                          robots 확인함
                        </button>
                      )}
                      {s.state === 'STOPPED' && s.robotsOk && s.legalOk && (
                        <button className="btn-primary"
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/state`, { state: 'READY' })}>
                          준비됨으로
                        </button>
                      )}
                      {s.state === 'READY' && (
                        <button className="btn-primary"
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/run`, {}, 'POST')}>
                          수집 실행
                        </button>
                      )}
                      {s.state !== 'BLOCKED' && (
                        <button className="btn-sm"
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/state`,
                            { state: 'BLOCKED', reason: note || '운영 판단' })}>
                          차단
                        </button>
                      )}
                      {s.state === 'BLOCKED' && (
                        <button className="btn-sm"
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/state`, { state: 'STOPPED' })}>
                          차단 해제
                        </button>
                      )}
                    </div>
                    {!s.legalOk && (
                      <div>
                        <input value={note} placeholder="법무 회신 요지 — 무엇을 근거로 여는지"
                          onChange={(e) => setNote(e.target.value)}
                          style={{ padding: 8, borderRadius: 7, width: '60%' }} />
                        <button className="btn-sm" style={{ marginLeft: 7 }}
                          onClick={() => void call(`/api/v1/admin/collect/sources/${s.code}/gate`,
                            { kind: 'LEGAL', note })}>
                          법무 회신 기록
                        </button>
                      </div>
                    )}
                    <p className="hint" style={{ marginTop: 8 }}>
                      <b>차단을 풀면 멈춤으로만 갑니다.</b> 곧바로 준비됨이 되지 않고
                      게이트를 다시 통과해야 합니다 — 왜 차단됐는지 잊고 바로
                      켜는 일을 막습니다.
                    </p>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {h.rates.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>성분 대조</h3>
          <table className="tbl">
            <thead><tr><th>대상</th><th>품목</th><th>맞음</th><th>안 맞음</th></tr></thead>
            <tbody>
              {h.rates.map((r) => (
                <tr key={r.code}>
                  <td>{r.name}</td>
                  <td>{r.items}</td>
                  <td>{r.matched}</td>
                  <td>{r.unmatched > 0 ? <b>{r.unmatched}</b> : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="notice">
            <b>안 맞은 성분이 많으면 마스터를 늘리십시오.</b>
            수집을 더 돌려도 그 성분은 계속 안 맞습니다.
          </div>
        </>
      )}

      <div className="notice">
        <b>사진 · 리뷰 본문 · HTML 원문은 담지 않습니다.</b>
        담을 컬럼 자체를 두지 않았습니다 — 담으면 저작권 문제가 되고
        지우기도 어렵습니다.
      </div>
      <div className="notice">
        <b>초 간격 · 동시 하나로 제한됩니다.</b>
        빠르게 두드리면 상대 서버에 부담을 주고 업무방해가 됩니다.
      </div>
      {/* v10.31 — 시안 안내(서버 fn_collect_gate 와 같음) */}
      <div className="notice warn">
        <b>차단을 풀면 멈춤으로만 갑니다 (INV-C5).</b> 곧바로 준비됨이 되지 않고 게이트를 다시 통과해야 합니다 — 왜 차단됐는지 잊고 바로 켜는 일을 막습니다.
      </div>
      <div className="notice">
        <b>안 맞은 성분이 많으면 마스터를 늘리십시오.</b> 수집을 더 돌려도 그 성분은 계속 안 맞습니다.
      </div>
    </div>
  );
}
