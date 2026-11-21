import { DatabaseService } from '../../db/database.service';
import { NotFound } from '../../core/errors';
import { grwSettings, num } from './common';

/* ---------------------------------------------------------------------
 * v10.601 (docs/743) ⑰ 매물 충실도 점수 · 등록 도우미 — 본인 매물에 「무엇을 더 적으면 좋은지」 안내만
 *   ★ 노출 순위 · 검색 순서 · 소개비 · 배지 · 검수 판정에 쓰지 않습니다. 점수를 DB 에 적지 않고 볼 때마다 셈(이 파일 밖에서 부르는 곳 = 컨트롤러뿐)
 *   이미 있는 것을 넓힘: 매물 칸(제목 · 한 줄 요약 · 본문 · 사진 listing_media · 지역 · 거래 금액 · 희망 소개비 · 연락 가능 시간)
 *     · 매물 AI 요약(lsx · v10.516)과 사진 점검(lsy · v10.526)은 따로 — 여기서는 칸이 비었는지만 봄(밖으로 나가는 것 없음 · AI 안 씀)
 *   항목 · 무게(합 100) — 바꿀 일이 생기면 이 표만(대표 결정 없이 정한 일반 안내 초안)
 * ------------------------------------------------------------------- */

export const FILL_ITEMS = [
  { code: 'TITLE', w: 10 },    // 제목 10 ~ 60자
  { code: 'SUMMARY', w: 10 },  // 한 줄 요약
  { code: 'BODY', w: 20 },     // 본문 200자 이상(80자 이상이면 절반)
  { code: 'PHOTO1', w: 15 },   // 사진 1장 이상
  { code: 'PHOTO3', w: 10 },   // 사진 3장 이상
  { code: 'REGION', w: 10 },   // 지역
  { code: 'AMOUNT', w: 10 },   // 거래 금액
  { code: 'FEE', w: 10 },      // 희망 소개비 · 부담 쪽
  { code: 'HOURS', w: 5 },     // 연락 가능 시간
] as const;
export type FillCode = (typeof FILL_ITEMS)[number]['code'];

export interface FillInput {
  title?: string | null; summary?: string | null; body?: string | null; photos?: number | null; region?: boolean | null;
  dealAmount?: string | number | null; desiredFee?: string | number | null; feeBearer?: string | null; contactHours?: string | null;
}

const len = (s: string | null | undefined) => [...String(s ?? '').trim()].length;
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** 점수 셈 — 순수 함수(DB · 밖으로 나가는 것 없음) */
export function fillScore(x: FillInput) {
  const photos = num(x.photos);
  const got: Record<FillCode, number> = {
    TITLE: len(x.title) >= 10 && len(x.title) <= 60 ? 10 : 0,
    SUMMARY: len(x.summary) >= 2 ? 10 : 0,
    BODY: len(x.body) >= 200 ? 20 : len(x.body) >= 80 ? 10 : 0,
    PHOTO1: photos >= 1 ? 15 : 0,
    PHOTO3: photos >= 3 ? 10 : 0,
    REGION: x.region ? 10 : 0,
    AMOUNT: has(x.dealAmount) ? 10 : 0,
    FEE: has(x.desiredFee) && has(x.feeBearer) ? 10 : 0,
    HOURS: len(x.contactHours) >= 2 ? 5 : 0,
  };
  const items = FILL_ITEMS.map((it) => ({ code: it.code, w: it.w, got: got[it.code], done: got[it.code] === it.w }));
  const score = items.reduce((a, b) => a + b.got, 0);
  return { score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', items, todo: items.filter((i) => !i.done).map((i) => i.code) };
}

const FIELDS = `
  SELECT l.id::text AS id, l.title, l.summary, l.body, l.status, l.deal_amount::text AS deal_amount, l.desired_fee::text AS desired_fee,
         l.fee_bearer, l.contact_hours, l.updated_at,
         (SELECT count(*) FROM listing_media m WHERE m.listing_id = l.id AND m.media_type = 'IMAGE')::int AS photos,
         (EXISTS (SELECT 1 FROM listing_regions r WHERE r.listing_id = l.id) OR coalesce(btrim(l.region_detail), '') <> '') AS region
    FROM listings l`;
interface Row {
  id: string; title: string | null; summary: string | null; body: string | null; status: string; deal_amount: string | null; desired_fee: string | null;
  fee_bearer: string | null; contact_hours: string | null; updated_at: string; photos: number; region: boolean;
}
const toInput = (r: Row): FillInput => ({ title: r.title, summary: r.summary, body: r.body, photos: r.photos, region: r.region,
  dealAmount: r.deal_amount, desiredFee: r.desired_fee, feeBearer: r.fee_bearer, contactHours: r.contact_hours });

/** GET /me/grw/listings — 내 매물(보관 빼고 최근 50) 점수 · 고칠 곳 */
export async function myListingsFill(db: DatabaseService, accountId: string) {
  const s = await grwSettings(db);
  const rows = await db.query<Row>(`${FIELDS} WHERE l.owner_account_id = $1::uuid AND l.status <> 'ARCHIVED' ORDER BY l.updated_at DESC LIMIT 50`, [accountId]);
  return {
    on: s.fillHelper,
    items: s.fillHelper ? rows.map((r) => ({ id: r.id, title: r.title, status: r.status, updatedAt: r.updated_at, ...fillScore(toInput(r)) })) : [],
    weights: FILL_ITEMS,
    note: '충실도 점수는 고칠 곳을 알려 드리는 안내일 뿐 — 노출 순서 · 검색 순위 · 소개비에는 쓰지 않습니다.',
  };
}

/** GET /me/grw/listings/{id}/fill — 내 매물 하나(남의 매물 · 없는 번호는 404) */
export async function myListingFill(db: DatabaseService, accountId: string, id: string) {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(id ?? ''))) throw new NotFound('매물을 찾을 수 없습니다.');
  const s = await grwSettings(db);
  const [r] = await db.query<Row>(`${FIELDS} WHERE l.id = $1::uuid AND l.owner_account_id = $2::uuid`, [id, accountId]);
  if (!r) throw new NotFound('매물을 찾을 수 없습니다.');
  return { on: s.fillHelper, id: r.id, status: r.status, ...fillScore(toInput(r)), note: '충실도 점수는 안내일 뿐 — 노출 순서 · 검색 순위 · 소개비에는 쓰지 않습니다.' };
}

/** GET /admin/grw/fill — 게시 중 매물 점수 나눔 · 많이 빠진 칸(숫자만 · 매물 · 회원 목록 없음) */
export async function fillStats(db: DatabaseService) {
  const s = await grwSettings(db);
  const rows = await db.query<Row>(`${FIELDS} WHERE l.status = 'PUBLISHED' ORDER BY l.updated_at DESC LIMIT 5000`);
  const scored = rows.map((r) => fillScore(toInput(r)));
  const bins = [['80-100', 80, 100], ['60-79', 60, 79], ['40-59', 40, 59], ['0-39', 0, 39]] as const;
  const missing = FILL_ITEMS.map((it) => ({ code: it.code, w: it.w, missing: scored.filter((x) => x.todo.includes(it.code)).length }));
  return {
    settings: { fillHelper: s.fillHelper }, listings: scored.length, sampled: rows.length >= 5000,
    avg: scored.length ? Math.round((10 * scored.reduce((a, b) => a + b.score, 0)) / scored.length) / 10 : null,
    bins: bins.map(([label, lo, hi]) => ({ label, n: scored.filter((x) => x.score >= lo && x.score <= hi).length })),
    missing, weights: FILL_ITEMS,
    note: '게시 중 매물(최근 5,000개)의 충실도 나눔입니다. 노출 순서 · 검색 순위 · 소개비 · 검수 판정에는 쓰지 않습니다.',
  };
}
