'use client';

/**
 * v10.332 (D224 · docs/463) — 고객센터 홈의 도움말 찾기 · 분야 탭 · 많이 찾는 질문
 *   대표 11/17 「보통의 고객센터 기능(당근 · 네이버 참조)」 — 맨 위 「무엇을 도와드릴까요?」 찾기 → 분야 탭 → 질문 펼치기.
 *   질문 글은 서버 FAQ(GET /faq — 운영 화면 「자주 묻는 질문」에서 고침). 찾는 것이 없으면 1:1 문의(챗봇) · 문의하기 폼으로 잇습니다.
 */
import { useMemo, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface HubFaq {
  id: string; question: string; answer: string; topic: string; isTop: boolean;
  keywords: string[]; linkHref: string | null; linkLabel: string | null;
}

const TOPICS = ['ACCOUNT', 'DEAL', 'MONEY', 'MALL', 'ADS', 'SAFETY', 'ETC'] as const;
type Tab = 'TOP' | (typeof TOPICS)[number];
const TOP_MAX = 10;

/* v10.334 (D226 · docs/465) — 펼침 · 「도움이 되었나요?」는 같은 브라우저에서 질문마다 하루 한 번만 보냄(서버는 하루 셈만 · 사람 정보 없음) */
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
function once(key: string): boolean {
  try {
    if (localStorage.getItem(key) === today()) return false;
    localStorage.setItem(key, today());
  } catch { /* 저장소가 막힌 브라우저는 매번 보냄 */ }
  return true;
}
const post = (path: string, body?: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).catch(() => undefined);

function Item({ f, open }: { f: HubFaq; open?: boolean }) {
  const t = useTranslations('deal.support.hub');
  const [voted, setVoted] = useState(false);
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && once(`sgb_faq_v:${f.id}`)) void post(`/api/v1/faq/${f.id}/view`);
  };
  const vote = (yes: boolean) => {
    setVoted(true);
    if (once(`sgb_faq_h:${f.id}`)) void post(`/api/v1/faq/${f.id}/helpful`, { yes });
  };
  return (
    <details data-cs-faq={f.id} data-cs-topic={f.topic} open={open} onToggle={onToggle}>
      <summary>{f.question}</summary>
      <p>{f.answer}</p>
      {f.linkHref && f.linkLabel && <p className="w1-cs-go"><Link href={f.linkHref}>{f.linkLabel} →</Link></p>}
      <p className="w1-cs-help" data-cs-help={f.id}>
        {voted ? <span data-cs-help-done="">{t('helpThanks')}</span> : <>
          {t('helpQ')}{' '}
          <button type="button" onClick={() => vote(true)} data-cs-help-yes="">{t('helpYes')}</button>{' '}
          <button type="button" onClick={() => vote(false)} data-cs-help-no="">{t('helpNo')}</button></>}
      </p>
    </details>
  );
}

export function CsHub({ faqs }: { faqs: HubFaq[] }) {
  const t = useTranslations('deal.support.hub');
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<Tab>('TOP');
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
            {(['TOP', ...tabs] as Tab[]).map((k) => (
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
