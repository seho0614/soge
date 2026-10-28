'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v10.141 (D137 · docs/214) — 가짜 표준창(/verify/mock-nice) — 점검판(identity.provider = MOCK)에서만 씀
 *   이름 · 생년월일을 넣으면 서버가 NICE 와 같은 암호로 결과를 만들어(POST /verifications/identity/mock-sign) 돌아오는 주소로 보냄.
 *   MOCK 이 아니면 서버가 403 MOCK_ONLY — 이 화면으로는 운영에서 인증할 수 없음.
 */
export function VerifyMockNice({ fields }: { fields: Record<string, string> }) {
  const t = useTranslations('join.verifyMock');
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(cancel: boolean) {
    setErr(null);
    if (!cancel && (!name.trim() || !/^\d{8}$/.test(birth))) { setErr(t('need')); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/verifications/identity/mock-sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_version_id: fields.token_version_id, enc_data: fields.enc_data, integrity_value: fields.integrity_value, name: name.trim(), birthdate: birth, cancel }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? t('failed')); return; }
      window.location.assign(`${d.returnUrl}?${new URLSearchParams(d.fields).toString()}`);
    } catch { setErr(t('failed')); } finally { setBusy(false); }
  }

  return (
    <div data-verify-mock-window>
      <p className="stub-note">{t('note')}</p>
      <label className="fld">{t('name')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-mock-name /></label>
      <label className="fld">{t('birth')}<input value={birth} onChange={(e) => setBirth(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="19900101" data-mock-birth /></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <p>
        <button className="cta-primary" disabled={busy} onClick={() => void go(false)} data-mock-ok>{t('ok')}</button>{' '}
        <button className="my-bp" disabled={busy} onClick={() => void go(true)} data-mock-cancel>{t('cancel')}</button>
      </p>
    </div>
  );
}
