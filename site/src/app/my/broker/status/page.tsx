import type { Metadata } from 'next';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import Link from 'next/link';
import { BackBar } from '@/components/common/BackBar';
import { BrokerExtraForm, type BrokerExtraValue } from '@/components/BrokerExtra';
import { BROKER_DOCS } from '@/components/broker-docs';   // v10.31 검정 — 'use client' 파일의 배열을 서버 화면에서 가져오면 참조만 넘어와 500

export const metadata: Metadata = { title: '중개사 인증 상태' };

interface B {
  applied: boolean; assumed: boolean;
  licenseNo?: string; officeName?: string; ceoName?: string;
  state?: string; lookupResult?: string; lookupAt?: string;
  recheckDue?: string; rejectReason?: string; createdAt?: string;
  decidedAt?: string | null; canPublish?: boolean;
}

const ST: Record<string, string> = {
  SUBMITTED: '접수됨', PENDING: '심사 중', VERIFIED: '인증 완료',
  REJECTED: '반려', EXPIRED: '기한 만료',
};
const LK: Record<string, string> = {
  MATCH: '일치', MISMATCH: '불일치', NOT_FOUND: '등록 없음',
};

/**
 * SB-BIZ-BRK-011 중개사 인증 상태
 *
 * 반려되면 **사유가 반드시 보여야** 합니다. 무엇을 고쳐야 하는지
 * 모르면 같은 것을 또 올립니다.
 *
 * v10.29 — 시안 scBrkMy 배치(현재 상태 판 · 단계 4칸 · 두 칸 표 · 안내 · 단추 줄)로 그립니다. 값은 GET /partner/broker 그대로.
 *   시안의 「보증(공제)」 칸(기관 · 증서 · 금액 · 기간)은 서버 자료가 없어 「신청 · 판정 · 재확인 기한」 칸으로 대신합니다(diffs 창업-6).
 * v10.31 (w2 · 10/10 「시안 기준」) — 보증(공제) 칸을 서버 자료(GET /me/broker/extra · D055)로 그립니다(기관 · 증서 · 금액 · 기간 · 만료 경고).
 *   「신청 · 판정 · 재확인 기한」(개발에만 있던 것)은 그 아래 줄로 남깁니다. 신청 전에도 이 화면을 보여 줍니다(시안: 신청 전 = 「미신청」).
 *   단추 줄 — 시안 「새로 신청」 · 「검수자 화면 보기」(검수 · 운영 계정이고 운영 화면 주소(ADMIN_ORIGIN)가 있을 때).
 */
export default async function BrokerStatusPage() {
  const p = await me();
  if (!p) redirect('/login');

  const [b0, ex] = await Promise.all([
    apiGet<B>('/partner/broker', 0).catch(() => null),
    apiGet<BrokerExtraValue & { applied?: boolean; guaranteeExpired?: boolean }>('/me/broker/extra', 0).catch(() => null),
  ]);
  const b: B = b0 ?? { applied: false, assumed: false };
  const reviewer = p.roles.some((r) => ['REVIEWER', 'ADMIN', 'OPS'].includes(r));
  const adminOrigin = process.env.ADMIN_ORIGIN;
  const g = ex && ex.applied !== false && (ex.guaranteeOrg || ex.guaranteeCertNo || ex.guaranteeAmount) ? ex : null;
  const docLabel = (k: string) => BROKER_DOCS.find(([c]) => c === k)?.[1] ?? k;

  const ok = b.state === 'VERIFIED';
  /* 단계 — 신청 · 자동 대조(국토부 대조 결과가 있으면) · 서류 심사(운영 판정 중/끝) · 인증 완료 */
  const steps: [string, boolean][] = [
    ['신청', b.applied],
    ['자동 대조', !!b.lookupResult || (b.applied && b.assumed) || b.state === 'PENDING' || ok],
    ['서류 심사', b.state === 'PENDING' || ok || b.state === 'REJECTED'],
    ['인증 완료', ok],
  ];
  const tone = ok ? 'ok' : 'warn';

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/my/broker" label="중개사 인증" wrap={false} />
        <div className="gw-pgh"><div><h1>내 인증 상태</h1><p>지금 어디까지 왔는지와 무엇이 남았는지를 봅니다.</p></div></div>

        <div className={`gw-brkstat gw-${tone}`} data-broker-state={b.state}>
          <div>
            <span className="gw-lb">현재 상태</span>
            <h2>{b.applied ? (ST[b.state ?? ''] ?? b.state) : '미신청'}</h2>
            <p>
              {!b.applied ? '아직 중개사 인증을 신청하지 않았습니다. 부동산 소개를 하시려면 먼저 신청해 주십시오.' : null}
              {ok && b.canPublish ? '부동산 매물을 공개하실 수 있습니다.' : null}
              {b.state === 'PENDING' ? '운영 확인 중입니다. 영업일 1~2일 걸립니다.' : null}
              {b.state === 'SUBMITTED' ? '접수되었습니다. 대조와 서류 심사를 차례로 진행합니다.' : null}
              {b.rejectReason ? <>사유: {b.rejectReason}</> : null}
            </p>
          </div>
          <div className="gw-brkno2">{b.licenseNo ?? '—'}</div>
        </div>

        <div className="gw-brkstep">
          {steps.map(([t, on], i) => <div key={t} className={`gw-bsi${on ? ' gw-on' : ''}`}><i>{i + 1}</i><span>{t}</span></div>)}
        </div>

        {b.applied && b.assumed ? (
          <div className="gw-nt gw-warn"><b>국토부 연동 전이라 대조를 건너뛴 건입니다.</b> 연동 후 실제 대조를 하며, 맞지 않으면 인증이 취소됩니다.</div>
        ) : null}

        <div className="gw-brkgrid">
          <div className="gw-brkbox">
            <span className="gw-lb">국토부 자료 대조</span>
            <dl className="gw-brdl">
              <dt>상호</dt><dd>{b.officeName ?? '—'}</dd>
              <dt>대표자</dt><dd>{b.ceoName ?? '—'}</dd>
              <dt>대조 결과</dt><dd>{b.lookupResult
                ? <span className={`gw-bg ${b.lookupResult === 'MATCH' ? 'gw-ok' : 'gw-no'}`}>{LK[b.lookupResult] ?? b.lookupResult}</span>
                : <span className="gw-ls">미조회</span>}</dd>
              <dt>기준일</dt><dd>{ymdKst(b.lookupAt) || '—'}</dd>
            </dl>
          </div>
          <div className="gw-brkbox" data-broker-guarantee={g ? 'on' : 'none'}>
            <span className="gw-lb">보증(공제)</span>
            {g ? (
              <>
                <dl className="gw-brdl">
                  <dt>기관</dt><dd>{g.guaranteeOrg ?? '—'}</dd>
                  <dt>증서</dt><dd>{g.guaranteeCertNo ?? '—'}</dd>
                  <dt>금액</dt><dd>{g.guaranteeAmount != null ? `${Number(g.guaranteeAmount).toLocaleString('ko-KR')}원` : '—'}</dd>
                  <dt>기간</dt><dd>{ymdKst(g.guaranteeFrom ?? undefined) || '—'} ~ {ymdKst(g.guaranteeUntil ?? undefined) || '—'}</dd>
                </dl>
                {ex?.guaranteeExpired && <div className="gw-ls gw-warn">기간이 지났습니다. 갱신 증서를 올려 주십시오.</div>}
              </>
            ) : <div className="gw-brnone">등록된 보증이 없습니다. <b>보증 없이는 승인되지 않습니다(INV-BR4).</b></div>}
            {ex?.submittedDocs && ex.submittedDocs.length > 0 && (
              <div className="gw-ls">제출 서류: {ex.submittedDocs.map(docLabel).join(' · ')}{ex.docFileCount ? ` · 파일 ${ex.docFileCount}개` : ''}</div>
            )}
            <div className="gw-ls">공제는 공개 API 가 없어 증서 입력과 만료일 관리로 갑니다.</div>
          </div>
        </div>

        {b.applied && (
          <div className="gw-brkbox" style={{ marginTop: 10 }}>
            <span className="gw-lb">신청 · 판정</span>
            <dl className="gw-brdl">
              <dt>신청</dt><dd>{ymdKst(b.createdAt) || '—'}</dd>
              <dt>판정</dt><dd>{ymdKst(b.decidedAt) || '심사 전'}</dd>
              <dt>재확인 기한</dt><dd>{ymdKst(b.recheckDue) || '—'}</dd>
            </dl>
            <div className="gw-ls">재확인 기한이 지나면 인증이 풀립니다.</div>
          </div>
        )}

        {b.applied && (
          <details className="gw-panel" style={{ marginTop: 10, padding: '12px 16px' }}>
            <summary><b>서류 · 보증(공제) 고쳐 올리기</b></summary>
            <BrokerExtraForm init={ex} />
          </details>
        )}

        <div className="gw-nt gw-info"><b>인증이 풀리는 경우가 있습니다.</b> 국토부 자료에서 폐업 · 등록취소로 바뀌거나 보증이 만료되면 일간 점검이 인증을 정지시키고 부동산 소개 노출이 함께 멈춥니다(INV-BR2 · INV-BR4). 180일마다 다시 확인합니다.</div>

        <div className="gw-prfact">
          {!b.applied || b.state === 'REJECTED' || b.state === 'EXPIRED'
            ? <Link className="gw-bp" href="/my/broker">새로 신청</Link>
            : <span className="gw-bp gw-off" title="진행 중인 신청이 있어 새로 신청할 수 없습니다" aria-disabled="true">새로 신청</span>}
          {reviewer && adminOrigin && <a className="gw-bo" href={`${adminOrigin}/#quals`}>검수자 화면 보기</a>}
          <Link className="gw-bo" href="/mal/brokers">공인중개사 매물 연동</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
