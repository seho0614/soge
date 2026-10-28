import type { Metadata } from 'next';
import Link from 'next/link';
import { faqs } from '@/lib/content';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { InquiryForm, type MyDeal } from '@/components/InquiryForm';
import { CS_HOURS } from '@/components/support/hours';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('supportNew') };
}

/**
 * SB-HOM-ETC-030 고객센터 · 문의하기 — v10.31 시안 scCs 그대로:
 *   「고객센터」 머리 · 「바로 물어보기 — 1:1 문의」 띠(→ /support 챗봇) · 자주 묻는 질문 접기(서버 FAQ — CS · FAQ) · 운영 안내 · 문의하기 폼.
 */
export default async function NewInquiryPage({ searchParams }: { searchParams: Promise<{ type?: string; deal?: string; draft?: string }> }) {
  const sp = await searchParams;
  const user = await me().catch(() => null);
  /* v10.139 (AI 상담 4단계 · docs/209) — ?draft= 면 본인 초안으로 칸을 채움(없음 · 만료 · 남의 것이면 빈 화면) · 제출은 회원이 */
  const draftId = user && sp.draft && /^[0-9a-f-]{36}$/i.test(sp.draft) ? sp.draft : null;
  const [cs, base, sum, deals, draft] = await Promise.all([
    faqs(undefined, 'CS'), faqs(),
    user ? apiGetPersonal<{ email?: string | null }>('/me/summary').catch(() => null) : Promise.resolve(null),
    user ? apiGetPersonal<MyDeal[]>('/me/deals?limit=30').catch(() => [] as MyDeal[]) : Promise.resolve([] as MyDeal[]),
    draftId ? apiGetPersonal<{ id: string; kind: string; fields: { category?: string; title?: string; body?: string } }>(`/me/agent/drafts/${draftId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const aiDraft = draft?.kind === 'INQUIRY' ? { id: draft.id, ...draft.fields } : undefined;
  const t = await getTranslations('deal');
  const list = [...cs, ...base.filter((f) => !cs.some((c) => c.question === f.question))];
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-030" style={{ maxWidth: 1100 }}>
      <BackBar href="/" label={t('common.prevScreen')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('support.newTitle')}</h1>
        <p>{t.rich('support.newLead', { b: (x) => <b>{x}</b> })}</p>
      </div>
      <div className="w1-csbot">
        <div><b>{t('support.botTitle')}</b>
          <p>{t('support.botBody')}</p></div>
        <Link className="w1-bp" href="/support">{t('support.botOpen')}</Link>
      </div>
      <div className="w1-csg">
        <div>
          <div className="w1-sh4">{t('support.faq')}</div>
          {list.length ? (
            <div className="w1-faq">
              {list.map((f) => <details key={f.question}><summary>{f.question}</summary><p>{f.answer}</p></details>)}
            </div>
          ) : <div className="w1-empty">{t('support.faqEmpty')}</div>}
        </div>
        <aside className="w1-csa">
          <div className="w1-sh4">{t('support.ops')}</div>
          <dl className="w1-kv">
            <dt>{t('support.opsOpen')}</dt><dd>{t(CS_HOURS.open)}</dd>
            <dt>{t('support.opsLunch')}</dt><dd>{t(CS_HOURS.lunch)}</dd>
            <dt>{t('support.opsAvg')}</dt><dd>{t(CS_HOURS.avg)}</dd>
            <dt>{t('support.opsHoliday')}</dt><dd>{t(CS_HOURS.holiday)}</dd>
          </dl>
          <div className="w1-nt" style={{ marginTop: 10 }}>{t.rich('support.payDay', { b: (x) => <b>{x}</b> })}</div>
          <p className="w1-ls" style={{ marginTop: 10 }}>{t.rich('support.newFoot', { guide: (x) => <Link href="/safety/guide">{x}</Link>, hist: (x) => <Link href="/support/history">{x}</Link> })}</p>
        </aside>
      </div>
      <Msgs ns={['forms']}><InquiryForm email={sum?.email ?? null} deals={deals} loggedIn={!!user} initialType={aiDraft?.category ?? sp.type} initialDeal={sp.deal} draft={aiDraft} /></Msgs>
    </div>
  );
}
