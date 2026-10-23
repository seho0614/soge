import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/**
 * 소개광장.
 *
 * ── 막는 것은 여기가 아니라 DB 입니다 ──────────────────────────
 * 금칙어 · 링크 · 도배 · 첫 글 검수 · 후기 자격은 전부 트리거가
 * 봅니다(C810). **여기서 막으면 API 를 우회하는 경로가 생깁니다** —
 * 배치나 다른 모듈이 직접 INSERT 하면 그냥 통과합니다.
 */
const BOARDS = ['REVIEW', 'TRADE', 'QNA', 'NOTICE'];
/** 운영 글 찾기에서 고를 수 있는 상태 (v10.72) — posts_state_check 와 같음 */
const ADMIN_STATES = ['PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED'];
/** 되살릴 때 처리 전 신고를 닫는 문구 — 신고한 사람에게 그대로 보입니다 */
const UNHIDE_RESOLUTION = '운영 확인 결과 규칙에 어긋나지 않는 글로 보고 다시 올렸습니다.';
/** 신고 3건 자동 감춤의 사유 — 신고 트리거(D031 fn_report_escalate)가 적는 글자 그대로입니다(v10.76 · 시험이 둘을 대조) */
const AUTO_HIDE_REASON = '신고 3건 — 운영 확인 대기';
/** 댓글을 되살릴 때 처리 전 신고를 닫는 문구(v10.80) — 신고한 사람에게 그대로 보입니다 */
const COMMENT_UNHIDE_RESOLUTION = '운영 확인 결과 규칙에 어긋나지 않는 댓글로 보고 다시 보이게 했습니다.';
/* v10.47 (D100) — 우리동네 맛집 글(board FOOD)은 「전체」 목록 · 메인에 섞지 않습니다(맛집 화면 /community/food 에서만).
 *   BOARDS 에도 넣지 않습니다 — 게시판 목록(board=)으로 고를 수 없습니다. 글 하나 보기(post) · 댓글 · 신고 · 검수는 그대로 씁니다. */

/**
 * 누구나 보는 화면에 나가는 작성자 표기 (v10.23 · G-146).
 *
 * 소개광장은 로그인하지 않아도 봅니다. 그래서 **이름 전체를 내보내지 않습니다** —
 * 첫 글자만 남깁니다(김OO). 매물 후기 조회(listing.service)와 같은 생각입니다.
 *   · 운영자(ADMIN · SUPER)가 쓴 글 · 댓글은 「운영자」
 *   · 탈퇴한 사람은 「(탈퇴)」
 * 운영 검수 큐(queue)는 누구 글인지 알아야 하므로 이름을 그대로 둡니다.
 */
export function publicAuthor(name: string | null | undefined, staff?: boolean): string {
  if (staff) return '운영자';
  const first = [...(name ?? '').trim()][0];
  return first ? `${first}OO` : '(탈퇴)';
}

/** 조회 줄의 `_name` · `_staff` 를 `author` 한 칸으로 바꿉니다 — 이름 전체가 응답에 실리지 않게. */
function withAuthor<T extends { _name?: string | null; _staff?: boolean }>(r: T) {
  const { _name, _staff, ...rest } = r;
  return { ...rest, author: publicAuthor(_name, _staff) };
}

/* 작성자 표기에 쓰는 두 칸(_name · _staff)은 조회마다 **글자 그대로** 적습니다 — accounts a 를 LEFT JOIN 한 조회 4곳.
 * 상수로 빼서 끼워 넣으면(템플릿 글 안의 달러-중괄호) 통합 검정의 「SQL 대조」(scripts/check-sql.js)가 그 조회를 건너뜁니다
 * (조립한 SQL 은 조각을 알 수 없어서). 열 · 표 이름이 바뀌었을 때 검정이 잡도록 고정 글로 둡니다(qa/srv_cmu.py E-4).
 * 이 주석에는 역따옴표를 쓰지 않습니다 — 그 검정이 역따옴표 쌍으로 SQL 을 찾습니다. */

@Injectable()
export class CommunityService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  async posts(board?: string, limit?: number) {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
    /* ★ 검수 대기 글은 **작성자 본인에게만** 보입니다.
     *   안 보이면 "글이 사라졌다" 고 합니다. */
    const rows = await this.db.query(
      `SELECT p.id, p.board, p.title, p.state, p.views, p.comment_count AS "commentCount",
              p.is_pinned AS "isPinned", p.created_at AS "createdAt",
              a.name AS _name,
              EXISTS (SELECT 1 FROM account_roles ar
                       WHERE ar.account_id = a.id AND ar.role IN ('ADMIN','SUPER')) AS _staff,
              (p.state = 'PENDING') AS "pendingMine"
         FROM posts p
         LEFT JOIN accounts a ON a.id = p.author_id
        WHERE (($1::text IS NULL AND p.board <> 'FOOD') OR p.board = $1)
          AND (p.state = 'PUBLISHED'
            OR (p.state = 'PENDING' AND p.author_id = $2::uuid))
        ORDER BY p.is_pinned DESC, p.created_at DESC
        LIMIT $3`, [board ?? null, this.me ?? null, n]);
    return rows.map(withAuthor);
  }

  /**
   * 쪽 번호가 있는 목록 + 게시글 검색 (v10.23).
   *
   * `posts()` 는 배열을 그대로 돌려주는 옛 길이라(메인 · 다른 화면이 씁니다) 모양을 바꾸지 않고,
   * 전체 건수가 필요한 소개광장 목록은 이 길을 씁니다.
   *   · 보이는 범위는 posts() 와 같습니다 — 공개 글 + **내** 검수 대기 글.
   *   · 검색은 fn_search_match(제목, 본문, 검색어) — 낱말이 **모두** 들어 있는 글(두 글자 이상인 낱말만 봄).
   *   · 순서는 고정 글 먼저, 그 다음 최신순. 같은 시각이면 id 로 — 쪽 사이에 글이 겹치거나 빠지지 않게.
   */
  async board(q: { board?: unknown; q?: unknown; page?: unknown; size?: unknown }) {
    /* 같은 이름을 두 번 보내면(?q=a&q=b) 값이 배열로 옵니다 — 첫 값만 씁니다(문자열 함수가 터지지 않게). */
    const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '');
    const board = one(q.board).trim() || null;
    if (board && !BOARDS.includes(board)) throw new BadRequestException('없는 게시판입니다.');
    const kw = one(q.q).trim().replace(/\s+/g, ' ');
    if ([...kw].length > 50) throw new BadRequestException('검색어는 50자까지 넣으실 수 있습니다.');
    const int = (v: unknown) => (/^\d{1,9}$/.test(one(v).trim()) ? Number(one(v).trim()) : NaN);
    const pageIn = int(q.page), sizeIn = int(q.size);
    const page = pageIn >= 1 ? Math.min(pageIn, 100000) : 1;
    const size = sizeIn >= 1 ? Math.min(sizeIn, 50) : 10;

    /* 건수 조회와 목록 조회의 조건은 **같아야** 합니다(다르면 쪽 수와 줄 수가 어긋납니다) — 두 곳을 함께 고치십시오. */
    const args = [board, this.me ?? null, kw];
    const [c] = await this.db.query(
      `SELECT count(*)::int AS n
         FROM posts p
        WHERE (($1::text IS NULL AND p.board <> 'FOOD') OR p.board = $1)
          AND (p.state = 'PUBLISHED'
            OR (p.state = 'PENDING' AND p.author_id = $2::uuid))
          AND fn_search_match(p.title, p.body, $3)`, args);
    const total = c?.n ?? 0;
    const rows = await this.db.query(
      `SELECT p.id, p.board, p.title, p.state, p.views, p.comment_count AS "commentCount",
              p.is_pinned AS "isPinned", p.created_at AS "createdAt",
              a.name AS _name,
              EXISTS (SELECT 1 FROM account_roles ar
                       WHERE ar.account_id = a.id AND ar.role IN ('ADMIN','SUPER')) AS _staff,
              (p.state = 'PENDING') AS "pendingMine"
         FROM posts p
         LEFT JOIN accounts a ON a.id = p.author_id
        WHERE (($1::text IS NULL AND p.board <> 'FOOD') OR p.board = $1)
          AND (p.state = 'PUBLISHED'
            OR (p.state = 'PENDING' AND p.author_id = $2::uuid))
          AND fn_search_match(p.title, p.body, $3)
        ORDER BY p.is_pinned DESC, p.created_at DESC, p.id
        LIMIT $4 OFFSET $5`, [...args, size, (page - 1) * size]);
    return { items: rows.map(withAuthor), total, page, size, pages: Math.ceil(total / size) };
  }

  async post(id: string) {
    const [p] = await this.db.query(
      `SELECT p.id, p.board, p.title, p.body, p.state, p.views,
              p.classified_by AS "classifiedBy", p.classify_terms AS "classifyTerms",
              p.hidden_reason AS "hiddenReason", p.created_at AS "createdAt",
              a.name AS _name,
              EXISTS (SELECT 1 FROM account_roles ar
                       WHERE ar.account_id = a.id AND ar.role IN ('ADMIN','SUPER')) AS _staff,
              (p.author_id = $2::uuid) AS mine
         FROM posts p
         LEFT JOIN accounts a ON a.id = p.author_id
        WHERE p.id = $1`, [id, this.me ?? null]);
    if (!p) return { ok: false, note: '없는 글입니다.' };
    const { _name, _staff, ...post } = p;       // 이름 전체는 여기서 버립니다(G-146)
    post.author = publicAuthor(_name, _staff);

    /* v10.26 (G-173) — 지운 글은 자리만 남깁니다. 제목 · 본문을 내보내지 않습니다(쓴 사람에게도 — 지운 것을 다시 내주지 않음).
     * 전에는 가려진 글 · 검수 중인 글만 가려서, 지운 글은 주소를 알면 누구에게나 제목 · 본문이 그대로 나갔습니다
     * (검수 중이라 남에게 안 보이던 글도 지우는 순간 공개됨). 달린 댓글은 남깁니다 — remove() 의 「달린 댓글은 남습니다」 그대로. 조회 수는 올리지 않습니다. */
    if (p.state === 'DELETED') {
      return { ok: true, id: p.id, board: p.board, deleted: true,
               note: '작성자가 지운 글입니다.', comments: await this.commentsOf(id) };
    }

    /* 가려진 글은 자리를 남깁니다 — 통째로 사라지면 다시 씁니다.
     * v10.76 — 신고 3건으로 자동으로 가려진 글만 「신고가 들어와 확인 중」. 운영자가 감춘 글(v10.72)은 신고가 없어도
     *   같은 문구가 나갔습니다 → 「운영 기준에 따라 가려진 글」(댓글 v10.75 와 같은 말). 운영자가 적은 사유는 작성자에게만 보입니다. */
    if (p.state === 'HIDDEN' && !p.mine) {
      return { ok: true, id: p.id, board: p.board, hidden: true,
               note: p.hiddenReason === AUTO_HIDE_REASON ? '신고가 들어와 확인 중입니다.' : '운영 기준에 따라 가려진 글입니다.' };
    }
    if (p.state === 'PENDING' && !p.mine) {
      return { ok: true, id: p.id, board: p.board, pending: true,
               note: '검수 중입니다.' };
    }

    /* v10.27 (G-201) — 글쓴이 본인이 열 때는 조회 수를 올리지 않습니다(자기 글을 고치러 여러 번 열면 조회 수가 부풀었음). */
    if (!p.mine) {
      await this.db.query(`UPDATE posts SET views = views + 1 WHERE id = $1`, [id]);
    }

    return { ok: true, ...post, comments: await this.commentsOf(id) };
  }

  /** 글에 달린 댓글 — 작성자 이름은 첫 글자만(G-146). 지운 댓글은 뺍니다.
   *  v10.75 — 감춘 댓글은 본문을 내보내지 않습니다(자리만 · 화면은 「가려진 댓글」). 감춘 글과 같습니다 — 전에는 화면만 가리고 API 로는 본문이 나갔습니다.
   *  v10.80 — mine(내 댓글 — 신고 단추를 숨김) · hiddenBy(REPORT 신고 3건 자동 · ADMIN 운영자). 댓글 표에는 사유 칸이 없어 신고 수로 가립니다(D110). */
  private async commentsOf(id: string) {
    const comments = await this.db.query(
      `SELECT c.id, c.parent_id AS "parentId",
              CASE WHEN c.state = 'HIDDEN' THEN NULL ELSE c.body END AS body, c.created_at AS "createdAt",
              (c.author_id = $2::uuid) AS mine,
              CASE WHEN c.state <> 'HIDDEN' THEN NULL WHEN c.report_count >= 3 THEN 'REPORT' ELSE 'ADMIN' END AS "hiddenBy",
              a.name AS _name,
              EXISTS (SELECT 1 FROM account_roles ar
                       WHERE ar.account_id = a.id AND ar.role IN ('ADMIN','SUPER')) AS _staff,
              (c.state = 'HIDDEN') AS hidden
         FROM post_comments c
         LEFT JOIN accounts a ON a.id = c.author_id
        WHERE c.post_id = $1 AND c.state <> 'DELETED'
        ORDER BY coalesce(c.parent_id, c.id), c.created_at`, [id, this.me ?? null]);
    return comments.map(withAuthor);
  }

  async classify(title: string, body?: string) {
    const [r] = await this.db.query(
      `SELECT * FROM fn_classify_board_auto($1, $2)`, [title, body ?? '']);
    return {
      board: r?.board ?? null,
      score: r?.score ?? 0,
      matched: r?.matched ?? [],
      confident: r?.confident ?? false,
      note: r?.confident
        ? null
        : '어느 게시판인지 뚜렷하지 않습니다. 직접 골라 주십시오.',
    };
  }

  async create(dto: {
    board: string; title: string; body: string;
    dealId?: string; classifiedBy?: string;
  }) {
    const [r] = await this.db.query(
      `INSERT INTO posts (board, author_id, title, body, deal_id, classified_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, board, state`,
      [dto.board, this.me, dto.title, dto.body,
       dto.dealId ?? null, dto.classifiedBy ?? 'USER']);
    return {
      ...r,
      note: r.state === 'PENDING'
        ? '첫 글이라 확인 후 올라갑니다. 보통 하루 안에 끝납니다.'
        : '올라갔습니다.',
    };
  }

  async update(id: string, dto: { title?: string; body?: string; board?: string }) {
    const [r] = await this.db.query(
      `UPDATE posts SET
          title = coalesce($3, title),
          body  = coalesce($4, body),
          board = coalesce($5, board),
          updated_at = now()
        WHERE id = $1 AND author_id = $2
      RETURNING id, board, title`,
      [id, this.me, dto.title ?? null, dto.body ?? null, dto.board ?? null]);
    if (!r) return { ok: false, note: '내 글이 아니거나 없는 글입니다.' };
    return { ok: true, ...r };
  }

  async remove(id: string) {
    /* ★ 실제로 지우지 않습니다. 댓글이 달렸으면 **대화가 끊깁니다.** */
    const [r] = await this.db.query(
      `UPDATE posts SET state = 'DELETED', hidden_at = now()
        WHERE id = $1 AND author_id = $2 RETURNING id`, [id, this.me]);
    if (!r) return { ok: false, note: '내 글이 아니거나 없는 글입니다.' };
    return { ok: true, note: '지웠습니다. 달린 댓글은 남습니다.' };
  }

  async comment(postId: string, dto: { body: string; parentId?: string }) {
    const [r] = await this.db.query(
      `INSERT INTO post_comments (post_id, parent_id, author_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at AS "createdAt"`,
      [postId, dto.parentId ?? null, this.me, dto.body]);
    return { ok: true, ...r };
  }

  async queue() {
    const pending = await this.db.query(
      `SELECT p.id, p.board, p.title, p.created_at AS "createdAt",
              coalesce(a.name,'(탈퇴)') AS author,
              (current_date - p.created_at::date) AS "daysWaiting"
         FROM posts p LEFT JOIN accounts a ON a.id = p.author_id
        WHERE p.state = 'PENDING'
        ORDER BY p.created_at`);
    const reported = await this.db.query(
      `SELECT id, board, title, report_count AS "reportCount", hidden_at AS "hiddenAt"
         FROM v_post_reported ORDER BY report_count DESC`);
    /* v10.80 — 신고된 댓글(신고 3건 이상 — 글과 같은 기준 · 3건이면 자동으로 가려짐 · D110) */
    const reportedComments = await this.db.query(
      `SELECT c.id, c.post_id AS "postId", p.title AS "postTitle", c.body, c.state,
              c.report_count AS "reportCount", c.hidden_at AS "hiddenAt", coalesce(a.name,'(탈퇴)') AS author
         FROM post_comments c
         JOIN posts p ON p.id = c.post_id
         LEFT JOIN accounts a ON a.id = c.author_id
        WHERE c.report_count >= 3 AND c.state <> 'DELETED'
        ORDER BY c.report_count DESC, c.created_at DESC
        LIMIT 100`);
    const [late] = await this.db.query(
      `SELECT count(*)::int AS n FROM v_post_pending_long`);
    return {
      pending, reported, reportedComments,
      lateCount: late?.n ?? 0,
      note: (late?.n ?? 0) > 0
        ? '2일 넘게 밀린 글이 있습니다 — 새 회원이 "글이 안 올라간다" 고 합니다.'
        : null,
    };
  }

  async approve(id: string) {
    const [r] = await this.db.query(
      `UPDATE posts SET state = 'PUBLISHED', updated_at = now()
        WHERE id = $1 AND state = 'PENDING' RETURNING id`, [id]);
    if (!r) return { ok: false, note: '검수 대기 상태가 아닙니다.' };
    return { ok: true, note: '올렸습니다.' };
  }

  /**
   * 운영 — 글 찾기 (v10.72).
   *
   * 검수 큐(queue)는 첫 글과 신고 3건 이상인 글만 보여 줍니다. 신고가 쌓이기 전의 광고 · 욕설 글이나
   * 잘못 가려진 글을 찾으려면 **모든 글**을 상태 · 게시판 · 검색어로 찾아야 합니다.
   *   · 운영 화면이라 작성자 이름을 그대로 둡니다(queue 와 같음). 맛집 글(FOOD)도 고를 수 있습니다.
   *   · 건수 조회와 목록 조회의 조건은 **같아야** 합니다 — 두 곳을 함께 고치십시오.
   */
  async adminPosts(q: { state?: unknown; board?: unknown; q?: unknown; page?: unknown; size?: unknown }) {
    const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '');
    const state = one(q.state).trim() || null;
    if (state && !ADMIN_STATES.includes(state)) throw new BadRequestException('없는 상태입니다.');
    const board = one(q.board).trim() || null;
    if (board && ![...BOARDS, 'FOOD'].includes(board)) throw new BadRequestException('없는 게시판입니다.');
    const kw = one(q.q).trim().replace(/\s+/g, ' ');
    if ([...kw].length > 50) throw new BadRequestException('검색어는 50자까지 넣으실 수 있습니다.');
    const int = (v: unknown) => (/^\d{1,9}$/.test(one(v).trim()) ? Number(one(v).trim()) : NaN);
    const pageIn = int(q.page), sizeIn = int(q.size);
    const page = pageIn >= 1 ? Math.min(pageIn, 100000) : 1;
    const size = sizeIn >= 1 ? Math.min(sizeIn, 50) : 20;

    const args = [state, board, kw];
    const [c] = await this.db.query(
      `SELECT count(*)::int AS n
         FROM posts p
        WHERE ($1::text IS NULL OR p.state = $1)
          AND ($2::text IS NULL OR p.board = $2)
          AND fn_search_match(p.title, p.body, $3)`, args);
    const total = c?.n ?? 0;
    const items = await this.db.query(
      `SELECT p.id, p.board, p.title, p.state, p.report_count AS "reportCount",
              p.comment_count AS "commentCount", p.created_at AS "createdAt",
              p.hidden_at AS "hiddenAt", p.hidden_reason AS "hiddenReason",
              coalesce(a.name,'(탈퇴)') AS author
         FROM posts p LEFT JOIN accounts a ON a.id = p.author_id
        WHERE ($1::text IS NULL OR p.state = $1)
          AND ($2::text IS NULL OR p.board = $2)
          AND fn_search_match(p.title, p.body, $3)
        ORDER BY p.created_at DESC, p.id
        LIMIT $4 OFFSET $5`, [...args, size, (page - 1) * size]);
    return { items, total, page, size, pages: Math.ceil(total / size) };
  }

  async hide(id: string, reason: string) {
    /* ★ 사유를 안 적으면 작성자가 **같은 글을 다시 씁니다.** */
    /* v10.27 (G-201) — 사유가 비거나 글이 없을 때 201 에 ok:false 로 답했습니다(성공 코드로 실패를 알림 —
     * 호출하는 쪽이 상태 코드만 보면 가려진 줄 압니다). 422 REASON_REQUIRED · 404 로 답합니다. */
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new PolicyViolation('REASON_REQUIRED', '사유를 적으십시오. 안 적으면 같은 글이 다시 올라옵니다.');
    }
    const [r] = await this.db.query(
      `UPDATE posts SET state = 'HIDDEN', hidden_at = now(), hidden_reason = $2
        WHERE id = $1 AND state <> 'DELETED' RETURNING id`, [id, reason.trim()]);
    /* v10.72 — 작성자가 지운 글(DELETED)은 감추지 않습니다(감추면 「감춘 글」 이 되어 되살리기 대상이 됩니다). */
    if (!r) throw new NotFound('없는 글이거나 작성자가 지운 글입니다.');
    return { ok: true, note: '감췄습니다. 작성자에게 사유가 보입니다.' };
  }

  /**
   * 운영 — 감춘 글 되살리기 (v10.72).
   *
   * 신고 3건이면 글이 자동으로 가려집니다(D031). 정상 글이었으면 되돌릴 길이 있어야 합니다 —
   * 없으면 경쟁사 세 명이 정상 글을 없앨 수 있습니다.
   *   · 감춘 글(HIDDEN)만 · 사유 필수. 감사 기록은 답(after_data)만 남기므로 답에 reason 을 담습니다(v10.75).
   *   · 그 글의 처리 전 신고(OPEN · QUEUED)는 **기각**으로 닫고 신고 수를 0 으로 둡니다(대표 결정 A · 2026-10-22).
   *     신고 수 트리거(fn_report_escalate)는 OPEN · QUEUED · UPHELD 만 세므로, 되살린 뒤에는 **새 신고 3건**이 쌓여야 다시 가려집니다.
   *     신고 기록은 지우지 않습니다. 신고한 사람에게는 결과를 알립니다(abuse.service resolve 와 같음).
   *   · 작성자가 지운 글(DELETED)은 되살리지 않습니다 — 작성자 뜻입니다.
   */
  async unhide(id: string, reason: string) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new PolicyViolation('REASON_REQUIRED', '되살리는 사유를 적으십시오. 감사 기록에 남습니다.');
    }
    const [p] = await this.db.query<{ state: string }>(`SELECT state FROM posts WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 글입니다.');
    if (p.state !== 'HIDDEN') {
      throw new StateConflict('NOT_HIDDEN', p.state === 'DELETED'
        ? '작성자가 지운 글은 되살리지 않습니다.' : '감춘 글이 아닙니다.');
    }
    return this.db.transaction(async () => {
      const [r] = await this.db.query(
        `UPDATE posts SET state = 'PUBLISHED', hidden_at = NULL, hidden_reason = NULL,
                          report_count = 0, updated_at = now()
          WHERE id = $1 AND state = 'HIDDEN' RETURNING id`, [id]);
      if (!r) throw new StateConflict('NOT_HIDDEN', '감춘 글이 아닙니다.');
      const closed = await this.db.query<{ reporter_id: string | null }>(
        `UPDATE reports
            SET state = 'DISMISSED', resolution = $2, handled_by = $3, handled_at = now()
          WHERE target_type = 'POST' AND target_id = $1 AND state IN ('OPEN','QUEUED')
          RETURNING reporter_id`, [id, UNHIDE_RESOLUTION, this.me ?? null]);
      const reporters = [...new Set(closed.map((c) => c.reporter_id).filter((x): x is string => !!x))];
      if (reporters.length) {
        await this.db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url)
           SELECT x, 'REPORT_RESOLVED', '신고 처리 결과를 알려 드립니다', $2, '/my/reports'
             FROM unnest($1::uuid[]) AS x
           ON CONFLICT DO NOTHING`, [reporters, UNHIDE_RESOLUTION]);
      }
      return { ok: true, dismissed: closed.length, reason: reason.trim(),
               note: closed.length ? `다시 올렸습니다. 처리 전 신고 ${closed.length}건은 기각으로 닫았습니다.` : '다시 올렸습니다.' };
    });
  }

  /** 운영 — 글의 댓글 전체 (v10.75). 회원 화면(commentsOf)과 달리 지운 댓글 · 작성자 이름을 그대로 보여 줍니다 */
  async adminComments(postId: string) {
    const [p] = await this.db.query(`SELECT id FROM posts WHERE id = $1`, [postId]);
    if (!p) throw new NotFound('없는 글입니다.');
    const items = await this.db.query(
      `SELECT c.id, c.parent_id AS "parentId", c.body, c.state, c.created_at AS "createdAt",
              c.hidden_at AS "hiddenAt", c.report_count AS "reportCount", coalesce(a.name,'(탈퇴)') AS author
         FROM post_comments c
         LEFT JOIN accounts a ON a.id = c.author_id
        WHERE c.post_id = $1
        ORDER BY coalesce(c.parent_id, c.id), c.created_at`, [postId]);
    return { items };
  }

  /**
   * 운영 — 댓글 감추기 · 되살리기 (v10.75).
   *
   * 댓글 표에는 감춘 사유 칸이 없습니다(마이그레이션 없이 하기로 함 · 대표 승인 2026-10-23).
   * 그래서 사유는 **답에 담아** 감사 기록(COMMENT_HIDE · COMMENT_UNHIDE 의 after_data)에 남깁니다.
   * 글의 댓글 수(comment_count)는 트리거(fn_comment_count)가 공개 댓글만 다시 셉니다.
   */
  async hideComment(id: string, reason: string) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new PolicyViolation('REASON_REQUIRED', '감추는 사유를 적으십시오. 감사 기록에 남습니다.');
    }
    const [r] = await this.db.query(
      `UPDATE post_comments SET state = 'HIDDEN', hidden_at = now()
        WHERE id = $1 AND state = 'PUBLISHED' RETURNING id, post_id AS "postId"`, [id]);
    if (r) return { ok: true, postId: r.postId, reason: reason.trim(), note: '감췄습니다. 회원 화면에는 「가려진 댓글」로 보입니다.' };
    const [c] = await this.db.query<{ state: string }>(`SELECT state FROM post_comments WHERE id = $1`, [id]);
    if (!c) throw new NotFound('없는 댓글입니다.');
    throw new StateConflict('NOT_PUBLISHED', c.state === 'DELETED'
      ? '작성자가 지운 댓글은 감추지 않습니다.' : '이미 감춘 댓글입니다.');
  }

  async unhideComment(id: string, reason: string) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new PolicyViolation('REASON_REQUIRED', '되살리는 사유를 적으십시오. 감사 기록에 남습니다.');
    }
    const [c] = await this.db.query<{ state: string }>(`SELECT state FROM post_comments WHERE id = $1`, [id]);
    if (!c) throw new NotFound('없는 댓글입니다.');
    if (c.state !== 'HIDDEN') {
      throw new StateConflict('NOT_HIDDEN', c.state === 'DELETED'
        ? '작성자가 지운 댓글은 되살리지 않습니다.' : '감춘 댓글이 아닙니다.');
    }
    /* v10.80 — 글 되살리기(v10.72 · 결정 A)와 같게: 처리 전 신고(OPEN · QUEUED)는 기각으로 닫고 신고 수 0 · 신고한 사람에게 알림.
     *   신고 수 트리거(D110)는 OPEN · QUEUED · UPHELD 만 세므로, 되살린 뒤에는 새 신고 3건이 쌓여야 다시 가려집니다. */
    return this.db.transaction(async () => {
      const [r] = await this.db.query(
        `UPDATE post_comments SET state = 'PUBLISHED', hidden_at = NULL, report_count = 0
          WHERE id = $1 AND state = 'HIDDEN' RETURNING id, post_id AS "postId"`, [id]);
      if (!r) throw new StateConflict('NOT_HIDDEN', '감춘 댓글이 아닙니다.');
      const closed = await this.db.query<{ reporter_id: string | null }>(
        `UPDATE reports
            SET state = 'DISMISSED', resolution = $2, handled_by = $3, handled_at = now()
          WHERE target_type = 'COMMENT' AND target_id = $1 AND state IN ('OPEN','QUEUED')
          RETURNING reporter_id`, [id, COMMENT_UNHIDE_RESOLUTION, this.me ?? null]);
      const reporters = [...new Set(closed.map((x) => x.reporter_id).filter((x): x is string => !!x))];
      if (reporters.length) {
        await this.db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url)
           SELECT x, 'REPORT_RESOLVED', '신고 처리 결과를 알려 드립니다', $2, '/my/reports'
             FROM unnest($1::uuid[]) AS x
           ON CONFLICT DO NOTHING`, [reporters, COMMENT_UNHIDE_RESOLUTION]);
      }
      return { ok: true, postId: r.postId, reason: reason.trim(), dismissed: closed.length,
               note: closed.length ? `다시 보이게 했습니다. 처리 전 신고 ${closed.length}건은 기각으로 닫았습니다.` : '다시 보이게 했습니다.' };
    });
  }
}
