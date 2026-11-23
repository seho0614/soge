import type { Metadata } from 'next';
import Link from 'next/link';
import { faqs } from '@/lib/content';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { InquiryForm, type MyDeal } from '@/components/InquiryForm';
import { CS_HOURS } from '@/components/support/hours';
import { ymdKst } from '@/lib/format';
import { CsHub, type HubFaq } from '@/components/support/CsHub';
import type { HomeNotice } from '@/components/home/types';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('supportNew') };
}

/**
 * SB-HOM-ETC-030 고객센터 · 문의하기 — v10.31 시안 scCs 그대로:
 *   「고객센터」 머리 · 「바로 물어보기 — 1:1 문의」 띠(→ /support 챗봇) · 자주 묻는 질문 접기(서버 FAQ — CS · FAQ) · 운영 안내 · 문의하기 폼.
 * v10.332 (D224 · docs/463) — 대표 11/17 「고객센터 링크 · 보통의 고객센터 기능」: 머리줄 「고객센터」 → 이 화면(고객센터 홈).
 *   「무엇을 도와드릴까요?」 찾기 · 바로가기 8칸 · 분야 탭 · 많이 찾는 질문(운영 화면 「자주 묻는 질문」) · 최근 공지 3건 · 운영 안내 · 문의하기 폼.
 */
const QUICK = [
  ['bot', '/support'], ['hist', '/support/history'], ['dispute', '/support/dispute'], ['scam', '/safety/guide'],
  ['notice', '/community?board=NOTICE'], ['guide', '/guide'], ['terms', '/guide#terms'], ['account', '/my'],
] as const;

export default async function NewInquiryPage({ searchParams }: { searchParams: Promise<{ type?: string; deal?: string; draft?: string; gwan?: string; page?: string }> }) {
  const sp = await searchParams;
  const user = await me().catch(() => null);
  /* v10.139 (AI 상담 4단계 · docs/209) — ?draft= 면 본인 초안으로 칸을 채움(없음 · 만료 · 남의 것이면 빈 화면) · 제출은 회원이 */
  const draftId = user && sp.draft && /^[0-9a-f-]{36}$/i.test(sp.draft) ? sp.draft : null;
  const [cs, base, sum, deals, draft, st, ntc] = await Promise.all([
    faqs(undefined, 'CS'), faqs(),
    user ? apiGetPersonal<{ email?: string | null }>('/me/summary').catch(() => null) : Promise.resolve(null),
    user ? apiGetPersonal<MyDeal[]>('/me/deals?limit=30').catch(() => [] as MyDeal[]) : Promise.resolve([] as MyDeal[]),
    draftId ? apiGetPersonal<{ id: string; kind: string; fields: { category?: string; title?: string; body?: string } }>(`/me/agent/drafts/${draftId}`).catch(() => null) : Promise.resolve(null),
    /* v10.171 (docs/264) — 연락처 · 개인정보 문의(바닥줄과 같은 설정) */
    apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>)),
    apiGetPersonal<HomeNotice[]>('/notices').catch(() => [] as HomeNotice[]),
  ]);
  const aiDraft = draft?.kind === 'INQUIRY' ? { id: draft.id, ...draft.fields } : undefined;
  const t = await getTranslations('deal');
  const list = [...cs, ...base.filter((f) => !cs.some((c) => c.question === f.question))];
  const hub: HubFaq[] = list.filter((f) => f.id).map((f) => ({ id: f.id!, question: f.question, answer: f.answer, topic: f.topic ?? 'ETC', isTop: !!f.isTop,
    keywords: f.keywords ?? [], linkHref: f.linkHref ?? null, linkLabel: f.linkLabel ?? null }));
  const notices = ntc.slice(0, 3);
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
      <nav className="w1-cs-quick" aria-label={t('support.hub.quickLabel')} data-cs-quick="">
        {QUICK.map(([k, href]) => <Link key={k} href={href} data-cs-go={k}><b>{t(`support.hub.quick.${k}`)}</b><span>{t(`support.hub.quickSub.${k}`)}</span></Link>)}
      </nav>
      <div className="w1-csg">
        <div>
          <div className="w1-sh4">{t('support.faq')}</div>
          {hub.length ? <Msgs ns={['deal']}><CsHub faqs={hub} /></Msgs> : <div className="w1-empty">{t('support.faqEmpty')}</div>}
          <div className="w1-sh4" style={{ marginTop: 18 }}>{t('support.hub.ntcH')} <Link className="w1-cs-more" href="/community?board=NOTICE">{t('support.hub.more')}</Link></div>
          {notices.length ? (
            <ul className="w1-cs-ntc" data-cs-notices={notices.length}>
              {notices.map((n) => (
                <li key={n.id}>
                  <Link href={`/community?board=NOTICE#n-${n.id}`}>{n.isPinned && <em>{t('support.ntcPinned')}</em>}{n.unread && <em className="new">{t('support.ntcNew')}</em>}{n.title}</Link>
                  {n.publishedAt && <time dateTime={n.publishedAt}>{ymdKst(n.publishedAt)}</time>}
                </li>
              ))}
            </ul>
          ) : <div className="w1-empty">{t('support.ntcEmpty')}</div>}
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
          {/* v10.171 (docs/264) — 사용자 웹 공개(11/1) 뒤 손님이 찾는 연락처 · 개인정보 문의 · 분쟁 · 사기 안내 */}
          <div className="w1-sh4" style={{ marginTop: 14 }}>{t('support.contact')}</div>
          <dl className="w1-kv" data-support-contact="">
            {st['footer.phone'] && <><dt>{t('support.contactPhone')}</dt><dd><a href={`tel:${st['footer.phone']}`}>{st['footer.phone']}</a></dd></>}
            {(st['footer.privacy_email'] || st['footer.privacy_contact']) && <><dt>{t('support.contactPrivacy')}</dt>
              <dd data-privacy-email={st['footer.privacy_email'] ?? ''}>{st['footer.privacy_officer'] ? `${st['footer.privacy_officer']} · ` : ''}
                {st['footer.privacy_email'] ? <a href={`mailto:${st['footer.privacy_email']}`}>{st['footer.privacy_email']}</a> : st['footer.privacy_contact']}</dd></>}
            <dt>{t('support.contactDispute')}</dt><dd><Link href="/support/dispute">{t('support.contactDisputeGo')}</Link></dd>
            <dt>{t('support.contactScam')}</dt><dd><Link href="/safety/guide">{t('support.contactScamGo')}</Link></dd>
            <dt>{t('support.ntcTitle')}</dt><dd><Link href="/community?board=NOTICE" data-support-notices-link>{t('support.ntcGo')}</Link></dd>
          </dl>
          <p className="w1-ls" style={{ marginTop: 10 }}>{t.rich('support.newFoot', { guide: (x) => <Link href="/safety/guide">{x}</Link>, hist: (x) => <Link href="/support/history">{x}</Link> })}</p>
        </aside>
      </div>
      <div id="cs-form" />
      <Msgs ns={['forms']}><InquiryForm email={sum?.email ?? null} deals={deals} loggedIn={!!user} initialType={aiDraft?.category ?? sp.type} initialDeal={sp.deal} draft={aiDraft} faqs={hub}
        source={/^[A-Z]{3,4}$/.test(sp.gwan ?? '') ? { gwan: sp.gwan!, page: /^(home|[a-z0-9][a-z0-9-]{1,39})$/.test(sp.page ?? '') ? sp.page : undefined } : undefined} /></Msgs>   {/* v10.681 관 페이지에서 온 문의 */}
    </div>
  );
}
