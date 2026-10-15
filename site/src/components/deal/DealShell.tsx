/**
 * v10.31 (w1) — 시안 dealShell: 「← 이전 화면」 · 제목 · 거래 번호 · 3단계 띠(계약서 · 결제 · 대금 · 성사 확정) · 거래 정보 표.
 *   자료: GET /deals/{id}/summary (거래 당사자 · 소개자만). 서버 컴포넌트 — 화면마다 아래 몸통만 다릅니다.
 *   단계 칸은 그 화면으로 가는 링크(시안은 「다음 — …」 단추로만 오감 — 실제 웹은 주소가 곧 화면).
 */
import Link from 'next/link';
import { won } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';

export interface DealSummary {
  id: string; status: string; statusLabel: string | null; step: number; myRole: 'BUYER' | 'SELLER' | 'INTRODUCER';
  title: string | null; targetType: string | null; targetId: string | null; gwanCode: string | null;
  introducer: string | null; refCode: string | null; tier: number; buyer: string; seller: string;
  amount: number | null; agreedFee: number | null; feeBearerLabel: string | null; dueDate: string | null; special: string | null;
  contract: { state: string; issuedAt: string; signedBuyerAt: string | null; signedSellerAt: string | null; agreedBuyerAt: string | null; agreedSellerAt: string | null; hasDocument: boolean } | null;
  confirmations: Array<{ party: string; confirmedAt: string; isAuto: boolean }>;
  payments: Array<{ method: string; reportedAt: string; party: string }>;
  confirmedAt: string | null; createdAt: string;
  myReview: { rating: number; body: string | null; tags?: string[]; createdAt: string } | null;
}

const STEPS: Array<[string, string, string]> = [
  ['계약서', '계약 조건을 양측이 확인합니다', 'contract'],
  ['결제 · 대금', '대금은 당사자끼리 직접 — 지급 사실만 신고합니다 (INV-11)', 'payment'],
  ['성사 확정', '양측이 각각 확인해야 넘어갑니다 (INV-4)', 'confirm'],
];
export const dealNo = (id: string) => `D-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

export function DealShell({ d, step, title, sub, children }: { d: DealSummary; step: number; title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w1 w1-wrap w1-deal" data-deal={d.id}>{/* v10.32 — 시안 .wrap.dealw 폭(가운데 좁은 폭 1000px 를 뺌) */}
      <BackBar href="/my/deals" label="소개 내역" wrap={false} />
      <div className="w1-pgh">
        <div><h1>{title}</h1><p>{sub}</p></div>
        <span className="w1-did">{dealNo(d.id)} · {d.statusLabel ?? d.status}</span>
      </div>
      <ol className="w1-steps">
        {STEPS.map(([t, s, path], i) => (
          <li key={t} style={{ display: 'contents' }}>
            <Link className={`st${i === step ? ' on' : i < d.step ? ' done' : ''}`} href={`/deal/${d.id}/${path}`} aria-current={i === step ? 'step' : undefined}>
              <span className="n">{i + 1}</span><b>{t}</b><span className="sd">{s}</span>
            </Link>
          </li>
        ))}
      </ol>
      <DealSummaryTable d={d} />
      {children}
    </div>
  );
}

export function DealSummaryTable({ d }: { d: DealSummary }) {
  return (
    <div className="w1-dsum">
      <div className="dr"><span>대상 {d.targetType === 'REQUEST' ? '요청' : '리스팅'}</span><b>{d.title ?? '—'}</b></div>
      <div className="dr"><span>소개자</span><b>{d.introducer ?? '없음(직접 거래)'}</b></div>
      <div className="dr"><span>소개코드</span><b>{d.refCode ? <><code>{d.refCode}</code> · tier {d.tier}</> : <i>귀속 코드 없음</i>}</b></div>
      <div className="dr"><span>거래 당사자</span><b>{d.buyer} ↔ {d.seller}</b></div>
      <div className="dr"><span>거래금액</span><b>{d.amount != null ? won(d.amount) : <i>계약서에서 양측이 합의하면 나옵니다</i>}</b></div>
      <div className="dr"><span>소개비</span><b>{d.agreedFee != null ? <>{won(d.agreedFee)} <i>— 양측 협의 (A-12)</i></> : <i>협의 전</i>}</b></div>
      <div className="dr"><span>소개비 부담</span><b>{d.feeBearerLabel ?? <i>협의</i>}</b></div>
    </div>
  );
}
