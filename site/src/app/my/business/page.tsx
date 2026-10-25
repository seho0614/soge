import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { uiMessages } from '@/lib/content';
import { BusinessForm } from '@/components/BusinessForm';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

interface Biz { companyName: string | null; bizRegNo: string | null; verifiedAt: string | null; rejectReason: string | null; ntsStatus: string | null; createdAt?: string | null }

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.biz'))('title') };
}

/* v10.31 (10/10 시안 기준 · 결정 기록 P4) — 시안(scMyBiz2) 두 목록 · 경고를 글자 그대로 씁니다:
 *   「소개비 수령 (INV-10)」은 사업자 인증 후 목록, 「인증 시각이 소개비 수령 자격의 기준일 · 인증 전 성사 건은 소급되지 않습니다」 경고.
 *   (v10.28 의 「소개비 받기(개인)」를 지금 할 수 있는 것에 두던 글 → 시안 글). 서버도 같은 규칙입니다 — 사업자로 받는 것은 인증 뒤 성사 건부터(D060 ⑦).
 *   개인(본인인증)으로 받는 정산(INV-10R · 시안 정산 화면의 「개인 회원」)은 그대로라, 개발에만 있던 안내 한 줄로 정산 화면에 잇습니다(규칙 ③). */
/* v10.37 (D095 · 10/13 · P2P) — 모든 업무는 본인인증 개인도 · 인증이 필요한 등록만 그 인증 · 사업자 인증은 사업자로 소개비를 받을 때 */
/* v10.38 (D096 · P2P) — 파트너 입점 · 공인중개사 인증 · 자격 심사 · 인력대행 회신도 본인인증 개인이 합니다(계정 기준) */
/* v10.99 — 목록 글은 사전 키(my.biz.can.* · my.biz.after.*) */
const CAN_NOW = ['register', 'iKnow', 'deal', 'urgent', 'post', 'partner', 'feeIndividual'] as const;
const AFTER = ['feeBiz', 'badge'] as const;

/**
 * SB-MYP-BIZ-020 사업자 전환 안내
 *
 * v10.28 — 개인(본인인증)도 소개비를 받습니다(INV-10R · 받을 계좌 확인). 사업자 인증은 거래 만들기 · 소개비 제시 · 계약서 발급에 필요하고,
 * 사업자 인증이 있으면 소개비를 사업자로 받습니다. (SETTLEMENT_BLOCKED_INDIVIDUAL 알림은 이제 /my/settlement 로 보냅니다.)
 * v10.29 — 시안 배치: 머리 오른쪽 「사업자 인증하기」 → 지금 하실 수 있는 것 · 사업자 인증 후 가능한 것 → 안내 2개 → (실제 웹) 신청서.
 */
export default async function BusinessPage() {
  const p = await me();
  const messages = await uiMessages();
  if (!p) redirect('/login');
  const t = await getTranslations('my.biz');

  if (p.businessVerifiedAt) {
    return (
      <><div data-biz-done="">
        <MyHead title={t('doneTitle')} sub={t('doneSub')} />
        <Note kind="ok">{t('doneNote', { date: ymdKst(p.businessVerifiedAt) })}</Note>
        <h2 className="my-s2">{t('hAfter')}</h2>
        <ul className="my-ul cols">{AFTER.map((x) => <li key={x}>{t(`after.${x}`)}</li>)}</ul>
        <div className="my-btns"><Link className="my-bo" href="/my/account">{t('viewBiz')}</Link><Link className="my-bo" href="/my">{t('my')}</Link></div>
      </div><i hidden data-root-end="" /></>
    );
  }

  /* v10.27 (G-201) — 신청이 있고 반려가 아니면 심사 중 카드를, 반려면 사유와 함께 다시 내는 폼을 보입니다. */
  const prof = await apiGetPersonal<{ business: Biz | null }>('/me/account').catch(() => null);
  const biz = prof?.business ?? null;
  if (biz && !biz.rejectReason) {
    return (
      <><div data-biz-pending>
        <MyHead title={t('pendingTitle')} sub={t('pendingSub')} />
        <div className="my-card">
          <b>{biz.companyName ?? t('noCompany')}</b>
          {biz.bizRegNo && <div className="my-ls">{t('bizRegNo', { no: biz.bizRegNo })}</div>}
          {biz.createdAt && <div className="my-ls">{t('appliedOn', { date: ymdKst(biz.createdAt) })}</div>}
        </div>
        <Note kind="info">{t.rich('pendingNote', { a: (c) => <Link href="/my/account">{c}</Link> })}</Note>
      </div><i hidden data-root-end="" /></>
    );
  }

  return (
    <><div data-biz-apply="">
      <MyHead title={t('title')}
        sub={t('sub')}
        right={<a className="my-bp" href="#biz-form">{t('apply')}</a>} />
      {biz?.rejectReason && (
        <Note kind="warn" role="alert" data-biz-rejected="">{t('rejected', { reason: biz.rejectReason })}</Note>
      )}

      <h2 className="my-s2">{t('hNow')}</h2>
      <ul className="my-ul cols my-cols3" data-biz-can="">{/* v10.32 — 시안 3열 */}{CAN_NOW.map((x) => <li key={x}>{t(`can.${x}`)}</li>)}</ul>
      <h2 className="my-s2">{t('hAfter')}</h2>
      <ul className="my-ul cols my-cols3" data-biz-after="">{AFTER.map((x) => <li key={x}>{t(`after.${x}`)}</li>)}</ul>

      <Note kind="info"><b>{t('ntsB')}</b> {t('ntsText')}</Note>
      <Note kind="warn" data-biz-noretro=""><b>{t('retroB')}</b> {t('retroText')}</Note>
      {/* 개발에만 있던 안내(규칙 ③) — 본인인증 개인 수령(INV-10R)과 거래 만들기 · 계약서 발급(사업자) · 사람 확인 */}
      <p className="my-ls" data-biz-dev="">
        {messages.BUSINESS_ONLY} {t.rich('devNote', { a: (c) => <Link href="/my/settlement">{c}</Link> })}
        {' '}{messages.MANUAL_REVIEW}
      </p>

      <h2 className="my-s2" id="biz-form">{t('hForm')}</h2>
      <div className="my-card"><Msgs ns={['join', 'forms']}><BusinessForm /></Msgs></div>

      <p className="my-ls"><Link href="/verify">{t('toVerify')}</Link></p>
    </div><i hidden data-root-end="" /></>
  );
}
