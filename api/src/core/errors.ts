import { HttpException, HttpStatus } from '@nestjs/common';

/* e1.2 (docs/002) 오류 모양 — 소개뱅크와 같게 { code, message } (화면이 code 로 판단) */
export class ErpError extends HttpException {
  constructor(status: number, code: string, message: string) { super({ code, message }, status); }
}
export const Unauthorized = (code: string, message: string) => new ErpError(HttpStatus.UNAUTHORIZED, code, message);
export const Forbidden = (code: string, message: string) => new ErpError(HttpStatus.FORBIDDEN, code, message);
export const NotFound = (message: string) => new ErpError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
export const Conflict = (code: string, message: string) => new ErpError(HttpStatus.CONFLICT, code, message);
export const Policy = (code: string, message: string) => new ErpError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
export const Unavailable = (code: string, message: string) => new ErpError(HttpStatus.SERVICE_UNAVAILABLE, code, message);
