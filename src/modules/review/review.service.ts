import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ReviewRepository } from './review.repository';
import { DecideReviewDto } from './review.dto';

@Injectable()
export class ReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ReviewRepository,
  ) {}

  /**
   * v10.26 (G-177) — 선언한 응답 모양({ items, nextCursor } · review.controller 의 PageDto)으로 돌려줍니다.
   * 전에는 목록(배열)을 그대로 내보내, items 를 읽는 운영 화면 「검수 큐」가 늘 「대기 건이 없습니다」로 보였습니다.
   * 다음 쪽 열쇠는 마지막 건의 SLA 마감 시각입니다(저장소 조회의 cursor 와 같은 값). 한 쪽(50건)이 안 차면 null.
   */
  async queue(gwanCode?: string, cursor?: string, status?: string) {
    const limit = 50;
    /* v10.28 (G-220) — 열쇠 = 「마감 시각(마이크로초)|id」. 옛 열쇠(시각만)도 받습니다(같은 시각 줄은 처음부터). 형식이 틀리면 400 */
    if (cursor && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?(\|[0-9a-f-]{36})?$/i.test(cursor)) {
      throw new BadRequestException({ code: 'BAD_CURSOR', message: '다음 쪽 열쇠의 형식이 맞지 않습니다.' });
    }
    const rows = await this.repo.queue({ gwanCode, cursor, limit, status });
    const last = rows[rows.length - 1] as { cursorKey?: string } | undefined;
    const nextCursor = rows.length === limit && last?.cursorKey ? last.cursorKey : null;
    const items = rows.map(({ cursorKey: _k, ...r }: any) => r);
    return { items, nextCursor };
  }

  throughput() {
    return this.repo.throughput();
  }

  counts(gwanCode?: string) {
    return this.repo.counts(gwanCode);
  }

  /**
   * 검수 결정. 승인이면 대상의 상태를 함께 전이시킵니다.
   * 대상 전이와 검수 기록은 같은 트랜잭션 안에 있어야 합니다 —
   * 승인은 됐는데 노출이 안 되는 상태가 생기면 운영에서 찾을 수 없습니다.
   */
  async decide(id: string, actorId: string, dto: DecideReviewDto) {
    return this.db.transaction(async () => {
      const item = await this.repo.decide(
        id, actorId, dto.decision, dto.reasonCode, dto.memo,
      );
      if (!item) {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: '이미 처리된 검수 건입니다.',
        });
      }

      const nextStatus = dto.decision === 'APPROVED' ? 'PUBLISHED' : 'REJECTED';

      if (item.targetType === 'LISTING') {
        await this.db.query(
          `UPDATE listings
              SET status = $2,
                  published_at = CASE WHEN $2 = 'PUBLISHED' THEN now() ELSE published_at END
            WHERE id = $1`,
          [item.targetId, nextStatus],
        );
      } else if (item.targetType === 'REQUEST') {
        await this.db.query(`UPDATE requests SET status = $2 WHERE id = $1`,
          [item.targetId, nextStatus]);
      } else if (item.targetType === 'BUSINESS' && dto.decision === 'APPROVED') {
        // INV-10 의 기준일. 이 시각 이후부터 소개비 수령 자격이 생깁니다.
        await this.db.query(
          `UPDATE businesses SET verified_at = now(), verified_by = $2 WHERE id = $1`,
          [item.targetId, actorId],
        );
      }

      await this.db.query(
        `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data)
         VALUES ($1, 'REVIEWER', $2, $3, $4, $5::jsonb)`,
        [actorId, `REVIEW_${dto.decision}`, item.targetType, item.targetId,
         JSON.stringify({ reasonCode: dto.reasonCode ?? null })],
      );

      return { id: item.id, status: item.status, targetStatus: nextStatus };
    });
  }

  /**
   * 검수 건 상세.
   * v10.31 (10/10 시안 기준 · SB-ADM-REV-020) — 시안 왼쪽 카드(제목 · 본문 · 등록자 · 사업자등록번호 · 접수)와
   * 「자동 검사」 4줄(제한업종 · 금칙 표현 · 중복 · 연락처)을 서버가 그 자리에서 계산해 붙입니다. 검사 결과는 저장하지 않습니다(참고용).
   * 줄 모양은 전과 같고(review_items 의 모든 열) 붙인 칸만 늘었습니다.
   */
  async get(id: string) {
    const [row] = await this.db.query<any>(`SELECT * FROM review_items WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: '검수 건이 없습니다.' });

    const [t] = await this.db.query<any>(
      `SELECT coalesce(l.title, rq.title, bl.title, bz.company_name) AS title,
              coalesce(l.body, rq.body, bl.body) AS body,
              coalesce(l.category_id, rq.category_id, bl.category_id) AS "categoryId",
              coalesce(c.name, '') AS "categoryName", g.name AS "gwanName", l.grade_code AS "gradeCode",
              coalesce(l.owner_account_id, rq.owner_account_id, bl.owner_account_id, bz.account_id, ri.submitted_by) AS "ownerId",
              coalesce(sb.company_name, sa.name) AS "submitterName",
              coalesce(sb.biz_reg_no, bz.biz_reg_no) AS "bizRegNo",
              coalesce(sb.nts_status, bz.nts_status) AS "ntsStatus",
              sa.phone IS NOT NULL AS "hasPhone", sa.identity_verified_at IS NOT NULL AS "identityVerified",
              /* v10.71(D108) — 금칙어는 매물 글 칸 모두(제목 · 본문 · 요약 · 지역 상세 · 연락 시간 · 업체 정보) */
              CASE WHEN l.id IS NOT NULL THEN fn_listing_text(l) WHEN bl.id IS NOT NULL THEN fn_listing_text(bl) END AS "listingText"
         FROM review_items ri
         LEFT JOIN listings l  ON ri.target_type = 'LISTING' AND l.id = ri.target_id
         LEFT JOIN requests rq ON ri.target_type = 'REQUEST' AND rq.id = ri.target_id
         LEFT JOIN listing_badges lb ON ri.target_type = 'LISTING_BADGE' AND lb.id = ri.target_id
         LEFT JOIN listings bl ON bl.id = lb.listing_id
         LEFT JOIN businesses bz ON ri.target_type = 'BUSINESS' AND bz.id = ri.target_id
         LEFT JOIN categories c ON c.id = coalesce(l.category_id, rq.category_id, bl.category_id)
         LEFT JOIN gwans g ON g.code = ri.gwan_code
         LEFT JOIN accounts sa ON sa.id = ri.submitted_by
         LEFT JOIN businesses sb ON sb.account_id = sa.id AND sb.kind = 'BUSINESS'
        WHERE ri.id = $1`, [id]);

    const text = `${t?.title ?? ''}\n${t?.body ?? ''}`;
    const checks: { key: string; label: string; ok: boolean; detail: string }[] = [];
    /* ① 제한업종 — 업종이 제한업종 목록과 이어져 있거나, 본문에 제한 어휘가 있는가 */
    const restricted = t?.categoryId ? await this.db.query<{ name: string }>(
      `SELECT r.name FROM restricted_industries r
        WHERE r.is_active AND (r.code = (SELECT restricted_code FROM categories WHERE id = $1)
              OR EXISTS (SELECT 1 FROM restrict_vocab v WHERE v.code = r.code AND $2 ILIKE '%' || v.term || '%'))
        LIMIT 3`, [t.categoryId, text]).catch(() => [] as { name: string }[]) : [];
    checks.push({ key: 'restricted', label: '제한업종 검사', ok: restricted.length === 0,
      detail: restricted.length ? `${restricted.map((r) => r.name).join(' · ')} 에 해당할 수 있습니다 — 확인이 필요합니다.` : '해당 없음' });
    /* ② 금칙 표현 — v10.71(D108) 실제 판정과 같은 함수(맞춤 방식 · 관 · 낱말 일치 · 정규식). 전: 맞춤 방식 · 관을 무시한 「포함」 검사 */
    const banned = await this.db.query<{ word: string; severity: string }>(
      `SELECT DISTINCT w.word, w.severity FROM fn_check_banned_words($1, $2) w ORDER BY w.severity, w.word LIMIT 5`,
      [t?.listingText ?? text, row.gwan_code]).catch(() => [] as { word: string; severity: string }[]);
    checks.push({ key: 'banned', label: '금칙 표현 검사', ok: banned.length === 0,
      detail: banned.length ? `${banned.map((b) => `「${b.word}」(${b.severity === 'BLOCK' ? '차단' : '주의'})`).join(' · ')} 표현이 있습니다.` : '해당 없음' });
    /* ③ 중복 — 같은 제목이 다른 매물로 이미 있는가(최근 90일) */
    const dup = t?.title && row.target_type === 'LISTING' ? await this.db.query<{ id: string; same: boolean }>(
      `SELECT id, owner_account_id = $3 AS same FROM listings
        WHERE id <> $1 AND lower(regexp_replace(title, '\\s', '', 'g')) = lower(regexp_replace($2, '\\s', '', 'g'))
          AND created_at > now() - interval '90 days' AND status <> 'DELETED' LIMIT 3`,
      [row.target_id, t.title, t.ownerId]).catch(() => [] as { id: string; same: boolean }[]) : [];
    checks.push({ key: 'duplicate', label: '중복 검사', ok: dup.length === 0,
      detail: dup.length ? `${dup[0].same ? '같은 등록자' : '다른 등록자'}의 매물 ${dup[0].id.slice(0, 8)} 와 제목이 같습니다 — 확인이 필요합니다.` : '해당 없음' });
    /* ④ 연락처 — 본문에 전화번호 · 이메일이 있으면 귀속 우회 위험 · 사업자 확인 여부 */
    const contact = /(01[016789][-. ]?\d{3,4}[-. ]?\d{4})|([\w.+-]+@[\w-]+\.[\w.]+)|(카톡|카카오톡\s*id|오픈채팅)/i.exec(text);
    checks.push({ key: 'contact', label: '연락처 검증', ok: !contact,
      detail: contact ? `본문에 연락처로 보이는 글(「${contact[0]}」)이 있습니다.`
        : t?.ntsStatus === 'VALID' ? '사업자등록번호 확인됨' : t?.identityVerified ? '본인인증 확인됨' : '본문에 연락처 없음' });

    const bizRegNo: string | null = t?.bizRegNo ?? null;
    return {
      ...row,
      targetTitle: t?.title ?? null, targetBody: t?.body ?? null,
      categoryName: t?.categoryName || null, gwanName: t?.gwanName ?? null, gradeCode: t?.gradeCode ?? null,
      submitterName: t?.submitterName ?? null,
      /* 사업자등록번호는 검수에 필요한 값이라 그대로 보입니다(검수 담당 · 운영만 — @Roles). 조회는 감사 기록에 남습니다 */
      bizRegNo, ntsStatus: t?.ntsStatus ?? null,
      autoChecks: checks,
    };
  }
}
