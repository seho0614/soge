import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/**
 * 시스템 상태 조회.
 *
 * ── 감시 뷰를 읽습니다 ────────────────────────────────────────
 * 검정(`npm run db:verify`)은 SQL 스크립트라 API 로 못 읽습니다.
 * 대신 **"0이어야 정상" 이라고 적힌 뷰**를 훑습니다 — 설명에
 * 그렇게 적어 두었으므로 뷰 자신이 기준을 갖고 있습니다.
 */
@Injectable()
export class GovernService {
  constructor(private readonly db: DatabaseService) {}

  async invariants() {
    /* 주석에 "0이어야" 라고 적힌 뷰만 고릅니다.
     *
     * ★ 뷰 목록을 코드에 박지 않습니다. 새 감시 뷰를 만들 때마다
     *   여기를 고쳐야 하면 반드시 빠뜨립니다. */
    const views = await this.db.query(
      `SELECT viewname AS name,
              obj_description(('public.'||quote_ident(viewname))::regclass) AS note
         FROM pg_views
        WHERE schemaname = 'public'
          AND viewname LIKE 'v\\_%'
          AND obj_description(('public.'||quote_ident(viewname))::regclass) LIKE '%0이어야%'
        ORDER BY viewname`);

    const items: Array<Record<string, unknown>> = [];
    for (const v of views) {
      try {
        const [r] = await this.db.query(`SELECT count(*)::int AS n FROM ${v.name}`);
        items.push({
          view: v.name,
          count: r?.n ?? 0,
          ok: (r?.n ?? 0) === 0,
          /* 설명의 첫 문장만 — 전체는 길어서 화면이 읽기 어렵습니다 */
          note: String(v.note ?? '').split('.')[0],
        });
      } catch {
        /* 뷰가 깨져 있으면 그것도 문제입니다 — 조용히 넘기지 않습니다 */
        items.push({ view: v.name, count: null, ok: false, note: '뷰를 읽을 수 없습니다' });
      }
    }
    const broken = items.filter((x) => !x.ok);
    return {
      total: items.length,
      ok: items.length - broken.length,
      broken: broken.length,
      items,
      note: broken.length
        ? `${broken.length}건이 정상이 아닙니다. 위에서부터 보십시오.`
        : '모두 정상입니다.',
    };
  }

  async acl() {
    const roles = await this.db.query(
      `SELECT r.role, count(*)::int AS n
         FROM account_roles r
         JOIN accounts a ON a.id = r.account_id AND a.withdrawn_at IS NULL
        GROUP BY r.role ORDER BY r.role`);

    /* ★ PAYOUT 과 ADMIN 을 함께 가진 사람이 있으면 안 됩니다.
     *   승인한 사람이 돈까지 보내면 아무도 못 막습니다(C710). */
    const conflict = await this.db.query(
      `SELECT a.id, a.name, a.email
         FROM accounts a
        WHERE EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='PAYOUT')
          AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='ADMIN')
          AND a.withdrawn_at IS NULL`);

    const DESC: Record<string, string> = {
      GUEST: '로그인하지 않은 사람',
      MEMBER: '로그인한 회원',
      BIZ_OWNER: '사업자 대표',
      BIZ_STAFF: '사업자 직원',
      REVIEWER: '검수 담당',
      ADMIN: '운영',
      PAYOUT: '지급 전담 — ADMIN 과 겸직 불가',
      SUPER: '최고 운영',
    };
    const all = Object.keys(DESC).map((role) => ({
      role,
      description: DESC[role],
      count: roles.find((r: { role: string }) => r.role === role)?.n ?? 0,
    }));

    return {
      roles: all,
      conflict,
      note: conflict.length
        ? '★ PAYOUT 과 ADMIN 을 함께 가진 사람이 있습니다. 승인한 사람이 돈까지 보내면 아무도 못 막습니다.'
        : null,
    };
  }
}
