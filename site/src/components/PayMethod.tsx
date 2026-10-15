'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 결제 수단 등록·삭제.
 *
 * 간주 상태에서는 **버튼을 눌러도 아무 일이 일어나지 않는다는 것**을
 * 먼저 알립니다. 되는 척하면 등록한 줄 알고 넘어갑니다.
 */
export function PayMethod({ registered, assumed }:
  { registered: boolean; assumed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function register() {
    if (assumed && !confirm(
      '지금은 연동 전이라 실제 카드가 등록되지 않습니다.\n' +
      '화면 확인용으로만 진행하시겠습니까?'
    )) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/billing-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* ★ 20260930 — 서버는 authKey 가 필수입니다. 빈 본문을 보내 **간주 상태에서도 늘 실패**
         *   했습니다(400). 간주 상태에서는 시연용 키를 보내 서버 스텁이 처리하게 하고,
         *   실연동 뒤에는 토스 결제창이 돌려준 authKey 를 넣어야 합니다(미구현 — 보고서 참조). */
        body: JSON.stringify({ authKey: assumed ? `assumed_${Date.now()}` : '' }),
      });
      if (!r.ok) throw new Error(String(r.status));
      router.refresh();
      setBusy(false);      // v10.26 (G-179) — 성공한 뒤에도 풀어야 합니다. 전에는 단추가 「처리 중…」에서 멈췄습니다(화면만 새로 받고 이 칸은 그대로 남음)
    } catch {
      setErr('등록하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(
      '결제 수단을 삭제하시겠습니까?\n\n' +
      '미납이 남아 있으면 삭제할 수 없고, 삭제 후에는 구독이 갱신되지 않습니다.'
    )) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/billing-key', { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
      router.refresh();
      setBusy(false);
    } catch {
      /* 미납이 있으면 서버가 막습니다 — 그 이유를 알려야 합니다. */
      setErr('삭제하지 못했습니다. 미납이 남아 있으면 먼저 정리하셔야 합니다.');
      setBusy(false);
    }
  }

  return (
    <div className="invite-actions">
      <button type="button" className="btn-primary" disabled={busy}
        onClick={() => void register()}>
        {busy ? '처리 중…' : registered ? '카드 바꾸기' : '카드 등록하기'}
      </button>
      {registered ? (
        <button type="button" className="btn ghost" disabled={busy}
          onClick={() => void remove()}>
          삭제
        </button>
      ) : null}
      {err ? <p className="form-error">{err}</p> : null}
    </div>
  );
}
