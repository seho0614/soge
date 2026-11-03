'use client';
/**
 * SB-MYP-PRV-010 개인정보 권리 요청 폼 (v10.181 · D170) — 종류 · 내용 → 서버 액션 createPrivacyRequest
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Act = { ok: true; note?: string } | { ok: false; code: string; message: string };

export function PrivacyRequestForm({ kinds, action }: {
  kinds: Array<{ code: string; label: string }>;
  action: (kind: string, body: string) => Promise<Act>;
}) {
  const t = useTranslations('my.privacy');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    setErr(null); setDone(null);
    if (!kind) { setErr(t('errKind')); return; }
    if (body.length < 5) { setErr(t('errBody')); return; }
    start(async () => {
      const r = await action(kind, body);
      if (!r.ok) { setErr(r.message); return; }
      form.reset(); setKind('');
      setDone(r.note ?? t('done'));
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit} data-privacy-form="">
      <label className="fld"><span>{t('kindLabel')}</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('choose')}</option>
          {kinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select></label>
      <label className="fld"><span>{t('bodyLabel')}</span>
        <textarea name="body" rows={4} maxLength={1000} placeholder={t('bodyPh')} /></label>
      {err && <div className="my-nt warn" role="alert" data-privacy-err="">{err}</div>}
      {done && <div className="my-nt ok" role="status" data-privacy-done="">{done}</div>}
      <div className="my-btns"><button className="my-bp" type="submit" disabled={pending} data-privacy-submit="">{t('submit')}</button></div>
    </form>
  );
}
