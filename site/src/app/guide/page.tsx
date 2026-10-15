import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { faqs } from '@/lib/content';
import { BackBar } from '@/components/common/BackBar';
import { sortTerms, termState, type TermIndex } from '@/components/terms/TermsViewer';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '이용안내' };

/* 시안 D.content.guide.flow — 01 단계는 개발에 있는 개인 회원 가입을 함께 적었습니다(시안 intro 와 같은 뜻 · 결정 기록) */
const FLOW: Array<[string, string, string]> = [
  ['01', '가입 · 인증', '개인은 본인인증, 사업자는 사업자등록번호로 인증하고 운영자 승인을 받습니다. 승인 전에는 열람만 됩니다.'],
  ['02', '등록 또는 요청', '소개할 것을 등록하거나, 필요한 것을 요청으로 올립니다.'],
  ['03', '검수', '운영자가 확인합니다. 제한업종은 등록되지 않습니다.'],
  ['04', '1:1 대화 · 소개코드', '대화가 시작되면 소개코드가 발급되고 귀속이 시작됩니다.'],
  ['05', '계약 · 성사 확정', '양측이 각각 확인해야 성사입니다.'],
  ['06', '정산', '소개비 전액이 소개자에게 갑니다 — 플랫폼은 한 푼도 떼지 않습니다.'],
];

/**
 * SB-HOM-ETC-010 이용안내 — v10.31 시안 scGuide 그대로(전: 화면이 없어 머리줄 「이용안내」가 고객센터로 감 — 결함 중).
 *   소개가 돈이 되기까지(6단계) · 자주 묻는 것(서버 FAQ channel=GUIDE) · 약관 · 정책 표(GET /terms/index — 이름을 누르면 전문).
 */
export default async function GuidePage() {
  const [faq, terms] = await Promise.all([
    faqs(undefined, 'GUIDE'),
    apiGet<TermIndex[]>('/terms/index', 300).catch(() => [] as TermIndex[]),
  ]);
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-010" style={{ maxWidth: 1000 }}>
      <BackBar href="/" label="메인" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>이용안내</h1>
        <p>소개뱅크는 소개하고 소개비를 받는 곳입니다. 개인 회원도 가입해 본인인증을 하면 모든 업무를 할 수 있고, 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.</p>
      </div>
      <h2 className="w1-s2">소개가 돈이 되기까지</h2>
      <ol className="w1-flow">
        {FLOW.map(([n, b, p]) => <li key={n}><span className="n">{n}</span><div><b>{b}</b><p>{p}</p></div></li>)}
      </ol>
      <h2 className="w1-s2">자주 묻는 것</h2>
      {faq.length ? (
        <div className="w1-faq">{faq.map((f) => <details key={f.question}><summary>{f.question}</summary><p>{f.answer}</p></details>)}</div>
      ) : <div className="w1-empty">준비 중입니다.</div>}
      <h2 className="w1-s2">약관 · 정책</h2>
      <table className="w1-tb">
        <thead><tr><th>문서</th><th>상태</th></tr></thead>
        <tbody>
          {sortTerms(terms).map((t) => (
            <tr key={t.code}>
              <td>{t.status === 'ARCHIVED' ? <b style={{ color: 'var(--ink-3)' }}>{t.title}</b> : <Link href={`/terms/${t.code}`}><b>{t.title}</b></Link>}</td>
              <td>{termState(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w1-nt" style={{ marginTop: 10 }}><b>문서 이름을 누르면 전문이 열립니다.</b> 발행된 판을 그대로 보여 줍니다 — 시행일 · 판 번호가 함께 나옵니다.</div>
      <p className="w1-ls" style={{ marginTop: 12 }}>더 궁금한 것은 <Link href="/support">1:1 문의</Link> · <Link href="/support/new">고객센터</Link>에서 물어보십시오.</p>
    </div>
  );
}
