'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 제휴 파트너 신청 — POST /partner/affiliate/apply
 *
 * v10.194 (D173 · docs/304) — 제휴 자격(partners.aff_status)은 안심소개 입점 신청(POST /partner/apply · status)과 따로입니다.
 *   전에는 입점 신청이 곧 제휴 신청이라 한쪽을 승인하면 두 센터가 함께 열렸습니다.
 *   422 IDENTITY_REQUIRED(본인인증 · 사업자 정보 둘 다 없음 — v10.38) · 409 ALREADY_APPLIED 를 사람 말로 보여 드립니다.
 */
export function AffiliateApply() {
  const router = useRouter();
  const t = useTranslations('affiliate.applyForm');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function apply() {
    setErr(null); setOk(null);
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const d = await r.json().catch(() => null) as { code?: string; message?: string; note?: string } | null;
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) {
        setErr({ code: d?.code, message: d?.message ?? t('fail') });
        return;
      }
      setOk(d?.note ?? t('ok'));
      router.refresh();
    });
  }

  return (
    <div className="p2act p2col">
      <button type="button" className="btn-sm p2primary" disabled={pending} onClick={apply}>
        {pending ? t('pending') : t('submit')}
      </button>
      {ok && <p className="ok-note" role="status">{ok}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {err.code === 'IDENTITY_REQUIRED' && <> <Link href="/verify">{t('goVerify')}</Link></>}
        </p>
      )}
    </div>
  );
}
