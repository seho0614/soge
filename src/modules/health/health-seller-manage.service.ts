import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { SELLER_LICENSE_KINDS } from './health-tenant.service';

/* ---------------------------------------------------------------------
 * v10.223 (D193 · docs/358) — 소개몰 판매자 관리
 *
 *   운영(ADMIN · SUPER)   정지 PAUSED · 다시 열기 ACTIVE · 이용 제한 BLOCKED · 폐점 CLOSED — 사유 필수 · 판매자에게 알림 · 감사 기록
 *                        상품은 DB 가 따라 내림 · 되돌림(fn_hlt_seller_products_follow)
 *                        수수료율 바꾸기(사유 · 기록 · 새 주문부터 — 수수료는 주문 때 박힘) · 정보 변경 요청 승인 · 반려
 *   판매자 본인           폐점(탈퇴) — 진행 중 주문 · 처리 안 끝난 취소 · 반품 · 정산 안 끝난 돈이 있으면 막음
 *                        정보 변경 요청 — 승인 뒤에만 바뀜(상호 · 대표 · 사업자번호 · 통신판매업 · 전화 · 반품지 · 주소 · 서류)
 * ------------------------------------------------------------------- */
export const CHANGE_KEYS = ['name', 'ceoName', 'bizRegNo', 'ecomRegNo', 'csTel', 'returnAddr', 'addr', 'licenses'] as const;
const COL: Record<string, string> = {
  name: 'name', ceoName: 'ceo_name', bizRegNo: 'biz_reg_no', ecomRegNo: 'ecom_reg_no', csTel: 'cs_tel', returnAddr: 'return_addr', addr: 'addr',
};
export type SellerAction = 'PAUSE' | 'RESUME' | 'BLOCK' | 'CLOSE';
const MOVE: Record<SellerAction, { from: string[]; to: string; code: string; title: string }> = {
  PAUSE:  { from: ['ACTIVE'],                      to: 'PAUSED',  code: 'SELLER_PAUSED',  title: '소개몰 판매가 일시 정지되었습니다' },
  RESUME: { from: ['PAUSED'],                      to: 'ACTIVE',  code: 'SELLER_RESUMED', title: '소개몰 판매가 다시 열렸습니다' },
  BLOCK:  { from: ['ACTIVE', 'PAUSED'],            to: 'BLOCKED', code: 'SELLER_BLOCKED', title: '소개몰 판매자 이용이 제한되었습니다' },
  CLOSE:  { from: ['ACTIVE', 'PAUSED', 'BLOCKED'], to: 'CLOSED',  code: 'SELLER_CLOSED',  title: '소개몰 판매자 폐점 처리되었습니다' },
};
type License = { kind: string; licenseNo: string; issuedAt?: string | null; expiresAt?: string | null };

@Injectable()
export class HealthSellerManageService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  private notify(sellerId: string, code: string, title: string, body: string, link: string) {
    return this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT account_id, $2, $3, $4, $5 FROM hlt_sellers WHERE id = $1 AND account_id IS NOT NULL`,
      [sellerId, code, title, body, link]);
  }

  /** 폐점을 막는 것 — 진행 중 주문(결제 뒤 ~ 구매 확정 전) · 처리 안 끝난 취소 · 반품 · 정산 안 끝난 돈 */
  async closeBlockers(sellerId: string) {
    const [r] = await this.db.query<{ orders: number; returns: number; settle: number; unsettled: number }>(
      `SELECT (SELECT count(*)::int FROM hlt_orders o WHERE o.seller_id = $1 AND o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED')) AS orders,
              (SELECT count(*)::int FROM hlt_returns x JOIN hlt_orders o ON o.id = x.order_id
                WHERE o.seller_id = $1 AND x.state IN ('REQUESTED','APPROVED')) AS returns,
              (SELECT count(*)::int FROM hlt_settlements st WHERE st.seller_id = $1 AND st.status IN ('DRAFT','CONFIRMED') AND st.net_amount <> 0) AS settle,
              (SELECT count(*)::int FROM hlt_orders o WHERE o.seller_id = $1 AND o.status = 'CONFIRMED'
                  AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items i WHERE i.order_id = o.id)) AS unsettled`, [sellerId]);
    const why: string[] = [];
    if (r.orders) why.push(`진행 중 주문 ${r.orders}건`);
    if (r.returns) why.push(`처리 안 끝난 취소 · 반품 ${r.returns}건`);
    if (r.settle) why.push(`지급 안 끝난 정산서 ${r.settle}건`);
    if (r.unsettled) why.push(`아직 정산하지 않은 구매 확정 주문 ${r.unsettled}건`);
    return { ...r, why };
  }

  /* ── 운영 ─────────────────────────────────────────────────────────── */

  /** 운영 — 정지 · 다시 열기 · 이용 제한 · 폐점 */
  async setStatus(id: string, action: SellerAction, reasonRaw: string) {
    const m = MOVE[action];
    if (!m) throw new PolicyViolation('BAD_ACTION', '정지 · 다시 열기 · 이용 제한 · 폐점 중에서 고르십시오.');
    const reason = String(reasonRaw ?? '').trim();
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '사유를 적어 주십시오 — 판매자에게 그대로 보이고 기록에 남습니다.');
    return this.db.transaction(async () => {
      const [s] = await this.db.query<{ status: string; type: string; name: string }>(
        `SELECT status, type, name FROM hlt_sellers WHERE id = $1 FOR UPDATE`, [id]);
      if (!s || !['TENANT', 'BRAND'].includes(s.type)) throw new NotFound('입점 판매자를 찾을 수 없습니다.');
      if (!m.from.includes(s.status)) throw new StateConflict('BAD_STATE', `지금 상태(${s.status})에서는 할 수 없습니다.`);
      if (action === 'CLOSE') {
        const b = await this.closeBlockers(id);
        if (b.why.length) throw new StateConflict('SELLER_OPEN_WORK', `폐점 전에 끝낼 일이 있습니다 — ${b.why.join(' · ')}. 급하면 「정지」나 「이용 제한」을 쓰십시오.`);
      }
      await this.db.query(
        `UPDATE hlt_sellers SET status = $2, status_reason = $3, status_by = $4, updated_at = now() WHERE id = $1`,
        [id, m.to, reason, this.me]);
      const [p] = await this.db.query<{ onSale: number; offBySeller: number }>(
        `SELECT count(*) FILTER (WHERE status = 'ON_SALE')::int AS "onSale", count(*) FILTER (WHERE off_by_seller_at IS NOT NULL)::int AS "offBySeller"
           FROM hlt_products WHERE seller_id = $1`, [id]);
      const tail = action === 'RESUME' ? ' 정지 때 내린 상품 중 판매 조건이 맞는 것은 다시 판매합니다.'
        : action === 'CLOSE' ? ' 다시 입점하려면 새로 신청하시면 됩니다.'
        : action === 'BLOCK' ? ' 다시 신청할 수 없습니다. 궁금한 점은 고객센터로 문의해 주십시오.'
        : ' 정지 중에는 상품이 판매되지 않습니다. 궁금한 점은 고객센터로 문의해 주십시오.';
      await this.notify(id, m.code, m.title, `사유: ${reason} —${tail}`, action === 'PAUSE' || action === 'RESUME' ? '/health/seller/center' : '/health/seller');
      const done: Record<SellerAction, string> = { PAUSE: '판매를 일시 정지했습니다', RESUME: '판매를 다시 열었습니다', BLOCK: '이용을 제한했습니다', CLOSE: '폐점 처리했습니다' };
      return { ok: true, status: m.to, onSale: p?.onSale ?? 0, offBySeller: p?.offBySeller ?? 0, note: `${s.name} — ${done[action]}.` };
    });
  }

  /** 운영 — 이 판매자만의 수수료율(null 이면 갈래 기본값) · 사유 · 새 주문부터 */
  async setRate(id: string, rate: number | null, reasonRaw: string) {
    const reason = String(reasonRaw ?? '').trim();
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '바꾸는 사유를 적어 주십시오 — 판매자에게 알리고 기록에 남습니다.');
    if (rate !== null && !(rate >= 0 && rate <= 50)) throw new PolicyViolation('BAD_RATE', '수수료율은 0 ~ 50% 사이로 적어 주십시오.');
    return this.db.transaction(async () => {
      const [s] = await this.db.query<{ rate: string | null; type: string; status: string }>(
        `SELECT commission_rate AS rate, type, status FROM hlt_sellers WHERE id = $1 FOR UPDATE`, [id]);
      if (!s || !['TENANT', 'BRAND'].includes(s.type)) throw new NotFound('입점 판매자를 찾을 수 없습니다.');
      if (!['ACTIVE', 'PAUSED'].includes(s.status)) throw new StateConflict('BAD_STATE', '판매 중이거나 정지된 판매자만 수수료율을 바꿉니다.');
      const from = s.rate === null ? null : Number(s.rate);
      if (from === rate) throw new StateConflict('SAME_RATE', '지금과 같은 수수료율입니다.');
      await this.db.query(`UPDATE hlt_sellers SET commission_rate = $2, updated_at = now() WHERE id = $1`, [id, rate]);
      await this.db.query(
        `INSERT INTO hlt_seller_rate_changes (seller_id, from_rate, to_rate, reason, changed_by) VALUES ($1, $2, $3, $4, $5)`,
        [id, from, rate, reason, this.me]);
      const show = (v: number | null) => (v === null ? '기본 수수료율' : `${v}%`);
      await this.notify(id, 'SELLER_RATE_CHANGED', '판매 수수료율이 바뀌었습니다',
        `${show(from)} → ${show(rate)} · 사유: ${reason} — 바뀐 뒤 들어오는 주문부터 적용합니다(이미 받은 주문은 그대로).`, '/health/seller/center');
      return { ok: true, from, to: rate, note: '수수료율을 바꿨습니다. 새 주문부터 적용합니다.' };
    });
  }

  /** 운영 — 판매자 한 곳의 수수료율 기록 · 상태 사유 */
  async history(id: string) {
    const [s] = await this.db.query(
      `SELECT id, code, name, status, status_reason AS "statusReason", status_at AS "statusAt", commission_rate AS "commissionRate"
         FROM hlt_sellers WHERE id = $1 AND type IN ('TENANT','BRAND')`, [id]);
    if (!s) throw new NotFound('입점 판매자를 찾을 수 없습니다.');
    const rates = await this.db.query(
      `SELECT r.from_rate AS "from", r.to_rate AS "to", r.reason, r.changed_at AS "at", a.name AS "by"
         FROM hlt_seller_rate_changes r LEFT JOIN accounts a ON a.id = r.changed_by
        WHERE r.seller_id = $1 ORDER BY r.changed_at DESC LIMIT 50`, [id]);
    const changes = await this.db.query(
      `SELECT id, fields, note, state, reason, requested_at AS "requestedAt", decided_at AS "decidedAt"
         FROM hlt_seller_change_requests WHERE seller_id = $1 ORDER BY requested_at DESC LIMIT 20`, [id]);
    return { ...s, blockers: (await this.closeBlockers(id)).why, rates, changes };
  }

  /** 운영 — 대기 중인 정보 변경 요청(지금 값과 나란히) */
  changeRequests() {
    return this.db.query(
      `SELECT c.id, c.fields, c.note, c.requested_at AS "requestedAt",
              s.id AS "sellerId", s.code, s.name, s.status,
              json_build_object('name', s.name, 'ceoName', s.ceo_name, 'bizRegNo', s.biz_reg_no, 'ecomRegNo', s.ecom_reg_no,
                                'csTel', s.cs_tel, 'returnAddr', s.return_addr, 'addr', s.addr,
                                'licenses', coalesce((SELECT json_agg(json_build_object('kind', l.kind, 'licenseNo', l.license_no, 'expiresAt', l.expires_at) ORDER BY l.kind)
                                                        FROM hlt_seller_licenses l WHERE l.seller_id = s.id), '[]'::json)) AS "current"
         FROM hlt_seller_change_requests c JOIN hlt_sellers s ON s.id = c.seller_id
        WHERE c.state = 'PENDING' ORDER BY c.requested_at`);
  }

  /** 운영 — 정보 변경 승인(그대로 반영 · 서류는 새 목록으로 바꾸고 확인한 것으로) · 반려(사유는 판매자에게) */
  async decideChange(id: string, approve: boolean, reasonRaw?: string) {
    const reason = String(reasonRaw ?? '').trim();
    if (!approve && reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오 — 판매자에게 그대로 보입니다.');
    return this.db.transaction(async () => {
      const [c] = await this.db.query<{ seller_id: string; fields: Record<string, unknown>; state: string }>(
        `SELECT seller_id, fields, state FROM hlt_seller_change_requests WHERE id = $1 FOR UPDATE`, [id]);
      if (!c) throw new NotFound('정보 변경 요청을 찾을 수 없습니다.');
      if (c.state !== 'PENDING') throw new StateConflict('NOT_PENDING', '대기 중인 요청이 아닙니다.');
      if (approve) {
        const sets: string[] = []; const args: unknown[] = [c.seller_id];
        for (const [k, col] of Object.entries(COL)) {
          if (!(k in c.fields)) continue;
          const v = c.fields[k];
          args.push(v === '' || v === undefined ? null : v);
          sets.push(`${col} = $${args.length}`);
        }
        if (sets.length) await this.db.query(`UPDATE hlt_sellers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
        const lic = c.fields.licenses as License[] | undefined;
        if (Array.isArray(lic)) {
          await this.db.query(`DELETE FROM hlt_seller_licenses WHERE seller_id = $1`, [c.seller_id]);
          for (const l of lic) {
            await this.db.query(
              `INSERT INTO hlt_seller_licenses (seller_id, kind, license_no, issued_at, expires_at, verified_by, verified_at)
               VALUES ($1, $2, $3, $4, $5, $6, now())`, [c.seller_id, l.kind, l.licenseNo, l.issuedAt || null, l.expiresAt || null, this.me]);
          }
        }
      }
      await this.db.query(
        `UPDATE hlt_seller_change_requests SET state = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
        [id, approve ? 'APPROVED' : 'REJECTED', approve ? null : reason, this.me]);
      await this.notify(c.seller_id, approve ? 'SELLER_CHANGE_APPROVED' : 'SELLER_CHANGE_REJECTED',
        approve ? '판매자 정보 변경이 승인되었습니다' : '판매자 정보 변경 요청이 반려되었습니다',
        approve ? '요청하신 정보로 바꿨습니다.' : `사유: ${reason} — 고쳐서 다시 요청하실 수 있습니다.`, '/health/seller/center');
      return { ok: true, state: approve ? 'APPROVED' : 'REJECTED' };
    });
  }

  /* ── 판매자 본인 ──────────────────────────────────────────────────── */

  private async mine() {
    const [s] = await this.db.query<{ id: string; status: string; name: string }>(
      `SELECT id, status, name FROM hlt_sellers WHERE account_id = $1 AND type IN ('TENANT','BRAND') AND status IN ('ACTIVE','PAUSED')`, [this.me]);
    if (!s) throw new Forbidden('NOT_SELLER', '입점 승인된 판매자만 할 수 있습니다.');
    return s;
  }

  /** 판매자센터 — 상태 사유 · 최근 정보 변경 요청 · 폐점을 막는 것 */
  async account() {
    const s = await this.mine();
    const [r] = await this.db.query<{ statusReason: string | null; statusAt: string | null }>(
      `SELECT status_reason AS "statusReason", status_at AS "statusAt" FROM hlt_sellers WHERE id = $1`, [s.id]);
    const [change] = await this.db.query(
      `SELECT id, fields, note, state, reason, requested_at AS "requestedAt", decided_at AS "decidedAt"
         FROM hlt_seller_change_requests WHERE seller_id = $1 ORDER BY requested_at DESC LIMIT 1`, [s.id]);
    return { status: s.status, statusReason: s.status === 'PAUSED' ? r?.statusReason ?? null : null, statusAt: r?.statusAt ?? null,
      change: change ?? null, closeBlockers: (await this.closeBlockers(s.id)).why };
  }

  /** 판매자 — 정보 변경 요청(대기 1건 · 같은 값이면 안 받음) */
  async requestChange(fields: Record<string, unknown>, note?: string) {
    const s = await this.mine();
    const clean: Record<string, unknown> = {};
    for (const k of CHANGE_KEYS) {
      if (fields[k] === undefined) continue;
      if (k === 'licenses') {
        const lic = fields[k] as License[];
        if (!Array.isArray(lic) || lic.length > 10 || lic.some((l) => !(SELLER_LICENSE_KINDS as readonly string[]).includes(l?.kind) || String(l?.licenseNo ?? '').trim().length < 2)) {
          throw new PolicyViolation('BAD_LICENSES', '서류는 종류와 번호(2자 이상)를 적어 10개까지 내 주십시오.');
        }
        clean.licenses = lic.map((l) => ({ kind: l.kind, licenseNo: String(l.licenseNo).trim(), issuedAt: l.issuedAt || null, expiresAt: l.expiresAt || null }));
      } else {
        clean[k] = String(fields[k] ?? '').trim();
      }
    }
    if (!Object.keys(clean).length) throw new PolicyViolation('NO_CHANGE', '바꿀 내용을 적어 주십시오.');
    if (clean.bizRegNo && !/^[0-9]{3}-[0-9]{2}-[0-9]{5}$/.test(String(clean.bizRegNo))) throw new PolicyViolation('BAD_BIZ_REG', '사업자등록번호는 123-45-67890 모양으로 적어 주십시오.');
    if (clean.name !== undefined && String(clean.name).length < 2) throw new PolicyViolation('BAD_NAME', '상호는 2자 이상으로 적어 주십시오.');
    const [busy] = await this.db.query(`SELECT 1 FROM hlt_seller_change_requests WHERE seller_id = $1 AND state = 'PENDING'`, [s.id]);
    if (busy) throw new StateConflict('CHANGE_PENDING', '이미 심사 중인 정보 변경 요청이 있습니다 — 결과가 나온 뒤 다시 요청하십시오.');
    try {
      await this.db.query(
        `INSERT INTO hlt_seller_change_requests (seller_id, fields, note, requested_by) VALUES ($1, $2::jsonb, $3, $4)`,
        [s.id, JSON.stringify(clean), note?.trim() || null, this.me]);
    } catch (e) {
      if (String((e as Error)?.message ?? '').includes('uq_hlt_change_pending')) throw new StateConflict('CHANGE_PENDING', '이미 심사 중인 정보 변경 요청이 있습니다 — 결과가 나온 뒤 다시 요청하십시오.');
      throw e;
    }
    return this.account();
  }

  /** 판매자 — 대기 중인 정보 변경 요청 거두기 */
  async cancelChange() {
    const s = await this.mine();
    const r = await this.db.query(
      `UPDATE hlt_seller_change_requests SET state = 'CANCELLED', decided_at = now() WHERE seller_id = $1 AND state = 'PENDING' RETURNING id`, [s.id]);
    if (!r.length) throw new StateConflict('NOT_PENDING', '대기 중인 요청이 없습니다.');
    return this.account();
  }

  /** 판매자 — 폐점(탈퇴). 끝낼 일이 있으면 막음 · 다시 입점은 새로 신청 */
  async closeSelf(reasonRaw?: string) {
    const s = await this.mine();
    const b = await this.closeBlockers(s.id);
    if (b.why.length) throw new StateConflict('SELLER_OPEN_WORK', `폐점 전에 끝낼 일이 있습니다 — ${b.why.join(' · ')}.`);
    const reason = `본인 폐점 신청${String(reasonRaw ?? '').trim() ? ` — ${String(reasonRaw).trim().slice(0, 200)}` : ''}`;
    await this.db.query(
      `UPDATE hlt_sellers SET status = 'CLOSED', status_reason = $2, status_by = $3, updated_at = now() WHERE id = $1 AND status IN ('ACTIVE','PAUSED')`,
      [s.id, reason, this.me]);
    await this.notify(s.id, 'SELLER_CLOSED', '소개몰 폐점이 처리되었습니다', '판매 중이던 상품을 모두 내렸습니다. 다시 입점하려면 새로 신청하시면 됩니다.', '/health/seller');
    return { ok: true, status: 'CLOSED', note: '폐점했습니다. 판매 중이던 상품을 모두 내렸습니다.' };
  }
}
