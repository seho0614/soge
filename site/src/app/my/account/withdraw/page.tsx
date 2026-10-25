import type { Metadata } from 'next';
import Link from 'next/link';
import { me, withdrawAccount } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Table } from '@/components/my/ui';
import { WithdrawForm } from './WithdrawForm';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.withdraw'))('title') };
}

interface Check {
  canWithdraw: boolean;
  blockers: Array<{ code: string; label: string; cnt: number; link: string }>;
  reasons: Array<{ code: string; label: string }>;
  keepsRecords: boolean;
  paidSubscription: boolean;
  partner: boolean;
  notes: string[];
}

/**
 * SB-MYP-ACC-020 회원 탈퇴 (v10.48 · D102)
 *   GET  /me/withdraw/check — 막는 항목(이용약관 제13조 ② 진행 중인 거래 · 분쟁 · 정산 · 소개몰 주문 · 환불 · 리드캐시 잔액)과 안내
 *   POST /me/withdraw       — 사유 · 비밀번호 → 탈퇴(매물 · 요청 내리기 · 소개코드 정지 · 자동 결제 멈춤 · 로그인 끊김)
 *   ★ 막는 항목이 있으면 폼을 보이지 않고, 무엇을 끝내야 하는지와 그 화면 링크를 먼저 보여 줍니다.
 */
export default async function WithdrawPage() {
  const p = await me();
  const t = await getTranslations('my.withdraw');
  /* 탈퇴를 마치면 로그인 쿠키가 지워져 이 화면이 다시 그려집니다 — 로그인 화면으로 튕기지 않고 끝났다는 안내를 보입니다 */
  if (!p) {
    return (
      <><div data-my-withdraw="" data-withdraw-signed-out="">
        <MyHead title={t('title')} />
        <Note kind="info" role="status"><b>{t('signedOutB')}</b> {t('signedOutText')}</Note>
        <div className="my-btns"><Link className="my-bp" href="/">{t('toMain')}</Link>
          <Link className="my-bo" href="/login?next=/my/account/withdraw">{t('login')}</Link></div>
      </div><i hidden data-root-end="" /></>
    );
  }

  const c = await apiGetPersonal<Check>('/me/withdraw/check').catch(() => null);

  async function doWithdraw(password: string, reason: string, memo?: string) {
    'use server';
    return withdrawAccount(password, reason, memo);
  }

  return (
    <><div data-my-withdraw="">
      <MyHead title={t('title')} sub={<>{t('sub')} <b>SB-MYP-ACC-020</b></>}
        right={<Link className="my-bo" href="/my/account">{t('backProfile')}</Link>} />
      {!c ? (
        <Note kind="warn" role="alert">{t('loadFail')}</Note>
      ) : (
        <>
          {c.blockers.length > 0 && (
            <>
              <Note kind="warn" data-withdraw-blocked=""><b>{t('blockedB')}</b> {t('blockedText')}</Note>
              <Table head={[t('thTodo'), t('thCount'), '']} narrow>
                {c.blockers.map((b) => (
                  <tr key={b.code} data-blocker={b.code}><td>{b.label}</td><td>{t('count', { n: String(b.cnt) })}</td>
                    <td><Link className="my-bo" href={b.link}>{t('go')}</Link></td></tr>
                ))}
              </Table>
            </>
          )}
          <h2 className="my-st2">{t('hAfter')}</h2>
          <Note kind="info"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Note>
          {c.canWithdraw ? (
            <>
              <h2 className="my-st2">{t('hApply')}</h2>
              <WithdrawForm reasons={c.reasons} action={doWithdraw} />
            </>
          ) : (
            <div className="my-btns"><Link className="my-bp" href="/my">{t('toMy')}</Link></div>
          )}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
