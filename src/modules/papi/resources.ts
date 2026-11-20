import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { PAPI_EVENTS, PAPI_SCOPES } from './keys';
import type { PapiPrincipal } from './guard';

/* ---------------------------------------------------------------------
 * v10.521 (D278 · docs/659) 파트너 오픈 API — 읽기 자료(키의 파트너 것만)
 *
 *   me        키 · 회사 · 범위 · 한도 · 웹훅(주소의 호스트만)
 *   leads     배정 리드(leads:read) — 회수(REVOKED) 뺌 · 연락처는 싣지 않음(파트너센터에서 열람 · 열람 기록이 남는 길 하나)
 *   services  내 서비스(services:read)
 *   cash      리드 이용료 받을 수 있는지 · 잔액(cash:read)
 *   docs      주소 · 범위 · 오류 코드 · 웹훅 서명 확인법(키만 맞으면)
 * ------------------------------------------------------------------- */

const LEAD_STATES = ['DELIVERED', 'VIEWED', 'EXPIRED'] as const;
/* 목록 · 한 건이 같은 칸(배정 번호 · 상태 · 시각 · 지역 · 급함 · 등급 · 업종 · 요약) — 연락처 칸은 없음 */

export async function papiMe(db: DatabaseService, p: PapiPrincipal) {
  const [info] = await db.query<{ company: string; grade: string; status: string }>(
    `SELECT b.company_name AS company, x.grade, x.status FROM partners x JOIN businesses b ON b.id = x.business_id WHERE x.id = $1`, [p.partnerId]);
  const [key] = await db.query<{ prefix: string; ratePerMin: number; expiresAt: string }>(
    `SELECT key_prefix AS prefix, rate_per_min AS "ratePerMin", expires_at AS "expiresAt" FROM ptn_api_keys WHERE id = $1::bigint`, [p.keyId]);
  const [hook] = await db.query<{ url: string; events: string[] }>(
    `SELECT url, events FROM ptn_api_hooks WHERE partner_id = $1 AND status = 'ACTIVE'`, [p.partnerId]);
  return {
    partner: info ?? null,
    key: { name: p.name, prefix: key?.prefix ?? null, scopes: p.scopes, ratePerMin: key?.ratePerMin ?? null, expiresAt: key?.expiresAt ?? null },
    hook: hook ? { host: new URL(hook.url).host, events: hook.events } : null,
  };
}

export async function papiLeads(db: DatabaseService, p: PapiPrincipal, q: { state?: string; since?: string; limit?: number }) {
  if (q.state && !(LEAD_STATES as readonly string[]).includes(q.state)) throw new PolicyViolation('PAPI_QUERY', 'state 는 DELIVERED · VIEWED · EXPIRED 중 하나입니다.');
  let since: string | null = null;
  if (q.since) {
    const t = Date.parse(q.since);
    if (Number.isNaN(t)) throw new PolicyViolation('PAPI_QUERY', 'since 는 ISO 8601 시각입니다(예: 2026-11-20T00:00:00Z).');
    since = new Date(t).toISOString();
  }
  const limit = q.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PolicyViolation('PAPI_QUERY', 'limit 는 1 ~ 100 입니다.');
  const items = await db.query(
    `SELECT d.id AS "deliveryId", d.state, d.delivered_at AS "deliveredAt", d.viewed_at AS "viewedAt", d.expires_at AS "expiresAt",
            l.sido, l.sigungu, l.is_urgent AS urgent, l.grade, c.name AS "categoryName", l.summary
       FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id LEFT JOIN categories c ON c.id = l.category_id
      WHERE d.partner_id = $1 AND d.state <> 'REVOKED' AND ($2::text IS NULL OR d.state = $2) AND ($3::timestamptz IS NULL OR d.delivered_at >= $3::timestamptz)
      ORDER BY d.delivered_at DESC LIMIT $4::int`, [p.partnerId, q.state ?? null, since, limit]);
  return { items, count: items.length, note: '연락처는 싣지 않습니다 — 파트너센터 › 리드에서 열람하십시오(열람 기록이 남습니다).' };
}

export async function papiLead(db: DatabaseService, p: PapiPrincipal, deliveryId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(deliveryId ?? ''))) throw new NotFound('없는 배정입니다.');
  const [row] = await db.query(
    `SELECT d.id AS "deliveryId", d.state, d.delivered_at AS "deliveredAt", d.viewed_at AS "viewedAt", d.expires_at AS "expiresAt",
            l.sido, l.sigungu, l.is_urgent AS urgent, l.grade, c.name AS "categoryName", l.summary, fn_lead_fee_quote(l.id, d.partner_id) AS "feeQuote", f.state AS "feeState"
       FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN lead_fees f ON f.delivery_id = d.id
      WHERE d.id = $1 AND d.partner_id = $2 AND d.state <> 'REVOKED'`, [deliveryId, p.partnerId]);
  if (!row) throw new NotFound('없는 배정입니다.');
  return row;
}

export async function papiServices(db: DatabaseService, p: PapiPrincipal) {
  const items = await db.query(
    `SELECT s.id, s.title, s.status, c.name AS "categoryName", s.created_at AS "createdAt"
       FROM partner_services s LEFT JOIN categories c ON c.id = s.category_id
      WHERE s.partner_id = $1 ORDER BY s.created_at DESC LIMIT 200`, [p.partnerId]);
  return { items, count: items.length };
}

export async function papiCash(db: DatabaseService, p: PapiPrincipal) {
  const [r] = await db.query<{ canReceive: boolean; balance: string | null }>(
    `SELECT can_receive AS "canReceive", balance FROM v_partner_eligible WHERE partner_id = $1`, [p.partnerId]);
  return { eligible: !!r, canReceive: !!r?.canReceive, balance: r?.balance == null ? null : Number(r.balance) };
}

/** 키만 맞으면 보는 안내 — 운영 화면 문서(docs/659 4절)와 같은 내용 */
export function papiDocs() {
  return {
    version: 'v1',
    base: '/api/partner/v1',
    auth: 'X-Partner-Key: sgbp_xxxxxxxx_… (또는 Authorization: Bearer sgbp_…)',
    scopes: PAPI_SCOPES,
    endpoints: [
      { method: 'GET', path: '/me', scope: null },
      { method: 'GET', path: '/leads?state=&since=&limit=', scope: 'leads:read' },
      { method: 'GET', path: '/leads/{deliveryId}', scope: 'leads:read' },
      { method: 'GET', path: '/services', scope: 'services:read' },
      { method: 'GET', path: '/cash', scope: 'cash:read' },
      { method: 'GET', path: '/docs', scope: null },
    ],
    errors: ['PAPI_OFF(503)', 'PAPI_KEY_INVALID(401)', 'PAPI_KEY_REVOKED(401)', 'PAPI_KEY_EXPIRED(401)', 'PAPI_PARTNER_INACTIVE(403)', 'PAPI_SCOPE(403)', 'PAPI_RATE_LIMIT(429 · Retry-After)', 'PAPI_QUERY(422)', 'NOT_FOUND(404)'],
    webhook: {
      events: PAPI_EVENTS,
      headers: ['X-Sgb-Event', 'X-Sgb-Delivery(event uid)', 'X-Sgb-Signature: t=<unix>,v1=<hex>'],
      signature: 'v1 = HMAC-SHA256(whsec 비밀값, t + "." + 받은 본문 그대로) · 5분 넘게 지난 t 는 버리십시오 · 같은 X-Sgb-Delivery 는 한 번만 처리하십시오',
      retry: '2xx 가 아니면 1분 · 5분 · 30분 · 2시간 · 6시간 · 12시간 뒤 다시(6번 뒤 포기)',
      body: '{ event, deliveryId, state, expiresAt, at } — 연락처 · 요약은 싣지 않음(GET /leads/{deliveryId} 로 확인)',
    },
  };
}
