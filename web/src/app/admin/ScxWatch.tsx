/* ===== v10.590 ~ 593 (docs/732 ~ 735) 15차 보안 · 기반 — web/src/app/admin/ScxWatch.tsx 새 파일 =====
 * 위험감지 › 이상 행동 감지(SB-ADM-SCX-010 · SUPER)
 *   ⑥ 운영자 이상 행동 30일(개인정보 열람 · 내려받기 · 밤 활동) · 확인(메모 · 본인 줄 못 함) · 하루 다시 셈(알림 없음) · 기준
 *   ⑦ 유출 비밀번호 막기(off · 간주 · LIVE — LIVE 는 법무 확인 뒤) · 판정 시험
 *   ⑧ 회원 2단계 인증 열기 · ⑨ 「내가 아니에요」 몰림 기준 · 회원 보안 숫자
 * (adminMenu · App.tsx 연결 줄은 patches/2_web.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Settings { anomalyWatch: boolean; viewMin: number; exportMin: number; nightMin: number; factor: number; pwnedMode: string; pwnedMin: number; pwnedLegalOk: boolean; memberMfa: boolean; notMeSurge: number }
interface Item { id: string; day: string; email: string | null; name: string | null; kind: string; kindKo: string; n: number; avg30: number; threshold: number; reviewedAt: string | null; reviewer: string | null; note: string | null; mine: boolean }
interface View {
  settings: Settings; items: Item[]; open: number;
  runs: Array<{ day: string; runAt: string; actors: number; found: number; alerted: boolean }>;
  member: Record<string, number>; canEdit: boolean; note: string;
}
const PWNED: Record<string, string> = { off: '꺼짐(처음)', ASSUME: '간주 — 서버 안 짧은 목록만(밖으로 보내지 않음)', LIVE: 'LIVE — SHA-1 앞 5글자만 범위 조회' };

export function ScxWatch() {
  const q = useApi<View>('/admin/sec2/watch');
  const a = useAct();
  const [day, setDay] = useState('');
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [pw, setPw] = useState('');
  const [out, setOut] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings, m = d.member;
  const put = (body: Record<string, unknown>, after?: () => void) =>
    void a.run('set', () => api('/admin/sec2/settings', { method: 'PUT', body: JSON.stringify(body) }), () => { after?.(); q.reload(); });
  const ask = (label: string) => (prompt(`${label} — 사유(2 ~ 200자)`) ?? '').trim();
  const toggle = (k: string, v: unknown, label: string) => { const why = ask(label); if (why.length >= 2) put({ [k]: v, reason: why }); };

  return (
    <section data-scx-watch="" data-scx-watch-on={s.anomalyWatch ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="kpis">
        <div className="kpi"><b data-scx-open="">{d.open}</b><span>확인 안 한 이상 행동</span></div>
        <div className="kpi"><b>{m.pwnedBlock30 ?? 0}</b><span>30일 유출 비밀번호 막음</span></div>
        <div className="kpi"><b>{m.memberMfa ?? 0}</b><span>2단계 켠 회원</span></div>
        <div className="kpi"><b>{m.notMe30 ?? 0}</b><span>30일 「내가 아니에요」</span></div>
      </div>
      <div className="ad-nt info">{d.note}</div>

      <h3>운영자 이상 행동(최근 30일)</h3>
      <table className="tbl" data-scx-items={d.items.length}>
        <thead><tr><th>날짜</th><th>운영자</th><th>종류</th><th>그날</th><th>평소(30일)</th><th>기준</th><th>확인</th></tr></thead>
        <tbody>{d.items.length === 0 ? <tr><td colSpan={7} className="muted">이상 행동이 없습니다.</td></tr> : d.items.map((r) => (
          <tr key={r.id} data-scx-item={r.kind}>
            <td>{r.day}</td><td>{r.name ?? '—'} <span className="mono">{r.email}</span></td><td>{r.kindKo}</td>
            <td className="warn-text">{r.n}</td><td>{r.avg30}</td><td>{r.threshold}</td>
            <td>{r.reviewedAt ? <span title={r.note ?? ''}>{ymdhm(r.reviewedAt)} · {r.reviewer}</span>
              : d.canEdit && !r.mine ? <button className="btn-sm" disabled={!!a.busy} data-scx-review={r.id} onClick={() => {
                  const note = (prompt('확인 메모(무엇을 왜 했는지 들은 내용 · 2 ~ 200자)') ?? '').trim();
                  if (note.length >= 2) void a.run('rv', () => api(`/admin/sec2/anomalies/${r.id}/review`, { method: 'POST', body: JSON.stringify({ note }) }), q.reload);
                }}>확인</button> : r.mine ? <span className="muted">본인 — 다른 SUPER 가</span> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {d.canEdit && (
        <p data-scx-scan="">
          <input className="inp" type="date" value={day} onChange={(e) => setDay(e.target.value)} />{' '}
          <button className="btn-sm" disabled={!day || !!a.busy} onClick={() => void a.run('scan', () => api<{ found: number; added: number }>('/admin/sec2/anomalies/scan', { method: 'POST', body: JSON.stringify({ day }) }), q.reload,
            (r) => `셈했습니다 — 기준 넘음 ${r.found} · 새 줄 ${r.added}(알림 없음)`)}>하루 다시 셈</button>
          <span className="muted"> 최근 셈: {d.runs.slice(0, 3).map((r) => `${r.day} ${r.found}건${r.alerted ? '(알림)' : ''}`).join(' · ') || '없음'}</span>
        </p>
      )}

      <h3>설정</h3>
      <table className="tbl"><tbody>
        <tr><th>이상 행동 감지</th><td data-scx-set="anomaly">{s.anomalyWatch ? '켜짐 — 매일 07시 뒤 어제를 셈 · 운영 알림 STAFF_ANOMALY' : '꺼짐(처음) — 직원에게 알린 뒤 켬'}
          {d.canEdit && <> <button className="btn-sm btn-plain" onClick={() => toggle('anomalyWatch', !s.anomalyWatch, s.anomalyWatch ? '감지 끄기' : '감지 켜기')}>{s.anomalyWatch ? '끄기' : '켜기'}</button></>}</td></tr>
        <tr><th>기준</th><td>열람 {s.viewMin} · 내려받기 {s.exportMin} · 밤 활동 {s.nightMin} 이상이면서 평소의 {s.factor}배 이상</td></tr>
        <tr><th>유출 비밀번호 막기</th><td data-scx-set="pwned" data-scx-pwned={s.pwnedMode}>{PWNED[s.pwnedMode] ?? s.pwnedMode} · {s.pwnedMin}번 이상 나온 것 막음 · 법무 확인 {s.pwnedLegalOk ? '됨' : '안 됨(LIVE 못 켬)'}
          <span className="muted"> · 30일 통과 {m.pwnedPass30 ?? 0} · 조회 실패 {m.pwnedError30 ?? 0}</span></td></tr>
        <tr><th>회원 2단계 인증</th><td data-scx-set="mfa">{s.memberMfa ? '열림 — 나의공간 › 보안에서 켬' : '닫힘(처음)'}
          {d.canEdit && <> <button className="btn-sm btn-plain" onClick={() => toggle('memberMfa', !s.memberMfa, s.memberMfa ? '회원 2단계 닫기' : '회원 2단계 열기')}>{s.memberMfa ? '닫기' : '열기'}</button></>}</td></tr>
        <tr><th>낯선 로그인</th><td>30일 알림 {m.alerts30 ?? 0} · 나였어요 {m.me30 ?? 0} · 내가 아니에요 {m.notMe30 ?? 0} · 1시간 {s.notMeSurge > 0 ? `${s.notMeSurge}건 이상이면 운영 알림` : '몰림 알림 끔'}</td></tr>
      </tbody></table>
      {d.canEdit && (f == null ? (
        <p><button className="btn-sm btn-plain" data-scx-edit="" onClick={() => setF({ viewMin: String(s.viewMin), exportMin: String(s.exportMin), nightMin: String(s.nightMin), factor: String(s.factor), pwnedMode: s.pwnedMode, pwnedMin: String(s.pwnedMin), pwnedLegalOk: s.pwnedLegalOk ? 'on' : 'off', notMeSurge: String(s.notMeSurge), reason: '' })}>기준 · 방식 바꾸기</button></p>
      ) : (
        <p data-scx-form="">
          <label>열람 <input className="inp" value={f.viewMin} onChange={(e) => setF({ ...f, viewMin: e.target.value })} /></label>{' '}
          <label>내려받기 <input className="inp" value={f.exportMin} onChange={(e) => setF({ ...f, exportMin: e.target.value })} /></label>{' '}
          <label>밤 활동 <input className="inp" value={f.nightMin} onChange={(e) => setF({ ...f, nightMin: e.target.value })} /></label>{' '}
          <label>배수 <input className="inp" value={f.factor} onChange={(e) => setF({ ...f, factor: e.target.value })} /></label>{' '}
          <label>유출 막기 <select value={f.pwnedMode} onChange={(e) => setF({ ...f, pwnedMode: e.target.value })}><option value="off">꺼짐</option><option value="ASSUME">간주</option><option value="LIVE">LIVE</option></select></label>{' '}
          <label>번수 <input className="inp" value={f.pwnedMin} onChange={(e) => setF({ ...f, pwnedMin: e.target.value })} /></label>{' '}
          <label>법무 확인 <select value={f.pwnedLegalOk} onChange={(e) => setF({ ...f, pwnedLegalOk: e.target.value })}><option value="off">안 됨</option><option value="on">됨</option></select></label>{' '}
          <label>몰림 기준 <input className="inp" value={f.notMeSurge} onChange={(e) => setF({ ...f, notMeSurge: e.target.value })} /></label>{' '}
          <label>사유 <input className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="2 ~ 200자" /></label>{' '}
          <button className="btn-sm" disabled={!!a.busy} data-scx-save="" onClick={() => put({
            viewMin: Number(f.viewMin), exportMin: Number(f.exportMin), nightMin: Number(f.nightMin), factor: Number(f.factor),
            pwnedMode: f.pwnedMode, pwnedMin: Number(f.pwnedMin), pwnedLegalOk: f.pwnedLegalOk === 'on', notMeSurge: Number(f.notMeSurge), reason: f.reason,
          }, () => setF(null))}>저장</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
        </p>
      ))}
      {d.canEdit && (
        <p data-scx-pwned-test="">
          <input className="inp" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="판정해 볼 비밀번호(저장 안 함)" />{' '}
          <button className="btn-sm" disabled={!pw || !!a.busy} onClick={() => void a.run('pt', async () => {
            const r = await api<{ note: string; count: number }>('/admin/sec2/pwned/test', { method: 'POST', body: JSON.stringify({ password: pw }) });
            setOut(`${r.note}${r.count ? ` (${r.count.toLocaleString('ko-KR')}번)` : ''}`); setPw('');
            return r;
          })}>판정 시험</button>{out && <span className="mono" data-scx-pwned-out=""> {out}</span>}
        </p>
      )}
      <div className="ad-nt info">이상 행동은 숫자만 봅니다(무엇을 봤는지 본문은 감사 기록 · 개인정보 접속기록에서). 자동으로 막지 않습니다. 유출 비밀번호 LIVE 는 비밀번호 원문 · 전체 해시를 보내지 않지만 해외 서비스에 앞 5글자를 보내므로 법무 확인 · 처리방침 1.2 게시 뒤 켭니다.</div>
    </section>
  );
}
