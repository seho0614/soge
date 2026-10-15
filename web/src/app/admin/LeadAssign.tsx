import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Delivery {
  deliveryId: string; partnerId: string; company: string; state: string; mode: string;
  deliveredAt: string; expiresAt: string | null; viewedAt: string | null; endReason: string | null;
  assignedBy?: string | null;
}
interface Lead {
  id: string; createdAt: string; summary: string; sido: string | null; sigungu: string | null; urgent: boolean;
  assignState: string; target: number; deadline: string | null; assignedAt: string | null; source: string;
  closeReason: string | null; categoryCode: string | null; categoryName: string | null; restrictMode: string | null;
  requester?: string | null; active?: number; viewed?: number; expired?: number; eligibleCount?: number | null;
  deliveries: Delivery[];
}
interface Settings { target: number; maxPartners: number; viewTtlHours: number; maxAgeHours: number;
  weights: Array<{ grade: string; weight: string }> }
interface LeadList { items: Lead[]; settings: Settings;
  counts: { open: number; assigned: number; unmatched: number; closed: number; legacy: number } }
interface Candidate {
  partnerId: string; company: string; grade: string; partnerStatus: string; eligible: boolean; reasons: string[];
  unpaid: string; unpaidCap: string; reserved: string; fee: string; recent30d: number;
  lastAssignedAt: string | null; weight: string; score: string;
}
interface LeadDetail extends Lead {
  candidates: Candidate[];
  /* v10.31 (합침 · W5 D071) — 리드 등급 · 알림톡 결과 */
  grade?: string | null; gradeLabel?: string | null; alimState?: string | null; alimAt?: string | null;
}
/* 알림톡 결과마다 고를 수 있는 등급(DB fn_lead_grade_guard 대역과 같음 — 대역 밖은 서버가 422) · 코드 S~G = 표시 S · A+ · A · A- · B+ · B · B- · C */
const ALIM: Record<string, string> = { NONE: '미발송', SENT: '발송함(결과 대기)', CONFIRMED: '확정', NO_RESPONSE: '미응답', FAILED: '발송 실패', CANCELED: '취소' };
const GRADE_BAND: Record<string, Array<[string, string]>> = {
  CONFIRMED: [['S', 'S'], ['A', 'A+'], ['B', 'A'], ['C', 'A-']],
  NO_RESPONSE: [['D', 'B+'], ['E', 'B'], ['F', 'B-']],
  FAILED: [['G', 'C']],
};

const ST: Record<string, string> = {
  OPEN: '배정 대기', ASSIGNED: '배정 완료', UNMATCHED: '미배정', CLOSED: '종료', LEGACY: '옛 형식',
};
const DST: Record<string, string> = { DELIVERED: '받음 · 미열람', VIEWED: '열람(과금)', EXPIRED: '기한 지남', REVOKED: '회수' };
const MODE: Record<string, string> = { AUTO: '자동', MANUAL: '운영 지정', REASSIGN: '재배정', LEGACY: '옛 형식' };
const FILTERS: Array<[string, string]> = [
  ['QUEUE', '손이 필요한 것'], ['OPEN', '배정 대기'], ['UNMATCHED', '미배정'], ['ASSIGNED', '배정 완료'],
  ['CLOSED', '종료'], ['ALL', '전체'],
];

/**
 * SB-ADM-PTN-090 리드 배정 (D008 · D018)
 *
 * 상담 신청은 휴대폰 확인을 마치면 인증업체 1곳에 자동으로 배정되고(D018), 받은 업체가 기한 안에 열지 않으면
 * 10분마다 도는 배치(lead_assign)가 다른 1곳으로 넘깁니다. 받을 업체가 없던 신청은 전달하지 않아 여기 오지 않습니다.
 * 여기서는 **자동으로 못 보낸 것**을 사람이 처리합니다 — 미배정(보낼 업체 없음) · 대기(목표 미달) ·
 * 업체가 연락이 안 될 때 거두고 다른 곳으로(재배정) · 장난 신청 종료.
 *
 * 후보와 탈락 사유는 서버(fn_lead_candidates)가 냅니다. 화면이 조건을 다시 판정하지 않습니다.
 */
export function LeadAssign() {
  const [filter, setFilter] = useState('QUEUE');
  const list = useApi<LeadList>(`/admin/leads?state=${filter}`);
  const [open, setOpen] = useState<string | null>(null);
  const a = useAct();

  const run = () => a.run('run', () => api<{ note: string }>('/admin/leads/run', { method: 'POST' }), list.reload);

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const c = list.data?.counts; const s = list.data?.settings;
  const rows = list.data?.items ?? [];
  return (
    <>
      <h2>리드 배정 <em>{c ? c.open + c.unmatched : ''}</em></h2>
      <p className="lead">
        상담 신청(안심소개 「생활·금융 상담」)은 휴대폰 확인을 마치면 인증업체 1곳에 자동 배정되고, 그 업체가 기한 안에 열지 않으면
        배치가 10분마다 다른 1곳으로 넘깁니다. 여기서는 자동으로 못 보낸 건을 처리합니다.
      </p>
      {s && (
        <p className="card">
          한 건에 <b>{s.target}곳</b>(최대 {s.maxPartners}곳) · 받은 업체가 <b>{s.viewTtlHours}시간</b> 안에 열지 않으면 다른 업체로 ·
          접수 후 {s.maxAgeHours}시간까지 자동으로 채우고, 그때까지 보낼 곳이 없으면 <b>미배정</b>으로 넘어옵니다.
          순번은 최근 30일 받은 수 ÷ 등급 가중치({s.weights.map((w) => `${w.grade} ${Number(w.weight)}`).join(' · ')})가 작은 업체부터입니다.
        </p>
      )}
      <div className="acts">
        {FILTERS.map(([k, l]) => (
          <button key={k} className={filter === k ? 'btn-ok' : 'btn-plain'} onClick={() => { setFilter(k); setOpen(null); }}>
            {l}{c && k === 'OPEN' ? ` ${c.open}` : c && k === 'UNMATCHED' ? ` ${c.unmatched}` : c && k === 'ASSIGNED' ? ` ${c.assigned}` : ''}
          </button>
        ))}
        <button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void run()}>지금 배정 돌리기</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">해당하는 상담 신청이 없습니다.</p>}
      {rows.map((l) => (
        <div key={l.id} className="card pad" data-lead={l.id}>
          <b>{l.categoryName ?? '업종 없음(옛 형식)'}</b>{' '}
          <span className="muted">{[l.sido, l.sigungu].filter(Boolean).join(' ')} · 접수 {ymdhm(l.createdAt)}</span>{' '}
          <span className={`badge ${l.assignState === 'ASSIGNED' ? 'badge-verified' : 'badge-urgent'}`}>{ST[l.assignState] ?? l.assignState}</span>
          {l.urgent && <span className="badge badge-urgent">급함</span>}
          {l.restrictMode === 'GATED' && <span className="muted"> · 자격 업종</span>}
          <p>{l.summary}</p>
          <p className="muted">
            보냄 {l.active ?? 0}/{l.target}곳 · 열람 {l.viewed ?? 0} · 기한 지남 {l.expired ?? 0}
            {l.eligibleCount != null ? ` · 지금 보낼 수 있는 업체 ${l.eligibleCount}곳` : ''}
            {l.deadline ? ` · 자동 배정 기한 ${ymdhm(l.deadline)}` : ''}
            {l.requester ? ` · 신청 ${l.requester}` : ''}
            {l.closeReason ? ` · 종료 사유: ${l.closeReason}` : ''}
          </p>
          {open === l.id
            ? <LeadPanel id={l.id} onDone={list.reload} onClose={() => setOpen(null)} />
            : <div className="acts"><button className="btn-sm" onClick={() => { a.clear(); setOpen(l.id); }}>후보 · 배정</button></div>}
        </div>
      ))}
      <p className="card warn">
        <b>배정은 요약만 보냅니다.</b> 이용료는 업체가 연락처를 <b>열람할 때</b> 생기고, 연락처는 열람한 업체에만 풀립니다.
        열람한 배정은 거둘 수 없습니다 — 연락처가 이미 넘어갔습니다.
      </p>
    </>
  );
}

function LeadPanel({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }) {
  const [d, setD] = useState<LeadDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ver, setVer] = useState(0);
  const [pick, setPick] = useState<string[]>([]);
  const [revoke, setRevoke] = useState<string[]>([]);
  const a = useAct();
  useEffect(() => {
    api<LeadDetail>(`/admin/leads/${id}`).then((r) => { setD(r); setErr(null); }).catch(setErr);
  }, [id, ver]);
  const after = () => { setPick([]); setRevoke([]); setVer((v) => v + 1); onDone(); };
  const toggle = (arr: string[], set: (v: string[]) => void, k: string) =>
    set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  if (err) return <ErrorView error={err} onRetry={() => setVer((v) => v + 1)} />;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const closed = d.assignState === 'CLOSED';

  const assign = (auto: boolean) => a.run('assign', () => api(`/admin/leads/${id}/assign`, {
    method: 'POST', body: JSON.stringify(auto ? {} : { partnerIds: pick }),
  }), after);
  const reassign = () => {
    const reason = prompt('거두는 사유 — 거둔 업체에 그대로 알립니다') ?? '';
    if (!reason.trim()) return;
    void a.run('reassign', () => api(`/admin/leads/${id}/reassign`, {
      method: 'POST', body: JSON.stringify({ deliveryIds: revoke, reason, ...(pick.length ? { partnerIds: pick } : {}) }),
    }), after);
  };
  const close = () => {
    const reason = prompt('종료 사유 — 장난 · 중복 신청 등. 아직 안 연 배정은 함께 거둡니다') ?? '';
    if (!reason.trim()) return;
    void a.run('close', () => api(`/admin/leads/${id}/close`, { method: 'POST', body: JSON.stringify({ reason }) }), after);
  };

  return (
    <div>
      <Flash msg={a.msg} err={a.err} />
      <LeadGrade d={d} onSaved={() => setVer((v) => v + 1)} />
      <h3 className="sec">배정 현황 <em>{d.deliveries.length}</em></h3>
      {d.deliveries.length === 0 ? <p className="muted">아직 보낸 업체가 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th></th><th>업체</th><th>상태</th><th>방식</th><th>보냄</th><th>열람 기한</th><th>열람</th></tr></thead>
          <tbody>
            {d.deliveries.map((x) => (
              <tr key={x.deliveryId} data-delivery={x.deliveryId}>
                <td>{x.state === 'DELIVERED' && !closed && (
                  <input type="checkbox" aria-label={`${x.company} 거두기`} checked={revoke.includes(x.deliveryId)}
                         onChange={() => toggle(revoke, setRevoke, x.deliveryId)} />)}</td>
                <td><b>{x.company}</b></td>
                <td>{DST[x.state] ?? x.state}{x.endReason ? <><br /><span className="muted">{x.endReason}</span></> : null}</td>
                <td className="muted">{MODE[x.mode] ?? x.mode}{x.assignedBy ? ` · ${x.assignedBy}` : ''}</td>
                <td className="muted">{ymdhm(x.deliveredAt)}</td>
                <td className="muted">{ymdhm(x.expiresAt)}</td>
                <td className="muted">{ymdhm(x.viewedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">후보 업체 <em>{d.candidates.filter((c) => c.eligible).length} / {d.candidates.length}</em></h3>
      <p className="muted">이 업종에 서비스를 등록한 업체입니다. 순번 점수가 작을수록 먼저 받습니다. 탈락 사유가 있으면 보낼 수 없습니다.</p>
      {d.candidates.length === 0 ? <p className="muted">이 업종에 서비스를 등록한 업체가 없습니다 — 파트너 모집이 먼저입니다.</p> : (
        <table className="tbl">
          <thead><tr><th></th><th>업체</th><th>등급</th><th>최근 30일</th><th>순번 점수</th><th>미납 · 예약 / 한도</th><th>탈락 사유</th></tr></thead>
          <tbody>
            {d.candidates.map((c) => (
              <tr key={c.partnerId} data-candidate={c.partnerId}>
                <td>{c.eligible && !closed && (
                  <input type="checkbox" aria-label={`${c.company} 보내기`} checked={pick.includes(c.partnerId)}
                         onChange={() => toggle(pick, setPick, c.partnerId)} />)}</td>
                <td><b>{c.company}</b></td>
                <td>{c.grade} <span className="muted">×{Number(c.weight)}</span></td>
                <td className="num-cell">{c.recent30d}</td>
                <td className="num-cell">{Number(c.score)}</td>
                <td className="num-cell">{n(c.unpaid)} · {n(c.reserved)} / {n(c.unpaidCap)}원</td>
                <td>{c.eligible ? <span className="st ok">보낼 수 있음</span>
                  : <span className="warn-text">{c.reasons.join(' · ')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="acts">
        {!closed && <button className="btn-ok" disabled={!!a.busy || pick.length === 0 || revoke.length > 0}
                            onClick={() => void assign(false)}>고른 업체에 보내기 {pick.length || ''}</button>}
        {!closed && <button className="btn-sm" disabled={!!a.busy || revoke.length > 0}
                            onClick={() => void assign(true)}>순번대로 빈자리 채우기</button>}
        {!closed && <button className="btn-sm" disabled={!!a.busy || revoke.length === 0}
                            onClick={reassign}>고른 배정 거두고 다시 보내기 {revoke.length || ''}</button>}
        {!closed && <button className="btn-no" disabled={!!a.busy} onClick={close}>신청 종료</button>}
        <button className="btn-plain" onClick={onClose}>닫기</button>
      </div>
      {revoke.length > 0 && (
        <p className="muted">
          거둘 배정 {revoke.length}건 — 업체를 함께 고르면 그 업체로, 고르지 않으면 순번대로 같은 수만큼 보냅니다.
        </p>
      )}
    </div>
  );
}

/** v10.31 (합침 · W5 D071) — 리드 등급 · 알림톡 결과 운영 입력(알림톡 연동 전). 확인비용 = 기준 단가 × 등급 비율(fn_lead_fee_quote).
 *  확인비용이 이미 나간 리드는 서버가 등급을 바꾸지 않습니다. */
function LeadGrade({ d, onSaved }: { d: LeadDetail; onSaved: () => void }) {
  const a = useAct();
  const [alim, setAlim] = useState(d.alimState ?? 'NONE');
  const band = GRADE_BAND[alim] ?? [];
  const [grade, setGrade] = useState<string>(d.grade ?? '');
  const g = band.some(([k]) => k === grade) ? grade : (band[0]?.[0] ?? '');
  const save = () => a.run('grade', () => api(`/admin/partner-center/leads/${d.id}/grade`, {
    method: 'POST', body: JSON.stringify({ alimState: alim, grade: band.length ? g : null }),
  }), onSaved, '리드 등급을 저장했습니다.');
  return (
    <div data-lead-grade={d.id}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">리드 등급 · 알림톡 결과</h3>
      <p className="muted">지금: {ALIM[d.alimState ?? 'NONE'] ?? d.alimState} · 등급 {d.gradeLabel ?? '미판정(기준 단가 그대로)'}{d.alimAt ? ` · ${ymdhm(d.alimAt)}` : ''}</p>
      <div className="acts">
        <select value={alim} onChange={(e) => setAlim(e.target.value)} aria-label="알림톡 결과">
          {Object.entries(ALIM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {band.length > 0 && (
          <select value={g} onChange={(e) => setGrade(e.target.value)} aria-label="리드 등급">
            {band.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => void save()}>등급 저장</button>
      </div>
    </div>
  );
}
