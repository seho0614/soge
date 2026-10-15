import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveBrokerLookupProvider } from './broker-lookup.provider';
import { assumeOn } from '../../common/integration/switches';

/**
 * 중개사 인증 심사 (SB-ADM-BRK-010 · 011, INV-BR1).
 *
 * `POST /partner/broker` 가 broker_verifications 에 쌓는 신청을 운영이 판정합니다.
 * 전에는 판정 API 가 없어 신청이 PENDING 에 머물렀고, 그러면
 * fn_is_verified_broker 가 늘 false 라 **부동산 매물 공개(fn_broker_gate)가
 * 영영 열리지 않았습니다.**
 *
 * 규칙은 DB 가 봅니다(fn_broker_guard) —
 *   - 승인은 국토부 대조가 MATCH 여야 합니다 (간주 모드면 신청 때 MATCH 로 둡니다)
 *   - 승인자(decided_by)가 없으면 막힙니다 — 자동 승인 경로를 두지 않습니다
 *   - 반려에는 사유가 필요합니다
 *   - 승인되면 재확인 기한(180일)이 붙고 businesses.broker_verified_at 이 맞춰집니다
 */
@Injectable()
export class BrokerService {
  constructor(private readonly db: DatabaseService) {}

  private static readonly SELECT = `
    SELECT v.id, v.state, v.license_no AS "licenseNo", v.office_name AS "officeName",
           v.ceo_name AS "ceoName", v.lookup_result AS "lookupResult", v.lookup_at AS "lookupAt",
           v.lookup_source AS "lookupSource", v.lookup_detail AS "lookupDetail",
           v.recheck_due AS "recheckDue", v.reject_reason AS "rejectReason",
           v.decided_at AS "decidedAt", da.email AS "decidedBy", v.created_at AS "createdAt",
           b.id AS "businessId", b.company_name AS "company", b.biz_reg_no AS "bizRegNo",
           b.ceo_name AS "bizCeoName", (b.verified_at IS NOT NULL) AS "bizVerified",
           (b.kind = 'PERSON') AS "personal",   -- v10.38 (D096) — 개인 신청(개인 활동 정보 · 이름 = 회원 이름)
           b.nts_status AS "ntsStatus", b.sido, b.sigungu,
           a.email AS "accountEmail",
           /* 신청 대표자와 사업자 대표자가 다르면 명의 도용을 먼저 의심합니다 */
           (btrim(coalesce(v.ceo_name,'')) = btrim(b.ceo_name)) AS "ceoMatch",
           fn_is_verified_broker(b.account_id) AS "canPublish",
           (SELECT count(*)::int FROM listings l
             WHERE l.owner_account_id = b.account_id AND l.gwan_code = 'MAL'
               AND l.status <> 'PUBLISHED') AS "malWaiting",
           (SELECT count(*)::int FROM listings l
             WHERE l.owner_account_id = b.account_id AND l.gwan_code = 'MAL'
               AND l.status = 'PUBLISHED') AS "malPublished"
      FROM broker_verifications v
      JOIN businesses b ON b.id = v.business_id
      JOIN accounts a   ON a.id = b.account_id
      LEFT JOIN accounts da ON da.id = v.decided_by`;

  /** 목록. state 가 없으면 심사 대기(SUBMITTED · PENDING).
   *  v10.27 (G-207) — 쪽 나눔(page · size) · 찾기(q — 상호 · 사무소 · 대표 · 이메일 · 사업자번호 · 등록번호) · 순서(order — old 오래된 순 · recent 최근 순).
   *  전에는 오래된 것부터 200건까지만 내려 대기가 200건을 넘으면 새 신청이 화면에 나오지 않았습니다. */
  async list(state?: string, opt: { q?: string; order?: string; page?: number; size?: number } = {}) {
    const st = (state ?? 'PENDING').toUpperCase();
    const map: Record<string, string[] | null> = {
      PENDING: ['SUBMITTED', 'PENDING'], VERIFIED: ['VERIFIED'],
      REJECTED: ['REJECTED'], EXPIRED: ['EXPIRED'], ALL: null,
    };
    if (!(st in map)) {
      throw new PolicyViolation('BAD_STATE', 'state 는 PENDING · VERIFIED · REJECTED · EXPIRED · ALL 중 하나입니다.');
    }
    const order = (opt.order ?? (st === 'PENDING' ? 'old' : 'recent')).toLowerCase();
    if (!['old', 'recent'].includes(order)) throw new PolicyViolation('BAD_ORDER', 'order 는 old · recent 중 하나입니다.');
    const size = Math.min(100, Math.max(1, Math.trunc(Number(opt.size ?? 50)) || 50));
    const page = Math.max(1, Math.trunc(Number(opt.page ?? 1)) || 1);
    const q = (opt.q ?? '').trim().slice(0, 60) || null;
    const where = `WHERE ($1::text[] IS NULL OR v.state = ANY($1::text[]))
          AND ($2::text IS NULL OR concat_ws(' ', b.company_name, v.office_name, v.ceo_name, b.ceo_name, a.email, b.biz_reg_no, v.license_no)
                                   ILIKE '%' || replace(replace(replace($2, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
    const items = await this.db.query(
      `${BrokerService.SELECT}
        ${where}
        ORDER BY v.created_at ${order === 'old' ? 'ASC' : 'DESC'}, v.id
        LIMIT $3 OFFSET $4`, [map[st], q, size, (page - 1) * size]);
    const [{ total }] = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM broker_verifications v
         JOIN businesses b ON b.id = v.business_id
         JOIN accounts a   ON a.id = b.account_id
        ${where}`, [map[st], q]);
    const [counts] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE state IN ('SUBMITTED','PENDING'))::int AS pending,
              count(*) FILTER (WHERE state = 'VERIFIED')::int AS verified,
              count(*) FILTER (WHERE state = 'REJECTED')::int AS rejected,
              count(*) FILTER (WHERE state = 'EXPIRED')::int  AS expired
         FROM broker_verifications`);
    const assumed = await assumeOn(this.db, 'broker', false);
    return { items, counts, assumed, lookupConfigured: resolveBrokerLookupProvider().configured,
             total, page, size, pages: Math.max(1, Math.ceil(total / size)), order, q };
  }

  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('중개사 인증 신청이 없습니다.');
    const [row] = await this.db.query<any>(`${BrokerService.SELECT} WHERE v.id = $1`, [id]);
    if (!row) throw new NotFound('중개사 인증 신청이 없습니다.');
    return { ...row, assumed: await assumeOn(this.db, 'broker', false) };
  }

  /** v10.32 — 보증 · 서류(시안 SB-ADM-BRK-011 셋째 칸). 읽기 전용 */
  async evidence(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('중개사 인증 신청이 없습니다.');
    const [row] = await this.db.query<any>(
      `SELECT v.id, v.guarantee_org AS "org", v.guarantee_cert_no AS "certNo", v.guarantee_amount AS "amount",
              v.guarantee_from AS "from", v.guarantee_until AS "until", v.submitted_docs AS "docs",
              coalesce(array_length(v.doc_file_ids, 1), 0) AS "files",
              (v.guarantee_until IS NOT NULL AND v.guarantee_until >= current_date) AS "valid"
         FROM broker_verifications v WHERE v.id = $1`, [id]);
    if (!row) throw new NotFound('중개사 인증 신청이 없습니다.');
    return { ...row, amount: row.amount != null ? Number(row.amount) : null };
  }

  /**
   * 국토부 다시 조회 (D008).
   *
   * 신청 때 조회가 실패(지연 · 장애)했거나, 간주로 들어온 건을 연동 뒤 실제로 맞춰 볼 때 씁니다.
   * 심사 대기 건만 — 판정이 끝난 건의 근거를 바꾸지 않습니다.
   * 조회 실패면 기존 결과를 지우지 않습니다(미조회로 덮어쓰면 간주 기록까지 사라집니다).
   */
  async relookup(id: string) {
    const cur = await this.get(id);
    if (!['SUBMITTED', 'PENDING'].includes(cur.state)) {
      throw new StateConflict('NOT_PENDING', '심사 대기 중인 신청만 다시 조회합니다.');
    }
    const provider = resolveBrokerLookupProvider();
    if (!provider.configured) {
      throw new PolicyViolation('LOOKUP_NOT_CONFIGURED',
        '국토부 중개사무소 조회 연동이 설정되지 않았습니다(BROKER_LOOKUP_URL · BROKER_LOOKUP_KEY) — 수기로 확인하십시오.');
    }
    const r = await provider.lookup({ licenseNo: cur.licenseNo, officeName: cur.officeName ?? '', ceoName: cur.ceoName ?? '' });
    const [row] = r.result
      ? await this.db.query<any>(
          `UPDATE broker_verifications
              SET lookup_result = $2, lookup_source = 'API', lookup_detail = $3, lookup_at = now()
            WHERE id = $1 AND state IN ('SUBMITTED','PENDING')
          RETURNING id, lookup_result AS "lookupResult", lookup_source AS "lookupSource",
                    lookup_detail AS "lookupDetail", lookup_at AS "lookupAt"`, [id, r.result, r.detail])
      : await this.db.query<any>(
          `UPDATE broker_verifications SET lookup_detail = $2
            WHERE id = $1 AND state IN ('SUBMITTED','PENDING')
          RETURNING id, lookup_result AS "lookupResult", lookup_source AS "lookupSource",
                    lookup_detail AS "lookupDetail", lookup_at AS "lookupAt"`, [id, r.detail]);
    if (!row) throw new StateConflict('NOT_PENDING', '심사 대기 중인 신청만 다시 조회합니다.');
    return { ...row, looked: !!r.result, errorKind: r.errorKind ?? null,
      note: r.result ? `국토부 조회 결과: ${r.result} — ${r.detail}` : `조회하지 못했습니다 — ${r.detail}` };
  }

  /**
   * 승인(VERIFIED) · 반려(REJECTED).
   * 승인하면 그 사업자의 부동산(MAL) 매물 공개가 열립니다(fn_broker_gate).
   */
  async decide(id: string, state: 'VERIFIED' | 'REJECTED', reason?: string) {
    if (state === 'REJECTED' && !reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED',
        '반려에는 무엇이 맞지 않았는지까지 적어야 합니다 — 신청자에게 그대로 보입니다.');
    }
    const cur = await this.get(id);
    if (!['SUBMITTED', 'PENDING'].includes(cur.state)) {
      throw new StateConflict('NOT_PENDING', '심사 대기 중인 신청이 아닙니다.');
    }
    return this.db.transaction(async () => {
      const [row] = await this.db.query<any>(
        `UPDATE broker_verifications
            SET state = $2, decided_by = $3,
                decided_at = now(),
                reject_reason = CASE WHEN $2 = 'REJECTED' THEN $4 ELSE NULL END
          WHERE id = $1 AND state IN ('SUBMITTED','PENDING')
        RETURNING id, state, recheck_due AS "recheckDue", reject_reason AS "rejectReason"`,
        [id, state, RequestCtx.actorId(), reason?.trim() ?? null]);
      if (!row) throw new StateConflict('NOT_PENDING', '심사 대기 중인 신청이 아닙니다.');

      const [acc] = await this.db.query<any>(
        `SELECT b.account_id AS "accountId", fn_is_verified_broker(b.account_id) AS "canPublish"
           FROM broker_verifications v JOIN businesses b ON b.id = v.business_id
          WHERE v.id = $1`, [id]);
      await this.db.query(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url)
         VALUES ($1, $2, $3, $4, '/my/broker/status')`,
        [acc.accountId, state === 'VERIFIED' ? 'BROKER_VERIFIED' : 'BROKER_REJECTED',
         state === 'VERIFIED' ? '중개사 인증이 완료되었습니다' : '중개사 인증이 반려되었습니다',
         state === 'VERIFIED'
           ? '이제 부동산 매물을 공개하실 수 있습니다. 180일마다 다시 확인합니다.'
           : `사유: ${reason!.trim()} — 고쳐서 다시 신청하실 수 있습니다.`]);

      return { ...row, canPublish: acc.canPublish,
        note: state === 'VERIFIED'
          ? '승인했습니다. 이 사업자의 부동산 매물 공개가 열립니다. 재확인 기한은 180일 뒤입니다.'
          : '반려했습니다. 사유가 신청자에게 보이고, 고쳐서 다시 신청할 수 있습니다.' };
    });
  }
}
