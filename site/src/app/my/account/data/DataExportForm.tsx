'use client';
/**
 * SB-MYP-DAT-010 내 정보 내려받기 폼 (v10.181 · D170) — 비밀번호 → 서버 액션 exportMyData → 파일로 저장
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Res = { ok: true; fileName: string; json: string } | { ok: false; code: string; message: string };

export function DataExportForm({ action }: { action: (password: string) => Promise<Res> }) {
  const t = useTranslations('my.data');
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
    start(async () => {
      const r = await action(pw);
      if (!r.ok) { setErr(r.message); return; }
      const url = URL.createObjectURL(new Blob([r.json], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      form.reset();
      setDone(t('done', { file: r.fileName }));
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit} data-export-form="">
      <label className="fld"><span>{t('password')}</span><input name="password" type="password" autoComplete="current-password" maxLength={100} /></label>
      {err && <div className="my-nt warn" role="alert" data-export-err="">{err}</div>}
      {done && <div className="my-nt ok" role="status" data-export-done="">{done}</div>}
      <div className="my-btns"><button className="my-bp" type="submit" disabled={pending} data-export-submit="">{pending ? t('working') : t('submit')}</button></div>
    </form>
  );
}
