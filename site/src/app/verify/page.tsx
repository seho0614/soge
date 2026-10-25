import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { VerifyPanel } from '@/components/VerifyPanel';
import { BizVerify } from '@/components/BizVerify';
import { BackBar } from '@/components/common/BackBar';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.verify'))('title') };
}

/**
 * SB-HOM-AUT-030 본인인증
 *
 * 상세 화면 CTA 가 IDENTITY_REQUIRED 로 막히면 여기로 옵니다.
 * 이 화면이 없으면 사용자가 갈 곳이 없어 F0 흐름이 끊깁니다.
 */
/* v10.27 (G-201) — 「돌아가기」가 늘 첫 화면으로 갔습니다(주문서에서 왔어도). ?next= 로 온 곳을 받아 그리로 돌려보냅니다.
 * 우리 사이트 안 주소(/로 시작 · //·\ 아님)만 받습니다 — 밖으로 보내는 통로가 되지 않게. */
function safeNext(v?: string) {
  return v && /^\/(?![\/\\])[^\s]*$/.test(v) && v.length <= 300 ? v : null;
}

/**
 * v10.32 (추가) — 시안 scVerify 그대로: 「← 메인(으)로 돌아가기」 · 제목 「본인 · 사업자 인증」 · 넓은 카드 두 장
 *   (1. 휴대폰 본인확인 — 실명 안내 · 본인인증 단추 / 2. 사업자 인증 — 사업자등록번호 · 노란 안내 · 「국세청 조회로 인증」).
 *   본인인증 흐름(VerifyPanel · POST /verifications/identity)은 그대로. 사업자 인증은 이미 있는 API 그대로(BizVerify — POST /signup/biz-check → POST /businesses).
 *   ol.steps · .step-state · .ok-note · .verify 는 기존 흐름 시험이 쓰는 손잡이라 이름을 남기고 모양만 시안 카드로 덮습니다(w1-vfy).
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const t = await getTranslations('join.verify');
  const p = await me();
  if (!p) redirect('/login');

  const identityDone = !!p.identityVerifiedAt;
  const businessDone = !!p.businessVerifiedAt;
  /* 사업자 신청이 이미 있고 반려가 아니면 심사 중(나의공간 사업자 전환과 같은 읽기 — GET /me/account) */
  const biz = businessDone ? null : await apiGetPersonal<{ business: { companyName: string | null; bizRegNo: string | null; rejectReason: string | null; createdAt?: string | null } | null }>('/me/account')
    .then((r) => r.business).catch(() => null);
  const pending = !!biz && !biz.rejectReason;

  return (
    <><div className="w1 w1-wrap w1-vfy auth-wrap" data-screen="SB-HOM-AUT-030">
      {/* 시안 「← 메인(으)로 돌아가기」 — ?next= 로 왔으면 그 화면으로(전 맨 아래 「돌아가기」를 위로 옮김) */}
      <BackBar href={next ?? '/'} label={next ? t('backPrev') : t('backMain')} wrap={false} linkData={{ 'data-verify-back': '' }} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('title')}</h1>
        <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p>
      </div>

      <ol className="steps">
        <li className={identityDone ? 'done' : 'now'}>
          <div className="step-head">
            <h2>{t('h1')}</h2>
            <span className="step-state">{identityDone ? t('stDone') : t('stNeeded')}</span>
          </div>
          {identityDone ? (
            <p className="ok-note my-nt ok"><b>{t('idDoneB')}</b>{p.identityVerifiedAt ? t('idDoneAt', { date: ymdKst(p.identityVerifiedAt) }) : ''}{t('doneTail')}</p>
          ) : (
            <>
              <div className="my-nt info">{t.rich('idNote', { b: (c) => <b>{c}</b> })}</div>
              <Msgs ns={['join']}><VerifyPanel /></Msgs>
            </>
          )}
        </li>

        <li className={businessDone ? 'done' : identityDone ? 'now' : 'wait'}>
          <div className="step-head">
            <h2>{t('h2')}</h2>
            <span className="step-state">{businessDone ? t('stDone') : pending ? t('stReviewing') : identityDone ? t('stOptional') : t('stAfterId')}</span>
          </div>
          {businessDone ? (
            <p className="ok-note my-nt ok"><b>{t('bizDoneB')}</b>{t('bizDoneText', { date: ymdKst(p.businessVerifiedAt) })}</p>
          ) : pending ? (
            <div className="my-nt info" data-biz-pending=""><b>{t('pendingB')}</b> — {biz!.companyName ?? t('noCompany')}{biz!.bizRegNo ? t('pendingBrn', { brn: biz!.bizRegNo }) : ''}{biz!.createdAt ? t('pendingAt', { date: ymdKst(biz!.createdAt) }) : ''}{t('pendingTail')}</div>
          ) : (
            <>
              {biz?.rejectReason && <div className="my-nt warn" role="alert">{t('rejected', { reason: biz.rejectReason })}</div>}
              <Msgs ns={['join', 'forms']}><BizVerify /></Msgs>
            </>
          )}
          {/* 개발에만 있던 길(남김) — 인증 시각 기준일 안내 · 사업장 주소까지 적는 사업자 전환 화면 */}
          {!businessDone && (
            <p className="my-ls w1-vmore">{t.rich('more', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/my/business">{c}</Link> })}</p>
          )}
        </li>
      </ol>

      {next && identityDone && (
        <p><Link className="my-bp" href={next} data-verify-next>{t('continue')}</Link></p>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
