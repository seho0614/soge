/**
 * v10.31 — 시안 reqCard (소개받기 목록 · SB-HOM-REQ-020). 서버 컴포넌트.
 *   관 · 업종 · 🔒 회사명 비공개 · D-day(7일 이하 빨강) · 제목 · 설명 · 📍 지역 · 📦 규모 · 💰 예산(비공개면 「예산 비공개」) · 요청 번호 ·
 *   성사 시 예상 소개비 · 「소개 제안하기」(요청 상세의 제안 폼으로) · 「제안 n건 · 공개 범위」.
 */
import Link from 'next/link';
import { won } from '@/lib/format';

export interface ReqRow {
  id: string; gwanCode: string; title: string; categoryName: string | null;
  summary?: string | null; region?: string | null; quantity?: string | null;
  budgetMin: number | null; budgetMax: number | null; budgetOpen?: boolean; companyBlind?: boolean;
  visibility?: string; visibilityLabel?: string | null;
  offeredFee: number | null; dday?: number | null; createdAt: string; proposalCount?: number;
}

export const GCLS: Record<string, string> = { MNY: 'm', MAL: 'l', BIZ: 'b', HLT: 'h' };

/** 예산 글 — 「월 800만원 내외」처럼 시안은 자유 글. 실제는 최소 · 최대 숫자라 「1억 ~ 1.5억」 */
export function budgetText(min: number | null, max: number | null, open = true): string {
  if (!open) return '예산 비공개';
  const f = (n: number) => (n >= 100_000_000 ? `${+(n / 100_000_000).toFixed(1)}억` : n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원` : won(n));
  if (min != null && max != null) return min === max ? f(min) : `${f(min)} ~ ${f(max)}`;
  if (max != null) return `${f(max)} 이내`;
  if (min != null) return `${f(min)} 이상`;
  return '예산 협의';
}

/** 요청 번호 — uuid 앞 6자리(시안 R-2041 처럼 짧게). 같은 요청이면 늘 같은 글자 */
export const reqNo = (id: string) => `R-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

export function ReqCard({ r, gwanName }: { r: ReqRow; gwanName: string }) {
  const soon = r.dday != null && r.dday <= 7;
  return (
    <div className="w1-rqc" data-request={r.id}>
      <div>
        <div className="top2">
          <span className={`w1-gb2 ${GCLS[r.gwanCode] ?? 'm'}`}>{gwanName}</span>
          {r.categoryName && <span className="cat2">{r.categoryName}</span>}
          {r.companyBlind && <span className="w1-blind">🔒 회사명 비공개</span>}
          {r.dday != null && <span className={`w1-dday${soon ? ' soon' : ''}`}>D-{r.dday}</span>}
        </div>
        <h4><Link href={`/request/${r.id}`}>{r.title}</Link></h4>
        {r.summary ? <div className="dsc">{r.summary}{r.summary.length >= 120 ? '…' : ''}</div>
          : r.visibility && r.visibility !== 'ALL' ? <div className="dsc">{r.visibilityLabel ?? '회원'} 공개 요청입니다 — 로그인하면 내용이 보입니다.</div> : null}
        <div className="mt3">
          <span>📍 {r.region || '지역 미기재'}</span>
          <span>📦 {r.quantity || '규모 미기재'}</span>
          <span>💰 {budgetText(r.budgetMin, r.budgetMax, r.budgetOpen !== false)}</span>
          <span className="mono">{reqNo(r.id)}</span>
        </div>
      </div>
      <div className="side2">
        <div className="w1-fee3">성사 시 예상 소개비<b>{r.offeredFee != null ? won(r.offeredFee) : '협의'}</b></div>
        <Link className="w1-bprop" href={`/request/${r.id}#propose`}>소개 제안하기</Link>
        <div className="w1-pcount">제안 {r.proposalCount ?? 0}건 · 공개 {r.visibilityLabel ?? '전체'}</div>
      </div>
    </div>
  );
}
