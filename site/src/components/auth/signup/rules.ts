/**
 * 회원가입 5단계(SignupWizard)가 같이 쓰는 형식 · 규칙.
 * v10.86 — SignupWizard.tsx 에서 나눔(동작 같음).
 */
export type AuthResult = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };
export interface SignupType { code: string; label: string; sub: string; needsBiz: boolean; needsCorp: boolean }
export interface JoinTerm { code: string; title: string; isRequired: boolean }

/** 5단계 — v10.95 글자는 사전 키(signup.steps.<키>.t · .s) */
export const STEPS = ['type', 'biz', 'person', 'terms', 'profile'] as const;
/** 비밀번호 = 영문 · 숫자 · 특수문자 조합 10자 이상(시안 문구 · 서버 WEAK_PASSWORD 와 같은 규칙) */
export const PW_OK = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
export const fmtBrn = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

export interface BizCheck { bizRegNo: string; status: string; stub: boolean; detail: string | null; taken: boolean; ok: boolean }
export interface SegRes { code: string; name: string; description: string }
