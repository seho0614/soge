import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { codeList, label } from '../../lib/codes';
import { remain } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';
import { ListingGeoPanel } from './ListingGeoPanel';

/** SB-ADM-REV-020 반려 사유 입력
 *
 * v10.29 — 시안(scAdmRevD) 모양: 왼쪽 검수 건 요약 · 오른쪽 「반려 사유」 고르기(코드 · 이름) → 반려 / 승인.
 * 서버 · 입력 이름은 그대로(PATCH /admin/reviews/:id { decision, reasonCode, memo }).
 * v10.31 — 시안 왼쪽의 등록 글 제목 · 본문 · 등록자 · 사업자번호 · 「자동 검사」 4줄을 서버(/admin/reviews/:id)가 붙여 줍니다.
 * 아래 「3회 반려 시 정지」 안내는 서버 규칙(D082 fn_review_reject_strikes)과 같습니다. */

interface Item {
  id: string; target_type: string; target_id: string; gwan_code: string | null;
  submitted_at: string; sla_due_at: string; status: string; decision_mode: string;
  manual_reasons: string[] | null;
  /* v10.31 — 서버가 붙여 주는 대상 내용 · 자동 검사(시안 왼쪽 카드) */
  targetTitle?: string | null; targetBody?: string | null; categoryName?: string | null;
  gwanName?: string | null; gradeCode?: string | null; submitterName?: string | null;
  bizRegNo?: string | null; ntsStatus?: string | null;
  autoChecks?: { key: string; label: string; ok: boolean; detail: string }[];
  /* v10.106 (D120) — AI 검수 보조 의견(참고만 · 결정은 사람) */
  aiOpinion?: { suggestion: 'APPROVE' | 'REJECT' | 'UNSURE'; reasonCodes: string[] | null; note: string | null; model: string; engine: string; createdAt: string } | null;
}

const AI_TXT: Record<string, string> = { APPROVE: '승인 제안', REJECT: '반려 제안', UNSURE: '모름' };

export function ReviewDecide({ id, onDone }: { id: string; onDone: () => void }) {
  const [reasons, setReasons] = useState<{ code: string; label: string; category?: string }[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /* v10.138 (D134 · docs/206) — AI 가 반려를 제안하면 사유 코드만 미리 채움 · 반려는 검수자가 「사유를 확인했습니다」를 누른 뒤 */
  const [aiFilled, setAiFilled] = useState('');
  const [aiConfirm, setAiConfirm] = useState(false);

  useEffect(() => {
    api<{ code: string; label: string; category?: string }[]>('/admin/review-reasons')
      .then(setReasons)
      .catch(() => setReasons(codeList('review.reason').map((c) => ({ code: c.code, label: c.label }))));
    api<Item>(`/admin/reviews/${id}`).then(setItem).catch(() => setItem(null));
  }, [id]);
  useEffect(() => {
    const c = item?.aiOpinion?.suggestion === 'REJECT' ? item.aiOpinion.reasonCodes?.find((x) => reasons.some((r) => r.code === x)) : undefined;
    if (c && !reasonCode) { setReasonCode(c); setAiFilled(c); }
  }, [item, reasons]);
  const aiReject = !!aiFilled && reasonCode === aiFilled;   // AI 가 채운 사유 그대로 반려하면 「AI 의견 참고」

  const decide = (decision: 'APPROVED' | 'REJECTED', aiAgreed = false) => {
    setBusy(true); setError(null);
    api(`/admin/reviews/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, reasonCode: reasonCode || undefined, memo: memo || undefined, ...(aiAgreed ? { aiAgreed: true } : {}) }),
    })
      .then(onDone)
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const r = item ? remain(item.sla_due_at) : null;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <>
      <button className="btn-sm" onClick={onDone} style={{ marginBottom: 12 }}>← 검수 큐</button>
      {error ? <ErrorView error={error} /> : null}

      <div className="ad-rv2">
        <div className="card rvl">
          <div className="lh">
            {item && <span className="ad-chip gw">{item.gwanName ?? item.gwan_code ?? label('review.target_type', item.target_type)}</span>}
            {item?.categoryName && <span className="ad-chip">{item.categoryName}</span>}
            {r && <span className={`ad-chip ${r.over ? 'no' : 'warn'}`}>SLA {r.over ? r.text : `잔여 ${r.text.replace(' 남음', '')}`}</span>}
          </div>
          <h2>{item?.targetTitle || `검수 · ${id.slice(0, 8)}`}</h2>
          {item?.targetBody && <p data-rv-body style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)', margin: '0 0 12px' }}>{item.targetBody}</p>}
          <div className="ad-dsum">
            <div><span>등록자</span><b>{item?.submitterName ?? '—'}</b></div>
            <div><span>사업자등록번호</span><b>{item?.bizRegNo ?? '—'}{item?.ntsStatus === 'VALID' && <span className="ad-chip ok" style={{ marginLeft: 6 }}>국세청 확인</span>}</b></div>
            <div><span>대상</span><b>{item ? `${label('review.target_type', item.target_type)} · ${item.target_id.slice(0, 8)}` : '—'}</b></div>
            <div><span>접수</span><b>{when(item?.submitted_at)}</b></div>
            <div><span>SLA 마감</span><b>{when(item?.sla_due_at)}</b></div>
            <div><span>판정 방식</span><b>{item ? (item.decision_mode === 'AUTO' ? '자동' : '사람') : '—'}</b></div>
          </div>
          {item?.autoChecks?.length ? (
            <>
              <h3 className="ad-s3">자동 검사</h3>
              {item.autoChecks.map((c) => (
                /* v10.32 — 시안 .flg.ok(초록) · .flg.warn(노랑). 전에는 통과 줄이 회색 */
                <div key={c.key} className={`ad-flg ${c.ok ? 'ok' : 'warn'}`} data-auto-check={c.key}><b>{c.label}</b><span>{c.detail}</span></div>
              ))}
            </>
          ) : null}
          {item?.aiOpinion ? (
            <>
              <h3 className="ad-s3">AI 의견 <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)' }}>참고만 · 결정은 검수자</span></h3>
              <div className={`ad-flg ${item.aiOpinion.suggestion === 'APPROVE' ? 'ok' : 'warn'}`} data-ai-opinion={item.aiOpinion.suggestion}>
                <b>{AI_TXT[item.aiOpinion.suggestion] ?? item.aiOpinion.suggestion}
                  {item.aiOpinion.reasonCodes?.length ? ` · ${item.aiOpinion.reasonCodes.map((c) => reasons.find((x) => x.code === c)?.label ?? c).join(' · ')}` : ''}</b>
                <span>{item.aiOpinion.note ?? '—'} ({item.aiOpinion.engine === 'MOCK' ? '시험 엔진' : item.aiOpinion.model})</span>
              </div>
            </>
          ) : null}
          {item?.manual_reasons?.length ? (
            <>
              <h3 className="ad-s3">사람이 보는 이유</h3>
              {item.manual_reasons.map((c) => (
                <div key={c} className="ad-flg warn"><b>{label('review.manual_reason', c)}</b><span>{c}</span></div>
              ))}
            </>
          ) : null}
          {/* v10.46 (docs/96) — 매물이면 소재지 좌표 · 핀(지도 사용이 꺼져 있으면 아무것도 그리지 않음) */}
          {item?.target_type === 'LISTING' && <ListingGeoPanel listingId={item.target_id} />}
        </div>

        <div className="card rvr">
          {/* 사유는 코드 선택이 필수입니다. 자유서술만 받으면
              재제출률과 사유 분포를 볼 수 없고, 그게 곧 자동화의 다음 후보입니다. */}
          <h3>반려 사유 <span className="dim">(반려 시 필수)</span></h3>
          <div role="radiogroup" aria-label="반려 사유">
            {reasons.map((x) => (
              <label key={x.code} className={`ad-rz${reasonCode === x.code ? ' on' : ''}`}>
                <input type="radio" name="reasonCode" value={x.code} checked={reasonCode === x.code}
                       onChange={() => setReasonCode(x.code)} />
                <b>{x.code} · {x.label}</b>
              </label>
            ))}
          </div>
          {/* 예전 고르개도 둡니다 — 같은 값(reasonCode)을 바꿉니다. 시험 · 키보드로 고르기 쉽게 */}
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label="반려 사유 고르기"
                  style={{ width: '100%', marginTop: 8 }}>
            <option value="">선택하지 않음</option>
            {reasons.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>

          {aiReject && (
            <label className="ad-nt warn" style={{ display: 'flex', gap: 8, marginTop: 8 }} data-ai-reason-filled={aiFilled}>
              <input type="checkbox" checked={aiConfirm} onChange={(e) => setAiConfirm(e.target.checked)} data-ai-reason-confirm />
              <span><b>AI 가 고른 사유로 미리 채웠습니다.</b> 글을 읽고 사유가 맞는지 확인하셨으면 표시하십시오(다르면 사유를 바꾸십시오).</span>
            </label>
          )}

          <label style={{ display: 'grid', gap: 4, marginTop: 12 }}>
            <span className="dim">메모 (선택)</span>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3}
                      maxLength={1000} style={{ resize: 'vertical' }} />
          </label>

          <div className="rvact">
            <button className="btn-no" disabled={busy || !reasonCode || (aiReject && !aiConfirm)} onClick={() => decide('REJECTED', aiReject)}
                    title={!reasonCode ? '반려하려면 사유를 선택하십시오' : aiReject && !aiConfirm ? 'AI 가 채운 사유를 확인했다고 표시하십시오' : undefined}>
              반려
            </button>
            <button className="btn-ok" disabled={busy} onClick={() => decide('APPROVED')}>
              승인
            </button>
            {item?.aiOpinion?.suggestion === 'APPROVE' && (
              <button className="btn-sm" disabled={busy} data-ai-agree-detail title="AI 승인 제안과 같게 — 승인은 검수자가 합니다"
                      onClick={() => { if (window.confirm('AI 의견(승인 제안)과 같게 승인할까요? 결정 · 책임은 검수자에게 있습니다.')) decide('APPROVED', true); }}>
                AI 의견과 같게 확인
              </button>
            )}
          </div>
          {!reasonCode && (
            <div className="ad-nt info"><b>사유를 고르기 전에는 반려할 수 없습니다.</b> “등록에 실패했습니다” 같은 뭉갠 문구를 보내지 않기 위해서입니다.</div>
          )}
        </div>
      </div>
      <div className="ad-nt warn"><b>같은 등록자가 제한업종 · 금칙 표현으로 3회 반려되면 등록 권한이 7일간 일시 정지됩니다.</b> 관리자에게도 알림이 갑니다(최근 90일 기준).</div>
    </>
  );
}
