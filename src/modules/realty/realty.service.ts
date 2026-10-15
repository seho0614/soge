import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

/**
 * 부동산 소유 확인.
 *
 * ── 막는 것은 DB 가 합니다 ────────────────────────────────────
 * 발급일 30일 · 사람 판정 필수는 `fn_owner_verify_guard` 가 봅니다.
 * 여기서 막으면 배치나 다른 모듈이 직접 INSERT 할 때 통과합니다.
 */
@Injectable()
export class RealtyService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  async submit(listingId: string, dto: { docKey?: string; fileId?: string; issuedOn: string; hasEncumbrance?: boolean }) {
    const [l] = await this.db.query(
      `SELECT id, owner_account_id, status FROM listings WHERE id = $1`, [listingId]);
    if (!l) return { ok: false, note: '없는 매물입니다.' };
    if (l.owner_account_id !== this.me) {
      return { ok: false, note: '내가 올린 매물이 아닙니다.' };
    }

    /* ★ D007 — 파일이 있으면 doc_key 에는 파일 이름을 담습니다(호환).
     *   남의 파일 · 다른 용도 · 확인 전(UPLOADING) 파일은 DB 트리거가 막습니다. */
    const [r] = await this.db.query(
      `INSERT INTO owner_verifications
         (listing_id, applicant_id, doc_key, issued_on, has_encumbrance, state, doc_file_id)
       VALUES ($1, $2, coalesce((SELECT original_name FROM files WHERE id = $6::uuid), $3), $4, $5, 'SUBMITTED', $6::uuid)
       ON CONFLICT (listing_id) DO UPDATE SET
         doc_key = EXCLUDED.doc_key,
         doc_file_id = EXCLUDED.doc_file_id,
         issued_on = EXCLUDED.issued_on,
         has_encumbrance = EXCLUDED.has_encumbrance,
         state = 'SUBMITTED',
         reject_code = NULL, reject_reason = NULL,
         decided_by = NULL, decided_at = NULL
       RETURNING id, state`,
      [listingId, this.me, dto.docKey ?? null, dto.issuedOn, dto.hasEncumbrance ?? false, dto.fileId ?? null]);

    return {
      ok: true, ...r,
      note: '접수했습니다. 확인이 끝나면 매물을 공개하실 수 있습니다. 보통 하루 안에 끝납니다.',
    };
  }

  async mine(listingId: string) {
    const [r] = await this.db.query(
      `SELECT o.state, o.doc_key AS "docKey", o.doc_file_id AS "docFileId", o.issued_on AS "issuedOn",
              o.has_encumbrance AS "hasEncumbrance",
              o.reject_reason AS "rejectReason", o.decided_at AS "decidedAt"
         FROM owner_verifications o
         JOIN listings l ON l.id = o.listing_id
        WHERE o.listing_id = $1 AND l.owner_account_id = $2`, [listingId, this.me]);
    if (!r) {
      return {
        ok: true, state: null,
        note: '아직 제출하지 않으셨습니다. 등기사항증명서를 올리시면 확인 후 공개됩니다.',
      };
    }
    return {
      ok: true, ...r,
      note: r.state === 'VERIFIED' ? '확인이 끝났습니다. 매물을 공개하실 수 있습니다.'
          : r.state === 'REJECTED' ? '거절되었습니다. 사유를 보시고 다시 제출하십시오.'
          : '확인 중입니다.',
    };
  }

  async queue() {
    const rows = await this.db.query(
      `SELECT o.id, o.listing_id AS "listingId", l.title,
              o.doc_key AS "docKey", o.issued_on AS "issuedOn",
              o.doc_file_id AS "docFileId", f.content_type AS "docFileType", f.size_bytes AS "docFileSize",
              o.has_encumbrance AS "hasEncumbrance",
              coalesce(a.name, '(탈퇴)') AS applicant,
              o.created_at AS "createdAt",
              ((now() AT TIME ZONE 'Asia/Seoul')::date - o.issued_on) AS "docAgeDays"
         FROM owner_verifications o
         JOIN listings l ON l.id = o.listing_id
         LEFT JOIN accounts a ON a.id = o.applicant_id
         LEFT JOIN files f ON f.id = o.doc_file_id AND f.status = 'READY'
        WHERE o.state = 'SUBMITTED'
        ORDER BY o.created_at`);
    return {
      items: rows,
      note: rows.length
        ? '등기사항증명서를 직접 보고 판단하십시오. 자동 승인 경로가 없습니다.'
        : null,
    };
  }

  async decide(id: string, dto: { state: string; reason?: string }) {
    /* ★ 거절 사유를 안 적으면 같은 서류를 다시 냅니다. */
    if (dto.state === 'REJECTED' && !dto.reason?.trim()) {
      return { ok: false, note: '거절 사유를 적으십시오. 안 적으면 같은 서류가 다시 올라옵니다.' };
    }
    const [r] = await this.db.query(
      `UPDATE owner_verifications SET
          state = $2,
          reject_reason = $3,
          decided_by = $4,
          decided_at = now()
        WHERE id = $1 AND state = 'SUBMITTED'
      RETURNING id, listing_id AS "listingId", state`,
      [id, dto.state, dto.reason ?? null, this.me]);
    if (!r) return { ok: false, note: '확인 대기 상태가 아닙니다.' };
    return {
      ok: true, ...r,
      note: dto.state === 'VERIFIED'
        ? '확인했습니다. 신청자가 매물을 공개할 수 있습니다.'
        : '거절했습니다. 사유가 신청자에게 보입니다.',
    };
  }
}
