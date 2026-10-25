/**
 * v10.31 (w1) — 시안 dealShell: 「← 이전 화면」 · 제목 · 거래 번호 · 3단계 띠(계약서 · 결제 · 대금 · 성사 확정) · 거래 정보 표.
 *   자료: GET /deals/{id}/summary (거래 당사자 · 소개자만). 서버 컴포넌트 — 화면마다 아래 몸통만 다릅니다.
 *   단계 칸은 그 화면으로 가는 링크(시안은 「다음 — …」 단추로만 오감 — 실제 웹은 주소가 곧 화면).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
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

/* v10.101 — 단계 이름 · 설명은 사전 키(deal.shell.steps.{path}.t · .s) */
const STEPS = ['contract', 'payment', 'confirm'] as const;
export const dealNo = (id: string) => `D-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

export function DealShell({ d, step, title, sub, children }: { d: DealSummary; step: number; title: string; sub: React.ReactNode; children: React.ReactNode }) {
  const t = useTranslations('deal');
  return (
    <div className="w1 w1-wrap w1-deal" data-deal={d.id}>{/* v10.32 — 시안 .wrap.dealw 폭(가운데 좁은 폭 1000px 를 뺌) */}
      <BackBar href="/my/deals" label={t('common.backDeals')} wrap={false} />
      <div className="w1-pgh">
        <div><h1>{title}</h1><p>{sub}</p></div>
        <span className="w1-did">{dealNo(d.id)} · {d.statusLabel ?? d.status}</span>
      </div>
      <ol className="w1-steps">
        {STEPS.map((path, i) => (
          <li key={path} style={{ display: 'contents' }}>
            <Link className={`st${i === step ? ' on' : i < d.step ? ' done' : ''}`} href={`/deal/${d.id}/${path}`} aria-current={i === step ? 'step' : undefined}>
              <span className="n">{i + 1}</span><b>{t(`shell.steps.${path}.t`)}</b><span className="sd">{t(`shell.steps.${path}.s`)}</span>
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
  const t = useTranslations('deal.shell');
  const f = useFmt();
  return (
    <div className="w1-dsum">
      <div className="dr"><span>{t('target', { kind: d.targetType === 'REQUEST' ? t('kindRequest') : t('kindListing') })}</span><b>{d.title ?? '—'}</b></div>
      <div className="dr"><span>{t('introducer')}</span><b>{d.introducer ?? t('noIntroducer')}</b></div>
      <div className="dr"><span>{t('refCode')}</span><b>{d.refCode ? <><code>{d.refCode}</code> · tier {d.tier}</> : <i>{t('noCode')}</i>}</b></div>
      <div className="dr"><span>{t('parties')}</span><b>{d.buyer} ↔ {d.seller}</b></div>
      <div className="dr"><span>{t('amount')}</span><b>{d.amount != null ? f.won(d.amount) : <i>{t('amountPending')}</i>}</b></div>
      <div className="dr"><span>{t('fee')}</span><b>{d.agreedFee != null ? <>{f.won(d.agreedFee)} <i>{t('feeAgreed')}</i></> : <i>{t('feePending')}</i>}</b></div>
      <div className="dr"><span>{t('bearer')}</span><b>{d.feeBearerLabel ?? <i>{t('bearerPending')}</i>}</b></div>
    </div>
  );
}
