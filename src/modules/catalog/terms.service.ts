import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * 약관 관리 (B-12).
 *
 * 법무 회신이 오면 여기로 들어옵니다. SQL 을 직접 치지 않게 하는 것이 목적입니다 —
 * 직접 치면 status 만 바꾸고 body 를 빼먹거나, 시행일을 과거로 넣습니다.
 *
 * 발행 조건은 DB 트리거(fn_assert_term_publish)가 강제합니다.
 */
@Injectable()
export class TermsService {
  constructor(private readonly db: DatabaseService) {}

  /** 관리자용. 미발행 약관도 보입니다. */
  async listAll() {
    /* v10.161 (D151) — 새 판이 시행된 약관의 앞 판을 먼저 보관으로(매시간 작업이 늦어도 화면은 지금 상태) */
    await this.db.query(`SELECT fn_terms_archive_due()`);
    return this.db.query(
      `SELECT t.code, t.version, t.title, coalesce(t.body,'') AS body, t.status,
              t.is_required AS "isRequired", t.blocked_by AS "blockedBy", t.change_note AS "changeNote",
              CASE WHEN t.effective_from = 'infinity' THEN NULL
                   ELSE t.effective_from END AS "effectiveFrom",
              /* v10.161 — 시행 예정(게시됐지만 시행 전 · 앞 판이 아직 시행 중) */
              EXISTS (SELECT 1 FROM v_terms_upcoming u WHERE u.code = t.code AND u.version = t.version) AS scheduled,
              /* v10.162 (D152) — 대상(제휴 약관은 회원 알림 없음) · 게시한 때 · 불리한 변경 */
              t.audience, t.published_at AS "publishedAt", t.is_adverse AS "isAdverse"
         FROM terms t ORDER BY t.display_order, t.code, t.effective_from DESC`);
  }

  /**
   * 초안 저장. 기존 버전을 덮지 않고 새 버전을 만듭니다 —
   * 이미 동의받은 문서를 고치면 동의 이력의 근거가 사라집니다.
   */
  async upsertDraft(code: string, dto: {
    version: string; title: string; body: string; isRequired?: boolean; changeNote?: string;
  }) {
    /* v10.159 (docs/243) — 새 판은 앞 판의 알림 여부(is_notice) · 대상(audience)을 이어받음.
     *   전에는 기본값(동의 항목 · 전체 회원)으로 만들어, 파트너 이용약관 새 판을 게시하면 모든 회원에게 동의를 받고 위탁 안내가 동의 항목이 될 수 있었음 */
    const [base] = await this.db.query<{ is_required: boolean; display_order: number; is_notice: boolean; audience: string }>(
      `SELECT is_required, display_order, is_notice, audience FROM terms WHERE code = $1
        ORDER BY (status = 'PUBLISHED') DESC, effective_from DESC LIMIT 1`, [code]);
    if (!base) throw new NotFound('약관 코드를 찾을 수 없습니다.');
    /* v10.157 (docs/239 · D150) — 운영 화면 「약관」 › 「고치기」가 부름.
     *   게시 · 보관된 판은 동의 기록의 근거라 같은 번호로 덮지 않음(전에는 ON CONFLICT 로 덮었음) → 새 번호로만. DB 트리거도 막음 */
    if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(dto.version)) {
      throw new PolicyViolation('TERM_VERSION', '판 번호는 1.1 처럼 숫자와 점으로 적으십시오.');
    }
    const [same] = await this.db.query<{ status: string }>(
      `SELECT status FROM terms WHERE code = $1 AND version = $2`, [code, dto.version]);
    if (same && (same.status === 'PUBLISHED' || same.status === 'ARCHIVED')) {
      throw new PolicyViolation('TERM_LOCKED', `게시되었거나 보관된 판(${dto.version})은 고칠 수 없습니다 — 새 판 번호로 저장하십시오.`);
    }

    const [row] = await this.db.query(
      `INSERT INTO terms (code, version, title, body, is_required,
                          effective_from, status, display_order, is_notice, audience, change_note)
       VALUES ($1,$2,$3,$4,$5,'infinity','LEGAL_REVIEW',$6,$7,$8,$9)
       ON CONFLICT (code, version) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body,
             is_required = EXCLUDED.is_required, change_note = coalesce(EXCLUDED.change_note, terms.change_note)
       RETURNING code, version, status`,
      [code, dto.version, dto.title, dto.body,
       dto.isRequired ?? base.is_required, base.display_order, base.is_notice, base.audience,
       /* 재동의 화면 「바뀐 점」(D041) */ dto.changeNote?.trim() || null]);
    return { ...row, holes: TermsService.holes(dto.body).length };
  }

  /**
   * 발행. 이 시점부터 가입 화면과 푸터에 나타납니다.
   * 내용이 비었거나 시행일이 없으면 DB 가 거부합니다.
   */
  async publish(code: string, dto: { version: string; effectiveFrom: string; adverse?: boolean }) {
    if (new Date(dto.effectiveFrom) < new Date(Date.now() - 86_400_000)) {
      throw new PolicyViolation(
        'EFFECTIVE_DATE_IN_PAST',
        '시행일을 과거로 지정할 수 없습니다. 동의 이력의 기준이 되는 날짜입니다.');
    }
    /* v10.156 (docs/237) — 운영 화면 「약관」 게시 단추가 부름. scripts/publish-terms.sh 와 같은 규칙:
     *   〔시행일〕 말고 〔…〕(미확정 표시)가 남아 있으면 거절(이용자에게 그 표시가 그대로 보임) · 본문의 〔시행일〕은 시행일로 채움 · 보관된 판은 게시하지 않음 */
    const [cur] = await this.db.query<{ body: string | null; status: string }>(
      `SELECT body, status FROM terms WHERE code = $1 AND version = $2`, [code, dto.version]);
    if (!cur) throw new NotFound('해당 버전의 약관이 없습니다.');
    if (cur.status === 'ARCHIVED') throw new PolicyViolation('TERM_ARCHIVED', '보관된 판은 게시할 수 없습니다 — 새 판을 만들어 게시하십시오.');
    /* v10.161 — 게시된 판을 다시 게시하면 시행일이 덮임(동의 기록의 기준 날짜가 바뀜) → 시행 예정이면 「예정 취소」 뒤 다시 */
    if (cur.status === 'PUBLISHED') throw new PolicyViolation('TERM_PUBLISHED', '이미 게시된 판입니다 — 시행일을 바꾸려면 「예정 취소」 뒤 다시 게시하십시오.');
    const holes = TermsService.holes(cur.body);
    if (holes.length) {
      throw new PolicyViolation('TERM_HOLES',
        `미확정 표시 ${holes.length}곳이 남아 있습니다(${holes.slice(0, 3).join(' · ')}${holes.length > 3 ? ' …' : ''}) — 법무 확인 뒤 채운 다음 게시하십시오.`);
    }
    const day = String(dto.effectiveFrom).slice(0, 10);
    /* v10.161 (D151) — 새 판 시행일은 지금 시행 중인(또는 첫 판으로 예정된) 판보다 뒤. 앞이면 그 날짜가 지난 뒤 옛 판이 다시 「지금 판」이 됨 */
    const [now_] = await this.db.query<{ version: string; later: boolean; day: string }>(
      `SELECT version, effective_from >= $3::timestamptz AS later, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day
         FROM v_terms_current WHERE code = $1 AND version <> $2`, [code, dto.version, dto.effectiveFrom]);
    if (now_?.later) throw new PolicyViolation('TERM_DATE_BEFORE_CURRENT', `지금 판(${now_.version})의 시행일(${now_.day})보다 뒤의 날짜로 게시하십시오.`);
    /* v10.162 (D152 · docs/248) — 회원에게 불리한 변경은 시행 30일 전 고지(이용약관 제14조) · 앞 판이 있을 때만(처음 게시는 바꾸는 것이 아님) */
    if (dto.adverse && now_ && new Date(dto.effectiveFrom).getTime() < Date.now() + 30 * 86_400_000) {
      throw new PolicyViolation('TERM_ADVERSE_30D', '회원에게 불리한 변경은 시행일을 오늘부터 30일 뒤 이후로 정하십시오(이용약관 제14조).');
    }
    /* v10.161 (D151 · docs/246) — 시행 예정 판은 약관마다 하나. 둘이면 어느 글이 언제 시행되는지 회원이 알 수 없음 */
    const [dup] = await this.db.query<{ version: string }>(
      `SELECT version FROM v_terms_upcoming WHERE code = $1 AND version <> $2`, [code, dto.version]);
    if (dup) throw new PolicyViolation('TERM_SCHEDULED_EXISTS', `시행 예정인 판(${dup.version})이 이미 있습니다 — 먼저 그 판의 「예정 취소」를 하십시오.`);

    return this.db.transaction(async () => {
      const [row] = await this.db.query<{ code: string; version: string; status: string }>(
        `UPDATE terms
            SET status = 'PUBLISHED', effective_from = $3, blocked_by = NULL, body = replace(body, '〔시행일〕', $4),
                published_at = now(), is_adverse = $5
          WHERE code = $1 AND version = $2
        RETURNING code, version, status`,
        [code, dto.version, dto.effectiveFrom, day, !!dto.adverse]);
      if (!row) throw new NotFound('해당 버전의 약관이 없습니다.');

      /* 앞 판은 보관 처리 — 삭제하지 않습니다(동의 이력이 참조). v10.161 (D151): 시행일이 지난 판만 지금, 시행 예정이면 앞 판은
       *   시행일까지 게시 그대로(그동안 회원은 앞 판 기준 · 재동의는 시행일부터) — 시행일이 되면 매시간 작업이 보관으로 바꿈 */
      const [a] = await this.db.query<{ n: number }>(`SELECT fn_terms_archive_due() AS n`);
      const [sc] = await this.db.query<{ scheduled: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM v_terms_upcoming WHERE code = $1 AND version = $2) AS scheduled`, [code, dto.version]);

      const notified = sc.scheduled ? await this.notifyMembers(code, dto.version, day, now_?.version ?? null) : 0;

      const [n] = await this.db.query<{ c: string }>(
        `SELECT count(*) AS c FROM v_open_blockers`);
      return { ...row, scheduled: sc.scheduled, archived: a.n, notified, remainingBlockers: Number(n.c) };
    });
  }

  /**
   * v10.161 (D151 · docs/246) — 시행 예정 판 게시 취소(SUPER · 감사 TERM_UNSCHEDULE).
   *   시행일 전이고 그 판에 받은 동의가 없을 때만. 법무 검토로 되돌리고(시행일 없음) 본문의 시행일 날짜는 〔시행일〕로 되돌림 — 다시 게시할 때 새 날짜로 채움
   */
  async unschedule(code: string, version: string) {
    const [t] = await this.db.query<{ status: string; future: boolean; day: string; agreed: string }>(
      `SELECT status, EXISTS (SELECT 1 FROM v_terms_upcoming u WHERE u.code = t.code AND u.version = t.version) AS future, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
              (SELECT count(*) FROM term_agreements a WHERE a.term_code = t.code AND a.term_version = t.version) AS agreed
         FROM terms t WHERE code = $1 AND version = $2`, [code, version]);
    if (!t) throw new NotFound('해당 버전의 약관이 없습니다.');
    if (t.status !== 'PUBLISHED' || !t.future) throw new PolicyViolation('TERM_NOT_SCHEDULED', '시행 예정인 게시 판만 취소할 수 있습니다 — 이미 시행된 판은 새 판으로 바꾸십시오.');
    if (Number(t.agreed) > 0) throw new PolicyViolation('TERM_HAS_CONSENT', `이 판에 이미 동의한 기록이 ${t.agreed}건 있어 취소할 수 없습니다 — 새 판으로 바꾸십시오.`);
    return this.db.transaction(async () => {
      /* 상태 먼저(게시 판은 글을 못 고침 · D150) → 법무 검토가 된 뒤 글의 날짜를 되돌림 */
      await this.db.query(`UPDATE terms SET status = 'LEGAL_REVIEW', effective_from = 'infinity', published_at = NULL, is_adverse = false WHERE code = $1 AND version = $2`, [code, version]);
      await this.db.query(`UPDATE terms SET body = replace(body, $3, '〔시행일〕') WHERE code = $1 AND version = $2`, [code, version, t.day]);
      /* v10.162 (D152) — 변경 안내를 받은 회원에게 취소 안내 */
      const notified = await this.notifyMembers(code, version, t.day, null, true);
      return { code, version, status: 'LEGAL_REVIEW', notified };
    });
  }

  /**
   * v10.162 (D152 · docs/248) — 시행 예정 게시 · 예정 취소 때 회원마다 「약관 변경 안내」 알림 1건(사이트 안).
   *   전체 회원 대상 약관만(제휴 약관은 빼고) · 설정 terms.notify_members = off 면 만들지 않음 · 메일 · 알림톡은 그 채널이 켜진 뒤 notify_dispatch 가 보냄.
   *   알림 링크 /terms?notice={code}@{version}#upcoming-terms 가 판을 가리킴(template_code 는 알림 양식 표를 가리켜 쓰지 않음) — 예정 취소 안내는 그 링크로 알림을 받은 회원에게만. 만든 수를 돌려줌
   */
  private async notifyMembers(code: string, version: string, day: string, prev: string | null, cancel = false) {
    const [t] = await this.db.query<{ title: string; is_required: boolean; change_note: string | null; audience: string; notify_on: boolean }>(
      `SELECT title, is_required, change_note, audience,
              coalesce((SELECT value FROM site_settings WHERE key = 'terms.notify_members'), 'on') = 'on' AS notify_on
         FROM terms WHERE code = $1 AND version = $2`, [code, version]);
    if (!t || !t.notify_on || t.audience !== 'ALL') return 0;
    const link = `/terms?notice=${code}@${version}`;   // 약관 코드 · 판 번호는 영문 대문자 · 숫자 · 점(TERM_VERSION)이라 그대로
    /* 알림 본문의 {영문} 은 DB 가 「치환 안 된 변수」로 거절(fn_assert_no_unresolved_vars) — 바뀐 점 글의 중괄호는 괄호로 */
    const note = (t.change_note ?? '').replace(/\{([a-zA-Z]+)\}/g, '($1)').trim();
    const title = cancel ? `[약관 변경 취소] ${t.title}` : `[약관 변경 안내] ${t.title} ${version}`;
    const body = cancel
      ? `${day} 시행 예정이던 ${t.title} ${version} 변경이 취소되었습니다. 지금 약관이 그대로 적용됩니다.`
      : [`${t.title}이(가) ${day}부터 바뀝니다${prev ? `(지금 판 ${prev} → ${version})` : ''}.`,
         note ? `바뀐 점: ${note.slice(0, 300)}` : '바뀐 점은 약관 화면에서 확인하십시오.',
         t.is_required ? '시행일 전까지는 지금 약관이 적용되고, 시행일부터 다시 동의를 받습니다.' : '시행일 전까지는 지금 약관이 적용됩니다.'].join(' ');
    const rows = await this.db.query(
      cancel
        ? `INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
           SELECT DISTINCT n.account_id, 'TERM_CHANGE_NOTICE', NULL, $2, $3, $1::text || '&cancel=1'
             FROM notifications n JOIN accounts a ON a.id = n.account_id
            WHERE n.event_code = 'TERM_CHANGE_NOTICE' AND n.link_url = $1::text || '#upcoming-terms' AND a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
           RETURNING id`
        : `INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
           SELECT a.id, 'TERM_CHANGE_NOTICE', NULL, $2, $3, $1::text || '#upcoming-terms'
             FROM accounts a WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
           RETURNING id`,
      [link, title, body]);
    return rows.length;
  }

  /** v10.156 — 본문의 미확정 표시(〔…〕 · 〔시행일〕 은 게시가 채우므로 뺌) */
  static holes(body: string | null | undefined): string[] {
    return (String(body ?? '').match(/〔[^〕]*〕/g) ?? []).filter((m) => m !== '〔시행일〕');
  }

  /** 오픈 차단 항목. 설정·약관·푸터를 함께 봅니다. */
  blockers() {
    return this.db.query(`SELECT kind, item, reason FROM v_open_blockers`);
  }

  /** v10.146 (D142) — 오픈 준비 점검 8줄(꼭 4 · 권장 4). 설정 값만 읽습니다. */
  readiness() {
    return this.db.query(
      `SELECT code, label, required, ok, now_value AS "nowValue", todo, go FROM v_open_readiness ORDER BY sort`);
  }

  /** v10.150 (D144 · docs/230) — 오픈일 · 홍보 기간 종료일 · 약관 게시 마감(한국 시간) */
  async openDate() {
    const [r] = await this.db.query<Record<string, any>>(
      `WITH v AS (
         SELECT nullif(btrim((SELECT value FROM site_settings WHERE key = 'service.open_date')), '')::date AS od,
                nullif(btrim((SELECT value FROM site_settings WHERE key = 'request.view.limit_from')), '') AS pe,
                (now() AT TIME ZONE 'Asia/Seoul')::date AS today)
       SELECT to_char(od, 'YYYY-MM-DD') AS "openDate", pe AS "promoEndsOn",
              to_char(od - 7, 'YYYY-MM-DD') AS "termsPublishBy", to_char(od - 30, 'YYYY-MM-DD') AS "termsUnfavorableBy",
              (od - today) AS "daysLeft",
              CASE WHEN od IS NULL THEN 0 ELSE (SELECT count(*) FROM (SELECT DISTINCT ON (code) effective_from FROM terms
                WHERE status = 'PUBLISHED' ORDER BY code, effective_from DESC) t
                WHERE (t.effective_from AT TIME ZONE 'Asia/Seoul')::date <> od) END::int AS "termsOtherDate"
         FROM v`);
    return r;
  }

  /** v10.150 — 오픈일 넣기(SUPER). 날짜를 넣으면 홍보 기간 종료일 = 오픈 + 3개월 을 함께 넣음 · 빈 값이면 오픈일만 지움 */
  async setOpenDate(date: string) {
    const d = (date ?? '').trim();
    if (d) {
      const [chk] = await this.db.query<{ past: boolean; valid: boolean }>(
        `SELECT to_char($1::date, 'YYYY-MM-DD') = $2::text AS valid, $1::date < (now() AT TIME ZONE 'Asia/Seoul')::date AS past`, [d, d])
        .catch(() => [{ valid: false, past: false }]);
      if (!chk.valid) throw new PolicyViolation('OPEN_DATE_INVALID', '없는 날짜입니다.');
      if (chk.past) throw new PolicyViolation('OPEN_DATE_PAST', '오픈일은 오늘 이후여야 합니다.');
    }
    await this.db.transaction(async () => {
      await this.db.query(`UPDATE site_settings SET value = $1 WHERE key = 'service.open_date'`, [d]);
      if (d) {
        await this.db.query(
          `UPDATE site_settings SET value = to_char($1::date + interval '3 months', 'YYYY-MM-DD') WHERE key = 'request.view.limit_from'`, [d]);
      }
    });
    return this.openDate();
  }
}

