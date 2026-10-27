import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { I18nService } from './i18n.service';
import { translateBody } from '../../common/i18n/server-text';

/**
 * v10.125 (docs/189) — 응답 출구에서 서버 안내 글(note · warning · reason · message · notice)을 화면 언어로.
 *   CategoryNameInterceptor 와 같은 규칙 — 한국어 · 다국어 꺼짐이면 아무것도 안 함 · 운영 화면(/admin) 건너뜀 · 실패하면 원문 그대로.
 *   오류 글(message)은 오류 출구 DbErrorFilter 가 옮깁니다.
 */
@Injectable()
export class ServerTextInterceptor implements NestInterceptor {
  private readonly log = new Logger(ServerTextInterceptor.name);
  constructor(private readonly i18n: I18nService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const url: string = ctx.switchToHttp().getRequest()?.originalUrl ?? '';
    if (/^\/api\/v1\/admin(\/|\?|$)/.test(url)) return next.handle();
    const langP = this.i18n.activeLang().catch(() => null);   // 요청 문맥 안에서 먼저 읽음
    return next.handle().pipe(mergeMap((body) => from(this.apply(body, langP))));
  }

  private async apply(body: unknown, langP: Promise<string | null>): Promise<unknown> {
    if (body == null || typeof body !== 'object') return body;
    const lang = await langP;
    if (!lang) return body;
    const proto = Array.isArray(body) ? null : Object.getPrototypeOf(body);
    if (proto !== null && proto !== Object.prototype) return body;   // 파일 · 버퍼 · 클래스 객체는 그대로(일반 객체 · 배열만)
    try {
      const copy = structuredClone(body);   // 서비스가 기억(캐시)해 둔 객체를 고치지 않게 — 사본을 옮김
      translateBody(copy, lang);
      return copy;
    } catch (e: any) {
      this.log.warn(`안내 글 번역 건너뜀: ${String(e?.message ?? e)}`);
      return body;
    }
  }
}
