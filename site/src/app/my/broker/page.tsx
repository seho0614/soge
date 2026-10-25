import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import Link from 'next/link';
import { BrokerApply } from '@/components/BrokerApply';
import { BackBar } from '@/components/common/BackBar';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.broker'))('title') };
}

interface B {
  applied: boolean; assumed: boolean;
  licenseNo?: string; state?: string; lookupResult?: string; rejectReason?: string | null;
}

/**
 * SB-BIZ-BRK-010 중개사 인증 신청
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 부동산은 **중개사만 소개할 수 있습니다**(공인중개사법 9조).
 * 인증 없이 올리면 무등록 중개가 되고, 플랫폼이 그 자리를
 * 제공한 것이 됩니다.
 *
 * 등록 자체를 DB 트리거가 막으므로(INV-BR1), 이 화면을 거치지
 * 않으면 부동산 매물을 올릴 수 없습니다.
 *
 * v10.29 — 시안 scBrkApp 배치(돌아가기 · 제목 · 법 조항 경고 · 입력 · 단추 줄 · 안내)로 그립니다.
 *   입력 항목(개설등록번호 · 사무소 상호 · 대표자명)과 API(POST /partner/broker)는 그대로 — 시안의 시연용 예시 번호 · 제출 서류 체크는 넣지 않았습니다(diffs 창업-5).
 * v10.31 (w2 · 10/10 「시안 기준」) — 제출 서류 체크 4종 · 서류 파일 · 보증(공제) 칸을 더했습니다(PUT /me/broker/extra · D055). 시연용 예시 번호 칩은 넣지 않습니다(실제 사무소 번호를 띄우지 않음).
 */
export default async function BrokerPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('my.broker');
  const B = (c: React.ReactNode) => <b>{c}</b>;

  const b = await apiGet<B>('/partner/broker', 0).catch(() => null);
  /* 반려 · 만료된 건은 다시 신청하는 자리입니다 — 상태 화면으로 돌려보내면
   * "다시 신청하기" 가 제자리를 맴돕니다. */
  const retry = b?.state === 'REJECTED' || b?.state === 'EXPIRED';
  if (b?.applied && !retry) redirect('/my/broker/status');

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/my" label={t('backMy')} wrap={false} />
        <div className="gw-pgh"><div><h1>{t('h1')}</h1><p>{t.rich('lead', { b: B })}</p></div></div>

        <div className="gw-nt gw-warn">
          <b>{t('lawB')}</b>{t('lawText')}
        </div>

        {retry ? (
          <div className="gw-nt gw-warn">
            <b>{b?.state === 'EXPIRED' ? t('expired') : t('rejected')}</b>
            {b?.rejectReason ? <>{t('reason', { reason: b.rejectReason })}</> : null} {t('retry')}
          </div>
        ) : null}

        {b?.assumed ? (
          <div className="gw-nt gw-warn">
            <b>{t('assumedB')}</b> {t('assumedText')}
          </div>
        ) : null}

        {/* v10.38 (D096 · P2P) — 공인중개사 인증은 개인(본인인증)도 신청합니다. 인증 대상은 개설등록번호입니다 */}
        {!p.identityVerifiedAt && !p.businessVerifiedAt ? (
          <div className="gw-nt gw-warn"><b>{t('needId')}</b> <Link href="/verify">{t('goVerify')}</Link></div>
        ) : (
          <div className="gw-brkform gw-brkwrap"><BrokerApply assumed={!!b?.assumed} /></div>
        )}

        <div className="gw-dact" style={{ marginTop: 12 }}>
          <Link className="gw-bo" href="/my/broker/status">{t('myStatus')}</Link>
          <Link className="gw-bo" href="/mal/brokers">{t('brokers')}</Link>
        </div>

        <div className="gw-nt gw-info"><b>{t('noAutoB')}</b> {t('noAutoText')}</div>
        <div className="gw-nt gw-info"><b>{t('recheckB')}</b> {t('recheckText')}</div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
