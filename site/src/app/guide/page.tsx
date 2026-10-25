import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { faqs } from '@/lib/content';
import { BackBar } from '@/components/common/BackBar';
import { sortTerms, termState, type TermIndex } from '@/components/terms/TermsViewer';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('meta.guide') };
}

/* 시안 D.content.guide.flow — 01 단계는 개발에 있는 개인 회원 가입을 함께 적었습니다(시안 intro 와 같은 뜻 · 결정 기록) */
/* v10.102 2-5c — 글(제목 · 설명)은 사전 policy.guide.flow.<키>.t · .d */
const FLOW = [
  ['01', 's1'], ['02', 's2'], ['03', 's3'], ['04', 's4'], ['05', 's5'], ['06', 's6'],
] as const;

/**
 * SB-HOM-ETC-010 이용안내 — v10.31 시안 scGuide 그대로(전: 화면이 없어 머리줄 「이용안내」가 고객센터로 감 — 결함 중).
 *   소개가 돈이 되기까지(6단계) · 자주 묻는 것(서버 FAQ channel=GUIDE) · 약관 · 정책 표(GET /terms/index — 이름을 누르면 전문).
 */
export default async function GuidePage() {
  const tr = await getTranslations('policy');
  const f = await getFmt();
  const [faq, terms] = await Promise.all([
    faqs(undefined, 'GUIDE'),
    apiGet<TermIndex[]>('/terms/index', 300).catch(() => [] as TermIndex[]),
  ]);
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-010" style={{ maxWidth: 1000 }}>
      <BackBar href="/" label={tr('guide.back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{tr('guide.title')}</h1>
        <p>{tr('guide.intro')}</p>
      </div>
      <h2 className="w1-s2">{tr('guide.flowH')}</h2>
      <ol className="w1-flow">
        {FLOW.map(([n, k]) => <li key={n}><span className="n">{n}</span><div><b>{tr(`guide.flow.${k}.t`)}</b><p>{tr(`guide.flow.${k}.d`)}</p></div></li>)}
      </ol>
      <h2 className="w1-s2">{tr('guide.faqH')}</h2>
      {faq.length ? (
        <div className="w1-faq">{faq.map((f) => <details key={f.question}><summary>{f.question}</summary><p>{f.answer}</p></details>)}</div>
      ) : <div className="w1-empty">{tr('guide.faqEmpty')}</div>}
      <h2 className="w1-s2">{tr('guide.termsH')}</h2>
      <table className="w1-tb">
        <thead><tr><th>{tr('guide.colDoc')}</th><th>{tr('guide.colState')}</th></tr></thead>
        <tbody>
          {sortTerms(terms).map((t) => (
            <tr key={t.code}>
              <td>{t.status === 'ARCHIVED' ? <b style={{ color: 'var(--ink-3)' }}>{t.title}</b> : <Link href={`/terms/${t.code}`}><b>{t.title}</b></Link>}</td>
              <td>{termState(t, tr, f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w1-nt" style={{ marginTop: 10 }}>{tr.rich('guide.note', { b: (c) => <b>{c}</b> })}</div>
      <p className="w1-ls" style={{ marginTop: 12 }}>{tr.rich('guide.more', { ask: (c) => <Link href="/support">{c}</Link>, cs: (c) => <Link href="/support/new">{c}</Link> })}</p>
    </div>
  );
}
