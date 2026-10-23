import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import type { VoidRequest, VoidList } from './shared';

/* ── SB-ADM-PTN-050 리드 반려 인정 / 기각 (T-04) ─────────────────── */
const DISPUTE: Record<string, string> = {
  FALSE_INFO: '허위 정보', UNREACHABLE: '연락 불가', DUPLICATE: '중복 리드', OUT_OF_SCOPE: '지역 · 분야 밖',
};

const DSTATE: Record<string, string> = { REQUESTED: '대기', ACCEPTED: '인정', DISMISSED: '기각' };

export function Rejects() {
  const [tab, setTab] = useState<'REQUESTED' | 'ALL'>('REQUESTED');
  const list = useApi<VoidList>(`/admin/partners/fees/void-requests?state=${tab}`);
  const [rule, setRule] = useState<Record<number, string>>({});
  const a = useAct();

  const accept = (r: VoidRequest) => {
    const code = rule[r.id] ?? 'RSK-02';
    if (!confirm(`이용료 ${r.feeId}번(${n(r.amount)}원)을 무효로 합니다 — 근거 ${code}.\n거래 자체가 없던 것이 됩니다. 되돌릴 수 없습니다.`)) return;
    void a.run(`v${r.id}`, () => api(`/admin/partners/fees/void-requests/${r.id}/accept`, {
      method: 'POST', body: JSON.stringify({ ruleCode: code }),
    }), list.reload);
  };
  const dismiss = (r: VoidRequest) => {
    const reason = prompt('기각 사유 — 파트너에게 그대로 보입니다') ?? '';
    if (!reason.trim()) return;
    void a.run(`v${r.id}`, () => api(`/admin/partners/fees/void-requests/${r.id}/dismiss`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }), list.reload);
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const rows = list.data?.items ?? [];
  const rules = list.data?.rules ?? [];
  const hrs = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 3600000));
  /* v10.32 — 시안(scAdmPtnRej) 배치: 노란 띠 → 파란 띠(자격 세 조건) → 신청 카드(사유 제목 · 번호 · 회사 · 리드 · 확인비용 · 신청 / 접수 시간 · 열람 · 한도 칩 · 상태 · 인정 / 기각).
   * 대기 · 전체 칩 · 근거 줄 · 위험감지 규칙 고르기는 개발에만(그대로 둠) */
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'partners/rejects') */}
      <div className="ad-nt warn">
        <b>인정에는 위험감지 규칙 근거가 필요합니다. 기각하면 이용료는 그대로 청구되고, 사유가 파트너에게 보입니다.</b> 당사자 간 상담 결렬은 무효 사유가 아닙니다 — 그것까지 판정하면
        플랫폼이 거래 당사자가 됩니다.
      </div>
      <div className="ad-nt info">
        <b>신청 자격은 서버가 이미 걸렀습니다</b> — 리드 접수 72시간 이내 · 이용료 한 건에 한 번 · 월 한도(당월 수신 건수의 15%).
        이용료는 열람 시점에 생기므로 &ldquo;미열람&rdquo; 조건은 이 모델에 없습니다.
      </div>
      <div className="ad-flt" role="tablist" aria-label="반려 신청 상태">
        <button role="tab" aria-selected={tab === 'REQUESTED'} className={tab === 'REQUESTED' ? 'on' : ''} onClick={() => setTab('REQUESTED')}>대기{tab === 'REQUESTED' && list.data ? <i>{rows.length}</i> : null}</button>
        <button role="tab" aria-selected={tab === 'ALL'} className={tab === 'ALL' ? 'on' : ''} onClick={() => setTab('ALL')}>전체 (판정 이력)</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="ad-empty">{tab === 'REQUESTED' ? '대기 중인 반려 신청이 없습니다.' : '반려 신청이 없습니다.'}</p>}
      {rows.map((r) => {
        const h = hrs(r.deliveredAt, r.requestedAt);
        const cap = Math.floor(r.monthReceived * 0.15);
        return (
          <div key={r.id} className="ad-mrow" data-void={r.id}>
            <div className="mt">
              <b>{DISPUTE[r.reasonCode] ?? r.reasonCode} — {r.reason}</b>
              <span className="ls">J-{r.id} · {r.company} · 리드 {r.summary}{r.sido ? ` (${[r.sido, r.sigungu].filter(Boolean).join(' ')})` : ''}{r.categoryName ? ` · ${r.categoryName}` : ''} · 확인비용 {n(r.amount)}원 · 신청 {ymdhm(r.requestedAt)}</span>
              <div className="lh">
                <span className={`ad-chip${h > 72 ? ' warn' : ''}`}>접수 {h}시간</span>
                <span className="ad-chip">{r.viewedAt ? `열람 ${ymdhm(r.viewedAt)}` : '미열람'}</span>
                <span className="ad-chip">한도 {r.monthRequested} / {r.monthReceived}건(15% · {cap}건)</span>
                <span className="ad-chip">이용료 {r.feeId}번 · 등급 {r.grade}</span>
              </div>
              <span className="ls">근거: {r.evidence ?? <span className="warn-text">제출 없음</span>} · 이달 이 파트너: 수신 {r.monthReceived}건 · 반려 신청 {r.monthRequested}건</span>
              {r.state !== 'REQUESTED' && (
                <span className="ls">{DSTATE[r.state]} · {r.decidedBy ?? '—'} · {ymdhm(r.decidedAt)}
                  {r.ruleCode ? ` · 근거 ${r.ruleCode}` : ''}{r.decisionReason ? ` · ${r.decisionReason}` : ''}</span>
              )}
            </div>
            <div className="mm">
              <span className={`ad-bg ${r.state === 'ACCEPTED' ? 'ok' : r.state === 'DISMISSED' ? 'no' : 'wait'}`}>{r.state === 'REQUESTED' ? '승인 대기' : DSTATE[r.state] ?? r.state}</span>
            </div>
            {r.state === 'REQUESTED' && (
              <div className="mact">
                <select value={rule[r.id] ?? 'RSK-02'} onChange={(e) => setRule({ ...rule, [r.id]: e.target.value })} aria-label="위험감지 규칙 근거">
                  {rules.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}
                </select>
                <button className="btn-plain btn-sm" disabled={a.busy === `v${r.id}`} onClick={() => dismiss(r)}>기각</button>
                <button className="btn-ok btn-sm" disabled={a.busy === `v${r.id}`} onClick={() => accept(r)}>인정 · 무효 처리</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
