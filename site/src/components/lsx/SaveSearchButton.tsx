'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { lsxCall } from './api';

/**
 * v10.513 (D276 · docs/651) 「이 검색 저장」 — 통합 검색 결과 위(SB-HOM-SRC-010).
 *   스위치(lsx.saved_search)가 꺼져 있으면 서버가 422 LSX_OFF — 단추는 그 글을 보여 줌. 로그인 전이면 로그인 안내.
 */
export function SaveSearchButton({ q, gwanCode }: { q: string; gwanCode?: string }) {
  const t = useTranslations('lsx');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; login?: boolean } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await lsxCall('/me/saved-searches', 'POST', { keyword: q, ...(gwanCode ? { gwanCode } : {}), name: q.slice(0, 40) });
      if (r.ok) setMsg({ ok: true, text: t('saved') });
      else if (r.status === 401 || r.status === 403) setMsg({ ok: false, text: t('saveLogin'), login: true });
      else setMsg({ ok: false, text: r.body.message ?? t('saveFail') });
    } catch { setMsg({ ok: false, text: t('saveFail') }); } finally { setBusy(false); }
  }
  return (
    <span className="lsx-save" data-lsx-save="">
      <button type="button" className="btn-sm" disabled={busy} onClick={save}>{busy ? t('saveBusy') : t('saveBtn')}</button>
      {msg && (
        <span className={msg.ok ? 'lsx-ok' : 'warn-text'} role="status">
          {' '}{msg.text}{' '}
          {msg.ok && <Link href="/my/saved-searches">{t('savedLink')}</Link>}
          {msg.login && <Link href="/login">{t('login')}</Link>}
        </span>
      )}
    </span>
  );
}
