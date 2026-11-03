'use client';
/**
 * SB-MYP-SEC-010 모든 기기 로그아웃 (v10.181 · D170) — 비밀번호 · 확인 → 서버 액션 logoutAllDevices
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Act = { ok: true; note?: string } | { ok: false; code: string; message: string };

export function LogoutAllForm({ action }: { action: (password: string) => Promise<Act> }) {
  const t = useTranslations('my.security');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = String(new FormData(form).get('password') ?? '');
    setErr(null); setDone(null);
    if (!pw) { setErr(t('errPw')); return; }
    if (!confirm(t('confirm'))) return;
    start(async () => {
      const r = await action(pw);
      if (!r.ok) { setErr(r.message); return; }
      form.reset();
      setDone(r.note ?? t('done'));
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit} data-logout-all-form="">
      <label className="fld"><span>{t('password')}</span><input name="password" type="password" autoComplete="current-password" maxLength={100} /></label>
      {err && <div className="my-nt warn" role="alert" data-logout-all-err="">{err}</div>}
      {done && <div className="my-nt ok" role="status" data-logout-all-done="">{done}</div>}
      <div className="my-btns"><button className="my-bp" type="submit" disabled={pending} data-logout-all-submit="">{t('submit')}</button></div>
    </form>
  );
}
