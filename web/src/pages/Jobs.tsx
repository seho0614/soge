import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../lib';

interface Job { name: string; schedule: string; enabled: boolean; description: string; lastRunAt: string | null; lastOk: boolean | null; lastNote: string | null; registered: boolean }

/* e1.4 (docs/004) 정기 작업(e1.3) — 주인(erp.jobs_owner) · 작업 · 손 실행(SUPER) */
export function Jobs({ isSuper }: { isSuper: boolean }) {
  const [d, setD] = useState<{ owner: string; jobs: Job[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<{ owner: string; jobs: Job[] }>('/admin/jobs').then(setD).catch((e) => setMsg(e instanceof ApiFailure ? e.message : '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);
  const run = (n: string) => api<{ ok: boolean; note: string }>(`/admin/jobs/${n}/run`, { method: 'POST', body: '{}' })
    .then((r) => { setMsg(`${n} — ${r.ok ? '성공' : '실패'} ${r.note ?? ''}`); void load(); })
    .catch((e) => setMsg(e instanceof ApiFailure ? e.message : '돌리지 못했습니다.'));
  if (!d) return <p className="dim">{msg ?? '불러오는 중…'}</p>;
  return (
    <section data-erp-jobs={d.owner}>
      <h2>정기 작업 <small className="dim">주인 {d.owner === 'ERP' ? 'ERP' : '소개뱅크(넘기기 전)'}</small></h2>
      {msg && <p className="dim" data-erp-msg>{msg}</p>}
      <table className="tbl">
        <thead><tr><th>작업</th><th>주기</th><th>마지막</th><th>결과</th><th></th></tr></thead>
        <tbody>
          {d.jobs.map((j) => (
            <tr key={j.name} data-erp-job={j.name}>
              <td><b className="mono">{j.name}</b><br /><span className="dim">{j.description}</span></td>
              <td className="mono">{j.schedule}{j.enabled ? '' : ' · 꺼짐'}</td>
              <td>{j.lastRunAt ? new Date(j.lastRunAt).toLocaleString('ko-KR') : '—'}</td>
              <td>{j.lastOk == null ? '—' : j.lastOk ? '성공' : <span className="warn-text">실패 {j.lastNote}</span>}</td>
              <td>{isSuper && j.registered && <button className="btn-plain" onClick={() => run(j.name)} data-erp-job-run={j.name}>지금 돌리기</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
