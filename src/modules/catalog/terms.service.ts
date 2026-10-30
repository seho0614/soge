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
  listAll() {
    return this.db.query(
      `SELECT code, version, title, coalesce(body,'') AS body, status,
              is_required AS "isRequired", blocked_by AS "blockedBy",
              CASE WHEN effective_from = 'infinity' THEN NULL
                   ELSE effective_from END AS "effectiveFrom"
         FROM terms ORDER BY display_order, code, effective_from DESC`);
  }

  /**
   * 초안 저장. 기존 버전을 덮지 않고 새 버전을 만듭니다 —
   * 이미 동의받은 문서를 고치면 동의 이력의 근거가 사라집니다.
   */
  async upsertDraft(code: string, dto: {
    version: string; title: string; body: string; isRequired?: boolean;
  }) {
    const [base] = await this.db.query<{ is_required: boolean; display_order: number }>(
      `SELECT is_required, display_order FROM terms WHERE code = $1 LIMIT 1`, [code]);
    if (!base) throw new NotFound('약관 코드를 찾을 수 없습니다.');

    const [row] = await this.db.query(
      `INSERT INTO terms (code, version, title, body, is_required,
                          effective_from, status, display_order)
       VALUES ($1,$2,$3,$4,$5,'infinity','LEGAL_REVIEW',$6)
       ON CONFLICT (code, version) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body,
             is_required = EXCLUDED.is_required
       RETURNING code, version, status`,
      [code, dto.version, dto.title, dto.body,
       dto.isRequired ?? base.is_required, base.display_order]);
    return row;
  }

  /**
   * 발행. 이 시점부터 가입 화면과 푸터에 나타납니다.
   * 내용이 비었거나 시행일이 없으면 DB 가 거부합니다.
   */
  async publish(code: string, dto: { version: string; effectiveFrom: string }) {
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
    const holes = TermsService.holes(cur.body);
    if (holes.length) {
      throw new PolicyViolation('TERM_HOLES',
        `미확정 표시 ${holes.length}곳이 남아 있습니다(${holes.slice(0, 3).join(' · ')}${holes.length > 3 ? ' …' : ''}) — 법무 확인 뒤 채운 다음 게시하십시오.`);
    }
    const day = String(dto.effectiveFrom).slice(0, 10);

    return this.db.transaction(async () => {
      const [row] = await this.db.query<{ code: string; version: string; status: string }>(
        `UPDATE terms
            SET status = 'PUBLISHED', effective_from = $3, blocked_by = NULL, body = replace(body, '〔시행일〕', $4)
          WHERE code = $1 AND version = $2
        RETURNING code, version, status`,
        [code, dto.version, dto.effectiveFrom, day]);
      if (!row) throw new NotFound('해당 버전의 약관이 없습니다.');

      // 이전 버전은 보관 처리. 삭제하지 않습니다 — 동의 이력이 참조합니다.
      await this.db.query(
        `UPDATE terms SET status = 'ARCHIVED'
          WHERE code = $1 AND version <> $2 AND status = 'PUBLISHED'`,
        [code, dto.version]);

      const [n] = await this.db.query<{ c: string }>(
        `SELECT count(*) AS c FROM v_open_blockers`);
      return { ...row, remainingBlockers: Number(n.c) };
    });
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

