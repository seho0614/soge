import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { bizNo, type PendingService } from './shared';

const STATUS: Record<string, string> = {
  APPLIED: '심사 대기', ACTIVE: '활동', SUSPENDED: '중지', WITHDRAWN: '탈퇴', REJECTED: '반려',
};

/* ── SB-ADM-PTN-030 서비스 검수 승인 (T-02) ──────────────────────── */
const REASONS = [
  ['R01', '금칙어 · 과장 표현'], ['R02', '정보 불충분'], ['R03', '가격 표시 부정확'],
  ['R04', '카테고리 부적합'], ['R05', '자격 · 인허가 미확인'], ['R06', '중복 등록'],
];

const QUAL: Record<string, string> = { APPROVED: '자격 승인', PENDING: '자격 심사 중', REJECTED: '자격 반려' };

export function Services() {
  const list = useApi<PendingService[]>('/admin/partners/services/pending');
  const [form, setForm] = useState<Record<string, { code: string; detail: string }>>({});
  const a = useAct();
  const f = (id: string) => form[id] ?? { code: 'R02', detail: '' };
  const set = (id: string, v: Partial<{ code: string; detail: string }>) => setForm({ ...form, [id]: { ...f(id), ...v } });

  const review = (s: PendingService, approve: boolean) => {
    const { code, detail } = f(s.id);
    const label = REASONS.find((r) => r[0] === code)?.[1];
    if (!approve && !detail.trim()) { a.setErr('반려에는 무엇을 고쳐야 하는지까지 적어 주십시오.'); return; }
    const reason = approve ? undefined : `${code} ${label} — ${detail.trim()}`;
    void a.run(s.id, () => api(`/admin/partners/services/${s.id}/review`, {
      method: 'POST', body: JSON.stringify({ approve, reason }),
    }), list.reload, approve ? `「${s.title}」 승인했습니다. 노출중으로 바뀌고 승인·반려 이력에 찍힙니다.`
      : `「${s.title}」 반려했습니다. 사유가 파트너에게 그대로 보입니다.`);
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  return (
    <>
      <h2>서비스 검수 승인 <em>{rows.length}</em></h2>
      <p className="lead">검수중 → 노출중 전환입니다 (T-02). 오래된 신청부터 보입니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">검수 대기 중인 서비스가 없습니다.</p>}
      {rows.map((s) => (
        <div key={s.id} className="card pad" data-service={s.id}>
          <b>{s.title}</b> <span className="muted">{s.company} · {s.categoryName ?? '분야 미지정'}{s.gwanCode ? ` (${s.gwanCode})` : ''}</span>
          <p className="muted">
            제출 {ymdhm(s.submittedAt)} · {bizNo(s.bizRegNo)} · 파트너 {STATUS[s.partnerStatus] ?? s.partnerStatus} · 등급 {s.grade}
            {' · '}이전 승인 {s.approvedBefore} / 반려 {s.rejectedBefore}
            {s.leadFee ? ` · 리드 단가 ${n(s.leadFee)}원` : ''}
          </p>
          {s.body && <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>}
          {s.restrictedCode && <p className="warn-text">제한업종({s.restrictedCode}) 분야입니다 — 승인해도 노출되지 않습니다.</p>}
          {s.qualCode && (
            <p className={s.qualState === 'APPROVED' ? 'muted' : 'warn-text'}>
              규제 분야({s.qualCode}) — {s.qualState ? QUAL[s.qualState] ?? s.qualState : '자격 미제출'}.
              {s.qualState !== 'APPROVED' ? ' 자격 심사가 끝나기 전에는 승인하지 마십시오.' : ''}
            </p>
          )}
          <div className="form-grid">
            <label><span>반려 사유 코드</span>
              <select value={f(s.id).code} onChange={(e) => set(s.id, { code: e.target.value })}>
                {REASONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
              </select>
            </label>
            <label><span>무엇을 고쳐야 하나 (반려 시 필수)</span>
              <input value={f(s.id).detail} onChange={(e) => set(s.id, { detail: e.target.value })} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === s.id} onClick={() => review(s, true)}>승인</button>
            <button className="btn-no" disabled={a.busy === s.id} onClick={() => review(s, false)}>반려</button>
          </div>
        </div>
      ))}
      <p className="card">
        <b>반려 사유는 소개뱅크 검수와 같은 코드(R01~R06)를 씁니다.</b> &lsquo;부적절&rsquo;만 쓰면 같은 것을
        다시 내고 검수 큐가 그만큼 늘어납니다 — 서버가 사유 없는 반려를 막습니다.
      </p>
    </>
  );
}
