import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me, changePassword } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ProfileForm, BusinessForm, EarningsForm, PasswordForm } from './AccountForms';
import { MyHead, Note, Table } from '@/components/my/ui';

import { ymdKst } from '@/lib/format';
export const metadata: Metadata = { title: '프로필 · 사업자 정보' };

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

  const a = await apiGetPersonal<Account>('/me/account').catch(() => null);
  if (!a) {
    return (
      <><div data-acc-fail="">
        <MyHead title="프로필 · 사업자 정보" sub="회원 정보와 사업자 정보를 고칩니다." />
        <Note kind="warn" role="alert">회원 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</Note>
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
      <MyHead title="프로필 · 사업자 정보" sub={<>회원 정보와 사업자 정보를 고칩니다. <b>SB-MYP-ACC-010</b></>} />
      <Note kind="info">
        <b>고칠 수 없는 것이 있습니다.</b> <b>이메일</b>은 로그인 수단이라 별도 절차로 바꿉니다.
        <b> 사업자등록번호</b>를 바꾸는 것은 다른 사업자가 되는 것이라 고치는 게 아니라 다시 등록하셔야 합니다.
      </Note>

      <h2 className="my-st2">회원 정보</h2>
      <ProfileForm name={a.account.name} phone={a.account.phone} email={maskEmail(a.account.email)} />
      {a.account.identityVerifiedAt ? (
        <Note kind="warn"><b>{a.note ?? '본인인증을 마치셨습니다. 이름을 바꾸시면 다시 인증해야 합니다.'}</b> 인증한 이름과 달라지기 때문입니다.</Note>
      ) : (
        <Note kind="warn" className="act">
          <div><b>본인인증 전입니다.</b><p>문의와 거래 참여에 필요합니다.</p></div>
          <Link className="my-bp" href="/verify">본인인증하기</Link>
        </Note>
      )}

      <h2 className="my-st2">비밀번호 변경</h2>
      <PasswordForm action={doChangePassword} />
      <p className="my-ls">비밀번호를 바꾸시면 <b>다른 기기의 로그인이 모두 풀립니다.</b> 지금 비밀번호를 5번 잘못 넣으시면 30분 동안 잠깁니다.</p>

      <h2 className="my-st2">공개 설정</h2>
      <EarningsForm name={a.account.name} on={!!a.account.earningsPublic} />

      <h2 className="my-st2">사업자 정보</h2>
      {!b ? (
        <Note kind="info" className="act">
          <div><b>등록된 사업자 정보가 없습니다.</b><p>거래 만들기 · 소개비 제시 · 계약서 발급은 본인인증만으로 됩니다. 사업자 정보는 사업자로 소개비(세금계산서)를 받으실 때 등록합니다.</p></div>
          <Link className="my-bp" href="/my/business">사업자 등록하기</Link>
        </Note>
      ) : (
        <>
          <Table head={['항목', '내용']} narrow>
            <tr><td>사업자등록번호</td><td>{bizNo(b.bizRegNo)} {b.verifiedAt
              ? <span className="my-bg ok">인증 완료</span>
              : <span className="my-bg wait">인증 전</span>}</td></tr>
            <tr><td>상호</td><td>{b.companyName ?? '—'}</td></tr>
            <tr><td>대표자</td><td>{b.ceoName ?? '—'}</td></tr>
            <tr><td>업태 · 종목</td><td>{[b.bizType, b.bizItem].filter(Boolean).join(' · ') || '—'}</td></tr>
            <tr><td>주소</td><td>{b.address ?? '—'}</td></tr>
            <tr><td>국세청 확인</td><td>{b.ntsStatus ?? (b.verifiedAt ? '확인됨' : '—')}{b.verifiedAt && ` · ${d(b.verifiedAt)}`}</td></tr>
            {b.rejectReason && <tr><td>반려 사유</td><td style={{ color: '#B42318' }}>{b.rejectReason}</td></tr>}
          </Table>
          {a.editable.business ? (
            <>
              <p className="my-ls">인증 전이라 고치실 수 있습니다. 고친 뒤 사업자 인증을 받으십시오.</p>
              <BusinessForm biz={b} />
            </>
          ) : (
            <>
              <Note kind="warn">
                <b>인증이 끝난 사업자 정보는 고칠 수 없습니다.</b> 국세청이 확인한 내용과 달라지면 <b>그 확인이 무의미해집니다.</b>{' '}
                바뀐 것이 있으면 다시 인증하십시오.
              </Note>
              <div className="my-btns"><Link className="my-bo" href="/my/business">사업자 정보 다시 인증</Link></div>
            </>
          )}
        </>
      )}

      <h2 className="my-st2">회원 탈퇴</h2>
      <Note kind="plain" className="act" data-withdraw-entry="">
        <div><b>소개뱅크를 그만 이용하시려면</b><p>진행 중인 거래 · 정산 · 주문이 없어야 탈퇴하실 수 있습니다. 탈퇴 화면에서 먼저 확인해 드립니다.</p></div>
        <Link className="my-bo" href="/my/account/withdraw">회원 탈퇴</Link>
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
