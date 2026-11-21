import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { parseCsv } from '../acct/bank';
import type { ListingService } from '../listing/listing.service';
import { lsqLine, lsqMask, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.602 (docs/744) ⑱ 매물 CSV 일괄 등록 — 미리보기 → 확정 → 검수 큐
 *
 *   받는 칸(머리줄 필수 · 순서 상관없음): gwan · category · title (필수) / summary · body · deal_amount · desired_fee · fee_bearer · region · region_detail (선택)
 *     gwan       관 코드(MNY · MAL · BIZ) 또는 관 이름(소개장터 …) — 소개몰(HLT)은 받지 않음(상품은 운영이 올림)
 *     category   승인된 업종 이름 · 코드 · id(그 관 안)
 *     region     시 · 도 이름(서울특별시 · 서울 …) — regions 표 시 · 도 코드로 바꿈
 *   이름 · 전화 · 주민번호 같은 칸은 받지 않음(개인정보 최소) · 글 안 연락처 · 메일 · 계좌 모양은 가려서 저장
 *   미리보기(PREVIEW · 24시간) — 줄마다 VALID · INVALID(문제 낱말 10개까지)
 *   확정 — VALID 줄만 하나씩 기존 매물 등록(ListingService.submit)을 부름 → IN_REVIEW · 검수 큐 · 자동검수 · 금칙어 · 제한업종 · 슬롯 한도 ·
 *          가입 24시간 회원 하루 상한은 그 함수 · DB 트리거가 판정(두 곳에 두지 않음) · 줄 하나가 실패해도 나머지는 계속(FAILED + 사유)
 *   스위치 lsq.bulk(처음 off) · 한 번에 lsq.bulk_max_rows(처음 50)줄 · 파일 200KB
 * ------------------------------------------------------------------- */

const CSV_MAX_BYTES = 200_000;
const HEAD_ALL = ['gwan', 'category', 'title', 'summary', 'body', 'deal_amount', 'desired_fee', 'fee_bearer', 'region', 'region_detail'] as const;
const HEAD_NEED = ['gwan', 'category', 'title'] as const;
const FEE_BEARERS = ['BUYER', 'SELLER', 'NEGOTIABLE'];
const BULK_GWANS = ['MNY', 'MAL', 'BIZ', 'HLT'].filter((g) => g !== 'HLT');   // 소개몰 상품(HLT)은 매물이 아니라 일괄 등록에서 뺌(관 목록 검사 ⑫)
export const LSQ_BULK_TEMPLATE = 'gwan,category,title,summary,body,deal_amount,desired_fee,fee_bearer,region,region_detail\n'
  + 'MNY,카페,역세권 카페 양도합니다,월 매출 안정 · 단골 많음,"평일 10시 ~ 18시 방문 상담 · 시설 2년 사용",62000000,3000000,SELLER,경기도,수원시\n';

export interface BulkRowData {
  gwanCode: string; categoryId: string; categoryName: string; title: string; summary?: string; body?: string;
  dealAmount?: number; desiredFee?: number; feeBearer?: string; regionCodes?: string[]; regionDetail?: string;
}

const money = (raw: string): number | null | undefined => {
  const s = raw.replace(/[,\s원]/g, '');
  if (!s) return undefined;
  if (!/^[0-9]{1,13}$/.test(s)) return null;
  return Number(s);
};

/** 미리보기 — 줄마다 판정 · 묶음 저장(24시간) */
export async function bulkPreview(db: DatabaseService, me: string, csv: string, fileName?: string) {
  const s = await lsqSettings(db);
  if (!s.bulkOn) throw new StateConflict('LSQ_BULK_OFF', '지금은 매물 일괄 등록을 받지 않습니다.');
  const src = String(csv ?? '').replace(/^﻿/, '');
  if (!src.trim()) throw new PolicyViolation('LSQ_BULK_EMPTY', 'CSV 가 비어 있습니다 — 첫 줄에 칸 이름(gwan,category,title …)을 적으십시오.');
  if (Buffer.byteLength(src, 'utf8') > CSV_MAX_BYTES) throw new PolicyViolation('LSQ_BULK_TOO_BIG', 'CSV 는 200KB 까지입니다 — 나눠서 올리십시오.');
  const all = parseCsv(src);
  const head = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = HEAD_NEED.filter((h) => !head.includes(h));
  if (missing.length) throw new PolicyViolation('LSQ_BULK_HEAD', `첫 줄에 꼭 있어야 하는 칸이 없습니다: ${missing.join(', ')}`);
  const extra = head.filter((h) => h && !(HEAD_ALL as readonly string[]).includes(h));
  if (extra.length) throw new PolicyViolation('LSQ_BULK_COLUMNS', `받지 않는 칸이 있습니다: ${extra.join(', ')} — 이름 · 전화 같은 칸은 지우고 올리십시오(개인정보 최소).`);
  const body = all.slice(1);
  if (!body.length) throw new PolicyViolation('LSQ_BULK_EMPTY', 'CSV 가 비어 있습니다 — 첫 줄에 칸 이름(gwan,category,title …)을 적으십시오.');
  if (body.length > s.bulkMaxRows) throw new PolicyViolation('LSQ_BULK_TOO_MANY', `한 번에 ${s.bulkMaxRows}줄까지입니다 — 나눠서 올리십시오.`);

  const gwans = await db.query<{ code: string; name: string }>(`SELECT code, name FROM gwans WHERE is_active AND code = ANY($1::text[])`, [BULK_GWANS]);
  const cats = await db.query<{ id: string; gwan: string; code: string; name: string }>(
    `SELECT id::text AS id, gwan_code AS gwan, code, name FROM categories WHERE status = 'APPROVED' AND gwan_code = ANY($1::text[])`, [BULK_GWANS]);
  const regions = await db.query<{ code: string; sido: string }>(`SELECT code, sido FROM regions WHERE is_active AND sigungu IS NULL`);
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? String(r[i] ?? '').trim() : ''; };

  const rows = body.map((r, i) => {
    const problems: string[] = [];
    const g0 = col(r, 'gwan');
    const g = gwans.find((x) => x.code === g0.toUpperCase() || x.name === g0);
    if (!g) problems.push('관(gwan)은 MNY · MAL · BIZ 중 하나입니다');
    const c0 = col(r, 'category');
    const c = g ? cats.find((x) => x.gwan === g.code && (x.id === c0 || x.code === c0 || x.name === c0)) : undefined;
    if (g && !c) problems.push('그 관의 승인된 업종이 아닙니다');
    const title = lsqLine(col(r, 'title'), 100) ?? '';
    if (title.length < 5) problems.push('제목은 5 ~ 100자입니다');
    const summary = lsqLine(col(r, 'summary'), 60) ?? undefined;
    const bodyText = col(r, 'body') ? lsqMask(col(r, 'body')).slice(0, 5000) : undefined;
    const deal = money(col(r, 'deal_amount'));
    if (deal === null) problems.push('거래 금액은 숫자(원)입니다');
    const fee = money(col(r, 'desired_fee'));
    if (fee === null) problems.push('희망 소개비는 숫자(원)입니다');
    const fb = col(r, 'fee_bearer').toUpperCase();
    if (fb && !FEE_BEARERS.includes(fb)) problems.push('소개비 부담은 BUYER · SELLER · NEGOTIABLE 중 하나입니다');
    const rg0 = col(r, 'region');
    const rg = rg0 ? regions.find((x) => x.sido === rg0 || x.sido.startsWith(rg0) || x.code === rg0) : undefined;
    if (rg0 && !rg) problems.push('지역(region)은 시 · 도 이름입니다');
    const regionDetail = lsqLine(col(r, 'region_detail'), 30) ?? undefined;
    const data: Partial<BulkRowData> = {
      gwanCode: g?.code, categoryId: c?.id, categoryName: c?.name, title, summary, body: bodyText,
      dealAmount: deal ?? undefined, desiredFee: fee ?? undefined, feeBearer: fb || undefined,
      regionCodes: rg ? [rg.code] : undefined, regionDetail,
    };
    return { line: i + 1, state: problems.length ? 'INVALID' : 'VALID', data, problems: problems.slice(0, 10) };
  });
  const valid = rows.filter((x) => x.state === 'VALID').length;
  const job = await db.transaction(async () => {
    const [j] = await db.query<{ id: string }>(
      `INSERT INTO lsq_bulk_jobs (account_id, file_name, row_count, valid_count) VALUES ($1::uuid, $2, $3::int, $4::int) RETURNING id::text AS id`,
      [me, fileName ? String(fileName).slice(0, 120) : null, rows.length, valid]);
    for (const x of rows) {
      await db.query(`INSERT INTO lsq_bulk_rows (job_id, line, state, data, problems) VALUES ($1::bigint, $2::int, $3, $4::jsonb, $5::text[])`,
        [j!.id, x.line, x.state, JSON.stringify(x.data), x.problems]);
    }
    return j!;
  });
  return { jobId: job.id, rows: rows.length, valid, invalid: rows.length - valid, items: rows,
    note: valid ? `${valid}줄을 등록할 수 있습니다 — 「확정」을 누르면 검수 큐로 들어갑니다(24시간 안).` : '등록할 수 있는 줄이 없습니다 — 고친 CSV 를 다시 올리십시오.' };
}

/** 확정 — VALID 줄을 하나씩 기존 매물 등록(검수 큐)으로 */
export async function bulkConfirm(db: DatabaseService, listings: ListingService, me: string, jobId: string) {
  const s = await lsqSettings(db);
  if (!s.bulkOn) throw new StateConflict('LSQ_BULK_OFF', '지금은 매물 일괄 등록을 받지 않습니다.');
  if (!/^\d{1,18}$/.test(String(jobId ?? ''))) throw new NotFound('일괄 등록 묶음을 찾을 수 없습니다.');
  const [job] = await db.query<{ state: string; expired: boolean }>(
    `SELECT state, expires_at < now() AS expired FROM lsq_bulk_jobs WHERE id = $1::bigint AND account_id = $2::uuid`, [jobId, me]);
  if (!job) throw new NotFound('일괄 등록 묶음을 찾을 수 없습니다.');
  if (job.state !== 'PREVIEW') throw new StateConflict('LSQ_BULK_STATE', '이미 확정했거나 기한이 지난 묶음입니다.');
  if (job.expired) throw new StateConflict('LSQ_BULK_EXPIRED', '미리보기 뒤 24시간이 지났습니다 — CSV 를 다시 올리십시오.');
  /* 먼저 DONE 으로 잠금(두 번 눌러도 한 번만) — 줄 결과는 아래에서 채움 */
  const [lock] = await db.query<{ id: string }>(
    `UPDATE lsq_bulk_jobs SET state = 'DONE', confirmed_at = now() WHERE id = $1::bigint AND state = 'PREVIEW' RETURNING id::text AS id`, [jobId]);
  if (!lock) throw new StateConflict('LSQ_BULK_STATE', '이미 확정했거나 기한이 지난 묶음입니다.');
  const rows = await db.query<{ line: number; data: BulkRowData }>(
    `SELECT line, data FROM lsq_bulk_rows WHERE job_id = $1::bigint AND state = 'VALID' ORDER BY line`, [jobId]);
  let made = 0, failed = 0, auto = 0;
  const results: Array<{ line: number; state: string; listingId?: string; status?: string; note?: string }> = [];
  for (const r of rows) {
    const d = r.data;
    try {
      const out = await listings.submit({
        ownerAccountId: me, gwanCode: d.gwanCode, categoryId: d.categoryId, title: d.title, body: d.body,
        desiredFee: d.desiredFee, feeBearer: d.feeBearer, regionCodes: d.regionCodes, summary: d.summary,
        dealAmount: d.dealAmount, regionDetail: d.regionDetail,
      });
      made++; if (out.autoApproved) auto++;
      await db.query(`UPDATE lsq_bulk_rows SET state = 'CREATED', listing_id = $3::uuid, result_note = $4 WHERE job_id = $1::bigint AND line = $2::int`,
        [jobId, r.line, out.listingId, out.autoApproved ? '자동 승인 · 바로 게시' : '검수 대기']);
      results.push({ line: r.line, state: 'CREATED', listingId: out.listingId, status: out.status });
    } catch (e) {
      failed++;
      const msg = String((e as { response?: { message?: string } })?.response?.message ?? (e as Error)?.message ?? e).replace(/^[A-Z_]+:\s*/, '').slice(0, 300);
      await db.query(`UPDATE lsq_bulk_rows SET state = 'FAILED', result_note = $3 WHERE job_id = $1::bigint AND line = $2::int`, [jobId, r.line, msg]);
      results.push({ line: r.line, state: 'FAILED', note: msg });
    }
  }
  await db.query(`UPDATE lsq_bulk_jobs SET made_count = $2::int, fail_count = $3::int WHERE id = $1::bigint`, [jobId, made, failed]);
  return { jobId, made, failed, autoApproved: auto, results,
    note: `${made}건을 등록했습니다(자동 승인 ${auto} · 나머지는 검수 대기)${failed ? ` · 실패 ${failed}건은 사유를 보고 고쳐 다시 올리십시오` : ''}.` };
}

/** 나의공간 — 최근 묶음 10 · 양식 */
export async function myBulk(db: DatabaseService, me: string) {
  const s = await lsqSettings(db);
  const jobs = await db.query(
    `SELECT id::text AS id, state, file_name AS "fileName", row_count AS rows, valid_count AS valid, made_count AS made, fail_count AS failed,
            created_at AS "createdAt", confirmed_at AS "confirmedAt", (state = 'PREVIEW' AND expires_at < now()) AS expired
       FROM lsq_bulk_jobs WHERE account_id = $1::uuid ORDER BY id DESC LIMIT 10`, [me]);
  return { on: s.bulkOn, maxRows: s.bulkMaxRows, columns: HEAD_ALL, required: HEAD_NEED, template: LSQ_BULK_TEMPLATE, jobs };
}

/** 나의공간 — 묶음 하나의 줄 */
export async function myBulkJob(db: DatabaseService, me: string, jobId: string) {
  if (!/^\d{1,18}$/.test(String(jobId ?? ''))) throw new NotFound('일괄 등록 묶음을 찾을 수 없습니다.');
  const [job] = await db.query(
    `SELECT id::text AS id, state, file_name AS "fileName", row_count AS rows, valid_count AS valid, made_count AS made, fail_count AS failed,
            created_at AS "createdAt", confirmed_at AS "confirmedAt", expires_at AS "expiresAt"
       FROM lsq_bulk_jobs WHERE id = $1::bigint AND account_id = $2::uuid`, [jobId, me]);
  if (!job) throw new NotFound('일괄 등록 묶음을 찾을 수 없습니다.');
  const items = await db.query(
    `SELECT r.line, r.state, r.data->>'title' AS title, r.data->>'gwanCode' AS "gwanCode", r.data->>'categoryName' AS "categoryName",
            r.problems, r.listing_id::text AS "listingId", l.status AS "listingStatus", r.result_note AS note
       FROM lsq_bulk_rows r LEFT JOIN listings l ON l.id = r.listing_id WHERE r.job_id = $1::bigint ORDER BY r.line`, [jobId]);
  return { job, items };
}

/** 운영 — 최근 30일 수 · 최근 묶음 50(가린 이름 · 글 없음) */
export async function adminBulk(db: DatabaseService) {
  const settings = await lsqSettings(db);
  const [sum] = await db.query<Record<string, number>>(
    `SELECT count(*)::int AS jobs, count(*) FILTER (WHERE state = 'DONE')::int AS done, coalesce(sum(row_count), 0)::int AS rows,
            coalesce(sum(made_count), 0)::int AS made, coalesce(sum(fail_count), 0)::int AS failed
       FROM lsq_bulk_jobs WHERE created_at > now() - interval '30 days'`);
  const [rv] = await db.query<{ inReview: number; published: number; rejected: number }>(
    `SELECT count(*) FILTER (WHERE l.status = 'IN_REVIEW')::int AS "inReview", count(*) FILTER (WHERE l.status = 'PUBLISHED')::int AS published,
            count(*) FILTER (WHERE l.status = 'REJECTED')::int AS rejected
       FROM lsq_bulk_rows r JOIN lsq_bulk_jobs j ON j.id = r.job_id JOIN listings l ON l.id = r.listing_id WHERE j.created_at > now() - interval '30 days'`);
  const recent = await db.query<{ id: string; state: string; name: string | null; rows: number; valid: number; made: number; failed: number; createdAt: string }>(
    `SELECT j.id::text AS id, j.state, a.name, j.row_count AS rows, j.valid_count AS valid, j.made_count AS made, j.fail_count AS failed, j.created_at AS "createdAt"
       FROM lsq_bulk_jobs j JOIN accounts a ON a.id = j.account_id ORDER BY j.id DESC LIMIT 50`);
  return { settings, summary30: { ...(sum ?? {}), ...(rv ?? {}) }, recent: recent.map(({ name, ...r }) => ({ ...r, member: maskName(name) ?? '회원' })),
    note: '확정한 줄은 기존 매물 등록과 같은 길로 검수 큐에 들어갑니다 — 검수 › 검수 큐에서 처리합니다.' };
}

/** 정기 정리 — 기한 지난 미리보기 EXPIRED · 90일 지난 묶음 지움 */
export async function bulkPurge(db: DatabaseService) {
  const ex = await db.query(`UPDATE lsq_bulk_jobs SET state = 'EXPIRED' WHERE state = 'PREVIEW' AND expires_at < now() RETURNING id`);
  const del = await db.query(`DELETE FROM lsq_bulk_jobs WHERE created_at < now() - interval '90 days' RETURNING id`);
  return { expired: ex.length, deleted: del.length };
}
