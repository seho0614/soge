import type { Metadata } from 'next';
import Link from 'next/link';
import { me, withdrawAccount } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Table } from '@/components/my/ui';
import { WithdrawForm } from './WithdrawForm';

export const metadata: Metadata = { title: '회원 탈퇴' };

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
  /* 탈퇴를 마치면 로그인 쿠키가 지워져 이 화면이 다시 그려집니다 — 로그인 화면으로 튕기지 않고 끝났다는 안내를 보입니다 */
  if (!p) {
    return (
      <><div data-my-withdraw="" data-withdraw-signed-out="">
        <MyHead title="회원 탈퇴" />
        <Note kind="info" role="status"><b>로그인 상태가 아닙니다.</b> 방금 탈퇴하셨다면 처리가 끝났습니다 — 그동안 소개뱅크를 이용해 주셔서 고맙습니다.</Note>
        <div className="my-btns"><Link className="my-bp" href="/">메인으로</Link>
          <Link className="my-bo" href="/login?next=/my/account/withdraw">로그인</Link></div>
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
      <MyHead title="회원 탈퇴" sub={<>탈퇴 전에 확인할 것을 보여 드립니다. <b>SB-MYP-ACC-020</b></>}
        right={<Link className="my-bo" href="/my/account">프로필로 돌아가기</Link>} />
      {!c ? (
        <Note kind="warn" role="alert">탈퇴 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</Note>
      ) : (
        <>
          {c.blockers.length > 0 && (
            <>
              <Note kind="warn" data-withdraw-blocked=""><b>아래 일이 끝나야 탈퇴하실 수 있습니다.</b> 이용약관 제13조 ② — 진행 중인 거래나 정산이 있으면 그것이 끝난 뒤 처리됩니다.</Note>
              <Table head={['남은 일', '건수', '']} narrow>
                {c.blockers.map((b) => (
                  <tr key={b.code} data-blocker={b.code}><td>{b.label}</td><td>{b.cnt}건</td>
                    <td><Link className="my-bo" href={b.link}>보러 가기</Link></td></tr>
                ))}
              </Table>
            </>
          )}
          <h2 className="my-st2">탈퇴하면</h2>
          <Note kind="info"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Note>
          {c.canWithdraw ? (
            <>
              <h2 className="my-st2">탈퇴 신청</h2>
              <WithdrawForm reasons={c.reasons} action={doWithdraw} />
            </>
          ) : (
            <div className="my-btns"><Link className="my-bp" href="/my">나의공간으로</Link></div>
          )}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
