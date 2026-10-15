import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/**
 * 메인 화면 구성.
 *
 * 구역 순서·노출과 문구를 데이터로 둡니다. 코드에 있으면
 * "성공 사례를 위로 올려 달라" 같은 요청마다 배포해야 합니다.
 *
 * 판정은 DB 가 합니다 — 잠긴 구역은 끌 수 없고, 문구에도 금칙어가
 * 적용됩니다. 여기서 다시 검사하지 않습니다.
 */
@Injectable()
export class MainService {
  constructor(private readonly db: DatabaseService) {}

  sections() {
    return this.db.query(
      `SELECT code, name, sort_order AS "sortOrder", is_active AS "isActive",
              is_locked AS "isLocked", description, updated_at AS "updatedAt"
         FROM main_sections ORDER BY sort_order`);
  }

  async setSection(code: string, isActive?: boolean, sortOrder?: number) {
    const [row] = await this.db.query<any>(
      `UPDATE main_sections
          SET is_active  = coalesce($2, is_active),
              sort_order = coalesce($3, sort_order)
        WHERE code = $1
      RETURNING code, name, is_active AS "isActive", sort_order AS "sortOrder"`,
      [code, isActive ?? null, sortOrder ?? null]);
    if (!row) throw new PolicyViolation('NO_SUCH_SECTION', '없는 구역입니다.');
    return row;
  }

  copy() {
    return this.db.query(
      `SELECT slot, text, note, updated_at AS "updatedAt"
         FROM main_copy ORDER BY slot`);
  }

  async setCopy(slot: string, text: string) {
    if (!text?.trim()) {
      throw new PolicyViolation('EMPTY_COPY', '문구를 비울 수 없습니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE main_copy SET text = $2 WHERE slot = $1
      RETURNING slot, text`, [slot, text.trim()]);
    if (!row) throw new PolicyViolation('NO_SUCH_SLOT', '없는 자리입니다.');
    return row;
  }

  /** 공지. 게시일(published_at)이 지난 것만 보입니다.
   *
   * ★ 20260930 — notices 에는 starts_at · ends_at 이 없습니다(게시일 한 칸).
   *   없는 열을 읽어 메인 운영 화면의 공지 목록이 늘 500 이었습니다(실측).
   *   게시 종료가 필요하면 열을 새 마이그레이션으로 더하고 여기를 바꾸십시오. */
  notices() {
    return this.db.query(
      `SELECT id, title, body, gwan_code AS "gwanCode", is_pinned AS "isPinned",
              published_at AS "startsAt", NULL::timestamptz AS "endsAt",
              (published_at IS NOT NULL AND published_at <= now()) AS "showing"
         FROM notices ORDER BY is_pinned DESC, published_at DESC NULLS LAST LIMIT 50`);
  }

  /**
   * 관별 현황 (SB-ADM-SIT-050 허브).
   *
   * 관마다 등록·요청·업종·검수 대기가 몇 건인지 한 화면에서 봅니다.
   * 관을 열기 전에 **응답할 공급이 있는지** 확인하는 자리이기도 합니다.
   */
  hub() {
    return this.db.query(
      `SELECT code, name, is_active AS "isActive", listings, requests,
              categories, review_pending AS "reviewPending", own_words AS "ownWords"
         FROM v_gwan_hub`);
  }

  /**
   * 공유 경계 (SB-ADM-SIT-060).
   *
   * 어떤 설정이 관마다 다르고 어떤 것이 전 관 공통인지 보여 줍니다.
   * 그 구분을 모르면 **한 관을 바꿨는데 다른 관이 함께 바뀝니다.**
   */
  scope() {
    return this.db.query(
      `SELECT table_name AS "table", label, shared_rows AS "sharedRows"
         FROM v_scope_map ORDER BY table_name`);
  }
}
