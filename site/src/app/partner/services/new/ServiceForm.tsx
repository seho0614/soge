'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function ServiceForm() {
  const t = useTranslations('partnerOps.svcNew.form');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit() {
    setErr(null); setOk(null);
    const res = await fetch('/api/v1/partner/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 반려 사유는 서버가 만든 것을 그대로 보여 줍니다.
      // 화면에서 다시 쓰면 어느 표현이 걸렸는지가 사라집니다.
      setErr(b.message ?? t('fail'));
      return;
    }
    setOk(b.note ?? t('requested'));
    start(() => router.push('/partner/services'));
  }

  return (
    <section>
      <label className="fld">
        <span>{t('name')}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder={t('namePh')} />
      </label>

      <label className="fld">
        <span>{t('desc')}</span>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder={t('descPh')} />
      </label>

      {/* v10.29 — 시안 단추(.bp) */}
      <button className="pt-bp" onClick={submit} disabled={pending || !title || !body}>
        {pending ? t('sending') : t('submit')}
      </button>

      {err && <div className="pt-nt warn notice">{err}</div>}
      {ok && <div className="pt-nt ok notice">{ok}</div>}
    </section>
  );
}
