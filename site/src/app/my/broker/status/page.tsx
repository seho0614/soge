import type { Metadata } from 'next';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import Link from 'next/link';
import { BackBar } from '@/components/common/BackBar';
import { BrokerExtraForm, type BrokerExtraValue } from '@/components/BrokerExtra';
import { BROKER_DOCS } from '@/components/broker-docs';   // v10.31 검정 — 'use client' 파일의 배열을 서버 화면에서 가져오면 참조만 넘어와 500

import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.brokerSt'))('title') };
}

interface B {
  applied: boolean; assumed: boolean;
  licenseNo?: string; officeName?: string; ceoName?: string;
  state?: string; lookupResult?: string; lookupAt?: string;
  recheckDue?: string; rejectReason?: string; createdAt?: string;
  decidedAt?: string | null; canPublish?: boolean;
}

/* v10.99 — 상태 · 대조 결과 이름은 사전 키(my.brokerSt.st.* · my.brokerSt.lk.*) */
const ST: Record<string, 'submitted' | 'pending' | 'verified' | 'rejected' | 'expired'> = {
  SUBMITTED: 'submitted', PENDING: 'pending', VERIFIED: 'verified',
  REJECTED: 'rejected', EXPIRED: 'expired',
};
const LK: Record<string, 'match' | 'mismatch' | 'notFound'> = {
  MATCH: 'match', MISMATCH: 'mismatch', NOT_FOUND: 'notFound',
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
  const t = await getTranslations('my.brokerSt');

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
  const steps: ['apply' | 'lookup' | 'docs' | 'done', boolean][] = [
    ['apply', b.applied],
    ['lookup', !!b.lookupResult || (b.applied && b.assumed) || b.state === 'PENDING' || ok],
    ['docs', b.state === 'PENDING' || ok || b.state === 'REJECTED'],
    ['done', ok],
  ];
  const tone = ok ? 'ok' : 'warn';
  const stKey = ST[b.state ?? ''];
  const lkKey = b.lookupResult ? LK[b.lookupResult] : undefined;

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/my/broker" label={t('backBroker')} wrap={false} />
        <div className="gw-pgh"><div><h1>{t('h1')}</h1><p>{t('lead')}</p></div></div>

        <div className={`gw-brkstat gw-${tone}`} data-broker-state={b.state}>
          <div>
            <span className="gw-lb">{t('curState')}</span>
            <h2>{b.applied ? (stKey ? t(`st.${stKey}`) : b.state) : t('notApplied')}</h2>
            <p>
              {!b.applied ? t('pNotApplied') : null}
              {ok && b.canPublish ? t('pCanPublish') : null}
              {b.state === 'PENDING' ? t('pPending') : null}
              {b.state === 'SUBMITTED' ? t('pSubmitted') : null}
              {b.rejectReason ? <>{t('reason', { reason: b.rejectReason })}</> : null}
            </p>
          </div>
          <div className="gw-brkno2">{b.licenseNo ?? '—'}</div>
        </div>

        <div className="gw-brkstep">
          {steps.map(([s, on], i) => <div key={s} className={`gw-bsi${on ? ' gw-on' : ''}`}><i>{i + 1}</i><span>{t(`step.${s}`)}</span></div>)}
        </div>

        {b.applied && b.assumed ? (
          <div className="gw-nt gw-warn"><b>{t('assumedB')}</b> {t('assumedText')}</div>
        ) : null}

        <div className="gw-brkgrid">
          <div className="gw-brkbox">
            <span className="gw-lb">{t('hLookup')}</span>
            <dl className="gw-brdl">
              <dt>{t('office')}</dt><dd>{b.officeName ?? '—'}</dd>
              <dt>{t('ceo')}</dt><dd>{b.ceoName ?? '—'}</dd>
              <dt>{t('lookupResult')}</dt><dd>{b.lookupResult
                ? <span className={`gw-bg ${b.lookupResult === 'MATCH' ? 'gw-ok' : 'gw-no'}`}>{lkKey ? t(`lk.${lkKey}`) : b.lookupResult}</span>
                : <span className="gw-ls">{t('notLooked')}</span>}</dd>
              <dt>{t('baseDate')}</dt><dd>{ymdKst(b.lookupAt) || '—'}</dd>
            </dl>
          </div>
          <div className="gw-brkbox" data-broker-guarantee={g ? 'on' : 'none'}>
            <span className="gw-lb">{t('hGuarantee')}</span>
            {g ? (
              <>
                <dl className="gw-brdl">
                  <dt>{t('org')}</dt><dd>{g.guaranteeOrg ?? '—'}</dd>
                  <dt>{t('cert')}</dt><dd>{g.guaranteeCertNo ?? '—'}</dd>
                  <dt>{t('amount')}</dt><dd>{g.guaranteeAmount != null ? `${Number(g.guaranteeAmount).toLocaleString('ko-KR')}원` : '—'}</dd>
                  <dt>{t('period')}</dt><dd>{ymdKst(g.guaranteeFrom ?? undefined) || '—'} ~ {ymdKst(g.guaranteeUntil ?? undefined) || '—'}</dd>
                </dl>
                {ex?.guaranteeExpired && <div className="gw-ls gw-warn">{t('expiredG')}</div>}
              </>
            ) : <div className="gw-brnone">{t.rich('noGuarantee', { b: (c) => <b>{c}</b> })}</div>}
            {ex?.submittedDocs && ex.submittedDocs.length > 0 && (
              <div className="gw-ls">{t('docs', { list: ex.submittedDocs.map(docLabel).join(' · ') })}{ex.docFileCount ? t('files', { n: String(ex.docFileCount) }) : ''}</div>
            )}
            <div className="gw-ls">{t('guaranteeHint')}</div>
          </div>
        </div>

        {b.applied && (
          <div className="gw-brkbox" style={{ marginTop: 10 }}>
            <span className="gw-lb">{t('hDecision')}</span>
            <dl className="gw-brdl">
              <dt>{t('step.apply')}</dt><dd>{ymdKst(b.createdAt) || '—'}</dd>
              <dt>{t('decided')}</dt><dd>{ymdKst(b.decidedAt) || t('beforeReview')}</dd>
              <dt>{t('recheckDue')}</dt><dd>{ymdKst(b.recheckDue) || '—'}</dd>
            </dl>
            <div className="gw-ls">{t('recheckHint')}</div>
          </div>
        )}

        {b.applied && (
          <details className="gw-panel" style={{ marginTop: 10, padding: '12px 16px' }}>
            <summary><b>{t('edit')}</b></summary>
            <Msgs ns={['join']}><BrokerExtraForm init={ex} /></Msgs>
          </details>
        )}

        <div className="gw-nt gw-info"><b>{t('lapseB')}</b> {t('lapseText')}</div>

        <div className="gw-prfact">
          {!b.applied || b.state === 'REJECTED' || b.state === 'EXPIRED'
            ? <Link className="gw-bp" href="/my/broker">{t('newApply')}</Link>
            : <span className="gw-bp gw-off" title={t('newApplyOff')} aria-disabled="true">{t('newApply')}</span>}
          {reviewer && adminOrigin && <a className="gw-bo" href={`${adminOrigin}/#quals`}>{t('reviewer')}</a>}
          <Link className="gw-bo" href="/mal/brokers">{t('brokers')}</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
