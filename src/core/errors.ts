import { HttpException } from '@nestjs/common';

/**
 * 오류 코드는 문자열 상수입니다. 프런트가 분기하는 대상이므로
 * 메시지가 바뀌어도 코드는 바뀌지 않아야 합니다.
 */
export type ErrorBody = { code: string; message: string; field?: string; details?: unknown };

export class AppError extends HttpException {
  constructor(status: number, body: ErrorBody) {
    super(body, status);
  }
}

/** 422 — 요청 형식은 맞지만 정책이 막음 */
export class PolicyViolation extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, { code, message, details });
  }
}

/** 409 — 상태 충돌. 재시도해도 같은 결과 */
export class StateConflict extends AppError {
  constructor(code: string, message: string) {
    super(409, { code, message });
  }
}

/** 403 — 권한 없음 (INV-7 게이트 포함) */
export class Forbidden extends AppError {
  constructor(code: string, message: string) {
    super(403, { code, message });
  }
}

export class NotFound extends AppError {
  constructor(message = '대상을 찾을 수 없습니다.') {
    super(404, { code: 'NOT_FOUND', message });
  }
}
