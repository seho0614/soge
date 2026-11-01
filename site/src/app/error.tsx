'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v10.174 (docs/268) — 화면을 그리다 오류가 나면(서버 응답 실패 · 부품 오류) Next 기본 영어 화면 대신 이 안내.
 *   머리줄 · 바닥줄은 그대로 남고 본문만 바뀝니다. 「다시 시도」는 그 화면만 다시 그림(reset).
 *   오류 번호(digest)는 서버 기록과 맞춰 볼 때 씁니다 — 오류 내용은 손님에게 보이지 않음.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errorPage');
  useEffect(() => { console.error(error); }, [error]);
  return (
    <article className="doc" data-error-page="">
      <h1>{t('title')}</h1>
      <p>{t('body')}</p>
      <p>
        <button type="button" className="btn-sm" onClick={() => reset()} data-error-retry="">{t('retry')}</button>{' '}
        <Link className="btn-sm" href="/">{t('home')}</Link>{' '}
        <Link className="btn-sm" href="/support/new">{t('support')}</Link>
      </p>
      {error.digest && <p className="dim" data-error-digest="">{t('code')} {error.digest}</p>}
    </article>
  );
}
