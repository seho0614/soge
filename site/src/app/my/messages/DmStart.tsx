'use client';
/** v10.504 (D273 · docs/642) 회원 대화 열기 단추 — POST /me/dm(거래 · 문의 번호 + 상대 쪽만 · 상대 계정 번호는 보내지 않음) */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function DmStart({ basisType, basisId, side }: { basisType: 'DEAL' | 'INQUIRY'; basisId: string; side: string }) {
  const t = useTranslations('mbx.dm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function open() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/me/dm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ basisType, basisId, side }) });
      const d = await r.json().catch(() => null) as { id?: string; code?: string; message?: string } | null;
      if (!r.ok || !d?.id) { setMsg(d?.code === 'IDENTITY_REQUIRED' ? t('needIdentity') : d?.message ?? t('failed')); return; }
      router.push(`/my/messages/${d.id}`);
    } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className="mbx-btn pri" disabled={busy} onClick={() => void open()} data-mbx-dm-start={side}>{t('start')}</button>
      {msg && <span className="m" role="status">{msg}</span>}
    </>
  );
}
