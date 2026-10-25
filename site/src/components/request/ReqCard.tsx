/**
 * v10.31 — 시안 reqCard (소개받기 목록 · SB-HOM-REQ-020). 서버 컴포넌트.
 *   관 · 업종 · 🔒 회사명 비공개 · D-day(7일 이하 빨강) · 제목 · 설명 · 📍 지역 · 📦 규모 · 💰 예산(비공개면 「예산 비공개」) · 요청 번호 ·
 *   성사 시 예상 소개비 · 「소개 제안하기」(요청 상세의 제안 폼으로) · 「제안 n건 · 공개 범위」.
 */
import Link from 'next/link';
import { won } from '@/lib/format';
import { useFmt } from '@/lib/useFmt';
import type { Fmt } from '@/lib/fmtBind';
import { EN_WORDS } from '@/lib/fmt';
import { useTranslations } from 'next-intl';

export interface ReqRow {
  id: string; gwanCode: string; title: string; categoryName: string | null;
  summary?: string | null; region?: string | null; quantity?: string | null;
  budgetMin: number | null; budgetMax: number | null; budgetOpen?: boolean; companyBlind?: boolean;
  visibility?: string; visibilityLabel?: string | null;
  offeredFee: number | null; dday?: number | null; createdAt: string; proposalCount?: number;
}

export const GCLS: Record<string, string> = { MNY: 'm', MAL: 'l', BIZ: 'b', HLT: 'h' };

/** 예산 글 — 「월 800만원 내외」처럼 시안은 자유 글. 실제는 최소 · 최대 숫자라 「1억 ~ 1.5억」 */
/*  v10.102 (2-5c) — fm(useFmt · getFmt)을 넘기면 한국어 밖에서는 억 · 만 줄임 없이 전체 금액(₩1,200,000)과 영어 글로. 넘기지 않거나 한국어면 예전 글자 그대로 */
export function budgetText(min: number | null, max: number | null, open = true, fm?: Fmt): string {
  if (fm && !fm.ko) {
    /* v10.107 — 영어 글은 lib/fmt.ts 의 언어 표(EN_WORDS)에 모음(「Negotiable」과 같은 곳 · 언어가 늘면 그 표에) */
    if (!open) return EN_WORDS.budgetHidden;
    const w = (n: number) => fm.won(n);
    if (min != null && max != null) return min === max ? w(min) : `${w(min)} ~ ${w(max)}`;
    if (max != null) return EN_WORDS.upTo(w(max));
    if (min != null) return EN_WORDS.orMore(w(min));
    return EN_WORDS.budgetNego;
  }
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
  const t = useTranslations('request.card');
  const f = useFmt();
  const soon = r.dday != null && r.dday <= 7;
  return (
    <div className="w1-rqc" data-request={r.id}>
      <div>
        <div className="top2">
          <span className={`w1-gb2 ${GCLS[r.gwanCode] ?? 'm'}`}>{gwanName}</span>
          {r.categoryName && <span className="cat2">{r.categoryName}</span>}
          {r.companyBlind && <span className="w1-blind">{t('blind')}</span>}
          {r.dday != null && <span className={`w1-dday${soon ? ' soon' : ''}`}>D-{r.dday}</span>}
        </div>
        <h4><Link href={`/request/${r.id}`}>{r.title}</Link></h4>
        {r.summary ? <div className="dsc">{r.summary}{r.summary.length >= 120 ? '…' : ''}</div>
          : r.visibility && r.visibility !== 'ALL' ? <div className="dsc">{t('scopeNote', { v: r.visibilityLabel ?? t('member') })}</div> : null}
        <div className="mt3">
          <span>📍 {r.region || t('noRegion')}</span>
          <span>📦 {r.quantity || t('noQuantity')}</span>
          <span>💰 {r.budgetOpen === false ? t('budgetHidden') : budgetText(r.budgetMin, r.budgetMax, true, f)}</span>
          <span className="mono">{reqNo(r.id)}</span>
        </div>
      </div>
      <div className="side2">
        <div className="w1-fee3">{t('feeLabel')}<b>{r.offeredFee != null ? f.won(r.offeredFee) : t('negotiable')}</b></div>
        <Link className="w1-bprop" href={`/request/${r.id}#propose`}>{t('propose')}</Link>
        <div className="w1-pcount">{t('count', { n: String(r.proposalCount ?? 0), v: r.visibilityLabel ?? t('all') })}</div>
      </div>
    </div>
  );
}
