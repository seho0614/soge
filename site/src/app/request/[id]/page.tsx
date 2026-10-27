import type { Metadata } from 'next';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { ago } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import { BackBar } from '@/components/common/BackBar';
import { EarnPromo, RoleTabs } from '@/components/gwan/GwParts';
import { SearchBox } from '@/components/search/SearchBox';
import { GCLS, budgetText, reqNo } from '@/components/request/ReqCard';
import { ProposalForm } from '@/components/request/ProposalForm';
import { ProposalList, type Proposal } from '@/components/request/ProposalList';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('request'))('detail.title') };
}
type Props = { params: Promise<{ id: string }> };

interface Req {
  id: string; gwanCode: string; title: string; body: string | null; status: string; categoryName: string | null;
  budgetMin: number | null; budgetMax: number | null; budgetOpen?: boolean;
  offeredFee: number | null; createdAt: string; proposalCount: number;
  region?: string | null; quantity?: string | null; contactHours?: string | null; companyBlind?: boolean; companyName?: string | null;
  visibilityLabel?: string | null; dday?: number | null; closed?: boolean;
  isOwner?: boolean; canPropose?: boolean; proposeBlockReason?: string;
  /** v10.31 — 대표 · 상세 이미지 공개 주소(GET /requests/{id}/images/{n}) */
  images?: string[];
  /** 열람 한도 상태 (D011) — 로그인하고 남의 요청을 볼 때만 옵니다 */
  viewLimit?: { enabled: boolean; basis: string; limit: number | null; used: number; remaining: number | null } | null;
}

const BLOCK = ['IDENTITY_REQUIRED', 'OWN_REQUEST', 'ALREADY_PROPOSED', 'CLOSED'] as const;
const isBlock = (c: string): c is (typeof BLOCK)[number] => (BLOCK as readonly string[]).includes(c);

/**
 * SB-HOM-REQ-030 요청 상세 · 소개 제안 — v10.31 시안 scReqDetail 그대로.
 *   ← 소개받기 목록 · 검색줄 · 3단추 · 요청 카드(관 · 업종 · D-day · 제목 · 내용 · 표: 요청 기업 · 지역 · 규모 · 희망 예산 · 공개 범위 · 요청 번호)
 *   받은 제안 n건(요청자는 수락 · 거절) · 「소개 제안하기」 폼(소개할 업체 · 관계 · 제안 내용) · 오른쪽: 성사 시 예상 소개비 · 귀속 안내 · 수락되면.
 *   전: 「소개 제안은 준비 중입니다」 — 제안 폼 · 받은 제안 없음(결함 중). 390 폭에서 오른쪽 칸이 제목을 가리던 것(결함 하)은 한 줄 배치로 고침.
 * 자료: GET /requests/{id} · GET /requests/{id}/proposals(요청자만 전부) · POST …/proposals · POST …/proposals/{pid}/decision.
 */
export default async function RequestDetail({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations('request.detail');
  const tr = await getTranslations('request');
  const f = await getFmt();
  let r: Req;
  /* D011 (10/2) — 로그인한 회원의 응답에는 열람 한도 상태가 실려 사람마다 다릅니다 → 캐시하지 않는 쪽으로 부릅니다.
   *   비로그인은 전처럼 공개 캐시(10초). */
  const user = await me();
  try { r = user ? await apiGetPersonal<Req>(`/requests/${id}`) : await apiGet<Req>(`/requests/${id}`, 10); }
  catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound(); /* 20261002 — 형식이 틀린 번호도 404 (전: 500) */
    /* 열람 한도를 넘으면(운영이 한도를 켠 뒤) 오류 화면 대신 안내를 보여 줍니다 */
    if (e instanceof ApiFailure && e.status === 422 && e.body.code === 'VIEW_QUOTA_EXCEEDED') {
      return (
        <><div className="page" data-view-quota="exceeded">
          <div className="page-head"><h1>{t('quotaTitle')}</h1></div>
          <p className="notice" role="alert">{e.body.message}</p>
          <p><Link className="cta-primary" href="/my/subscription/upgrade">{t('quotaPlans')}</Link>{' '}
            <Link className="btn" href="/request">{t('quotaList')}</Link></p>
        </div><i hidden data-root-end="" /></>
      );
    }
    /* v10.31 — 공개 범위(회원 · 인증 회원) */
    if (e instanceof ApiFailure && e.status === 403 && ['MEMBER_ONLY', 'VERIFIED_ONLY'].includes(e.body.code)) {
      return (
        <div className="w1 w1-wrap" data-request-scope={e.body.code}>
          <BackBar href="/request" label={t('backToList')} wrap={false} />
          <div className="w1-panel" style={{ padding: 24, marginTop: 12, textAlign: 'center' }}>
            <p style={{ fontWeight: 800, fontSize: 16, margin: '0 0 8px' }}>{e.body.message}</p>
            <p className="w1-nt3">{t('scopeNote')}</p>
            <p style={{ marginTop: 14 }}>
              {e.body.code === 'MEMBER_ONLY'
                ? <Link className="w1-bdone" href={`/login?next=/request/${id}`}>{t('login')}</Link>
                : <Link className="w1-bdone" href="/verify">{t('verify')}</Link>}
            </p>
          </div>
        </div>
      );
    }
    throw e;
  }
  const vl = r.viewLimit;
  const proposals = user ? await apiGetPersonal<Proposal[]>(`/requests/${id}/proposals`).catch(() => [] as Proposal[]) : [];
  const gwans = await apiGet<Array<{ code: string; name: string }>>('/gwans', 300).catch(() => []);
  const gn = gwans.find((g) => g.code === r.gwanCode)?.name ?? r.gwanCode;
  const soon = r.dday != null && r.dday <= 7;
  const spec: Array<[string, string]> = [
    [t('spec.company'), r.companyBlind ? t('spec.companyBlind') : (r.companyName ?? t('spec.companyNone'))],
    [t('spec.region'), r.region || t('spec.none')],
    [t('spec.quantity'), r.quantity || t('spec.none')],
    [t('spec.budget'), r.budgetOpen === false && !r.isOwner ? t('spec.budgetHidden') : budgetText(r.budgetMin, r.budgetMax, true, f)],
    [t('spec.visibility'), t('spec.visibilityValue', { v: r.visibilityLabel ?? t('spec.visibilityAll') })],
    [t('spec.reqNo'), reqNo(r.id)],
  ];
  if (r.contactHours) spec.splice(5, 0, [t('spec.contactHours'), r.contactHours]);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REQ-030">
      <BackBar href="/request" label={t('backToList')} wrap={false} />
      <div style={{ marginTop: 10 }}><SearchBox variant="gwan" blue aside={<EarnPromo />} /></div>
      <div style={{ marginTop: 14 }}><RoleTabs on="get" note={tr('list.roleNote')} /></div>

      <div className="w1-layr" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="w1-panel" style={{ padding: 17 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <span className={`w1-gb2 ${GCLS[r.gwanCode] ?? 'm'}`}>{gn}</span>
              {r.categoryName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.categoryName}</span>}
              {r.closed ? <span className="w1-dday">{t('closed')}</span>
                : r.dday != null && <span className={`w1-dday${soon ? ' soon' : ''}`}>D-{r.dday}</span>}
            </div>
            <h1 style={{ margin: '0 0 9px', fontSize: 20, fontWeight: 900, letterSpacing: '-.8px', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{r.title}</h1>
            {!!r.images?.length && (
              <div className="w1-rqimg" data-request-images={r.images.length}>
                {r.images.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener"><img src={u} alt={i === 0 ? t('imgMain') : t('imgDetail', { n: String(i) })} loading="lazy" /></a>)}
              </div>
            )}
            {r.body && <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{r.body}</p>}
            <dl className="w1-spec">
              {spec.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
            </dl>
            <p className="w1-nt3" style={{ marginTop: 8 }}>{t('registered', { ago: f.ago(r.createdAt, ago(r.createdAt)) })}</p>
            {vl?.enabled && vl.limit != null && (
              <p className="w1-nt3" data-view-limit={`${vl.used}/${vl.limit}`}>
                {t('viewLimit', { period: vl.basis === 'PLAN' ? t('periodPlan') : t('periodMonth'), used: String(vl.used), limit: String(vl.limit) })}
              </p>
            )}
          </div>

          <div className="w1-panel" style={{ padding: 17, marginTop: 12 }} id="proposals">
            <h2 className="w1-h2">{t('proposalsHead', { n: String(r.proposalCount) })}</h2>
            {proposals.length > 0
              ? <Msgs ns={['request']}><ProposalList requestId={r.id} items={proposals} owner={!!r.isOwner} /></Msgs>
              : <p className="w1-nt3">{r.isOwner ? t('noProposals') : t('proposalsPrivate')}</p>}
          </div>

          {!r.isOwner && (
            <div className="w1-panel" style={{ padding: 17, marginTop: 12 }} id="propose">
              <h2 className="w1-h2" style={{ marginBottom: 4 }}>{t('proposeHead')}</h2>
              <div className="w1-nt3" style={{ marginBottom: 13 }}>{t.rich('proposeLead', { b: (c) => <b>{c}</b> })}</div>
              {r.canPropose
                ? <Msgs ns={['request']}><ProposalForm requestId={r.id} /></Msgs>
                : (
                  <div className="w1-nt">
                    {isBlock(r.proposeBlockReason ?? '') ? t(`block.${r.proposeBlockReason as (typeof BLOCK)[number]}`) : t('block.default')}
                    {r.proposeBlockReason === 'IDENTITY_REQUIRED' && <> <Link href={`/login?next=/request/${r.id}%23propose`}>{t('login')}</Link></>}
                  </div>
                )}
            </div>
          )}
        </div>

        <aside style={{ minWidth: 0 }}>
          <div className="w1-panel" style={{ padding: 15 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 3 }}>{t('feeLabel')}</div>
            <div className="w1-bigfee">{r.offeredFee != null ? f.won(r.offeredFee) : t('negotiable')}</div>
            <div className="w1-nt3" style={{ marginTop: 8 }}>{withCodes(t.rich('feeNote', { b: (c) => <b>{c}</b>, br: () => <br /> }))}</div>
          </div>
          <div className="w1-wrn" style={{ marginTop: 12 }}>
            <span className="ic" aria-hidden="true">!</span>
            <span>{withCodes(t.rich('attribution', { b: (c) => <b>{c}</b>, br: () => <br /> }))}</span>
          </div>
          <div className="w1-panel" style={{ padding: 15, marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 7 }}>{t('acceptedHead')}</div>
            <div className="w1-nt3">{withCodes(t.rich('acceptedSteps', { b: (c) => <b>{c}</b>, br: () => <br /> }))}</div>
            {r.isOwner && <p style={{ marginTop: 10 }}><a className="w1-bo sm" href="#proposals">{t('viewProposals')}</a></p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
