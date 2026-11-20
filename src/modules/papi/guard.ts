import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';
import { clientIpKey } from '../identity/auth-throttle';
import { PAPI_KEY_RE, keyHash, sameHash } from './keys';

/* ---------------------------------------------------------------------
 * v10.521 (D278 · docs/659) 파트너 오픈 API 키 가드 — /api/partner/v1/* 컨트롤러에 @UseGuards 로
 *
 *   머리글 X-Partner-Key: sgbp_… (또는 Authorization: Bearer sgbp_… — 회원 로그인 증표 검사는 sgbp_ 를 비로그인으로 넘김)
 *   순서: 스위치(papi.enabled · 10초 기억) → 키 모양 → 앞머리로 찾고 sha256 지문 고정 시간 비교 → 거둠 · 기한 · 파트너 상태 → 범위 → 1분 한도
 *     · 지문이 틀리면 앞머리가 있어도 똑같이 401 PAPI_KEY_INVALID(키가 있는지 알려 주지 않음)
 *     · 1분 한도는 이 프로세스 메모리에서 키마다(서버 1대) — 넘으면 429 PAPI_RATE_LIMIT + Retry-After
 *   요청마다 ptn_api_requests 한 줄(응답이 끝난 뒤 · 기다리지 않음 · 실패 무시) — 막힌 요청도 까닭(reason)과 함께
 *   IP 는 auth-throttle 의 하루 HMAC 앞 16자만(원래 IP 없음)
 * ------------------------------------------------------------------- */

export const PAPI_SCOPE_KEY = 'papi_scope';
/** 이 처리기에 필요한 범위(없으면 키만 맞으면 됨) */
export const PapiScope = (scope: string) => SetMetadata(PAPI_SCOPE_KEY, scope);

export interface PapiPrincipal { keyId: string; partnerId: string; scopes: string[]; name: string }

interface KeyRow { id: string; partnerId: string; name: string; hash: string; scopes: string[]; rate: number; status: string; expired: boolean; partnerStatus: string }

const buckets = new Map<string, { min: number; n: number }>();
const touched = new Map<string, number>();
const MAX_KEYS = 20_000;

/** 키마다 1분 창에 한 번 더 세고, 한도를 넘었으면 true */
export function papiHit(keyId: string, limit: number, now = Date.now()): boolean {
  const min = Math.floor(now / 60_000);
  const b = buckets.get(keyId);
  if (!b || b.min !== min) {
    if (buckets.size >= MAX_KEYS) for (const [k, v] of buckets) if (v.min !== min) buckets.delete(k);
    buckets.set(keyId, { min, n: 1 });
    return 1 > limit;
  }
  b.n += 1;
  return b.n > limit;
}
/** 시험용 — 창 비우기 */
export function resetPapiHits() { buckets.clear(); touched.clear(); }

const fail = (status: number, code: string, message: string) => new AppError(status, { code, message });

@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  private on = false;
  private readAt = 0;

  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  private async enabled(): Promise<boolean> {
    if (Date.now() - this.readAt > 10_000) {
      try {
        const [r] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'papi.enabled'`);
        this.on = (r?.value ?? '') === 'on';
        this.readAt = Date.now();
      } catch { /* DB 가 잠시 안 되면 지난 값 */ }
    }
    return this.on;
  }

  private log(keyId: string | null, partnerId: string | null, req: Request, status: number, ms: number | null, reason: string | null) {
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0]!.slice(0, 200) || '/';
    const ip = clientIpKey();
    void this.db.query(
      `INSERT INTO ptn_api_requests (key_id, partner_id, method, path, status, ms, reason, ip_key) VALUES ($1::bigint, $2::uuid, $3, $4, $5::int, $6::int, $7, $8)`,
      [keyId, partnerId, String(req.method ?? 'GET').toUpperCase().slice(0, 7), path, status, ms, reason, ip ? ip.slice(0, 16) : null]).catch(() => undefined);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { papi?: PapiPrincipal }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const t0 = Date.now();
    const deny = (keyId: string | null, partnerId: string | null, status: number, code: string, message: string) => {
      this.log(keyId, partnerId, req, status, Date.now() - t0, code);
      return fail(status, code, message);
    };

    if (!(await this.enabled())) throw deny(null, null, 503, 'PAPI_OFF', '파트너 오픈 API 가 꺼져 있습니다 — 소개뱅크 담당자에게 문의해 주십시오.');

    const auth = String(req.headers['authorization'] ?? '');
    const raw = String(req.headers['x-partner-key'] ?? '').trim() || (auth.startsWith('Bearer sgbp_') ? auth.slice(7).trim() : '');
    const m = PAPI_KEY_RE.exec(raw);
    if (!m) throw deny(null, null, 401, 'PAPI_KEY_INVALID', 'API 키가 맞지 않습니다.');

    let row: KeyRow | undefined;
    try {
      [row] = await this.db.query<KeyRow>(
        `SELECT k.id::text AS id, k.partner_id AS "partnerId", k.name, k.key_hash AS hash, k.scopes, k.rate_per_min AS rate, k.status,
                (k.expires_at <= now()) AS expired, p.status AS "partnerStatus"
           FROM ptn_api_keys k JOIN partners p ON p.id = k.partner_id WHERE k.key_prefix = $1`, ['sgbp_' + m[1]]);
    } catch {
      throw fail(503, 'PAPI_UNAVAILABLE', '잠시 뒤 다시 시도해 주십시오.');
    }
    if (!row || !sameHash(row.hash, keyHash(raw))) throw deny(null, null, 401, 'PAPI_KEY_INVALID', 'API 키가 맞지 않습니다.');
    if (row.status !== 'ACTIVE') throw deny(row.id, row.partnerId, 401, 'PAPI_KEY_REVOKED', '거둔 API 키입니다 — 새 키를 받으십시오.');
    if (row.expired) throw deny(row.id, row.partnerId, 401, 'PAPI_KEY_EXPIRED', '기한이 지난 API 키입니다 — 새 키를 받으십시오.');
    if (row.partnerStatus !== 'ACTIVE') throw deny(row.id, row.partnerId, 403, 'PAPI_PARTNER_INACTIVE', '활동 중인 파트너가 아닙니다.');

    const need = this.reflector.getAllAndOverride<string>(PAPI_SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (need && !row.scopes.includes(need)) throw deny(row.id, row.partnerId, 403, 'PAPI_SCOPE', '이 키의 범위로는 부를 수 없는 주소입니다.');

    if (papiHit(row.id, row.rate)) {
      const retry = 60 - Math.floor((Date.now() % 60_000) / 1000);
      res.setHeader('Retry-After', String(retry));
      throw deny(row.id, row.partnerId, 429, 'PAPI_RATE_LIMIT', '1분 사용 한도를 넘었습니다. 잠시 뒤 다시 시도해 주십시오.');
    }

    req.papi = { keyId: row.id, partnerId: row.partnerId, scopes: row.scopes, name: row.name };
    const keyId = row.id, partnerId = row.partnerId;
    res.on('finish', () => this.log(keyId, partnerId, req, res.statusCode, Date.now() - t0, null));
    /* 마지막 사용 시각 — 키마다 1분에 한 번만 씀 */
    const last = touched.get(keyId) ?? 0;
    if (Date.now() - last > 60_000) {
      touched.set(keyId, Date.now());
      void this.db.query(`UPDATE ptn_api_keys SET last_used_at = now() WHERE id = $1::bigint AND status = 'ACTIVE'`, [keyId]).catch(() => undefined);
    }
    return true;
  }
}
