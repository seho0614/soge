'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface TrackState { status: string; can: boolean; why: string[] }

/**
 * v10.224 (D194 · docs/359) — 파트너 본인 해지. GET · POST /partner/withdraw
 *   track MAL(안심소개 — 사업자 정보 · 계정 화면) · AFF(제휴 — 정산 화면). 대표 계정만 · 돈이 남아 있으면 서버가 막음(막는 것을 미리 보여 줌).
 *   한쪽만 해지해도 다른 자격은 그대로 · 다시 하려면 신청부터.
 */
export function PartnerWithdraw({ track }: { track: 'MAL' | 'AFF' }) {
  const t = useTranslations('partner.withdraw');
  const router = useRouter();
  const [st, setSt] = useState<TrackState | null | undefined>(undefined);
  const [chk, setChk] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch('/api/v1/partner/withdraw').then((r) => (r.ok ? r.json() : null))
      .then((d: { mal: TrackState | null; aff: TrackState | null } | null) => setSt(d ? (track === 'MAL' ? d.mal : d.aff) : null))
      .catch(() => setSt(null));
  }, [track]);

  if (msg) return <section className="pt-fset" data-partner-withdraw={track}><p className="ok-note" role="status">{msg}</p></section>;
  if (!st) return null;

  function go() {
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/partner/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reason.trim() ? { track, reason: reason.trim() } : { track }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(r.status >= 500 ? t('fail') : d?.message ?? t('fail')); return; }
      setMsg(d?.note ?? t('done'));
      router.refresh();
    });
  }

  return (
    <section className="pt-fset" data-partner-withdraw={track}>
      <h3>{track === 'MAL' ? t('titleMal') : t('titleAff')}</h3>
      <p className="hint">{track === 'MAL' ? t('helpMal') : t('helpAff')}</p>
      {!st.can ? (
        <p className="notice" data-partner-withdraw-blocked="">{t('blocked', { why: st.why.join(' · ') })}</p>
      ) : (
        <>
          <label className="fld"><span>{t('reason')}</span><input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
          <label className="hlt-chk"><input type="checkbox" checked={chk} onChange={(e) => setChk(e.target.checked)} data-partner-withdraw-chk="" /> <span>{t('chk')}</span></label>
          <button type="button" className="pt-bp sm" disabled={pending || !chk} onClick={go} data-partner-withdraw-go="">{t('go')}</button>
        </>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </section>
  );
}
