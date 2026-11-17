'use client';
/**
 * v10.341 (D231 · docs/474) — 내 문의 내역 답변 아래 「해결됨 / 아직 해결 안 됨」
 *   아직 해결 안 됨 = 문의가 다시 열리고 영업일 1일 안에 다시 답이 옴. 운영자가 다시 답하면 다시 고를 수 있음.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function InquiryFeedback({ id, feedback }: { id: string; feedback: string | null }) {
  const t = useTranslations('deal.support');
  const router = useRouter();
  const [fb, setFb] = useState(feedback);
  const [busy, setBusy] = useState(false);
  const send = async (resolved: boolean) => {
    setBusy(true);
    const r = await fetch(`/api/v1/me/inquiries/${id}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setFb(resolved ? 'RESOLVED' : 'UNRESOLVED'); router.refresh(); }
  };
  if (fb === 'RESOLVED') return <p className="w1-ls" data-inq-fb="RESOLVED">{t('fbDoneYes')}</p>;
  if (fb === 'UNRESOLVED') return <p className="w1-ls" data-inq-fb="UNRESOLVED">{t('fbDoneNo')}</p>;
  return (
    <p className="w1-ls" data-inq-fb="">
      {t('fbQ')}{' '}
      <button type="button" className="w1-bo" disabled={busy} onClick={() => void send(true)} data-inq-fb-yes="">{t('fbYes')}</button>{' '}
      <button type="button" className="w1-bo" disabled={busy} onClick={() => void send(false)} data-inq-fb-no="">{t('fbNo')}</button>
    </p>
  );
}
