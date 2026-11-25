import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { BrokerLookupProvider, resolveBrokerLookupProvider } from '../partner/broker-lookup.provider';

/* ---------------------------------------------------------------------
 * v10.792 (D331 · docs/907) 간주 끈 뒤 처리 도구 — 오픈 체크리스트 › 「간주 끈 뒤 처리」
 *
 *   ① 중개사 재대조 일괄 — 간주로 승인된 중개사(v_broker_recheck_pending)를 국토부 조회로 다시 맞춤(한 번에 50건까지 · SUPER)
 *        MATCH → 기록만(재대조 대상에서 빠짐) · MISMATCH · NOT_FOUND → 기록 + 운영 알림 BROKER_RECHECK_MISMATCH(WARN)
 *        **승인 상태는 바꾸지 않음**(대표 11/25 「알림만 · 사람이 판단」 — 명의 도용 · 조회 오류 가능성) · 조회 실패 → FAILED(결격 아님)
 *   ② 시험 기록 목록 — 구독 청구 · 소개몰 결제 · 리드 캐시 충전 · 소개몰 지급 요청의 시험(스텁) 기록 최근 50건씩(읽기만)
 *   ③ 시험 하위가맹점 번호(STUB-SUB-…) 판매자 — 바꾸기는 지금 길 POST /admin/health/sellers/{id}/submerchant
 *   값은 건수 · 번호 · 금액 · 날짜만(개인정보 · 키 없음).
 * ------------------------------------------------------------------- */

type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
export const RECHECK_MAX = 50;
export const STUB_KINDS = [
  { key: 'subscription', label: '구독 청구 시험 결제', sql: `SELECT id::text, amount::bigint AS amount, status, issued_at AS at FROM subscription_invoices WHERE is_stub ORDER BY issued_at DESC LIMIT 50`, count: `SELECT count(*)::int AS n FROM subscription_invoices WHERE is_stub` },
  { key: 'mallPayment', label: '소개몰 시험 결제', sql: `SELECT id::text, amount::bigint AS amount, state AS status, created_at AS at FROM hlt_payments WHERE stub ORDER BY created_at DESC LIMIT 50`, count: `SELECT count(*)::int AS n FROM hlt_payments WHERE stub` },
  { key: 'leadCash', label: '리드 캐시 시험 충전', sql: `SELECT id::text, amount::bigint AS amount, NULL::text AS status, created_at AS at FROM lead_cash_charges WHERE stub ORDER BY created_at DESC LIMIT 50`, count: `SELECT count(*)::int AS n FROM lead_cash_charges WHERE stub` },
  { key: 'payout', label: '소개몰 시험 지급 요청', sql: `SELECT id::text, amount::bigint AS amount, NULL::text AS status, created_at AS at FROM hlt_payout_requests WHERE stub ORDER BY created_at DESC LIMIT 50`, count: `SELECT count(*)::int AS n FROM hlt_payout_requests WHERE stub` },
] as const;

export class AssumeAfter {
  constructor(private readonly q: Q, private readonly provider: () => BrokerLookupProvider = resolveBrokerLookupProvider) {}

  async overview() {
    const p = this.provider();
    const pending = await this.q<{ n: number }>(`SELECT count(*)::int AS n FROM v_broker_recheck_pending`);
    const brokers = await this.q(
      `SELECT v.id, v.license_no AS "licenseNo", v.office_name AS "officeName", v.decided_at AS "decidedAt",
              l.id AS "recheckId", l.result AS "lastResult", l.detail AS "lastDetail", l.checked_at AS "lastCheckedAt",
              l.ack_at AS "ackAt", l.ack_note AS "ackNote",
              NOT EXISTS (SELECT 1 FROM v_broker_recheck_pending p WHERE p.id = v.id) AS "matched"
         FROM broker_verifications v
         LEFT JOIN LATERAL (SELECT r.* FROM broker_rechecks r WHERE r.verification_id = v.id ORDER BY r.checked_at DESC, r.id DESC LIMIT 1) l ON true
        WHERE v.id IN (SELECT id FROM v_broker_verified_assumed)
        ORDER BY (l.result IN ('MISMATCH', 'NOT_FOUND') AND l.ack_at IS NULL) DESC NULLS LAST, l.checked_at NULLS FIRST, v.decided_at
        LIMIT 100`);
    const stubs = [];
    for (const k of STUB_KINDS) {
      const [c] = await this.q<{ n: number }>(k.count).catch(() => [{ n: 0 }]);
      const rows = await this.q(k.sql).catch(() => []);
      stubs.push({ key: k.key, label: k.label, total: Number(c?.n ?? 0), rows: rows.map((r: any) => ({ ...r, amount: r.amount != null ? Number(r.amount) : null })) });
    }
    const sellers = await this.q(
      `SELECT id, code, name, status, submerchant_id AS "submerchantId" FROM hlt_sellers WHERE submerchant_id LIKE 'STUB-SUB-%' ORDER BY code LIMIT 200`);
    return {
      broker: { configured: p.configured, pending: Number(pending[0]?.n ?? 0), max: RECHECK_MAX, items: brokers },
      stubs, sellers,
      note: '재대조 결과가 다름 · 없음이어도 승인은 그대로입니다(알림만) — 해제는 운영자가 판단 · 시험 기록은 매출 · 정산에서 빼고 보는지 확인 · 하위가맹점 번호는 결제대행사 화면에서 받은 값으로',
    };
  }

  async brokerRecheck(actor: string, limit = RECHECK_MAX) {
    const p = this.provider();
    if (!p.configured) {
      throw new PolicyViolation('LOOKUP_NOT_CONFIGURED',
        '국토부 중개사무소 조회 연동이 설정되지 않았습니다(BROKER_LOOKUP_URL · BROKER_LOOKUP_KEY) — 연동 뒤 다시 하십시오.');
    }
    const n = Math.min(RECHECK_MAX, Math.max(1, Math.trunc(Number(limit)) || RECHECK_MAX));
    const rows = await this.q<{ id: string; licenseNo: string; officeName: string | null; ceoName: string | null }>(
      `SELECT v.id, v.license_no AS "licenseNo", v.office_name AS "officeName", v.ceo_name AS "ceoName"
         FROM broker_verifications v JOIN v_broker_recheck_pending p ON p.id = v.id
        ORDER BY p.last_checked_at NULLS FIRST, v.decided_at DESC LIMIT $1`, [n]);
    const out = { checked: 0, match: 0, mismatch: 0, notFound: 0, failed: 0 };
    const flagged: string[] = [];
    for (const r of rows) {
      const o = await p.lookup({ licenseNo: r.licenseNo, officeName: r.officeName ?? '', ceoName: r.ceoName ?? '' });
      const result = o.result ?? 'FAILED';
      await this.q(`INSERT INTO broker_rechecks (verification_id, result, detail, checked_by) VALUES ($1, $2, $3, $4)`,
        [r.id, result, (o.detail ?? '').slice(0, 500) || null, actor]);
      out.checked++;
      if (result === 'MATCH') out.match++;
      else if (result === 'MISMATCH') { out.mismatch++; flagged.push(r.licenseNo); }
      else if (result === 'NOT_FOUND') { out.notFound++; flagged.push(r.licenseNo); }
      else out.failed++;
    }
    if (flagged.length) {
      await this.q(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         VALUES ('BROKER_RECHECK_MISMATCH', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
        [`간주로 승인된 중개사 재대조 — 다름 ${out.mismatch} · 없음 ${out.notFound}건(승인은 그대로 · 확인 필요)`,
          JSON.stringify({ mismatch: out.mismatch, notFound: out.notFound, licenses: flagged.slice(0, 20) })]);
    }
    const [left] = await this.q<{ n: number }>(`SELECT count(*)::int AS n FROM v_broker_recheck_pending`);
    return { ...out, pending: Number(left?.n ?? 0) };
  }

  async ack(actor: string, id: string, note: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('재대조 기록이 없습니다.');
    const t = (note ?? '').trim();
    if (t.length < 2 || t.length > 200) throw new PolicyViolation('NOTE_REQUIRED', '확인 내용을 2 ~ 200자로 적어 주십시오.');
    const [cur] = await this.q<{ result: string; ack: boolean }>(`SELECT result, ack_at IS NOT NULL AS ack FROM broker_rechecks WHERE id = $1`, [id]);
    if (!cur) throw new NotFound('재대조 기록이 없습니다.');
    if (!['MISMATCH', 'NOT_FOUND'].includes(cur.result)) throw new StateConflict('RECHECK_NOT_FLAGGED', '다름 · 없음 결과만 확인으로 닫습니다.');
    if (cur.ack) throw new StateConflict('RECHECK_ACKED', '이미 확인한 기록입니다.');
    const [row] = await this.q(
      `UPDATE broker_rechecks SET ack_by = $2, ack_at = now(), ack_note = $3 WHERE id = $1 AND ack_at IS NULL
       RETURNING id, result, ack_at AS "ackAt", ack_note AS "ackNote"`, [id, actor, t]);
    if (!row) throw new StateConflict('RECHECK_ACKED', '이미 확인한 기록입니다.');
    return row;
  }
}
