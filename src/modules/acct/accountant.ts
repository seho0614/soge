import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.437 (D257 · docs/574) 세무사 공유 계정 — 대표 11/19 「다음개발」
 *   운영 역할 ACCOUNTANT(SUPER 가 권한 관리에서 줌 · 기한 7 · 30 · 90일 꼭 · DB 가 막음 ACCOUNTANT_EXPIRY).
 *   읽기 전용: 서버 권한 검사(core/auth AuthGuard)가 ACCOUNTANT 에게 /api/v1/admin/acct 아래 「지급 담당이 볼 수 있는 GET」만 열어 줌.
 *     쓰기(POST · PATCH · PUT)는 역할이 없어 403 — 예외는 이 파일의 질문 남기기와 내려받기 요청(ExportGate)뿐.
 *   증빙 파일: fn_file_can_read 가 ACCT_EVIDENCE 만 엶. 회원 · 사내 문서 · 다른 운영 화면은 역할이 없어 못 봄.
 *   기한이 지나면 로그인 때 역할에서 빠지고(principal) 매시간 정기 작업(roleExpire)이 거둠.
 *   접속 기록: 운영 화면 API 를 부를 때마다 acct_accountant_access 한 줄(쌓기만 · auth.middleware).
 * ------------------------------------------------------------------- */

const ymOk = (ym?: string) => (ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym) ? ym : null);
const STAFF_OTHER = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'];
/** 세무사 역할만 가진 계정인가(다른 운영 역할이 있으면 그 역할 규칙을 따름) */
export const accountantOnly = (roles: readonly string[] | undefined | null) =>
  !!roles?.includes('ACCOUNTANT') && !roles.some((r) => STAFF_OTHER.includes(r));

/** auth.middleware 가 부름 — 세무사만인 계정이 운영 화면 API 를 부르면 한 줄(실패는 무시) */
export async function logAccountantAccess(db: DatabaseService, accountId: string, method: string, path: string, ip: string | null) {
  const m = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? method : 'GET';
  await db.query(`INSERT INTO acct_accountant_access (account_id, method, path, ip) VALUES ($1::uuid, $2, $3, $4)`,
    [accountId, m, path.split('?')[0]!.slice(0, 300), ip]).catch(() => undefined);
}

/** GET /admin/acct/accountant — 세무사: 내 기한 · 질문 / SUPER · 지급 담당: 세무사 계정 · 기한 · 최근 접속 · 질문 */
export async function accountantDesk(db: DatabaseService, me: string | null, ymIn?: string) {
  const ym = ymOk(ymIn);
  const myRoles = me ? (await db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid`, [me])).map((r) => r.role) : [];
  const isAccountant = accountantOnly(myRoles);
  const accountants = isAccountant ? [] : await db.query(
    `SELECT a.id::text AS id, a.email, a.name, r.expires_at AS "expiresAt", (r.expires_at > now()) AS active,
            (SELECT max(x.at) FROM acct_accountant_access x WHERE x.account_id = a.id) AS "lastAt",
            (SELECT count(*)::int FROM acct_accountant_access x WHERE x.account_id = a.id AND x.at > now() - interval '30 days') AS "calls30"
       FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE r.role = 'ACCOUNTANT' ORDER BY r.expires_at DESC NULLS LAST`);
  const [mine] = isAccountant && me ? await db.query<{ expiresAt: string | null }>(
    `SELECT expires_at AS "expiresAt" FROM account_roles WHERE account_id = $1::uuid AND role = 'ACCOUNTANT'`, [me]) : [];
  const access = isAccountant ? [] : await db.query(
    `SELECT x.id::text AS id, a.email, x.method, x.path, x.at FROM acct_accountant_access x JOIN accounts a ON a.id = x.account_id ORDER BY x.id DESC LIMIT 50`);
  const notes = await db.query<{ id: string }>(
    `SELECT n.id::text AS id, n.ym, n.entry_id::text AS "entryId", n.body, n.created_at AS "createdAt", a.email AS author,
            coalesce((SELECT json_agg(json_build_object('id', r.id::text, 'body', r.body, 'by', ra.email, 'at', r.created_at) ORDER BY r.id)
                        FROM acct_accountant_replies r JOIN accounts ra ON ra.id = r.account_id WHERE r.note_id = n.id), '[]'::json) AS replies
       FROM acct_accountant_notes n JOIN accounts a ON a.id = n.account_id
      WHERE ($1::text IS NULL OR n.ym = $1) AND ($2::uuid IS NULL OR n.account_id = $2::uuid)
      ORDER BY n.id DESC LIMIT 100`, [ym, isAccountant ? me : null]);
  return { isAccountant, ym, myExpiresAt: mine?.expiresAt ?? null, accountants, access, notes,
           note: '세무사 계정은 회계 화면을 읽기만 합니다(고치기 · 넣기 없음). 내려받기는 승인이 필요하고, 질문을 남기면 SUPER 가 답합니다. 기한이 지나면 저절로 막힙니다.' };
}

/** POST /admin/acct/accountant/notes — 세무사 질문(달 · 전표) */
export async function addAccountantNote(db: DatabaseService, me: string | null, b: { ym?: string; entryId?: string; body?: string }) {
  if (!me) throw new PolicyViolation('ACCOUNTANT_NOTE', '로그인이 필요합니다.');
  const ym = ymOk(b.ym);
  if (!ym) throw new PolicyViolation('ACCOUNTANT_NOTE', '달(YYYY-MM)을 고르십시오.');
  const body = (b.body ?? '').trim();
  if (body.length < 2 || body.length > 1000) throw new PolicyViolation('ACCOUNTANT_NOTE', '질문은 2 ~ 1000자입니다.');
  if (b.entryId) {
    const [e] = await db.query(`SELECT 1 FROM acct_entries WHERE id = $1::bigint`, [b.entryId]);
    if (!e) throw new NotFound('없는 전표입니다.');
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_accountant_notes (account_id, ym, entry_id, body) VALUES ($1::uuid, $2, $3::bigint, $4) RETURNING id::text AS id`, [me, ym, b.entryId ?? null, body]);
  return { ok: true, id: r!.id, note: '질문을 남겼습니다 — SUPER 가 답합니다.' };
}

/** POST /admin/acct/accountant/notes/{id}/reply — SUPER 답 */
export async function replyAccountantNote(db: DatabaseService, me: string | null, id: string, body: string) {
  const [n] = await db.query(`SELECT 1 FROM acct_accountant_notes WHERE id = $1::bigint`, [id]);
  if (!n) throw new NotFound('없는 질문입니다.');
  const t = (body ?? '').trim();
  if (t.length < 1 || t.length > 1000) throw new PolicyViolation('ACCOUNTANT_NOTE', '답은 1 ~ 1000자입니다.');
  await db.query(`INSERT INTO acct_accountant_replies (note_id, account_id, body) VALUES ($1::bigint, $2::uuid, $3)`, [id, me, t]);
  return { ok: true, id, note: '답을 남겼습니다.' };
}
