'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DisputableFee { id: number; summary: string; amount: string; deliveredAt?: string }

const REASONS: Array<[string, string]> = [
  ['UNREACHABLE', '연락 불가 — 번호가 없거나 받지 않음'],
  ['FALSE_INFO', '허위 정보 — 요청 내용이 사실과 다름'],
  ['DUPLICATE', '중복 리드 — 같은 요청을 이미 받음'],
  ['OUT_OF_SCOPE', '지역 · 분야 밖 — 켜지 않은 지역·업종'],
];

/**
 * 리드 반려 신청 폼 (SB-PTC-CTR-330 → POST /partner/fees/{id}/dispute).
 *
 * 자격(접수 72시간 · 한 건 한 번 · 월 15%)은 서버가 봅니다.
 * 막히면 서버가 준 이유를 그대로 보여 드립니다 — "왜 안 되나"를 묻지 않게.
 */
export function FeeDisputeForm({ fees }: { fees: DisputableFee[] }) {
  const router = useRouter();
  const [f, setF] = useState({ feeId: String(fees[0]?.id ?? ''), reasonCode: 'UNREACHABLE', reason: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    if (f.reason.trim().length < 5) { setErr('무엇이 사실과 달랐는지 다섯 글자 이상 적어 주십시오.'); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await fetch(`/api/v1/partner/fees/${f.feeId}/dispute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasonCode: f.reasonCode, reason: f.reason, evidence: f.evidence || undefined }),
      });
      const d = await r.json().catch(() => null) as { message?: string; note?: string } | null;
      if (!r.ok) { setErr(d?.message ?? '신청하지 못했습니다.'); return; }
      setOk(d?.note ?? '접수했습니다.');
      setF({ ...f, reason: '', evidence: '' });
      router.refresh();
    } catch {
      setErr('신청하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
    } finally { setBusy(false); }
  }

  if (!fees.length) {
    return <div className="empty">지금 반려를 신청할 수 있는 이용료가 없습니다 (리드 접수 후 72시간 이내 · 한 건에 한 번).</div>;
  }
  return (
    <div className="card" style={{ padding: '18px 20px' }} id="dispute-form">
      <label className="fld"><span>이용료</span>
        <select value={f.feeId} onChange={(e) => setF({ ...f, feeId: e.target.value })} name="feeId">
          {fees.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id}번 · {x.summary} · {Number(x.amount).toLocaleString('ko-KR')}원
            </option>
          ))}
        </select>
      </label>
      <label className="fld"><span>사유</span>
        <select value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })} name="reasonCode">
          {REASONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
        </select>
      </label>
      <label className="fld"><span>무엇이 사실과 달랐나</span>
        <textarea rows={3} maxLength={1000} value={f.reason} name="reason"
          placeholder="예) 안내된 번호가 결번입니다. 3회 통화 시도"
          onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </label>
      <label className="fld"><span>근거 (선택)</span>
        <input className="inp" maxLength={2000} value={f.evidence} name="evidence"
          placeholder="통화 기록 · 문자 발송 내역 등"
          onChange={(e) => setF({ ...f, evidence: e.target.value })} />
      </label>
      <button type="button" className="btn-primary" disabled={busy || !f.feeId} onClick={() => void submit()}>
        {busy ? '신청하는 중…' : '반려 신청'}
      </button>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {ok ? <p className="ok-note" role="status">{ok}</p> : null}
      <p className="hint">
        <b>상담이 결렬된 것은 반려 사유가 아닙니다.</b> 리드 자체의 결함만 인정됩니다.
      </p>
    </div>
  );
}
