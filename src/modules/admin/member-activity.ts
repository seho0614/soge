/* ---------------------------------------------------------------------
 * v10.365 (docs/500) — 회원 활동 한 줄 기록 — 회원 › 회원 상세 「활동 기록」
 *   있는 표를 읽기만(새 표 없음): accounts · identity_verifications · login_history · inquiries · reports
 *   · posting_suspensions · member_notes · role_changes · account_withdrawals
 *   본문 · 연락처 · IP 전체는 넣지 않음(로그인은 가린 IP · 브라우저 종류만 · 문의는 분류 · 상태 · 제목 앞 30자).
 * ------------------------------------------------------------------- */
import { NotFound } from '../../core/errors';

interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export const ACTIVITY_KINDS = ['SIGNUP', 'IDENTITY', 'LOGIN', 'INQUIRY', 'REPORT_IN', 'REPORT_OUT', 'SUSPEND', 'NOTE', 'ROLE', 'WITHDRAW'] as const;
export const ACTIVITY_KO: Record<string, string> = {
  SIGNUP: '가입', IDENTITY: '본인인증', LOGIN: '로그인', INQUIRY: '1:1 문의', REPORT_IN: '받은 신고', REPORT_OUT: '한 신고',
  SUSPEND: '등록 정지', NOTE: '운영 메모', ROLE: '권한', WITHDRAW: '탈퇴',
};

export interface ActivityRow { at: string; kind: string; label: string; text: string }

export async function memberActivity(db: Q, id: string, kindIn?: string) {
  const [a] = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE id = $1`, [id]);
  if (!a) throw new NotFound('그 회원이 없습니다.');
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(String(kindIn ?? '')) ? String(kindIn) : null;
  const rows = await db.query<{ at: string; kind: string; text: string }>(
    `WITH x AS (
       SELECT a.created_at AS at, 'SIGNUP' AS kind, '가입' AS text FROM accounts a WHERE a.id = $1
       UNION ALL
       SELECT coalesce(v.completed_at, v.requested_at), 'IDENTITY', v.provider || ' · ' || CASE v.result WHEN 'SUCCESS' THEN '성공' WHEN 'FAIL' THEN '실패' ELSE '진행 중' END
         FROM identity_verifications v WHERE v.account_id = $1
       UNION ALL
       SELECT h.at, 'LOGIN', CASE WHEN h.ok THEN '성공' ELSE '비밀번호 틀림' END || coalesce(' · ' || h.ip_masked, '') || coalesce(' · ' || h.ua_kind, '')
         FROM (SELECT * FROM login_history WHERE account_id = $1 ORDER BY at DESC LIMIT 40) h
       UNION ALL
       SELECT i.created_at, 'INQUIRY', i.category || ' · ' || CASE i.status WHEN 'OPEN' THEN '답변 전' WHEN 'ANSWERED' THEN '답변함' ELSE '닫힘' END || ' · ' || left(i.title, 30)
         FROM inquiries i WHERE i.account_id = $1
       UNION ALL
       SELECT r.created_at, 'REPORT_IN', r.target_type || ' · ' || r.reason_code || ' · ' || r.state
         FROM reports r
        WHERE (r.target_type = 'PROFILE' AND r.target_id = $1)
           OR (r.target_type = 'LISTING' AND r.target_id IN (SELECT l.id FROM listings l WHERE l.owner_account_id = $1))
           OR (r.target_type = 'REQUEST' AND r.target_id IN (SELECT q.id FROM requests q WHERE q.owner_account_id = $1))
           OR (r.target_type = 'POST' AND r.target_id IN (SELECT p.id FROM posts p WHERE p.author_id = $1))
           OR (r.target_type = 'COMMENT' AND r.target_id IN (SELECT c.id FROM post_comments c WHERE c.author_id = $1))
       UNION ALL
       SELECT r.created_at, 'REPORT_OUT', r.target_type || ' · ' || r.reason_code || ' · ' || r.state FROM reports r WHERE r.reporter_id = $1
       UNION ALL
       SELECT s.created_at, 'SUSPEND', '등록 정지 ~ ' || to_char(s.until_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || CASE WHEN s.lifted_at IS NOT NULL THEN ' · 풀림' ELSE '' END
         FROM posting_suspensions s WHERE s.account_id = $1
       UNION ALL
       SELECT n.created_at, 'NOTE', CASE WHEN n.important THEN '중요 · ' ELSE '' END || left(n.body, 40) FROM member_notes n WHERE n.account_id = $1
       UNION ALL
       SELECT c.changed_at, 'ROLE', c.role || ' ' || CASE c.action WHEN 'GRANT' THEN '주기' ELSE '거두기' END FROM role_changes c WHERE c.account_id = $1
       UNION ALL
       SELECT w.created_at, 'WITHDRAW', '탈퇴 · ' || w.reason_code FROM account_withdrawals w WHERE w.account_id = $1
     )
     SELECT at, kind, text FROM x WHERE at IS NOT NULL AND ($2::text IS NULL OR kind = $2) ORDER BY at DESC LIMIT 100`, [id, kind]);
  const counts = await db.query<{ kind: string; n: number }>(
    `SELECT 'LOGIN' AS kind, count(*)::int AS n FROM login_history WHERE account_id = $1
     UNION ALL SELECT 'INQUIRY', count(*)::int FROM inquiries WHERE account_id = $1
     UNION ALL SELECT 'REPORT_OUT', count(*)::int FROM reports WHERE reporter_id = $1
     UNION ALL SELECT 'SUSPEND', count(*)::int FROM posting_suspensions WHERE account_id = $1
     UNION ALL SELECT 'NOTE', count(*)::int FROM member_notes WHERE account_id = $1
     UNION ALL SELECT 'ROLE', count(*)::int FROM role_changes WHERE account_id = $1`, [id]);
  return {
    rows: rows.map((r): ActivityRow => ({ at: r.at, kind: r.kind, label: ACTIVITY_KO[r.kind] ?? r.kind, text: r.text })),
    kind, kinds: ACTIVITY_KINDS.map((k) => ({ kind: k, label: ACTIVITY_KO[k] })), counts: Object.fromEntries(counts.map((c) => [c.kind, Number(c.n)])),
  };
}
