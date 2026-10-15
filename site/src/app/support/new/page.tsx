import type { Metadata } from 'next';
import Link from 'next/link';
import { faqs } from '@/lib/content';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { InquiryForm, type MyDeal } from '@/components/InquiryForm';
import { CS_HOURS } from '@/components/support/hours';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '고객센터' };

/**
 * SB-HOM-ETC-030 고객센터 · 문의하기 — v10.31 시안 scCs 그대로:
 *   「고객센터」 머리 · 「바로 물어보기 — 1:1 문의」 띠(→ /support 챗봇) · 자주 묻는 질문 접기(서버 FAQ — CS · FAQ) · 운영 안내 · 문의하기 폼.
 */
export default async function NewInquiryPage({ searchParams }: { searchParams: Promise<{ type?: string; deal?: string }> }) {
  const sp = await searchParams;
  const user = await me().catch(() => null);
  const [cs, base, sum, deals] = await Promise.all([
    faqs(undefined, 'CS'), faqs(),
    user ? apiGetPersonal<{ email?: string | null }>('/me/summary').catch(() => null) : Promise.resolve(null),
    user ? apiGetPersonal<MyDeal[]>('/me/deals?limit=30').catch(() => [] as MyDeal[]) : Promise.resolve([] as MyDeal[]),
  ]);
  const list = [...cs, ...base.filter((f) => !cs.some((c) => c.question === f.question))];
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-030" style={{ maxWidth: 1100 }}>
      <BackBar href="/" label="이전 화면" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>고객센터</h1>
        <p>자주 묻는 질문에서 먼저 찾아보세요. <b>답이 없으면 아래에서 문의</b>해 주시면 영업일 기준 1일 이내에 답변드립니다.</p>
      </div>
      <div className="w1-csbot">
        <div><b>바로 물어보기 — 1:1 문의</b>
          <p>소개비 · 정산 · 귀속처럼 규칙이 정해진 것은 챗봇이 바로 답합니다. 금액 · 계정 · 분쟁은 상담원에게 넘깁니다.</p></div>
        <Link className="w1-bp" href="/support">1:1 문의 열기</Link>
      </div>
      <div className="w1-csg">
        <div>
          <div className="w1-sh4">자주 묻는 질문</div>
          {list.length ? (
            <div className="w1-faq">
              {list.map((f) => <details key={f.question}><summary>{f.question}</summary><p>{f.answer}</p></details>)}
            </div>
          ) : <div className="w1-empty">준비 중입니다.</div>}
        </div>
        <aside className="w1-csa">
          <div className="w1-sh4">운영 안내</div>
          <dl className="w1-kv">
            <dt>운영시간</dt><dd>{CS_HOURS.open}</dd>
            <dt>점심</dt><dd>{CS_HOURS.lunch}</dd>
            <dt>평균 응답</dt><dd>{CS_HOURS.avg}</dd>
            <dt>주말 · 공휴일</dt><dd>{CS_HOURS.holiday}</dd>
          </dl>
          <div className="w1-nt" style={{ marginTop: 10 }}>정산 · 지급 관련 문의는 <b>매주 수요일</b> 지급일 전후로 응답이 몰립니다.</div>
          <p className="w1-ls" style={{ marginTop: 10 }}>거래 전에는 <Link href="/safety/guide">사기 예방 가이드</Link>를 먼저 보십시오. <Link href="/support/history">내 문의 내역</Link></p>
        </aside>
      </div>
      <InquiryForm email={sum?.email ?? null} deals={deals} loggedIn={!!user} initialType={sp.type} initialDeal={sp.deal} />
    </div>
  );
}
