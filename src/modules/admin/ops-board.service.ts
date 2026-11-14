import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.286 (D213 · docs/412) — 운영자 게시판
 *
 *   대표 결정(11/14): 「운영자 매일 또는 슬랙 · 텔레그램 발송 내용을 운영자 게시판에 게시 · 운영자만 본다」.
 *   · 자동 글(하루 요약 · 급한 알림 · 대표 할 일 주간 · 시험 메시지)은 보내기 결과와 함께 항상 올림(꺼져 있어도) — opsBoardPost
 *     같은 내용을 「관리자」 공지(끝 시각 2일 뒤 · 알림 없음)로도 — DB fn_ops_board_post 한 곳
 *   · 운영자 글 · 고치기(전 내용 기록) · 내림(쓴 사람 · SUPER) · 댓글 · 「확인함」
 *   · 운영 화면 계정만(컨트롤러 @Roles) — 사용자 웹에는 없음
 * ------------------------------------------------------------------- */
export type BoardKind = 'DAILY_DIGEST' | 'URGENT' | 'OWNER_TODO' | 'TEST' | 'STAFF';
export const BOARD_KINDS: BoardKind[] = ['DAILY_DIGEST', 'URGENT', 'OWNER_TODO', 'TEST', 'STAFF'];
const log = new Logger('OpsBoard');

/** 보내기 결과를 한 낱말로 — 보냄 SENT · 그 밖에는 까닭(OFF · NO_TOKEN · NO_CHAT · NO_WEBHOOK · SEND_…) · 해당 없음 null */
export const sendResult = (pushed: boolean | number | undefined, reason: string | null | undefined): string | null =>
  pushed ? 'SENT' : (reason ?? null);

/** 자동 글 한 줄 — 게시판이 실패해도 보내기 · 정기 작업은 계속(기록만) */
export async function opsBoardPost(db: DatabaseService, kind: Exclude<BoardKind, 'STAFF'>, title: string, body: string, telegram: string | null, slack: string | null): Promise<number | null> {
  try {
    const [r] = await db.query<{ id: string }>(`SELECT fn_ops_board_post($1, $2, $3, $4, $5) AS id`, [kind, title, body, telegram, slack]);
    return r ? Number(r.id) : null;
  } catch (e) {
    log.error(`[OPS_BOARD_POST_FAILED] ${kind} ${(e as Error).message}`);
    return null;
  }
}

@Injectable()
export class OpsBoardService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }
  private get isSuper() { return RequestCtx.get()?.actorRole === 'SUPER'; }

  async list(q: { kind?: string; from?: string; to?: string; unread?: boolean; page?: number }) {
    const page = Math.max(1, Math.min(Number(q.page) || 1, 1000));
    const kind = BOARD_KINDS.includes(q.kind as BoardKind) ? q.kind : null;
    const args = [kind, q.from || null, q.to || null, !!q.unread, this.me, (page - 1) * 50];
    const where = `WHERE ($1::text IS NULL OR p.kind = $1)
        AND ($2::date IS NULL OR p.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Seoul'))
        AND ($3::date IS NULL OR p.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'))
        AND (NOT $4 OR NOT EXISTS (SELECT 1 FROM ops_board_reads r WHERE r.post_id = p.id AND r.account_id = $5))`;
    const [items, [t]] = await Promise.all([
      this.db.query(
        `SELECT p.id::text AS id, p.kind, p.title, left(p.body, 300) AS preview, p.telegram, p.slack, p.is_pinned AS "isPinned",
                p.taken_down_at AS "takenDownAt", p.created_at AS "createdAt", p.updated_at AS "updatedAt", a.name AS author,
                (SELECT count(*)::int FROM ops_board_reads r WHERE r.post_id = p.id) AS reads,
                (SELECT count(*)::int FROM ops_board_comments c WHERE c.post_id = p.id) AS comments,
                EXISTS (SELECT 1 FROM ops_board_reads r WHERE r.post_id = p.id AND r.account_id = $5) AS "readByMe"
           FROM ops_board_posts p LEFT JOIN accounts a ON a.id = p.author_id
          ${where}
          ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC LIMIT 50 OFFSET $6`, args),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ops_board_posts p ${where.replace('$5', '$5')}`, args.slice(0, 5)),
    ]);
    return { items, total: Number(t?.n ?? 0), page, pageSize: 50 };
  }

  async get(id: string) {
    const [p] = await this.db.query<Record<string, unknown>>(
      `SELECT p.id::text AS id, p.kind, p.title, p.body, p.telegram, p.slack, p.is_pinned AS "isPinned", p.notice_id AS "noticeId",
              p.taken_down_at AS "takenDownAt", p.taken_down_reason AS "takenDownReason", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              p.author_id AS "authorId", a.name AS author, (p.author_id = $2) AS mine
         FROM ops_board_posts p LEFT JOIN accounts a ON a.id = p.author_id WHERE p.id::text = $1`, [id, this.me]);
    if (!p) throw new NotFound('게시판 글을 찾을 수 없습니다.');
    const [comments, reads, revisions] = await Promise.all([
      this.db.query(`SELECT c.id::text AS id, c.body, c.created_at AS at, a.name AS author FROM ops_board_comments c LEFT JOIN accounts a ON a.id = c.author_id WHERE c.post_id::text = $1 ORDER BY c.created_at, c.id`, [id]),
      this.db.query(`SELECT r.at, a.name AS who FROM ops_board_reads r LEFT JOIN accounts a ON a.id = r.account_id WHERE r.post_id::text = $1 ORDER BY r.at`, [id]),
      this.db.query(`SELECT v.id::text AS id, v.before, v.reason, v.at, a.name AS who FROM ops_board_revisions v LEFT JOIN accounts a ON a.id = v.by_account WHERE v.post_id::text = $1 ORDER BY v.at DESC, v.id DESC`, [id]),
    ]);
    return { ...p, comments, reads, revisions };
  }

  async create(d: { title: string; body: string; isPinned?: boolean }) {
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO ops_board_posts (kind, title, body, author_id, is_pinned) VALUES ('STAFF', $1, $2, $3, $4) RETURNING id::text AS id`,
      [d.title.trim(), d.body.trim(), this.me, !!d.isPinned]);
    await this.read(r.id);
    return { ok: true, id: r.id, note: '글을 올렸습니다 — 운영 화면 계정만 봅니다.' };
  }

  /** 운영자 글: 쓴 사람 · SUPER 가 제목 · 본문 · 고정(전 내용 기록) · 자동 글: SUPER 가 고정만 */
  async update(id: string, d: { title?: string; body?: string; isPinned?: boolean; reason?: string }) {
    const [p] = await this.db.query<{ kind: string; title: string; body: string; is_pinned: boolean; author_id: string | null; down: boolean }>(
      `SELECT kind, title, body, is_pinned, author_id, taken_down_at IS NOT NULL AS down FROM ops_board_posts WHERE id::text = $1`, [id]);
    if (!p) throw new NotFound('게시판 글을 찾을 수 없습니다.');
    if (d.title === undefined && d.body === undefined && d.isPinned === undefined) throw new PolicyViolation('NO_CHANGE', '바꿀 것이 없습니다.');
    if (p.down) throw new StateConflict('POST_TAKEN_DOWN', '내린 글은 고칠 수 없습니다.');
    const text = d.title !== undefined || d.body !== undefined;
    if (p.kind !== 'STAFF' && text) throw new StateConflict('AUTO_POST_LOCKED', '자동 글은 내용을 고칠 수 없습니다(보낸 그대로) — 고정만 바꿀 수 있습니다.');
    if (!this.isSuper && (p.kind !== 'STAFF' || p.author_id !== this.me)) throw new Forbidden('NOT_AUTHOR', '쓴 사람 또는 최고 관리자만 고칠 수 있습니다.');
    if (text) {
      await this.db.query(`INSERT INTO ops_board_revisions (post_id, before, reason, by_account) VALUES ($1, $2::jsonb, $3, $4)`,
        [id, JSON.stringify({ title: p.title, body: p.body }), d.reason?.trim() || null, this.me]);
    }
    await this.db.query(
      `UPDATE ops_board_posts SET title = coalesce($2, title), body = coalesce($3, body), is_pinned = coalesce($4, is_pinned), updated_at = now() WHERE id::text = $1`,
      [id, d.title?.trim() ?? null, d.body?.trim() ?? null, d.isPinned ?? null]);
    return { ok: true, note: text ? '글을 고쳤습니다(전 내용은 기록에 남습니다).' : '고정을 바꿨습니다.' };
  }

  async takeDown(id: string, reasonIn: string) {
    const [p] = await this.db.query<{ kind: string; author_id: string | null; down: boolean }>(
      `SELECT kind, author_id, taken_down_at IS NOT NULL AS down FROM ops_board_posts WHERE id::text = $1`, [id]);
    if (!p) throw new NotFound('게시판 글을 찾을 수 없습니다.');
    if (p.down) throw new StateConflict('POST_TAKEN_DOWN', '이미 내린 글입니다.');
    if (!this.isSuper && p.author_id !== this.me) throw new Forbidden('NOT_AUTHOR', '쓴 사람 또는 최고 관리자만 내릴 수 있습니다.');
    const reason = reasonIn?.trim();
    if (!reason || reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '내리는 사유를 적어 주십시오(2자 이상).');
    await this.db.query(`UPDATE ops_board_posts SET taken_down_at = now(), taken_down_by = $2, taken_down_reason = $3, is_pinned = false WHERE id::text = $1`, [id, this.me, reason]);
    return { ok: true, note: '글을 내렸습니다 — 목록에는 「내림」으로 남습니다.' };
  }

  async comment(id: string, body: string) {
    const [p] = await this.db.query<{ id: string }>(`SELECT id FROM ops_board_posts WHERE id::text = $1`, [id]);
    if (!p) throw new NotFound('게시판 글을 찾을 수 없습니다.');
    await this.db.query(`INSERT INTO ops_board_comments (post_id, author_id, body) VALUES ($1, $2, $3)`, [p.id, this.me, body.trim()]);
    return { ok: true, note: '댓글을 남겼습니다.' };
  }

  async read(id: string) {
    const [p] = await this.db.query<{ id: string }>(`SELECT id FROM ops_board_posts WHERE id::text = $1`, [id]);
    if (!p) throw new NotFound('게시판 글을 찾을 수 없습니다.');
    await this.db.query(`INSERT INTO ops_board_reads (post_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, this.me]);
    return { ok: true };
  }
}
