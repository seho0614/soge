import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { SMX_KEYS, ZIP_RE, smxNum, smxOn, smxWon } from './common';
import { SmxRemoteZoneSaveDto } from './smx.dto';

/* ---------------------------------------------------------------------
 * v10.554 (D287 · docs/692) ② 도서산간 배송비
 *   구역 표(우편번호 처음 ~ 끝 · 금액) — 운영이 정함 · 겹치면 큰 금액 하나(fn_smx_remote_fee)
 *   주문   health-checkout.service.ts 의 order() 에서 smxRemoteQuote → ship_fee 에 더하고 remote_ship_fee · remote_zone 에 따로 적음
 *          (주문 금액 규칙 total = 상품 + 배송비 − 할인 … 은 그대로 · 주문 뒤 바꾸지 못함 — DB)
 *   범위   직판 · 입점 판매자 주문 모두(대표 11/21) — 직판은 기본 배송비 0 + 추가 몫 · 입점은 판매자 배송비 + 추가 몫(둘 다 판매자 몫으로 정산 — 11/21 대표 · D287 이 v_hlt_settle_ready 의 goods_amount 에 더함 · base_ship_fee · remote_ship_fee 칸)
 *   세무   면세 상품만 담은 직판 주문의 추가 몫은 면세 · 섞이면 상품 금액 비율로 나눔(fn_smx_remote_exempt · smx.remote_tax_mode RATIO · SUPER 가 TAXABLE 로 바꿈) — 현금영수증 · 직판 매출 전표가 씀
 *   주문서 GET /me/health/remote-fee?addressId= 로 미리 보여 줌(주문 때 서버가 다시 셈)
 * ------------------------------------------------------------------- */

export interface SmxRemote { fee: number; zone: string | null }

/** 주문 때 — 스위치 on · 내 배송지 우편번호가 구역에 들면 그 금액(아니면 0) · 직판 · 입점 모두(판매자가 없으면 0) */
export async function smxRemoteQuote(db: DatabaseService, addressId: unknown, me: string, sellerType?: string | null): Promise<SmxRemote> {
  if (!sellerType) return { fee: 0, zone: null };
  if (!(await smxOn(db, SMX_KEYS.remote))) return { fee: 0, zone: null };
  const [r] = await db.query<{ fee: number | null; zone: string | null }>(
    `SELECT f.fee, f.zone_name AS zone
       FROM hlt_addresses a CROSS JOIN LATERAL fn_smx_remote_fee(a.zipcode) f
      WHERE a.id::text = $1 AND a.account_id = $2 AND a.deleted_at IS NULL`, [String(addressId ?? ''), me]);
  const fee = smxNum(r?.fee);
  return fee > 0 ? { fee, zone: r?.zone ?? null } : { fee: 0, zone: null };
}

/** 주문 응답 안내 — 도서산간 몫이 붙었을 때(문장은 통째로 · 번역 틀이 한 문장씩 맞춤) · base = 판매자 기본 배송비(직판 0) */
export function smxRemoteNote(fee: number, discount: number, base = 0): string {
  if (base > 0) return `배송비 ${smxWon(base + fee)}원이 포함되어 있습니다(판매자 배송비 ${smxWon(base)}원 · 도서산간 추가 ${smxWon(fee)}원).`;
  return discount > 0
    ? `도서산간 추가 배송비 ${smxWon(fee)}원이 붙었습니다(직판 상품 기본 배송비는 없습니다). 쿠폰 ${smxWon(discount)}원 할인.`
    : `도서산간 추가 배송비 ${smxWon(fee)}원이 붙었습니다(직판 상품 기본 배송비는 없습니다).`;
}

/** GET /me/health/remote-fee?addressId= — 주문서 미리보기(판매자 하나인 장바구니면 화면이 부름 · 직판 · 입점 같은 금액) */
export async function remoteFeeMine(db: DatabaseService, addressId: string) {
  const me = RequestCtx.actorId()!;
  const on = await smxOn(db, SMX_KEYS.remote);
  const [a] = await db.query<{ id: string }>(`SELECT id FROM hlt_addresses WHERE id::text = $1 AND account_id = $2 AND deleted_at IS NULL`, [addressId, me]);
  if (!a) throw new NotFound('없는 배송지입니다.');
  const q = await smxRemoteQuote(db, addressId, me, 'ANY');
  return { on, fee: q.fee, zone: q.zone, note: q.fee > 0 ? `도서산간 추가 배송비 ${smxWon(q.fee)}원이 붙습니다.` : '추가 배송비가 없습니다.' };
}

/* ── 운영 ── */

/** GET /admin/smx/remote-zones — 구역 표 · 스위치 · 최근 30일 붙은 주문 수 · 금액 */
export async function remoteZones(db: DatabaseService) {
  const on = await smxOn(db, SMX_KEYS.remote);
  const items = await db.query<Record<string, unknown>>(
    `SELECT id, name, kind, zip_from AS "zipFrom", zip_to AS "zipTo", fee, is_active AS "isActive", memo, updated_at AS "updatedAt"
       FROM smx_remote_zones ORDER BY zip_from, zip_to LIMIT 500`);
  const [s] = await db.query<{ n: number; amt: string }>(
    `SELECT count(*)::int AS n, coalesce(sum(remote_ship_fee), 0)::text AS amt FROM hlt_orders WHERE remote_ship_fee > 0 AND created_at > now() - interval '30 days'`);
  return { on, items, orders30: smxNum(s?.n), amount30: smxNum(s?.amt),
    note: on ? '도서산간 배송비가 켜져 있습니다 — 주문 배송지 우편번호가 켠 구역에 들면 배송비에 더합니다(입점 판매자 주문은 판매자 몫으로 정산).' : '도서산간 배송비가 꺼져 있습니다(smx.remote_ship) — 구역 표는 만들어 두기만 하고 주문에는 붙지 않습니다.' };
}

/** GET /admin/smx/remote-zones/check?zip= — 우편번호 하나로 맞는 구역 · 금액 확인(스위치와 상관없이 표만 봄) */
export async function remoteCheck(db: DatabaseService, zip: string) {
  if (!ZIP_RE.test(zip ?? '')) throw new PolicyViolation('SMX_REMOTE_ZIP', '우편번호는 숫자 5자리로 주십시오.');
  const [r] = await db.query<{ zoneId: string; zoneName: string; fee: number }>(`SELECT zone_id AS "zoneId", zone_name AS "zoneName", fee FROM fn_smx_remote_fee($1)`, [zip]);
  return { zip, zoneId: r?.zoneId ?? null, zone: r?.zoneName ?? null, fee: smxNum(r?.fee) };
}

function zoneArgs(dto: SmxRemoteZoneSaveDto) {
  if (dto.zipFrom > dto.zipTo) throw new PolicyViolation('SMX_REMOTE_ZIP', '우편번호 처음이 끝보다 클 수 없습니다.');
  return [dto.name.trim(), dto.kind, dto.zipFrom, dto.zipTo, dto.fee, dto.isActive !== false, dto.memo?.trim() || null, RequestCtx.actorId() ?? null];
}

/** POST /admin/smx/remote-zones */
export async function remoteCreate(db: DatabaseService, dto: SmxRemoteZoneSaveDto) {
  const [dup] = await db.query<{ id: string }>(`SELECT id FROM smx_remote_zones WHERE zip_from = $1 AND zip_to = $2`, [dto.zipFrom, dto.zipTo]);
  if (dup) throw new StateConflict('SMX_REMOTE_DUP', '같은 우편번호 범위의 구역이 이미 있습니다 — 그 줄을 고치십시오.');
  const [z] = await db.query<{ id: string }>(
    `INSERT INTO smx_remote_zones (name, kind, zip_from, zip_to, fee, is_active, memo, updated_by) VALUES ($1, $2, $3, $4, $5::int, $6::boolean, $7, $8) RETURNING id`, zoneArgs(dto));
  return { id: z.id, note: '구역을 더했습니다.' };
}

/** PUT /admin/smx/remote-zones/{id} — 이미 받은 주문의 금액은 그대로(주문 때 복사) */
export async function remoteUpdate(db: DatabaseService, id: string, dto: SmxRemoteZoneSaveDto) {
  const [dup] = await db.query<{ id: string }>(`SELECT id FROM smx_remote_zones WHERE zip_from = $1 AND zip_to = $2 AND id <> $3`, [dto.zipFrom, dto.zipTo, id]);
  if (dup) throw new StateConflict('SMX_REMOTE_DUP', '같은 우편번호 범위의 구역이 이미 있습니다 — 그 줄을 고치십시오.');
  const n = await db.query<{ id: string }>(
    `UPDATE smx_remote_zones SET name = $1, kind = $2, zip_from = $3, zip_to = $4, fee = $5::int, is_active = $6::boolean, memo = $7, updated_by = $8 WHERE id = $9 RETURNING id`,
    [...zoneArgs(dto), id]);
  if (!n.length) throw new NotFound('없는 구역입니다.');
  return { id, note: '구역을 고쳤습니다(이미 받은 주문은 그대로).' };
}

/** DELETE /admin/smx/remote-zones/{id} — 주문에는 구역 이름이 복사돼 있어 지워도 주문 기록은 그대로 */
export async function remoteDelete(db: DatabaseService, id: string) {
  const n = await db.query<{ id: string }>(`DELETE FROM smx_remote_zones WHERE id = $1 RETURNING id`, [id]);
  if (!n.length) throw new NotFound('없는 구역입니다.');
  return { id, deleted: true, note: '구역을 지웠습니다.' };
}
