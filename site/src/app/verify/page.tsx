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

export const metadata: Metadata = { title: '본인 · 사업자 인증' };

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
      <BackBar href={next ?? '/'} label={next ? '이전 화면' : '메인'} wrap={false} linkData={{ 'data-verify-back': '' }} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>본인 · 사업자 인증</h1>
        <p>본인인증은 <b>사람</b>을, 사업자 인증은 <b>사업체</b>를 확인합니다. 본인인증을 하면 소개비를 개인으로 받고 모든 업무를 하실 수 있습니다. 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다. 사업자 인증은 사업자로 소개비(세금계산서 · 인증 뒤 성사 거래부터)를 받으실 때 하십시오.</p>
      </div>

      <ol className="steps">
        <li className={identityDone ? 'done' : 'now'}>
          <div className="step-head">
            <h2>1. 휴대폰 본인확인</h2>
            <span className="step-state">{identityDone ? '완료' : '필요'}</span>
          </div>
          {identityDone ? (
            <p className="ok-note my-nt ok"><b>본인확인 완료</b>{p.identityVerifiedAt ? ` — ${ymdKst(p.identityVerifiedAt)} 인증` : ''}. 완료되었습니다.</p>
          ) : (
            <>
              <div className="my-nt info">정산 신청 때 예금주명과 대조하므로 <b>실명</b>이어야 합니다. 문의하기와 거래 참여에도 필요합니다.</div>
              <VerifyPanel />
            </>
          )}
        </li>

        <li className={businessDone ? 'done' : identityDone ? 'now' : 'wait'}>
          <div className="step-head">
            <h2>2. 사업자 인증</h2>
            <span className="step-state">{businessDone ? '완료' : pending ? '심사 중' : identityDone ? '선택' : '본인인증 후'}</span>
          </div>
          {businessDone ? (
            <p className="ok-note my-nt ok"><b>인증 완료</b> — {ymdKst(p.businessVerifiedAt)} 인증. 이 시각 뒤에 성사된 거래부터 소개비를 사업자로 받습니다. 완료되었습니다.</p>
          ) : pending ? (
            <div className="my-nt info" data-biz-pending=""><b>사업자 인증 심사 중</b> — {biz!.companyName ?? '(상호 없음)'}{biz!.bizRegNo ? ` · 사업자등록번호 ${biz!.bizRegNo}` : ''}{biz!.createdAt ? ` · 신청 ${ymdKst(biz!.createdAt)}` : ''}. 결과는 알림으로 알려 드립니다.</div>
          ) : (
            <>
              {biz?.rejectReason && <div className="my-nt warn" role="alert">지난 신청이 반려되었습니다 — {biz.rejectReason}. 고쳐서 다시 신청해 주십시오.</div>}
              <BizVerify />
            </>
          )}
          {/* 개발에만 있던 길(남김) — 인증 시각 기준일 안내 · 사업장 주소까지 적는 사업자 전환 화면 */}
          {!businessDone && (
            <p className="my-ls w1-vmore">인증이 완료된 시각이 <b>소개비 수령 자격의 기준일</b>입니다. 사업장 주소까지 한 번에 적으시려면 <Link href="/my/business">사업자 정보 등록</Link>(나의공간 › 사업자 전환)에서 신청하실 수 있습니다.</p>
          )}
        </li>
      </ol>

      {next && identityDone && (
        <p><Link className="my-bp" href={next} data-verify-next>하던 일 이어서 하기 ›</Link></p>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
