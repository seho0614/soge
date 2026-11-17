'use client';

/**
 * v10.332 (D224 · docs/463) — 고객센터 홈의 도움말 찾기 · 분야 탭 · 많이 찾는 질문
 *   대표 11/17 「보통의 고객센터 기능(당근 · 네이버 참조)」 — 맨 위 「무엇을 도와드릴까요?」 찾기 → 분야 탭 → 질문 펼치기.
 *   질문 글은 서버 FAQ(GET /faq — 운영 화면 「자주 묻는 질문」에서 고침). 찾는 것이 없으면 1:1 문의(챗봇) · 문의하기 폼으로 잇습니다.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface HubFaq {
  id: string; question: string; answer: string; topic: string; isTop: boolean;
  keywords: string[]; linkHref: string | null; linkLabel: string | null;
}

const TOPICS = ['ACCOUNT', 'DEAL', 'MONEY', 'MALL', 'ADS', 'SAFETY', 'ETC'] as const;
const TOP_MAX = 10;

function Item({ f, open }: { f: HubFaq; open?: boolean }) {
  return (
    <details data-cs-faq={f.id} data-cs-topic={f.topic} open={open}>
      <summary>{f.question}</summary>
      <p>{f.answer}</p>
      {f.linkHref && f.linkLabel && <p className="w1-cs-go"><Link href={f.linkHref}>{f.linkLabel} →</Link></p>}
    </details>
  );
}

export function CsHub({ faqs }: { faqs: HubFaq[] }) {
  const t = useTranslations('deal.support.hub');
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<string>('TOP');
  const word = q.trim().toLowerCase();
  const found = useMemo(() => !word ? [] : faqs.filter((f) =>
    f.question.toLowerCase().includes(word) || f.answer.toLowerCase().includes(word) || f.keywords.some((k) => k.toLowerCase().includes(word) || word.includes(k.toLowerCase()))), [faqs, word]);
  const top = useMemo(() => {
    const picked = faqs.filter((f) => f.isTop);
    return (picked.length ? picked : faqs).slice(0, TOP_MAX);
  }, [faqs]);
  const tabs = TOPICS.filter((k) => faqs.some((f) => f.topic === k));
  const list = topic === 'TOP' ? top : faqs.filter((f) => f.topic === topic);

  return (
    <div data-cs-hub="">
      <form className="w1-cs-find" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="cs-q">{t('findH')}</label>
        <div>
          <input id="cs-q" name="cs-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('findPh')} maxLength={50} autoComplete="off" data-cs-q="" />
        </div>
      </form>
      {word ? (
        <section data-cs-found={found.length}>
          <div className="w1-sh4">{t('foundH', { q: q.trim(), n: found.length })}</div>
          {found.length
            ? <div className="w1-faq">{found.map((f) => <Item key={f.id} f={f} />)}</div>
            : <div className="w1-empty" data-cs-none="">{t('none')} <Link href="/support">{t('askBot')}</Link> · <a href="#cs-form">{t('askForm')}</a></div>}
        </section>
      ) : (
        <section>
          <div className="w1-cs-tabs" role="tablist" aria-label={t('tabsLabel')}>
            {['TOP', ...tabs].map((k) => (
              <button key={k} type="button" role="tab" aria-selected={topic === k} className={topic === k ? 'on' : undefined}
                onClick={() => setTopic(k)} data-cs-tab={k}>{t(`topic.${k}`)}</button>
            ))}
          </div>
          {list.length
            ? <div className="w1-faq" data-cs-list={topic}>{list.map((f) => <Item key={f.id} f={f} />)}</div>
            : <div className="w1-empty">{t('empty')}</div>}
        </section>
      )}
    </div>
  );
}
