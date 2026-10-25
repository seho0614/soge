'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 소개광장 「번역 보기」 (v10.105 · 다국어 3-3 · docs/163).
 *   누를 때만 번역합니다(글을 열 때마다 부르지 않음 — 비용). 화면 언어는 API 가 쿠키 sgb_lang 으로 봅니다.
 *   비회원은 방문자 쿠키(sgb_visitor)로 하루 횟수를 셉니다. 번역은 저장되어 다음 사람은 비용 없이 봅니다.
 */
export function TranslateButton({ postId }: { postId: string }) {
  const t = useTranslations('plaza.mt');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const v = /(?:^|;\s*)sgb_visitor=([A-Za-z0-9-]{8,64})/.exec(document.cookie)?.[1];
      const r = await fetch(`/api/v1/community/posts/${postId}/translate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(v ? { 'X-Visitor-Key': v } : {}) },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.message ?? t('fail')); return; }
      router.refresh();
    } catch {
      setErr(t('fail'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="plz-meta" data-mt-btn="">
      <button type="button" className="btn-sm ghost" disabled={busy} onClick={() => void go()}>{busy ? t('busy') : t('translate')}</button>
      {err && <span className="form-error" role="alert">{err}</span>}
    </p>
  );
}
