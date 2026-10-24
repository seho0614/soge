/* v10.95 — 사전 키를 이어 붙일 때 쓰는 정해진 목록(형식 검사가 키를 확인하도록) */
export const GWAN_KEYS = ['MNY', 'MAL', 'BIZ', 'HLT'] as const;
export type GwanKey = (typeof GWAN_KEYS)[number];
export const isGwanKey = (c: string): c is GwanKey => (GWAN_KEYS as readonly string[]).includes(c);

export const SIGNUP_TYPES = ['PERSONAL', 'SOLE', 'CORP'] as const;
export type SignupTypeKey = (typeof SIGNUP_TYPES)[number];
export const isSignupTypeKey = (c: string): c is SignupTypeKey => (SIGNUP_TYPES as readonly string[]).includes(c);
