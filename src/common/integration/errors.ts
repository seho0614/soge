import { HttpErrorKind } from '../http-json';

/* ---------------------------------------------------------------------
 * v10.44 (2026-10-15 · 외부 연동 틀 통일) — 연동 오류 종류 한 벌
 *
 *   HttpErrorKind   TIMEOUT · NETWORK · AUTH · HTTP_4XX · UPSTREAM · BAD_RESPONSE (common/http-json.ts)
 *   NOT_CONFIGURED  키 · 주소가 없어 부르지 않음
 *   REJECTED        업체가 요청을 받고 「안 됨」이라 답함(형식은 맞음)
 *
 * 연동마다 더 필요한 것은 이어 붙입니다 — 예: 계좌인증 = IntegrationErrorKind | 'HOLDER_MISMATCH' | 'CODE_MISMATCH'.
 * 화면 문구 · 재시도 여부를 종류로 가르므로, 같은 뜻에 다른 이름을 새로 만들지 마십시오.
 * ------------------------------------------------------------------- */
export type IntegrationErrorKind = HttpErrorKind | 'NOT_CONFIGURED' | 'REJECTED';
