import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../db/database.service';
import { clientIpKey, TooManyAttempts } from '../modules/identity/auth-throttle';
import { clientIpRaw, isInternalIp, settingInt } from '../modules/identity/abuse-guard';

/* ---------------------------------------------------------------------
 * v10.176 (D165 · docs/273) — API 전체 요청 한도(IP 하나 · 1분)
 *
 *   사용자 웹 전체 공개(11/1) 뒤 서버 1대(t3)가 긁어 가기 · 몰아치기 한 번에 느려지지 않게.
 *   상한은 사이트 설정 abuse.api_per_ip_min(운영 전용 · 기본 600 · 0 이면 끔 · 1분마다 다시 읽음).
 *   사용자 웹 화면(서버 렌더링)이 부르는 API 도 접속자 IP 를 넘기므로 같이 셉니다 — 그래서 넉넉히 600.
 *   세지 않는 것: 내부 IP(같은 서버 · 사설망) · 로그인한 운영자(ADMIN · SUPER · REVIEWER · PAYOUT).
 *   IP 는 HMAC 값(auth-throttle · 날짜를 섞음)으로만 이 프로세스 메모리에서 셉니다 — DB 에 남기지 않음.
 *   넘으면 429 API_RATE_LIMIT + Retry-After. 걸린 횟수는 운영 화면 「지켜보기」 카드(한도 걸림 1시간)에.
 * ------------------------------------------------------------------- */

const STAFF = new Set(['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT']);
const MAX_KEYS = 50_000;
const KEEP_MS = 60 * 60 * 1000;

const buckets = new Map<string, { min: number; n: number }>();
const limited: Array<{ at: number; key: string }> = [];

/** 이번 1분 창에 한 번 더 세고, 상한을 넘었으면 true */
export function countHit(key: string, limit: number, now = Date.now()): boolean {
  const min = Math.floor(now / 60_000);
  const b = buckets.get(key);
  if (!b || b.min !== min) {
    if (buckets.size >= MAX_KEYS) for (const [k, v] of buckets) if (v.min !== min) buckets.delete(k);
    buckets.set(key, { min, n: 1 });
    return 1 > limit;
  }
  b.n += 1;
  return b.n > limit;
}

function recordLimited(key: string, now = Date.now()) {
  limited.push({ at: now, key });
  while (limited.length > 5000 || (limited.length && limited[0].at < now - KEEP_MS)) limited.shift();
}

/** 지난 minutes 분 동안 한도에 걸린 요청 수 · 걸린 IP 수 */
export function rateLimitedSince(minutes: number, now = Date.now()) {
  const recent = limited.filter((h) => h.at >= now - minutes * 60 * 1000);
  return { n: recent.length, ips: new Set(recent.map((h) => h.key)).size };
}

/** 시험용 — 창 비우기 */
export function resetRateLimit() { buckets.clear(); limited.length = 0; }

@Injectable()
export class ApiRateLimitMiddleware implements NestMiddleware {
  private limit = 600;
  private readAt = 0;

  constructor(private readonly db: DatabaseService) {}

  private async currentLimit(): Promise<number> {
    if (Date.now() - this.readAt > 60_000) {
      this.readAt = Date.now();
      try { this.limit = await settingInt(this.db, 'abuse.api_per_ip_min', 600); } catch { /* DB 가 잠시 안 되면 지난 값 */ }
    }
    return this.limit;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const roles: string[] = (req as any).principal?.roles ?? [];
    if (isInternalIp(clientIpRaw()) || roles.some((r) => STAFF.has(r))) return next();
    const limit = await this.currentLimit();
    const key = clientIpKey();
    if (limit <= 0 || !key || !countHit(key, limit)) return next();
    recordLimited(key);
    const retry = 60 - Math.floor((Date.now() % 60_000) / 1000);
    res.setHeader('Retry-After', String(retry));
    throw new TooManyAttempts('API_RATE_LIMIT', '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주십시오.', retry);   // 미들웨어에서 던져도 DbErrorFilter 가 받음
  }
}
