'use client';
import type { SignupType } from './rules';
import { useTranslations } from 'next-intl';
import { isSignupTypeKey } from '@/i18n/keys';

/* 시안 1단계 설명(개인 회원 문구는 v10.28 개인 정산 — 본인인증 시 소개비 수령) · v10.95 사전 signup.typeText.<유형> */

/** 회원가입 1 가입 유형 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepType({ types, type, setType }: {
  types: SignupType[]; type: string; setType: (v: string) => void;
}) {
  const tr = useTranslations('signup');
  return (
    <div className="w1-jsec">
      <div className="w1-jc i"><span className="lb">{tr('typeSameLb')}</span>
        {/* v10.37 (D095 · P2P) — 모든 업무는 개인도 · 인증이 필요한 등록만 그 인증 */}
        {tr.rich('typeSameBody', { b: (c) => <b>{c}</b> })}</div>
      <div className="w1-jt">{tr('typeTitle')}</div>
      <div className="w1-jops" role="radiogroup" aria-label={tr('typeLabel')}>
        {types.map((t) => (
          <button key={t.code} type="button" role="radio" aria-checked={type === t.code}
            className={`w1-jop${type === t.code ? ' on' : ''}`} data-jt={t.code} onClick={() => setType(t.code)}>
            <span className="rd" aria-hidden="true" />
            <span><b>{t.label}</b><span>{isSignupTypeKey(t.code) ? tr.rich(`typeText.${t.code}`, { b: (c) => <b>{c}</b> }) : t.sub}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
