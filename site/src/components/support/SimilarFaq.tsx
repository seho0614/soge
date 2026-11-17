'use client';
/**
 * v10.340 (D230 · docs/473) — 문의하기 폼 제목 아래 「혹시 이 질문인가요?」
 *   제목 낱말(2자 이상)이 질문 · 챗봇 낱말에 많이 든 순으로 3개. 답을 펼쳐 보고 「이걸로 해결됨」을 누르면 그날 셈 +1(사람 정보 없음 ·
 *   같은 브라우저에서 질문마다 하루 한 번). 문의는 그대로 보낼 수 있습니다.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface SimilarItem { id: string; question: string; answer: string; keywords: string[]; linkHref: string | null; linkLabel: string | null }

const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
function once(key: string): boolean {
  try {
    if (localStorage.getItem(key) === today()) return false;
    localStorage.setItem(key, today());
  } catch { /* 저장소가 막힌 브라우저는 매번 보냄 */ }
  return true;
}

export function pickSimilar(faqs: SimilarItem[], title: string, max = 3): SimilarItem[] {
  const words = [...new Set(title.toLowerCase().split(/[\s,.?!·~]+/).filter((w) => w.length >= 2))];
  if (!words.length) return [];
  return faqs
    .map((f) => {
      const q = f.question.toLowerCase(), ks = f.keywords.map((k) => k.toLowerCase());
      const score = words.reduce((a, w) => a + (q.includes(w) ? 2 : 0) + (ks.some((k) => k.includes(w) || w.includes(k)) ? 1 : 0), 0);
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, max)
    .map((x) => x.f);
}

export function SimilarFaq({ faqs, title }: { faqs: SimilarItem[]; title: string }) {
  const t = useTranslations('forms.inq');
  const [done, setDone] = useState<string | null>(null);
  const list = useMemo(() => (title.trim().length >= 2 ? pickSimilar(faqs, title) : []), [faqs, title]);
  if (!list.length) return null;
  const solved = (id: string) => {
    if (once(`sgb_faq_d:${id}`)) void fetch(`/api/v1/faq/${id}/deflect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
    setDone(id);
  };
  return (
    <div className="w1-nt" data-similar-faq={list.length}>
      <b>{t('similarH')}</b>
      {list.map((f) => (
        <details key={f.id} data-similar-item={f.id}>
          <summary>{f.question}</summary>
          <p style={{ whiteSpace: 'pre-line' }}>{f.answer}</p>
          {f.linkHref && f.linkLabel && <p><Link href={f.linkHref}>{f.linkLabel} →</Link></p>}
          {done === f.id
            ? <p data-similar-done="">{t('similarThanks')}</p>
            : <button type="button" className="w1-bo" onClick={() => solved(f.id)} data-similar-yes="">{t('similarYes')}</button>}
        </details>
      ))}
    </div>
  );
}
