import { HttpException, HttpStatus } from '@nestjs/common';

/* e1.2 (docs/002) 오류 모양 — 소개뱅크와 같게 { code, message } (화면이 code 로 판단)
 * e3.1 (docs/010) 소개뱅크 core/errors.ts 와 **같은 클래스**(AppError · PolicyViolation · StateConflict · Forbidden · NotFound)
 *   — 옮겨 온 회계 코드가 `throw new PolicyViolation(…)` 를 그대로 씀 · ERP 자기 코드의 짧은 함수(Unauthorized · Conflict · Policy · Unavailable)도 남김 */
export type ErrorBody = { code: string; message: string; field?: string; details?: unknown };

export class AppError extends HttpException {
  constructor(status: number, body: ErrorBody) { super(body, status); }
}
/** 422 — 요청 형식은 맞지만 정책이 막음 */
export class PolicyViolation extends AppError {
  constructor(code: string, message: string, details?: unknown) { super(422, { code, message, details }); }
}
/** 409 — 상태 충돌 */
export class StateConflict extends AppError {
  constructor(code: string, message: string) { super(409, { code, message }); }
}
/** 403 — 권한 없음 */
export class Forbidden extends AppError {
  constructor(code: string, message: string) { super(403, { code, message }); }
}
export class NotFound extends AppError {
  constructor(message = '대상을 찾을 수 없습니다.') { super(404, { code: 'NOT_FOUND', message }); }
}

export class ErpError extends HttpException {
  constructor(status: number, code: string, message: string) { super({ code, message }, status); }
}
export const Unauthorized = (code: string, message: string) => new ErpError(HttpStatus.UNAUTHORIZED, code, message);
export const Conflict = (code: string, message: string) => new ErpError(HttpStatus.CONFLICT, code, message);
export const Policy = (code: string, message: string) => new ErpError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
export const Unavailable = (code: string, message: string) => new ErpError(HttpStatus.SERVICE_UNAVAILABLE, code, message);
