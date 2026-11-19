import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.408 (D249 · docs/545) 거래처 대장
 *   매입처 · 매출처를 한 곳에 — 사업자번호(하나에 한 거래처) · 담당 · 계좌는 은행 이름 + 끝 4자리만(개인정보 최소).
 *   연결: 광고주(advertisers) · 입점 판매자(hlt_sellers · DIRECT 빼고) · 매입(⑫ acct_purchases.supplier_biz_no 같은 번호).
 *   「가져오기」(SUPER) — 광고주 · 입점 판매자 · 매입 공급자 중 아직 없는 것을 한 번에(사업자번호 · 연결 번호로 겹침 막음 · 다시 눌러도 같음).
 *   거래처 한 곳 보기 — 매입 합계(⑫) · 광고 청구 · 입금 · 입점 정산 수수료 · 계약(v10.409) · 수입(v10.411).
 *   지우지 않음(닫기만).
 * ------------------------------------------------------------------- */

export const PARTY_KINDS = ['SUPPLIER', 'CUSTOMER', 'BOTH'] as const;
export const PARTY_KIND_KO: Record<string, string> = { SUPPLIER: '매입처', CUSTOMER: '매출처', BOTH: '매입 · 매출' };

const n = (v: unknown) => Number(v ?? 0);
const has = async (db: DatabaseService, t: string) => (await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]))[0]?.ok === true;
const digits = (s?: string | null) => (s ?? '').replace(/[^0-9]/g, '');

export interface PartyInput {
  kind: string; name: string; bizNo?: string; contactName?: string; contactPhone?: string; contactEmail?: string;
  bankName?: string; accountLast4?: string; advertiserId?: string; sellerId?: string; memo?: string; state?: string;
}

function check(b: PartyInput) {
  if (!(PARTY_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('PARTY_KIND', '거래처 종류(매입처 · 매출처 · 둘 다)를 고르십시오.');
  const name = (b.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) throw new PolicyViolation('PARTY_NAME', '거래처 이름은 1 ~ 120자입니다.');
  const bizNo = digits(b.bizNo);
  if (bizNo && bizNo.length !== 10) throw new PolicyViolation('PARTY_BIZNO', '사업자등록번호는 숫자 10자리입니다.');
  const last4 = digits(b.accountLast4);
  if (b.accountLast4 && last4.length !== 4) throw new PolicyViolation('PARTY_ACCOUNT', '계좌는 끝 4자리 숫자만 적습니다.');
  const phone = (b.contactPhone ?? '').trim();
  if (phone && !/^[0-9-]{7,20}$/.test(phone)) throw new PolicyViolation('PARTY_PHONE', '담당 전화는 숫자 · 하이픈 7 ~ 20자입니다.');
  const email = (b.contactEmail ?? '').trim();
  if (email && (email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw new PolicyViolation('PARTY_EMAIL', '담당 메일 주소가 맞지 않습니다.');
  const uuid = (v?: string) => { const t = (v ?? '').trim(); if (t && !/^[0-9a-f-]{36}$/i.test(t)) throw new PolicyViolation('PARTY_LINK', '연결 번호가 맞지 않습니다.'); return t || null; };
  return { kind: b.kind, name, bizNo: bizNo || null, contactName: (b.contactName ?? '').trim().slice(0, 40) || null, contactPhone: phone || null, contactEmail: email || null,
           bankName: (b.bankName ?? '').trim().slice(0, 20) || null, accountLast4: last4 || null, advertiserId: uuid(b.advertiserId), sellerId: uuid(b.sellerId),
           memo: (b.memo ?? '').trim().slice(0, 200) || null };
}

async function dupCheck(db: DatabaseService, v: ReturnType<typeof check>, id: string | null) {
  const [d] = await db.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM acct_parties
      WHERE ($1::bigint IS NULL OR id <> $1::bigint)
        AND ((biz_no IS NOT NULL AND biz_no = $2) OR (advertiser_id IS NOT NULL AND advertiser_id = $3::uuid) OR (seller_id IS NOT NULL AND seller_id = $4::uuid)) LIMIT 1`,
    [id, v.bizNo, v.advertiserId, v.sellerId]);
  if (d) throw new StateConflict('PARTY_DUP', `같은 사업자번호 · 연결의 거래처(${d.id}번 ${d.name})가 이미 있습니다.`);
}

/** POST /admin/acct/parties */
export async function addParty(db: DatabaseService, b: PartyInput, actor: string | null) {
  const v = check(b);
  await dupCheck(db, v, null);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_parties (kind, name, biz_no, contact_name, contact_phone, contact_email, bank_name, account_last4, advertiser_id, seller_id, memo, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid, $11, $12, $12) RETURNING id::text AS id`,
    [v.kind, v.name, v.bizNo, v.contactName, v.contactPhone, v.contactEmail, v.bankName, v.accountLast4, v.advertiserId, v.sellerId, v.memo, actor]);
  return { ok: true, id: r!.id, note: '거래처를 넣었습니다.' };
}

/** PATCH /admin/acct/parties/{id} — 모든 칸 · 닫기(state CLOSED) · 다시 열기 */
export async function updateParty(db: DatabaseService, id: string, b: PartyInput, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 거래처입니다.');
  const [cur] = await db.query(`SELECT 1 FROM acct_parties WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 거래처입니다.');
  const v = check(b);
  await dupCheck(db, v, id);
  const state = b.state === 'CLOSED' ? 'CLOSED' : 'ACTIVE';
  await db.query(
    `UPDATE acct_parties SET kind = $2, name = $3, biz_no = $4, contact_name = $5, contact_phone = $6, contact_email = $7, bank_name = $8, account_last4 = $9,
            advertiser_id = $10::uuid, seller_id = $11::uuid, memo = $12, state = $13, updated_by = $14 WHERE id = $1::bigint`,
    [id, v.kind, v.name, v.bizNo, v.contactName, v.contactPhone, v.contactEmail, v.bankName, v.accountLast4, v.advertiserId, v.sellerId, v.memo, state, actor]);
  return { ok: true, id, note: state === 'CLOSED' ? '거래처를 닫았습니다(기록은 남음).' : '거래처를 고쳤습니다.' };
}

/** GET /admin/acct/parties?q=&kind=&state= */
export async function listParties(db: DatabaseService, q?: string, kind?: string, state?: string) {
  const pur = await has(db, 'acct_purchases');
  const items = await db.query(
    `SELECT p.id::text AS id, p.kind, p.name, p.biz_no AS "bizNo", p.contact_name AS "contactName", p.contact_phone AS "contactPhone", p.contact_email AS "contactEmail",
            p.bank_name AS "bankName", p.account_last4 AS "accountLast4", p.advertiser_id AS "advertiserId", a.name AS "advertiserName",
            p.seller_id AS "sellerId", s.name AS "sellerName", p.memo, p.state, p.updated_at AS "updatedAt",
            ${pur ? `(SELECT coalesce(sum(x.total), 0)::bigint FROM acct_purchases x WHERE x.state = 'ACTIVE' AND p.biz_no IS NOT NULL AND x.supplier_biz_no = p.biz_no)` : '0::bigint'} AS "purchaseTotal",
            (SELECT coalesce(sum(i.total), 0)::bigint FROM ad_invoices i WHERE p.advertiser_id IS NOT NULL AND i.advertiser_id = p.advertiser_id AND i.status <> 'VOID') AS "adTotal"
       FROM acct_parties p LEFT JOIN advertisers a ON a.id = p.advertiser_id LEFT JOIN hlt_sellers s ON s.id = p.seller_id
      WHERE ($1::text = '' OR lower(p.name) LIKE '%' || lower($1) || '%' OR p.biz_no = regexp_replace($1, '[^0-9]', '', 'g'))
        AND ($2::text = '' OR p.kind = $2 OR p.kind = 'BOTH') AND ($3::text = '' OR p.state = $3)
      ORDER BY p.state, lower(p.name) LIMIT 500`,
    [(q ?? '').trim(), (PARTY_KINDS as readonly string[]).includes(kind ?? '') ? kind : '', state === 'CLOSED' || state === 'ACTIVE' ? state : '']);
  return { items, kinds: PARTY_KIND_KO,
           note: '계좌는 은행 이름과 끝 4자리만 적습니다(통장 사본은 받지 않음). 사업자번호 하나에 거래처 하나 — 「가져오기」로 광고주 · 입점 판매자 · 매입 공급자를 한 번에 넣을 수 있습니다.' };
}

/** GET /admin/acct/parties/{id} — 한 곳 보기 · 거래 합계 */
export async function partyDetail(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 거래처입니다.');
  const [p] = await db.query<any>(
    `SELECT id::text AS id, kind, name, biz_no AS "bizNo", contact_name AS "contactName", contact_phone AS "contactPhone", contact_email AS "contactEmail",
            bank_name AS "bankName", account_last4 AS "accountLast4", advertiser_id AS "advertiserId", seller_id AS "sellerId", memo, state, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM acct_parties WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  const purchases = p.bizNo && await has(db, 'acct_purchases') ? await db.query(
    `SELECT id::text AS id, kind, issued_on::text AS "issuedOn", item, total::bigint AS total, state FROM acct_purchases WHERE supplier_biz_no = $1 ORDER BY issued_on DESC, id DESC LIMIT 50`, [p.bizNo]) : [];
  const ads = p.advertiserId ? await db.query(
    `SELECT i.id::text AS id, i.invoice_no AS "invoiceNo", i.created_at AS "createdAt", i.total::bigint AS total, i.status,
            (SELECT coalesce(sum(x.amount), 0)::bigint FROM ad_payments x WHERE x.invoice_id = i.id) AS paid
       FROM ad_invoices i WHERE i.advertiser_id = $1::uuid ORDER BY i.created_at DESC LIMIT 50`, [p.advertiserId]) : [];
  const settlements = p.sellerId ? await db.query(
    `SELECT id::text AS id, period_from::text AS "periodFrom", period_to::text AS "periodTo", status, commission::bigint AS commission
       FROM hlt_settlements WHERE seller_id = $1::uuid ORDER BY period_to DESC LIMIT 50`, [p.sellerId]) : [];
  const contracts = await has(db, 'acct_contracts') ? await db.query(
    `SELECT id::text AS id, title, kind, start_on::text AS "startOn", end_on::text AS "endOn", monthly_amount::bigint AS "monthlyAmount", state FROM acct_contracts WHERE party_id = $1::bigint ORDER BY id DESC LIMIT 50`, [id]) : [];
  const imports = await has(db, 'acct_imports') ? await db.query(
    `SELECT id::text AS id, title, state, ordered_on::text AS "orderedOn", goods_krw::bigint AS "goodsKrw" FROM acct_imports WHERE party_id = $1::bigint ORDER BY id DESC LIMIT 50`, [id]) : [];
  const sum = (xs: any[], k: string, f: (x: any) => boolean = () => true) => xs.filter(f).reduce((a, x) => a + n(x[k]), 0);
  return { party: p, purchases, ads, settlements, contracts, imports,
           total: { purchase: sum(purchases, 'total', (x) => x.state === 'ACTIVE'), ad: sum(ads, 'total', (x) => x.status !== 'VOID'), adPaid: sum(ads, 'paid'), commission: sum(settlements, 'commission') } };
}

/** POST /admin/acct/parties/import — 광고주 · 입점 판매자 · 매입 공급자 중 없는 것 넣기(SUPER · 다시 눌러도 같음) */
export async function importParties(db: DatabaseService, actor: string | null) {
  const adv = await db.query(
    `INSERT INTO acct_parties (kind, name, biz_no, advertiser_id, memo, created_by, updated_by)
     SELECT 'CUSTOMER', left(a.name, 120), CASE WHEN length(regexp_replace(coalesce(a.biz_reg_no, ''), '[^0-9]', '', 'g')) = 10 THEN regexp_replace(a.biz_reg_no, '[^0-9]', '', 'g') END,
            a.id, '광고주에서 가져옴', $1, $1
       FROM advertisers a
      WHERE NOT EXISTS (SELECT 1 FROM acct_parties p WHERE p.advertiser_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM acct_parties p WHERE p.biz_no IS NOT NULL AND p.biz_no = regexp_replace(coalesce(a.biz_reg_no, ''), '[^0-9]', '', 'g'))
     ON CONFLICT DO NOTHING RETURNING id`, [actor]);
  const sel = await db.query(
    `INSERT INTO acct_parties (kind, name, biz_no, seller_id, memo, created_by, updated_by)
     SELECT 'CUSTOMER', left(s.name, 120), CASE WHEN length(regexp_replace(coalesce(s.biz_reg_no, ''), '[^0-9]', '', 'g')) = 10 THEN regexp_replace(s.biz_reg_no, '[^0-9]', '', 'g') END,
            s.id, '입점 판매자에서 가져옴', $1, $1
       FROM hlt_sellers s
      WHERE s.type <> 'DIRECT' AND NOT EXISTS (SELECT 1 FROM acct_parties p WHERE p.seller_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM acct_parties p WHERE p.biz_no IS NOT NULL AND p.biz_no = regexp_replace(coalesce(s.biz_reg_no, ''), '[^0-9]', '', 'g'))
     ON CONFLICT DO NOTHING RETURNING id`, [actor]);
  const pur = await has(db, 'acct_purchases') ? await db.query(
    `INSERT INTO acct_parties (kind, name, biz_no, memo, created_by, updated_by)
     SELECT DISTINCT ON (x.supplier_biz_no) 'SUPPLIER', left(x.supplier_name, 120), x.supplier_biz_no, '매입에서 가져옴', $1::uuid, $1::uuid
       FROM acct_purchases x
      WHERE x.supplier_biz_no IS NOT NULL AND NOT EXISTS (SELECT 1 FROM acct_parties p WHERE p.biz_no = x.supplier_biz_no)
      ORDER BY x.supplier_biz_no, x.id DESC
     ON CONFLICT DO NOTHING RETURNING id`, [actor]) : [];
  const made = adv.length + sel.length + pur.length;
  return { ok: true, made, advertisers: adv.length, sellers: sel.length, suppliers: pur.length,
           note: made ? `거래처 ${made}곳을 가져왔습니다(광고주 ${adv.length} · 입점 판매자 ${sel.length} · 매입 공급자 ${pur.length}).` : '새로 가져올 거래처가 없습니다.' };
}
