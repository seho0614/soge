import type { Metadata } from 'next';
import Link from 'next/link';
import { faqs } from '@/lib/content';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { ChatBot, type BotQa } from '@/components/support/ChatBot';
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('support') };
}

/**
 * SB-HOM-CSB-010 1:1 문의(챗봇) — v10.31 시안 scAsk1. 먼저 챗봇이 답하고, 사람이 판단할 일은 상담원에게 넘깁니다.
 *   답 글은 서버 FAQ(channel=BOT). 자주 묻는 질문 · 문의하기 폼은 고객센터(/support/new — 시안 cs)로 옮겼습니다.
 */
export default async function SupportPage() {
  const [qa, user] = await Promise.all([faqs(undefined, 'BOT'), me().catch(() => null)]);
  const t = await getTranslations('deal.support');
  const list: BotQa[] = qa.map((f) => ({ question: f.question, answer: f.answer, keywords: f.keywords ?? [], linkHref: f.linkHref ?? null, linkLabel: f.linkLabel ?? null, handoff: !!f.handoff }));
  return (
    <div className="w1 w1-wrap w1-csb" data-screen="SB-HOM-CSB-010">{/* v10.32 — 시안 .wrap.srcw 폭(가운데 좁은 폭 1100px 를 뺌) · 대화 칸 높이 */}
      <BackBar href="/support/new" label={t('backCs')} wrap={false} />
      <div className="w1-pgh">
        <div><h1>{t('title')}</h1><p>{t('lead')}</p></div>
        <span className="w1-did">{t('botOn')}</span>
      </div>
      <Msgs ns={['deal']}><ChatBot qa={list} loggedIn={!!user} /></Msgs>
      <p className="w1-ls" style={{ marginTop: 14 }}>{t.rich('disputeFoot', { link: (x) => <Link href="/support/dispute">{x}</Link> })}</p>
    </div>
  );
}
