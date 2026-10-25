import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me, changePassword } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ProfileForm, BusinessForm, EarningsForm, PasswordForm } from './AccountForms';
import { MyHead, Note, Table } from '@/components/my/ui';

import { ymdKst } from '@/lib/format';
import { getTranslations } from 'next-intl/server';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.acc'))('title') };
}

interface Account {
  account: {
    id: string; email: string; name: string; phone: string | null; accountType: string;
    status: string; identityVerifiedAt: string | null; createdAt: string;
    earningsPublic: boolean;
  };
  business: {
    id: string; bizRegNo: string; companyName: string | null; ceoName: string | null;
    bizType: string | null; bizItem: string | null; address: string | null;
    verifiedAt: string | null; ntsStatus: string | null; rejectReason: string | null;
  } | null;
  editable: { name: boolean; phone: boolean; email: boolean; business: boolean; bizRegNo: boolean };
  note: string | null;
}

/* 이메일은 가려서 보여 드립니다 — 화면 캡처로 새지 않게 */
const maskEmail = (e: string) => e.replace(/^(.{3})[^@]*/, '$1****');
const bizNo = (n: string) => n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n;
const d = (iso: string | null) => iso ? ymdKst(iso) : '';

/**
 * SB-MYP-ACC-010 프로필 · 사업자 정보 수정
 *
 *   GET   /me/account     회원 · 사업자 정보 + 고칠 수 있는 항목(editable)
 *   PATCH /me/account     이름 · 연락처 · 누적수익 공개 여부(v10.21)
 *   PATCH /me/business    사업자 정보 (인증 전만)
 *
 * ★ 무엇을 고칠 수 있는지 **묻지 않아도 알려 줍니다** — 고치려다 거절당하고 나서야 알면 안 됩니다.
 * v10.29 — 시안(scMyAcc) 배치: 고칠 수 없는 것 안내 → 회원 정보(입력 카드) → 본인인증 안내 → 공개 설정 → 사업자 정보 표 → 안내 · 다시 인증.
 * v10.48 (D102) — 회원 정보 아래 비밀번호 변경(PATCH /me/password) · 맨 아래 회원 탈퇴(SB-MYP-ACC-020 /my/account/withdraw).
 */
export default async function MyAccountPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('my.acc');
  const B = (c: React.ReactNode) => <b>{c}</b>;

  const a = await apiGetPersonal<Account>('/me/account').catch(() => null);
  if (!a) {
    return (
      <><div data-acc-fail="">
        <MyHead title={t('title')} sub={t('sub')} />
        <Note kind="warn" role="alert">{t('loadFail')}</Note>
      </div><i hidden data-root-end="" /></>
    );
  }
  const b = a.business;

  async function doChangePassword(current: string, next: string) {
    'use server';
    return changePassword(current, next);
  }

  return (
    <><div data-my-account="">
      <MyHead title={t('title')} sub={<>{t('sub')} <b>SB-MYP-ACC-010</b></>} />
      <Note kind="info">
        {t.rich('locked', { b: B })}
      </Note>

      <h2 className="my-st2">{t('hMember')}</h2>
      <ProfileForm name={a.account.name} phone={a.account.phone} email={maskEmail(a.account.email)} />
      {a.account.identityVerifiedAt ? (
        <Note kind="warn"><b>{a.note ?? t('verifiedNote')}</b> {t('verifiedWhy')}</Note>
      ) : (
        <Note kind="warn" className="act">
          <div><b>{t('unverified')}</b><p>{t('unverifiedWhy')}</p></div>
          <Link className="my-bp" href="/verify">{t('verify')}</Link>
        </Note>
      )}

      <h2 className="my-st2">{t('hPassword')}</h2>
      <PasswordForm action={doChangePassword} />
      <p className="my-ls">{t.rich('pwNote', { b: B })}</p>

      <h2 className="my-st2">{t('hPublic')}</h2>
      <EarningsForm name={a.account.name} on={!!a.account.earningsPublic} />

      <h2 className="my-st2">{t('hBiz')}</h2>
      {!b ? (
        <Note kind="info" className="act">
          <div><b>{t('noBiz')}</b><p>{t('noBizText')}</p></div>
          <Link className="my-bp" href="/my/business">{t('bizRegister')}</Link>
        </Note>
      ) : (
        <>
          <Table head={[t('thItem'), t('thValue')]} narrow>
            <tr><td>{t('bizRegNo')}</td><td>{bizNo(b.bizRegNo)} {b.verifiedAt
              ? <span className="my-bg ok">{t('verifiedBadge')}</span>
              : <span className="my-bg wait">{t('unverifiedBadge')}</span>}</td></tr>
            <tr><td>{t('company')}</td><td>{b.companyName ?? '—'}</td></tr>
            <tr><td>{t('ceo')}</td><td>{b.ceoName ?? '—'}</td></tr>
            <tr><td>{t('typeItem')}</td><td>{[b.bizType, b.bizItem].filter(Boolean).join(' · ') || '—'}</td></tr>
            <tr><td>{t('address')}</td><td>{b.address ?? '—'}</td></tr>
            <tr><td>{t('nts')}</td><td>{b.ntsStatus ?? (b.verifiedAt ? t('ntsOk') : '—')}{b.verifiedAt && ` · ${d(b.verifiedAt)}`}</td></tr>
            {b.rejectReason && <tr><td>{t('rejectReason')}</td><td style={{ color: 'var(--sgb-rd-text)' }}>{b.rejectReason}</td></tr>}
          </Table>
          {a.editable.business ? (
            <>
              <p className="my-ls">{t('bizEditable')}</p>
              <BusinessForm biz={b} />
            </>
          ) : (
            <>
              <Note kind="warn">
                {t.rich('bizLocked', { b: B })}{' '}
                {t('bizLockedTail')}
              </Note>
              <div className="my-btns"><Link className="my-bo" href="/my/business">{t('bizReverify')}</Link></div>
            </>
          )}
        </>
      )}

      <h2 className="my-st2">{t('hWithdraw')}</h2>
      <Note kind="plain" className="act" data-withdraw-entry="">
        <div><b>{t('withdrawB')}</b><p>{t('withdrawText')}</p></div>
        <Link className="my-bo" href="/my/account/withdraw">{t('hWithdraw')}</Link>
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
