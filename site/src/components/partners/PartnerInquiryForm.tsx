'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AffResult } from './types';

/** 1:1 문의 접수 — POST /partner/affiliate/inquiries (제목 2~100자 · 내용 5~5000자) */
export function PartnerInquiryForm() {
  const router = useRouter();
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
    if (subject.length < 2) { setErr('제목을 두 글자 이상 쓰십시오.'); return; }
    if (body.length < 5) { setErr('내용을 다섯 글자 이상 쓰십시오.'); return; }
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const d = (await r.json().catch(() => null)) as (AffResult & { message?: string }) | null;
      if (!r.ok) { setErr(d?.message ?? '접수하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); return; }
      if (!d?.ok) { setErr(d?.note ?? '접수하지 못했습니다.'); return; }
      setOk(d.note ?? '접수했습니다.');
      form.reset();
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>제목</span><input name="subject" maxLength={100} required /></label>
      <label className="fld"><span>내용</span><textarea name="body" rows={4} maxLength={5000} required /></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      {ok && <p className="ok-note" role="status">{ok} 답변이 달리면 위 목록에서 보실 수 있습니다.</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? '접수 중…' : '문의하기'}</button></div>
    </form>
  );
}
