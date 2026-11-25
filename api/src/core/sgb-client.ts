import { createHash } from 'crypto';
import { Unavailable } from './errors';

/* ---------------------------------------------------------------------
 * e1.2 (docs/002) 소개뱅크 연결 — ERP 가 소개뱅크에 묻고 · 쓰는 길(서비스 토큰 머리 X-Erp-Service-Token)
 *   SGB_API_URL        소개뱅크 API (예: http://localhost:3000/api/v1 · 점검판 http://api:3000/api/v1)
 *   SGB_SERVICE_TOKEN  소개뱅크 운영 화면 › 외부 연동 › ERP 연동 「토큰 만들기」 원문(ERP .env 에만 · 로그 · 응답에 싣지 않음)
 *   introspect 결과는 토큰 해시마다 60초 기억(설계서 4-1) · 소개뱅크가 멈추면 503 ERP_SGB_DOWN
 * ------------------------------------------------------------------- */

export interface Introspect {
  active: boolean; reason?: string; accountId?: string; name?: string | null; roles?: string[]; staff?: boolean; super?: boolean;
  mfaOk?: boolean; perm?: { enforce: string; decide: string; tasks: string[] }; exp?: number | null;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; v: Introspect }>();
const key = (t: string) => createHash('sha256').update(t).digest('hex');
export const introspectCacheClear = () => cache.clear();

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class SgbClient {
  constructor(private readonly f: FetchLike = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(5000) }) as any,
              private readonly env: NodeJS.ProcessEnv = process.env) {}

  private base() { return String(this.env.SGB_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, ''); }
  private svc() { return String(this.env.SGB_SERVICE_TOKEN ?? '').trim(); }

  async introspect(bearer: string): Promise<Introspect> {
    const k = key(bearer);
    const c = cache.get(k);
    if (c && Date.now() - c.at < CACHE_MS) return c.v;
    let r;
    try {
      r = await this.f(`${this.base()}/auth/introspect`, { headers: { 'X-Erp-Service-Token': this.svc(), Authorization: `Bearer ${bearer}` } });
    } catch {
      throw Unavailable('ERP_SGB_DOWN', '소개뱅크에 연결하지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
    }
    if (r.status === 403) throw Unavailable('ERP_SGB_TOKEN', 'ERP 서비스 토큰이 소개뱅크와 맞지 않습니다 — 운영 화면 › 외부 연동 › ERP 연동을 확인하십시오.');
    if (!r.ok) throw Unavailable('ERP_SGB_DOWN', '소개뱅크에 연결하지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
    const v = (await r.json()) as Introspect;
    if (cache.size > 2000) cache.clear();
    cache.set(k, { at: Date.now(), v });
    return v;
  }

  async post<T = any>(path: string, body: unknown): Promise<{ status: number; body: T }> {
    let r;
    try {
      r = await this.f(`${this.base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Erp-Service-Token': this.svc() }, body: JSON.stringify(body) });
    } catch {
      throw Unavailable('ERP_SGB_DOWN', '소개뱅크에 연결하지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
    }
    return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
  }

  /** 운영 알림(설계서 4-4) — 실패해도 ERP 일은 계속(알림만 못 감 · false) */
  async alert(a: { code: string; title?: string; severity?: 'INFO' | 'WARN' | 'CRITICAL'; detail?: Record<string, unknown>; mode?: 'RAISE' | 'ONCE' | 'RESOLVE'; note?: string }) {
    try { return (await this.post('/internal/erp/alerts', a)).status === 200; } catch { return false; }
  }

  async notify(n: { accountId: string; kind: string; title: string; body: string; link?: string }) {
    try { return (await this.post('/internal/erp/notify', n)).status === 200; } catch { return false; }
  }

  async redeem(code: string) { return this.post<{ accessToken?: string; refreshToken?: string; accountId?: string; code?: string; message?: string }>('/internal/erp/handoff/redeem', { code }); }
}
