'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('join.verifyPanel');
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
        if (!r.ok) { setErr(d.message ?? t('failed')); return; }
        setRes(d as IdentityResult);
        router.refresh();
      } catch {
        setErr(t('noServer'));
      }
    });
  }

  return (
    <div className="verify">
      <button className="cta-primary" onClick={run} disabled={pending}>
        {pending ? t('working') : t('submit')}
      </button>

      {err && <p className="form-error" role="alert">{err}</p>}

      {res?.stub && (
        <p className="stub-note">
          {t.rich('stub', { strong: (c) => <strong>{c}</strong> })}
        </p>
      )}
    </div>
  );
}
