'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface IdentityResult { success: boolean; stub: boolean }

/**
 * 본인인증 (PASS).
 *
 * 계약·발신 IP 등록에 4~6주가 걸려 그 전까지는 스텁입니다.
 * 서버가 stub: true 를 실어 주므로 화면에 그대로 표시합니다 —
 * "클릭 즉시 통과"가 실동작처럼 보이는 것이 시연 리스크였습니다.
 */
export function VerifyPanel() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<IdentityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      try {
        const r = await fetch('/api/v1/verifications/identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'PASS' }),
        });
        const d = await r.json();
        if (!r.ok) { setErr(d.message ?? '인증에 실패했습니다.'); return; }
        setRes(d as IdentityResult);
        router.refresh();
      } catch {
        setErr('인증 서버에 연결하지 못했습니다.');
      }
    });
  }

  return (
    <div className="verify">
      <button className="cta-primary" onClick={run} disabled={pending}>
        {pending ? '인증 중…' : 'PASS 로 본인인증'}
      </button>

      {err && <p className="form-error" role="alert">{err}</p>}

      {res?.stub && (
        <p className="stub-note">
          연동 준비 중입니다 — <strong>실제 확인이 이루어지지 않았습니다.</strong>
        </p>
      )}
    </div>
  );
}
