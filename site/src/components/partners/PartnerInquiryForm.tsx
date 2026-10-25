'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AffResult } from './types';

/** 1:1 문의 접수 — POST /partner/affiliate/inquiries (제목 2~100자 · 내용 5~5000자) */
export function PartnerInquiryForm() {
  const router = useRouter();
  const t = useTranslations('affiliate.inquiryForm');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const subject = String(fd.get('subject') ?? '').trim();
    const body = String(fd.get('body') ?? '').trim();
    setErr(null); setOk(null);
    if (subject.length < 2) { setErr(t('subjectShort')); return; }
    if (body.length < 5) { setErr(t('bodyShort')); return; }
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const d = (await r.json().catch(() => null)) as (AffResult & { message?: string }) | null;
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      if (!d?.ok) { setErr(d?.note ?? t('failShort')); return; }
      setOk(d.note ?? t('ok'));
      form.reset();
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>{t('subject')}</span><input name="subject" maxLength={100} required /></label>
      <label className="fld"><span>{t('body')}</span><textarea name="body" rows={4} maxLength={5000} required /></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      {ok && <p className="ok-note" role="status">{ok} {t('okSuffix')}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('pending') : t('submit')}</button></div>
    </form>
  );
}
