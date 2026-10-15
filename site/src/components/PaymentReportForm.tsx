'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** 금액·계좌 입력이 없습니다 — deal_payment_records 에 그 컬럼이 없습니다 (INV-11) */
export function PaymentReportForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);   // 신고 뒤 거래 상태(서버가 알려 줌)
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}/payment-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: String(fd.get('method') ?? 'BANK_TRANSFER'),
          memo: String(fd.get('memo') ?? '') || undefined,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '신고하지 못했습니다.'); return; }
      setDone(String(d?.dealStatus ?? 'PAYMENT_REPORTED'));
      router.refresh();
    });
  }

  /* v10.27 (G-201) — 안내를 거래 상태에 맞춥니다. 전에는 이미 확정된 거래에도
   * 「상대방이 확인하면 계약서 서명으로 진행합니다」가 나왔습니다. */
  if (done) {
    const closed = done === 'CONFIRMED' || done === 'SETTLED';
    return (
      <div className="result" data-pay-done={done}>
        <p className="ok-note">
          {closed
            ? '신고되었습니다. 이 거래는 이미 성사가 확정되어 있어 더 할 일은 없습니다 — 후기를 남겨 주시면 다른 회원에게 도움이 됩니다.'
            : '신고되었습니다. 다음은 성사 확정입니다 — 양쪽이 모두 확정을 누르면 거래가 끝납니다.'}
        </p>
        {closed
          ? <a className="cta-primary as-link" href={`/deal/${dealId}/review`}>후기 쓰기</a>
          : <a className="cta-primary as-link" href={`/deal/${dealId}/confirm`}>성사 확정으로</a>}
        <a className="as-link" style={{ marginLeft: 12 }} href="/my/deals">내 거래로</a>
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>지급 방식</span>
        <select name="method">
          <option value="BANK_TRANSFER">계좌 이체</option>
          <option value="CASH">현금</option>
          <option value="OTHER">기타</option>
        </select>
      </label>
      <label className="fld">
        <span>메모</span>
        <textarea name="memo" rows={3} placeholder="증빙에 대한 설명 (선택)" />
        <em>금액과 계좌는 입력하지 않습니다 — 플랫폼이 보관하지 않습니다</em>
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="cta-primary" disabled={pending}>
        {pending ? '신고 중…' : '지급 신고'}
      </button>
    </form>
  );
}
