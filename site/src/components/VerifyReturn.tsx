'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * v10.141 (D137 · docs/214) — 표준창에서 돌아온 곳(/verify/return)
 *   돌아온 값 3개(token_version_id · enc_data · integrity_value)를 서버에 넘겨 확인(POST /verifications/identity/complete).
 *   한 번만 보냄(같은 값을 두 번 보내면 서버가 409 IDENTITY_USED) · 실패는 서버 문장 그대로 + 「다시 하기」.
 */
export function VerifyReturn({ fields }: { fields: Record<string, string> }) {
  const t = useTranslations('join.verifyReturn');
  const sent = useRef(false);
  const [st, setSt] = useState<{ ok: boolean; text: string; next?: string | null; nameMatch?: boolean } | null>(null);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!fields.token_version_id || !fields.enc_data || !fields.integrity_value) { setSt({ ok: false, text: t('missing') }); return; }
    fetch('/api/v1/verifications/identity/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_version_id: fields.token_version_id, enc_data: fields.enc_data, integrity_value: fields.integrity_value }),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      setSt(r.ok ? { ok: true, text: t('done'), next: d.next, nameMatch: d.nameMatch } : { ok: false, text: d.message ?? t('failed') });
    }).catch(() => setSt({ ok: false, text: t('noServer') }));
  }, [fields, t]);

  if (!st) return <p className="hint" aria-busy="true" data-verify-return="busy">{t('working')}</p>;
  return (
    <div data-verify-return={st.ok ? 'ok' : 'fail'}>
      <p className={st.ok ? 'ok-note my-nt ok' : 'form-error'} role={st.ok ? 'status' : 'alert'}>{st.text}</p>
      {st.ok && st.nameMatch === false && <p className="hint" data-verify-name-diff>{t('nameDiff')}</p>}
      <p><Link className="my-bp" href={st.ok && st.next ? st.next : '/verify'} data-verify-continue>{st.ok && st.next ? t('continue') : t('back')}</Link></p>
    </div>
  );
}
