'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/* v10.729 (D325 · docs/837) 손님 한 줄 의견 — 「도움이 됐나요?」 예 · 아니오 → 한 줄(200자 · 선택) → 보내기
 *   로그인 없이 · 쿠키 · 계정을 보내지 않음(credentials omit) · 서버가 같은 기기 같은 페이지 하루 한 번만 받음 */
export function FeedbackBlock({ kind, refKey, title }: { kind: 'LAYOUT' | 'PAGE'; refKey: string; title: string }) {
  const t = useTranslations('gwan.feedback');
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const send = () => {
    if (helpful === null) return;
    void fetch('/api/v1/page-feedback', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ref: refKey, helpful, comment: comment.trim() || undefined }) }).catch(() => undefined).finally(() => setDone(true));
  };
  if (done) return <section className="gp-feedback" data-page-feedback="done"><p>{t('thanks')}</p></section>;
  return (
    <section className="gp-feedback" data-page-feedback={refKey}>
      <h2 className="gp-h">{title}</h2>
      <div className="quick">
        <button type="button" className={helpful === true ? 'on' : ''} onClick={() => setHelpful(true)} aria-pressed={helpful === true}>{t('yes')}</button>
        <button type="button" className={helpful === false ? 'on' : ''} onClick={() => setHelpful(false)} aria-pressed={helpful === false}>{t('no')}</button>
      </div>
      {helpful !== null && (
        <p><input value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} placeholder={t('placeholder')} aria-label={t('placeholder')} style={{ width: '100%', maxWidth: 520 }} />{' '}
          <button type="button" className="btn-ok" onClick={send} data-page-feedback-send>{t('send')}</button></p>
      )}
    </section>
  );
}
