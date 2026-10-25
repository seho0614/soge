import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { I18nService } from './i18n.service';

/** 업종 이름을 담는 칸 — 서비스마다 c.name AS "categoryName" · 대표 업종 mainCategory · 몇 곳은 category(글자 또는 { code, name }) */
const KEYS = new Set(['categoryName', 'mainCategory', 'category']);
/** 안의 묶음 name 이 업종 이름인 칸 */
const NAME_PARENTS = new Set(['category', 'categories', 'candidates']);
const MAX_NODES = 20_000;   // 아주 큰 응답은 끝까지 돌지 않음(그 뒤는 원문)

/**
 * v10.107 (docs/166) — 응답 출구에서 업종 이름을 화면 언어로.
 *
 *   리드 · 상담 · 파트너 센터 · 정산 · 업체 목록 · 자격 · 소개자 · 검색 · AI 추천 · 내 활동 · 대화 요약 등
 *   업종 이름을 글자로 내보내는 곳이 많아(14곳), 서비스마다 고치지 않고 여기 한 곳에서 바꿉니다.
 *   ① 화면 언어가 한국어 · 다국어 꺼짐이면 아무것도 하지 않음(응답 그대로) ② 운영 화면(/admin) 은 건너뜀(한국어 유지)
 *   ③ 칸 값이 업종 이름과 **정확히 같을 때만** 승인된 번역으로 바꿈 — 다른 글자는 건드리지 않음
 *   ④ 실패해도 응답은 원문 그대로 나감
 */
@Injectable()
export class CategoryNameInterceptor implements NestInterceptor {
  private readonly log = new Logger(CategoryNameInterceptor.name);
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
    try {
      const map = await this.i18n.categoryNameMap(lang);
      if (map.size) walk(body, map, { n: 0 });
    } catch (e: any) {
      this.log.warn(`업종 이름 번역 건너뜀: ${String(e?.message ?? e)}`);
    }
    return body;
  }
}

function plain(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function walk(v: unknown, map: Map<string, string>, c: { n: number }): void {
  if (++c.n > MAX_NODES) return;
  if (Array.isArray(v)) { for (const x of v) walk(x, map, c); return; }
  if (!plain(v)) return;
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x === 'string') { if (KEYS.has(k)) { const t = map.get(x); if (t) v[k] = t; } }
    else if (x && typeof x === 'object') {
      // 업종을 { code, name } 묶음(들)로 내보내는 곳 — 상담 업체 목록 category · 검색 업종 후보 candidates 등
      if (NAME_PARENTS.has(k)) {
        for (const y of Array.isArray(x) ? x : [x]) {
          if (plain(y) && typeof y.name === 'string') { const t = map.get(y.name); if (t) y.name = t; }
        }
      }
      walk(x, map, c);
    }
  }
}
