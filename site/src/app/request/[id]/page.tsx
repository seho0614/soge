import type { Metadata } from 'next';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { won, ago } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { EarnPromo, RoleTabs } from '@/components/gwan/GwParts';
import { SearchBox } from '@/components/search/SearchBox';
import { GCLS, budgetText, reqNo } from '@/components/request/ReqCard';
import { ProposalForm } from '@/components/request/ProposalForm';
import { ProposalList, type Proposal } from '@/components/request/ProposalList';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '요청 상세' };
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

const BLOCK: Record<string, string> = {
  IDENTITY_REQUIRED: '로그인하고 본인인증을 마치면 제안할 수 있습니다.',
  OWN_REQUEST: '내가 올린 요청입니다 — 아래에서 받은 제안을 보고 수락하거나 거절하십시오.',
  ALREADY_PROPOSED: '이 요청에는 이미 제안했습니다 — 요청 1건당 한 번만 제안할 수 있습니다.',
  CLOSED: '마감된 요청입니다.',
};

/**
 * SB-HOM-REQ-030 요청 상세 · 소개 제안 — v10.31 시안 scReqDetail 그대로.
 *   ← 소개받기 목록 · 검색줄 · 3단추 · 요청 카드(관 · 업종 · D-day · 제목 · 내용 · 표: 요청 기업 · 지역 · 규모 · 희망 예산 · 공개 범위 · 요청 번호)
 *   받은 제안 n건(요청자는 수락 · 거절) · 「소개 제안하기」 폼(소개할 업체 · 관계 · 제안 내용) · 오른쪽: 성사 시 예상 소개비 · 귀속 안내 · 수락되면.
 *   전: 「소개 제안은 준비 중입니다」 — 제안 폼 · 받은 제안 없음(결함 중). 390 폭에서 오른쪽 칸이 제목을 가리던 것(결함 하)은 한 줄 배치로 고침.
 * 자료: GET /requests/{id} · GET /requests/{id}/proposals(요청자만 전부) · POST …/proposals · POST …/proposals/{pid}/decision.
 */
export default async function RequestDetail({ params }: Props) {
  const { id } = await params;
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
          <div className="page-head"><h1>요청 열람 한도</h1></div>
          <p className="notice" role="alert">{e.body.message}</p>
          <p><Link className="cta-primary" href="/my/subscription/upgrade">요금제 보기</Link>{' '}
            <Link className="btn" href="/request">요청 목록</Link></p>
        </div><i hidden data-root-end="" /></>
      );
    }
    /* v10.31 — 공개 범위(회원 · 인증 회원) */
    if (e instanceof ApiFailure && e.status === 403 && ['MEMBER_ONLY', 'VERIFIED_ONLY'].includes(e.body.code)) {
      return (
        <div className="w1 w1-wrap" data-request-scope={e.body.code}>
          <BackBar href="/request" label="소개받기 목록" wrap={false} />
          <div className="w1-panel" style={{ padding: 24, marginTop: 12, textAlign: 'center' }}>
            <p style={{ fontWeight: 800, fontSize: 16, margin: '0 0 8px' }}>{e.body.message}</p>
            <p className="w1-nt3">남의 회사 사정이 올라오는 자리라 요청한 분이 공개 범위를 정했습니다.</p>
            <p style={{ marginTop: 14 }}>
              {e.body.code === 'MEMBER_ONLY'
                ? <Link className="w1-bdone" href={`/login?next=/request/${id}`}>로그인</Link>
                : <Link className="w1-bdone" href="/verify">본인인증 하기</Link>}
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
    ['요청 기업', r.companyBlind ? '🔒 회사명 비공개' : (r.companyName ?? '개인 · 미인증 사업자')],
    ['지역', r.region || '미기재'],
    ['규모 · 수량', r.quantity || '미기재'],
    ['희망 예산', r.budgetOpen === false && !r.isOwner ? '비공개 — 제안 시 협의' : budgetText(r.budgetMin, r.budgetMax)],
    ['공개 범위', `${r.visibilityLabel ?? '전체'} 공개`],
    ['요청 번호', reqNo(r.id)],
  ];
  if (r.contactHours) spec.splice(5, 0, ['문의 가능 시간', r.contactHours]);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REQ-030">
      <BackBar href="/request" label="소개받기 목록" wrap={false} />
      <div style={{ marginTop: 10 }}><SearchBox variant="gwan" blue aside={<EarnPromo />} /></div>
      <div style={{ marginTop: 14 }}><RoleTabs on="get" note="필요한 물품 · 용역 · 부동산 · 장비 · 창업 공간을 등록하면 소개자가 찾아드립니다!" /></div>

      <div className="w1-layr" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="w1-panel" style={{ padding: 17 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <span className={`w1-gb2 ${GCLS[r.gwanCode] ?? 'm'}`}>{gn}</span>
              {r.categoryName && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.categoryName}</span>}
              {r.closed ? <span className="w1-dday">마감</span>
                : r.dday != null && <span className={`w1-dday${soon ? ' soon' : ''}`}>D-{r.dday}</span>}
            </div>
            <h1 style={{ margin: '0 0 9px', fontSize: 22, fontWeight: 900, letterSpacing: '-.8px', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{r.title}</h1>
            {!!r.images?.length && (
              <div className="w1-rqimg" data-request-images={r.images.length}>
                {r.images.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener"><img src={u} alt={i === 0 ? '대표 이미지' : `상세 이미지 ${i}`} loading="lazy" /></a>)}
              </div>
            )}
            {r.body && <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{r.body}</p>}
            <dl className="w1-spec">
              {spec.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
            </dl>
            <p className="w1-nt3" style={{ marginTop: 8 }}>등록 {ago(r.createdAt)}</p>
            {vl?.enabled && vl.limit != null && (
              <p className="w1-nt3" data-view-limit={`${vl.used}/${vl.limit}`}>
                이번 {vl.basis === 'PLAN' ? '결제 기간' : '달'} 요청 열람 {vl.used} / {vl.limit}건 — 같은 요청을 다시 여는 것은 세지 않습니다.
              </p>
            )}
          </div>

          <div className="w1-panel" style={{ padding: 17, marginTop: 12 }} id="proposals">
            <h2 className="w1-h2">받은 제안 {r.proposalCount}건</h2>
            {proposals.length > 0
              ? <ProposalList requestId={r.id} items={proposals} owner={!!r.isOwner} />
              : <p className="w1-nt3">{r.isOwner ? '아직 받은 제안이 없습니다.' : '제안 내용은 요청한 분에게만 보입니다. 다른 소개자는 볼 수 없습니다.'}</p>}
          </div>

          {!r.isOwner && (
            <div className="w1-panel" style={{ padding: 17, marginTop: 12 }} id="propose">
              <h2 className="w1-h2" style={{ marginBottom: 4 }}>소개 제안하기</h2>
              <div className="w1-nt3" style={{ marginBottom: 13 }}>아는 공급처를 연결해주세요. 요청자가 <b>수락</b>해야 대화가 열리고, 그 시점에 귀속이 확정됩니다.</div>
              {r.canPropose
                ? <ProposalForm requestId={r.id} />
                : (
                  <div className="w1-nt">
                    {BLOCK[r.proposeBlockReason ?? ''] ?? '지금은 제안할 수 없습니다.'}
                    {r.proposeBlockReason === 'IDENTITY_REQUIRED' && <> <Link href={`/login?next=/request/${r.id}%23propose`}>로그인</Link></>}
                  </div>
                )}
            </div>
          )}
        </div>

        <aside style={{ minWidth: 0 }}>
          <div className="w1-panel" style={{ padding: 15 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 3 }}>성사 시 예상 소개비</div>
            <div className="w1-bigfee">{r.offeredFee != null ? won(r.offeredFee) : '협의'}</div>
            <div className="w1-nt3" style={{ marginTop: 8 }}><b>요청자가 적은 희망 금액</b>입니다 — 요율표로 산정한 값이 아닙니다 (A-12). 최종 금액은 수락 뒤 대화에서 정합니다.<br />
              <b>공급 기업이 부담</b>합니다 — 요청한 기업은 내지 않습니다.</div>
          </div>
          <div className="w1-wrn" style={{ marginTop: 12 }}>
            <span className="ic" aria-hidden="true">!</span>
            <span><b>귀속은 제안한 순간이 아니라 수락된 순간입니다.</b><br />
              “소개 합니다”는 먼저 코드를 태운 사람에게 90일 귀속됩니다(INV-2). 소개받기에 그 규칙을 그대로 쓰면, <b>먼저 제안만 던져놓고 움직이지 않는 사람이 90일을 잠급니다</b>.
              그래서 여기서는 <b>요청자가 수락한 제안</b>에 귀속이 붙습니다.</span>
          </div>
          <div className="w1-panel" style={{ padding: 15, marginTop: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 7 }}>제안이 수락되면</div>
            <div className="w1-nt3">① 1:1 대화가 열리고 Deal이 생성됩니다<br />
              ② 소개코드가 발급됩니다 — 이때 <b>양측 구독을 검사</b>합니다(INV-8)<br />
              ③ 이후 흐름은 “소개 합니다”와 같습니다 — 계약 · 성사 확정 · 정산</div>
            {r.isOwner && <p style={{ marginTop: 10 }}><a className="w1-bo sm" href="#proposals">받은 제안 보기 (요청자 화면)</a></p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
