import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { uiMessages } from '@/lib/content';
import { BusinessForm } from '@/components/BusinessForm';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note } from '@/components/my/ui';

interface Biz { companyName: string | null; bizRegNo: string | null; verifiedAt: string | null; rejectReason: string | null; ntsStatus: string | null; createdAt?: string | null }

export const metadata: Metadata = { title: '사업자 전환' };

/* v10.31 (10/10 시안 기준 · 결정 기록 P4) — 시안(scMyBiz2) 두 목록 · 경고를 글자 그대로 씁니다:
 *   「소개비 수령 (INV-10)」은 사업자 인증 후 목록, 「인증 시각이 소개비 수령 자격의 기준일 · 인증 전 성사 건은 소급되지 않습니다」 경고.
 *   (v10.28 의 「소개비 받기(개인)」를 지금 할 수 있는 것에 두던 글 → 시안 글). 서버도 같은 규칙입니다 — 사업자로 받는 것은 인증 뒤 성사 건부터(D060 ⑦).
 *   개인(본인인증)으로 받는 정산(INV-10R · 시안 정산 화면의 「개인 회원」)은 그대로라, 개발에만 있던 안내 한 줄로 정산 화면에 잇습니다(규칙 ③). */
/* v10.37 (D095 · 10/13 · P2P) — 모든 업무는 본인인증 개인도 · 인증이 필요한 등록만 그 인증 · 사업자 인증은 사업자로 소개비를 받을 때 */
/* v10.38 (D096 · P2P) — 파트너 입점 · 공인중개사 인증 · 자격 심사 · 인력대행 회신도 본인인증 개인이 합니다(계정 기준) */
const CAN_NOW = ['모든 관 등록 · 요청 등록', "'제가 알아요'로 소개 참여", '문의 · 거래 만들기 · 소개비 제시 · 계약서', '급구 · 급매 신청', '공고 · 자문 서비스 올리기', '파트너 입점 · 공인중개사 인증 · 자격 심사 신청', '소개비 받기(개인)'];
const AFTER = ['사업자로 소개비 받기(세금계산서)', '사업자 배지'];

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

  if (p.businessVerifiedAt) {
    return (
      <><div data-biz-done="">
        <MyHead title="사업자 인증 완료" sub="사업자로 소개비(세금계산서)를 받으실 수 있습니다." />
        <Note kind="ok">{ymdKst(p.businessVerifiedAt)} 에 인증되었습니다. 이 시각 뒤에 성사된 거래부터 소개비를 사업자로 받습니다(그 전 성사 건은 소급되지 않고 개인으로 받습니다).</Note>
        <h2 className="my-s2">사업자 인증 후 가능한 것</h2>
        <ul className="my-ul cols">{AFTER.map((x) => <li key={x}>{x}</li>)}</ul>
        <div className="my-btns"><Link className="my-bo" href="/my/account">사업자 정보 보기</Link><Link className="my-bo" href="/my">나의공간</Link></div>
      </div><i hidden data-root-end="" /></>
    );
  }

  /* v10.27 (G-201) — 신청이 있고 반려가 아니면 심사 중 카드를, 반려면 사유와 함께 다시 내는 폼을 보입니다. */
  const prof = await apiGetPersonal<{ business: Biz | null }>('/me/account').catch(() => null);
  const biz = prof?.business ?? null;
  if (biz && !biz.rejectReason) {
    return (
      <><div data-biz-pending>
        <MyHead title="사업자 인증 심사 중" sub="신청하신 내용을 운영자가 확인하고 있습니다. 결과는 알림으로 알려 드립니다." />
        <div className="my-card">
          <b>{biz.companyName ?? '(상호 없음)'}</b>
          {biz.bizRegNo && <div className="my-ls">사업자등록번호 {biz.bizRegNo}</div>}
          {biz.createdAt && <div className="my-ls">신청일 {ymdKst(biz.createdAt)}</div>}
        </div>
        <Note kind="info">잘못 적은 것이 있으면 심사가 끝나기 전에 <Link href="/my/account">프로필 · 사업자 정보 수정</Link>에서 고치실 수 있습니다.</Note>
      </div><i hidden data-root-end="" /></>
    );
  }

  return (
    <><div data-biz-apply="">
      <MyHead title="사업자 전환"
        sub="개인회원도 본인인증으로 모든 업무를 하실 수 있습니다. 사업자 인증은 사업자로 소개비(세금계산서)를 받으실 때 하시면 됩니다."
        right={<a className="my-bp" href="#biz-form">사업자 인증하기</a>} />
      {biz?.rejectReason && (
        <Note kind="warn" role="alert" data-biz-rejected="">지난 신청이 반려되었습니다 — {biz.rejectReason}. 고쳐서 다시 신청해 주십시오.</Note>
      )}

      <h2 className="my-s2">지금 하실 수 있는 것</h2>
      <ul className="my-ul cols my-cols3" data-biz-can="">{/* v10.32 — 시안 3열 */}{CAN_NOW.map((x) => <li key={x}>{x}</li>)}</ul>
      <h2 className="my-s2">사업자 인증 후 가능한 것</h2>
      <ul className="my-ul cols my-cols3" data-biz-after="">{AFTER.map((x) => <li key={x}>{x}</li>)}</ul>

      <Note kind="info"><b>사업자 인증은 국세청 조회로 확인합니다.</b> 등록번호와 상호가 맞아야 하고, 휴업·폐업 상태면 인증되지 않습니다.</Note>
      <Note kind="warn" data-biz-noretro=""><b>인증 시각이 소개비 수령 자격의 기준일입니다.</b> 인증 전에 성사된 건은 소급되지 않습니다 — 먼저 인증하시는 편이 낫습니다.</Note>
      {/* 개발에만 있던 안내(규칙 ③) — 본인인증 개인 수령(INV-10R)과 거래 만들기 · 계약서 발급(사업자) · 사람 확인 */}
      <p className="my-ls" data-biz-dev="">
        {messages.BUSINESS_ONLY} 사업자 인증 전 성사 건의 소개비는 <Link href="/my/settlement">정산</Link>에서 본인인증 · 받을 계좌 확인으로 개인으로 받습니다.
        {' '}{messages.MANUAL_REVIEW}
      </p>

      <h2 className="my-s2" id="biz-form">사업자 정보 입력</h2>
      <div className="my-card"><BusinessForm /></div>

      <p className="my-ls"><Link href="/verify">인증 현황으로 ›</Link></p>
    </div><i hidden data-root-end="" /></>
  );
}
