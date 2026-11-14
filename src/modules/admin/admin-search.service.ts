import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';
import { maskEmail, maskName } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.289 (docs/413) — 운영 화면 전체 찾기(메뉴 줄 오른쪽)
 *
 *   대표 승인(11/14 「백오피스 기능」 C): 회원 · 주문 · 판매자 · 공지 · 매물 · 거래를 한 칸에서 · 묶음마다 5건.
 *   · 사람 이름 · 이메일은 가린 값만(찾기는 원래 값으로) · 역할마다 볼 수 있는 묶음만(화면 탭 권한과 같음)
 *   · 감사 ADMIN_SEARCH — 찾은 말은 앞 2자만 · 묶음별 건수
 * ------------------------------------------------------------------- */
export type SearchSection = 'members' | 'orders' | 'sellers' | 'notices' | 'listings' | 'deals';
/** 묶음 → 볼 수 있는 역할(SUPER 는 늘 통과) · 누르면 가는 운영 화면 탭 */
export const SEARCH_SECTIONS: Record<SearchSection, { roles: string[]; tab: string; label: string }> = {
  members:  { roles: ['ADMIN'], tab: 'members', label: '회원' },
  orders:   { roles: ['ADMIN'], tab: 'hlt-orders', label: '소개몰 주문' },
  sellers:  { roles: ['ADMIN', 'PARTNER_MAL'], tab: 'hlt-sellers', label: '소개몰 판매자' },
  notices:  { roles: ['ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'], tab: 'mainops', label: '공지' },
  listings: { roles: ['ADMIN', 'REVIEWER'], tab: 'queue', label: '매물' },
  deals:    { roles: ['ADMIN', 'PAYOUT'], tab: 'deals', label: '거래' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminSearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(qIn: string, roles: readonly string[]) {
    const q = (qIn ?? '').trim().slice(0, 100);
    if (q.length < 2) throw new PolicyViolation('QUERY_TOO_SHORT', '두 글자 이상 적어 주십시오.');
    const c = RequestCtx.get();
    const can = (s: SearchSection) => roles.includes('SUPER') || SEARCH_SECTIONS[s].roles.some((r) => roles.includes(r));
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, '');
    const uuid = UUID.test(q) ? q : null;
    const hex = /^[0-9a-f-]{6,36}$/i.test(q) ? q.toLowerCase() : null;
    const out: Partial<Record<SearchSection, unknown[]>> = {};
    const tasks: Promise<void>[] = [];
    const run = (s: SearchSection, f: () => Promise<unknown[]>) => { if (can(s)) tasks.push(f().then((r) => { out[s] = r; })); };

    run('members', async () => (await this.db.query<{ id: string; name: string; email: string; status: string; createdAt: string }>(
      `SELECT id::text AS id, name, email::text AS email, status, created_at AS "createdAt" FROM accounts
        WHERE ($3::uuid IS NOT NULL AND id = $3) OR email ILIKE $1 OR name ILIKE $1
           OR (length($2) >= 4 AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%')
        ORDER BY created_at DESC LIMIT 5`, [like, digits, uuid]))
      .map((r) => ({ id: r.id, title: maskName(r.name), sub: `${maskEmail(r.email)} · ${r.status}`, at: r.createdAt })));
    run('orders', () => this.db.query(
      `SELECT o.id::text AS id, o.order_no AS title, o.status || ' · ' || coalesce(left(a.name, 1) || '**', '') AS sub, o.created_at AS at
         FROM hlt_orders o LEFT JOIN accounts a ON a.id = o.account_id
        WHERE o.order_no ILIKE $1 OR ($2::uuid IS NOT NULL AND o.id = $2) ORDER BY o.created_at DESC LIMIT 5`, [like, uuid]));
    run('sellers', () => this.db.query(
      `SELECT id::text AS id, name AS title, code || ' · ' || status AS sub, created_at AS at FROM hlt_sellers
        WHERE name ILIKE $1 OR code ILIKE $1 OR ($2::uuid IS NOT NULL AND id = $2) ORDER BY created_at DESC LIMIT 5`, [like, uuid]));
    run('notices', () => this.db.query(
      `SELECT id::text AS id, title, CASE WHEN published_at IS NULL THEN '초안' ELSE '게시' END || ' · ' || array_to_string(grades, ',') AS sub, coalesce(published_at, created_at) AS at
         FROM notices WHERE title ILIKE $1 OR ($2::uuid IS NOT NULL AND id = $2) ORDER BY coalesce(published_at, created_at) DESC LIMIT 5`, [like, uuid]));
    run('listings', () => this.db.query(
      `SELECT id::text AS id, title, gwan_code || ' · ' || status AS sub, created_at AS at FROM listings
        WHERE title ILIKE $1 OR ($2::uuid IS NOT NULL AND id = $2) ORDER BY created_at DESC LIMIT 5`, [like, uuid]));
    run('deals', () => this.db.query(
      `SELECT d.id::text AS id, coalesce(l.title, '(매물 없음)') AS title, d.status || coalesce(' · ' || d.agreed_fee::text || '원', '') AS sub, d.created_at AS at
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id
        WHERE ($2::text IS NOT NULL AND d.id::text LIKE $2 || '%') OR l.title ILIKE $1 ORDER BY d.created_at DESC LIMIT 5`, [like, hex]));
    await Promise.all(tasks);

    const sections = (Object.keys(SEARCH_SECTIONS) as SearchSection[]).filter((s) => out[s])
      .map((s) => ({ key: s, label: SEARCH_SECTIONS[s].label, tab: SEARCH_SECTIONS[s].tab, items: out[s] }));
    await this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, 'ADMIN_SEARCH', 'SEARCH', NULL, $3::jsonb, $4, $5)`,
      [RequestCtx.actorId(), c?.actorRole ?? null,
       JSON.stringify({ q: `${q.slice(0, 2)}${'*'.repeat(Math.min(q.length - 2, 8))}`, len: q.length, found: Object.fromEntries(sections.map((x) => [x.key, x.items?.length ?? 0])) }),
       c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
    return { q, sections };
  }
}
