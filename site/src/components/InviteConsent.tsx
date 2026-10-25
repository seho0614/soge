'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Props = { token: string; introducer: string; consented?: boolean };

/**
 * 초대 동의 · 거절 (시안 「동의하고 연결」 · 「거절」).
 *
 * ── 거절도 버튼으로 받습니다 ── 그냥 닫아 버리면 소개자는 답을 기다리며 계속 붙잡혀 있습니다.
 * ── 동의 뒤 ── 서버가 연결을 만들고, 로그인한 분이면 요청자와의 1:1 대화를 엽니다(chatId).
 *   로그인 전이면 동의만 기록됩니다 — 로그인하고 같은 링크에서 「대화 열기」를 누르면 대화가 열립니다.
 */
export function InviteConsent({ token, introducer, consented }: Props) {
  const router = useRouter();
  const t = useTranslations('deal.invite');
  const [busy, setBusy] = useState<'agree' | 'decline' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function send(agree: boolean) {
    if (!agree && !window.confirm(t('declineAsk'))) return;
    setBusy(agree ? 'agree' : 'decline');
    setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/v1/invites/${encodeURIComponent(token)}/consent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agree }),
      });
      const r = (await res.json().catch(() => ({}))) as { chatId?: string | null; note?: string; message?: string };
      if (!res.ok) { setErr(r.message ?? t('fail')); setBusy(null); return; }
      if (agree && r.chatId) { router.push(`/chat/${r.chatId}`); return; }
      setNote(r.note ?? null);
      router.refresh();
    } catch {
      setErr(t('cut'));
    }
    setBusy(null);
  }

  if (consented) {
    return (
      <div>
        <div className="w1-nt ok">{t.rich('consented', { b: (x) => <b>{x}</b> })}</div>
        <div className="w1-prfact" style={{ marginTop: 10 }}>
          <button type="button" className="w1-bp" disabled={busy !== null} onClick={() => void send(true)}>{busy ? t('opening') : t('open')}</button>
          <Link className="w1-bo" href={`/login?next=/i/${encodeURIComponent(token)}`}>{t('login')}</Link>
        </div>
        {note && <p className="w1-ok" role="status">{note}</p>}
        {err && <p className="w1-err" role="alert">{err}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="w1-prfact">
        <button type="button" className="w1-bp" disabled={busy !== null} onClick={() => void send(true)}>
          {busy === 'agree' ? t('connecting') : t('agree')}
        </button>
        <button type="button" className="w1-bo" disabled={busy !== null} onClick={() => void send(false)}>
          {busy === 'decline' ? t('declining') : t('decline')}
        </button>
      </div>
      {note && <p className="w1-ok" role="status">{note}</p>}
      {err && <p className="w1-err" role="alert">{err}</p>}
      <p className="w1-ls" style={{ marginTop: 8 }}>{t('note', { name: introducer })}</p>
    </div>
  );
}
