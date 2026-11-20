'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';

/**
 * v10.505 (D274 · docs/643) 품절 옵션 「입고되면 알림」 — SB-HLT-PRD-010 옵션 줄 · SB-HLT-MLX-010
 *   POST /api/v1/me/health/restock { optionId } — 로그인이 필요하면 로그인 화면으로(돌아올 주소 붙임)
 *   상품 화면이 mall.restock_alert(공개 설정)가 on 일 때만 이 단추를 그립니다.
 */
export function RestockButton({ optionId }: { optionId: string }) {
  const t = useTranslations('order');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function go() {
    setMsg(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/restock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`); return; }
        setMsg({ ok: false, text: d?.message ?? t('restockFail') });
        return;
      }
      setMsg({ ok: true, text: d?.already ? t('restockAlready') : t('restockDone') });
    });
  }
  return (
    <span data-restock={optionId}>
      <button type="button" className="hlt-btn sm" disabled={pending || msg?.ok === true} onClick={go}>{t('restockBtn')}</button>
      {msg && <span className={msg.ok ? 'hlt-sm hlt-mut3' : 'form-error'} role={msg.ok ? 'status' : 'alert'}> {msg.text}</span>}
    </span>
  );
}
