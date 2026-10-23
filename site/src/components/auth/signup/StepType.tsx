'use client';
import type { SignupType } from './rules';

/* 시안 1단계 설명(개인 회원 문구는 v10.28 개인 정산 — 본인인증 시 소개비 수령) */
const TYPE_TEXT: Record<string, React.ReactNode> = {
  PERSONAL: <>사업자등록 없이 바로 시작합니다. <b>요청 등록과 소개 참여</b>가 가능하며, 본인인증을 하시면 소개비도 받으십니다. <b>모든 업무</b>를 하실 수 있습니다. 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.</>,
  SOLE: <>사업자등록번호 10자리를 인증합니다. 대표자는 <b>가입자 본인</b>이어야 합니다. 휴업 · 폐업 확인을 거칩니다.</>,
  CORP: <>사업자등록번호와 <b>법인등록번호 13자리</b>를 모두 인증합니다. 대표자는 가입자와 달라도 됩니다.</>,
};

/** 회원가입 1 가입 유형 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepType({ types, type, setType }: {
  types: SignupType[]; type: string; setType: (v: string) => void;
}) {
  return (
    <div className="w1-jsec">
      <div className="w1-jc i"><span className="lb">개인 · 사업자 모두 같은 업무를 합니다</span>
        <b>개인 회원</b>도 요청 등록과 소개 참여를 하실 수 있고, <b>본인인증을 하시면 소개비도 받으십니다</b>.
        {/* v10.37 (D095 · P2P) — 모든 업무는 개인도 · 인증이 필요한 등록만 그 인증 */}
        등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다. 사업자로 소개비(세금계산서)를 받으시려면 나중에 나의공간에서 사업자 전환을 하시면 됩니다.</div>
      <div className="w1-jt">1. 가입 유형을 선택하세요</div>
      <div className="w1-jops" role="radiogroup" aria-label="가입 유형">
        {types.map((t) => (
          <button key={t.code} type="button" role="radio" aria-checked={type === t.code}
            className={`w1-jop${type === t.code ? ' on' : ''}`} data-jt={t.code} onClick={() => setType(t.code)}>
            <span className="rd" aria-hidden="true" />
            <span><b>{t.label}</b><span>{TYPE_TEXT[t.code] ?? t.sub}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
