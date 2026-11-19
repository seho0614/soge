import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { SOURCES, runJournal } from './journal';
import { acctReport, cancelTaxInvoiceRequest, requestTaxInvoice, taxInvoices, vatSummary, withholdingSummary } from './acct-reports';
import { BANK_MAX_CHARS, bankAutoMatch, bankMatch, bankMonth, uploadBank } from './bank';
import { DATE_STYLES, FIELDS, checkFormat, listFormats, pickFormat, renderRows } from './formats';
import { deadlines, monthSummary } from './month';

/* ---------------------------------------------------------------------
 * v10.381 ~ 384 (D242 · docs/517 ~ 520) 회계 · 세무 1단계 — 운영 화면 「회계」 메뉴
 *   보기 SUPER · PAYOUT(지급 담당) · 고치기 · 마감 SUPER
 *   v10.381  GET   /admin/acct/accounts                    계정(역할 · 회계 프로그램 코드) · 전표 규칙(돈 흐름별 줄 모양) · 설정
 *            PATCH /admin/acct/accounts/{role}             회계 프로그램 코드 · 이름(SUPER · 사유 · 감사 ACCT_ACCOUNT_SET)
 *            GET   /admin/acct/products                    직판 상품 과세 · 면세
 *            PATCH /admin/acct/products/{code}/tax-type    과세 · 면세 고르기(ADMIN · SUPER · 사유 · 감사 PRODUCT_TAX_TYPE)
 *   v10.382  GET   /admin/acct/journal?ym=                 그 달 전표 · 계정별 합 · 마감
 *            POST  /admin/acct/journal/run                 지금 전표 만들기(SUPER · 정기 작업과 같음)
 *            GET   /admin/acct/journal/export?ym=          전표 CSV(회계 프로그램 올리기용 일반 양식 · 내려받기 승인 ACCT_JOURNAL)
 *            GET   /admin/acct/closings · POST /admin/acct/closings   월 마감(SUPER · 지난 달만 · 한 번 · 감사 ACCT_CLOSE)
 *   v10.383  GET   /admin/acct/tax/vat?q=YYYY-Qn · /tax/withholding?ym= · /tax/invoices?ym=
 *            GET   /admin/acct/tax/export?kind=VAT|WHT_YEAR&period=   신고 자료 CSV(내려받기 승인 ACCT_TAX)
 *   v10.384  GET   /admin/acct/report?months=              월별 손익 · 매출 구성 · 현금 들고 남
 *   ── ⑪ (D244 · docs/525 ~ 528) ──
 *   v10.388  POST  /admin/acct/bank/upload                 통장 거래 내역 CSV(같은 줄 한 번 · 감사 ACCT_BANK_UPLOAD)
 *            GET   /admin/acct/bank?ym=                    그 달 통장 줄 · 후보 전표 · 장부에만 있음 · 마지막 잔액
 *            POST  /admin/acct/bank/{id}/match             맞춤(전표) · 맞출 것 없음(사유) · 풀기(사유) · 감사 ACCT_BANK_MATCH
 *            POST  /admin/acct/bank/auto-match             후보 하나 + 이름 같음만 자동
 *   v10.389  GET   /admin/acct/formats · POST /admin/acct/formats · PATCH /admin/acct/formats/{id}   전표 CSV 양식(SUPER)
 *            POST  /admin/acct/formats/preview             양식 미리보기(보기 줄 3개 · 실제 전표 아님)
 *            GET   /admin/acct/journal/export?ym=&format=  고른 양식(비우면 기본)
 *   v10.390  GET   /admin/acct/month?ym=                   월 결산 요약 · 할 일 · 신고 기한
 *            GET   /admin/acct/deadlines                   다가오는 신고 기한(원천세 10일 · 부가세 25일)
 *   v10.391  POST  /admin/acct/tax/invoices/request        광고 청구 · 입점 수수료 세금계산서 발행 요청 → /admin/etax/{ad|commission}/{id}/send
 *            POST  /admin/acct/tax/invoices/{id}/cancel    보내지 않은 요청 취소
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const VIEW = ['SUPER', 'PAYOUT'] as const;

export class AcctAccountDto {
  @ApiPropertyOptional({ example: '404', description: '회계 프로그램 계정 코드(비우면 없음)' }) @IsOptional() @IsString() @Matches(/^([0-9A-Za-z._-]{1,20})?$/) extCode?: string;
  @ApiPropertyOptional({ example: '용역매출', description: '회계 프로그램 계정 이름' }) @IsOptional() @IsString() @Length(0, 60) extName?: string;
  @ApiProperty({ example: '세무사 확인 — 계정 코드표 맞춤', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class TaxTypeDto {
  @ApiProperty({ enum: ['TAXABLE', 'EXEMPT'] }) @IsIn(['TAXABLE', 'EXEMPT']) taxType!: string;
  @ApiProperty({ example: '면세 품목(세무사 확인)', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctCloseDto {
  @ApiProperty({ example: '2026-11', description: '마감할 달(이번 달 전)' }) @Matches(YM) ym!: string;
  @ApiPropertyOptional({ example: '회계 프로그램에 올림', description: '메모(200자까지)' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}

export class BankUploadDto {
  @ApiProperty({ description: `통장 거래 내역 CSV 글자(엑셀 저장 · ${BANK_MAX_CHARS.toLocaleString('ko-KR')}자까지)` }) @IsString() @Length(1, BANK_MAX_CHARS) csv!: string;
  @ApiPropertyOptional({ example: '거래내역_202611.csv' }) @IsOptional() @IsString() @Length(0, 200) filename?: string;
  @ApiPropertyOptional({ example: '국민은행' }) @IsOptional() @IsString() @Length(0, 40) bank?: string;
}
export class BankMatchDto {
  @ApiPropertyOptional({ example: '123', description: '맞출 전표 번호' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) entryId?: string;
  @ApiPropertyOptional({ description: '맞출 것 없음(이자 · 수수료 등 — 사유 필요)' }) @IsOptional() @IsBoolean() ignore?: boolean;
  @ApiPropertyOptional({ description: '맞춤 풀기(사유 필요)' }) @IsOptional() @IsBoolean() clear?: boolean;
  @ApiPropertyOptional({ example: '예금 이자' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class YmDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM) ym!: string;
}
export class FormatColDto {
  @ApiProperty({ enum: Object.keys(FIELDS) }) @IsIn(Object.keys(FIELDS)) field!: string;
  @ApiPropertyOptional({ example: '일자' }) @IsOptional() @IsString() @Length(0, 30) title?: string;
}
export class AcctFormatDto {
  @ApiProperty({ example: '세무사랑' }) @IsString() @Length(1, 40) name!: string;
  @ApiProperty({ type: [FormatColDto] }) @IsArray() columns!: FormatColDto[];
  @ApiPropertyOptional({ enum: DATE_STYLES }) @IsOptional() @IsIn(DATE_STYLES as unknown as string[]) dateStyle?: string;
  @ApiPropertyOptional({ enum: ['SPLIT', 'SIGN'] }) @IsOptional() @IsIn(['SPLIT', 'SIGN']) dcStyle?: string;
  @ApiPropertyOptional({ example: '차변' }) @IsOptional() @IsString() @Length(0, 10) dcDebit?: string;
  @ApiPropertyOptional({ example: '대변' }) @IsOptional() @IsString() @Length(0, 10) dcCredit?: string;
  @ApiPropertyOptional({ description: '머리줄 넣기(처음 예)' }) @IsOptional() @IsBoolean() header?: boolean;
  @ApiPropertyOptional({ description: '기본 양식으로' }) @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class TaxInvoiceRequestDto {
  @ApiProperty({ enum: ['AD', 'COMMISSION'] }) @IsIn(['AD', 'COMMISSION']) kind!: 'AD' | 'COMMISSION';
  @ApiProperty({ format: 'uuid', description: '광고 청구서 · 입점 정산 번호' }) @IsString() @Length(36, 36) sourceId!: string;
}
export class TaxInvoiceCancelDto {
  @ApiProperty({ example: '금액 다시 확인' }) @IsString() @Length(1, 400) reason!: string;
}

const reasonOk = (r: string, code: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const kstYm = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 7);
const EV_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '' };

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.381 계정 · 규칙 ── */
  @Get('accounts')
  @Roles(...VIEW)
  @ApiOperation({ summary: '회계 계정 · 전표 규칙 (v10.381)', description: '계정(역할 · 이름 · 회계 프로그램 코드) · 돈 흐름별 전표 줄 모양(11,000원 예) · 설정(acct.*) · 고칠 수 있는가(SUPER). 규칙은 초안(세무사 확인).' })
  @ApiOkResponse({ type: Object })
  async accounts() {
    const accounts = await this.db.query(
      `SELECT role, name, kind, ext_code AS "extCode", ext_name AS "extName", note, updated_at AS "updatedAt" FROM acct_accounts ORDER BY sort, role`);
    const settings = await this.db.query<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key LIKE 'acct.%' ORDER BY key`);
    const sv = settings.find((s) => s.key === 'acct.sub_vat_included')?.value !== 'off', cv = settings.find((s) => s.key === 'acct.commission_vat_included')?.value !== 'off';
    const sample: Record<string, unknown> = { key: 'x', at: '', party: null, amt: 11000, supply: 10000, vat: 1000, total: 11000, paid: 11000, exempt: 0, gross: 11000, wht: 363, net: 10637, kind: 'USE', no: '', method: 'TRANSFER', period: '' };
    const rules = SOURCES.map((s) => {
      const b = s.build(sample as never, { subVat: sv, commissionVat: cv });
      return { source: s.name, label: s.label, evidence: b?.evidence ?? 'NONE', lines: b?.lines ?? [] };
    });
    return { accounts, rules, settings, canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER', note: '전표 규칙 · 계정 코드는 초안입니다 — 세무사 확인 뒤 회계 프로그램 코드만 고치십시오(역할은 그대로).' };
  }

  @Patch('accounts/:role')
  @Roles('SUPER')
  @Audit('ACCT_ACCOUNT_SET', 'SETTING')
  @ApiParam({ name: 'role', example: 'REV_SUB' })
  @ApiOperation({ summary: '회계 계정 코드 고치기 (v10.381 · SUPER)', description: '회계 프로그램 계정 코드 · 이름만. 이미 만든 전표의 줄은 역할로 남아 있어 내려받을 때 새 코드로 나갑니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  async setAccount(@Param('role') role: string, @Body() dto: AcctAccountDto) {
    reasonOk(dto.reason, 'ACCT_REASON');
    const r = await this.db.query(
      `UPDATE acct_accounts SET ext_code = nullif($2, ''), ext_name = nullif($3, ''), updated_by = $4, updated_at = now() WHERE role = $1 RETURNING role`,
      [role, (dto.extCode ?? '').trim(), (dto.extName ?? '').trim(), RequestCtx.actorId() ?? null]);
    if (!r.length) throw new NotFound('없는 계정입니다.');
    return { ok: true, role, note: '계정 코드를 고쳤습니다 — 다음 내려받기부터 새 코드로 나갑니다.' };
  }

  @Get('products')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '직판 상품 과세 · 면세 (v10.383)', description: '소개몰 직판(DIRECT) 상품 — 코드 · 이름 · 상태 · 과세 · 면세. 입점 상품은 판매자 매출이라 빠짐.' })
  @ApiOkResponse({ type: Object })
  async products() {
    const items = await this.db.query(
      `SELECT p.code, p.name, p.status, p.tax_type AS "taxType" FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
        ORDER BY (p.tax_type = 'EXEMPT') DESC, p.status, p.name LIMIT 300`);
    return { items, exempt: items.filter((x: any) => x.taxType === 'EXEMPT').length };
  }

  @Patch('products/:code/tax-type')
  @Roles('ADMIN', 'SUPER')
  @Audit('PRODUCT_TAX_TYPE', 'SETTING')
  @ApiParam({ name: 'code', example: 'P-0001' })
  @ApiOperation({ summary: '상품 과세 · 면세 고르기 (v10.383)', description: '직판 상품만 · 다음 주문부터(지난 주문 줄은 주문 때 값 그대로) · 사유 · 감사 PRODUCT_TAX_TYPE.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 직판 상품이 아님' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  async setTaxType(@Param('code') code: string, @Body() dto: TaxTypeDto) {
    reasonOk(dto.reason, 'ACCT_REASON');
    const r = await this.db.query(
      `UPDATE hlt_products p SET tax_type = $2, updated_at = now() FROM hlt_sellers s WHERE p.code = $1 AND s.id = p.seller_id AND s.type = 'DIRECT' RETURNING p.code`,
      [code, dto.taxType]);
    if (!r.length) throw new NotFound('없거나 직판 상품이 아닙니다.');
    return { ok: true, code, taxType: dto.taxType, note: dto.taxType === 'EXEMPT' ? '면세로 바꿨습니다 — 다음 주문부터 부가세를 나누지 않습니다.' : '과세로 바꿨습니다 — 다음 주문부터 부가세를 나눕니다.' };
  }

  /* ── v10.382 전표 · 마감 ── */
  @Get('journal')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '그 달 전표 (v10.382)', description: '전표(최근 300장 · 줄 포함) · 계정별 차변 · 대변 합 · 돈 흐름별 장 수 · 마감 여부 · 늦게 들어온 전표 수. 비우면 이번 달(한국).' })
  @ApiOkResponse({ type: Object })
  async journal(@Query('ym') ymQ?: string) {
    const ym = ymQ && YM.test(ymQ) ? ymQ : kstYm();
    const entries = await this.db.query(
      `SELECT e.id::text AS id, e.entry_date::text AS date, e.source, e.source_key AS "sourceKey", e.memo, e.party, e.evidence, e.late,
              (SELECT json_agg(json_build_object('role', l.role, 'debit', l.debit, 'credit', l.credit) ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) AS lines
         FROM acct_entries e WHERE e.ym = $1 ORDER BY e.entry_date DESC, e.id DESC LIMIT 300`, [ym]);
    const byRole = await this.db.query(
      `SELECT l.role, a.name, a.ext_code AS "extCode", sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
         FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
        WHERE e.ym = $1 GROUP BY l.role, a.name, a.ext_code, a.sort ORDER BY a.sort`, [ym]);
    const [t] = await this.db.query<{ n: number; late: number; d: string; c: string }>(
      `SELECT count(DISTINCT e.id)::int AS n, count(DISTINCT e.id) FILTER (WHERE e.late)::int AS late, coalesce(sum(l.debit), 0)::text AS d, coalesce(sum(l.credit), 0)::text AS c
         FROM acct_entries e LEFT JOIN acct_lines l ON l.entry_id = e.id WHERE e.ym = $1`, [ym]);
    const bySource = await this.db.query(`SELECT source, count(*)::int AS n FROM acct_entries WHERE ym = $1 GROUP BY source ORDER BY source`, [ym]);
    const [cl] = await this.db.query(`SELECT ym, entries, debit_sum::text AS "debitSum", note, closed_at AS "closedAt" FROM acct_closings WHERE ym = $1`, [ym]);
    return { ym, entries, byRole, bySource, total: { entries: Number(t?.n ?? 0), late: Number(t?.late ?? 0), debit: Number(t?.d ?? 0), credit: Number(t?.c ?? 0) }, closing: cl ?? null };
  }

  @Post('journal/run')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '지금 전표 만들기 (v10.382 · SUPER)', description: '정기 작업 acct_journal 과 같음 — 아직 전표가 없는 돈 흐름만(같은 근거는 한 번).' })
  @ApiOkResponse({ type: Object })
  run() { return runJournal(this.db); }

  @Get('journal/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_JOURNAL')
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiQuery({ name: 'format', required: false, example: '1', description: 'v10.389 양식 번호(비우면 기본 양식)' })
  @ApiOperation({ summary: '전표 CSV (v10.382 · 내려받기 승인)', description: '회계 프로그램 올리기용 일반 양식 — 일자 · 전표번호 · 줄 · 계정코드 · 계정명 · 차변 · 대변 · 거래처 · 적요 · 증빙 · 근거. 엑셀에서 열림(UTF-8 BOM). 대표 회계 프로그램 양식은 양식 파일을 받은 뒤 맞춤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_YM' })
  async export(@Query('ym') ym: string, @Query('format') format?: string) {
    if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_YM', '달은 YYYY-MM 으로 적어 주십시오.');
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT e.entry_date::text AS date, e.id::text AS no, row_number() OVER (PARTITION BY e.id ORDER BY l.id)::int AS line,
              coalesce(a.ext_code, '') AS code, coalesce(a.ext_name, a.name) AS name, l.debit, l.credit, coalesce(e.party, '') AS party, coalesce(e.memo, '') AS memo,
              e.evidence, e.source || ':' || e.source_key AS src
         FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
        WHERE e.ym = $1 ORDER BY e.entry_date, e.id, l.id`, [ym]);
    /* v10.389 (D244 · docs/526) — 고른 양식(비우면 기본 · 처음 기본은 「일반 양식」 = 전과 같은 칸) */
    const f = await pickFormat(this.db, format && /^\d{1,9}$/.test(format) ? format : undefined);
    const { head, body } = renderRows(f, rows, EV_KO);
    const csv = f.header ? toCsv(head, body) : toCsv((body[0] ?? []).map(String), body.slice(1));
    return { filename: `journal-${ym}.csv`, csv, rows: rows.length, format: { id: f.id, name: f.name }, note: `${ym} 전표 ${rows.length}줄을 「${f.name}」 양식으로 내려받았습니다.` };
  }

  @Get('closings')
  @Roles(...VIEW)
  @ApiOperation({ summary: '월 마감 목록 (v10.382)', description: '마감한 달(전표 수 · 차변 합 · 메모 · 때) 최근 24.' })
  @ApiOkResponse({ type: Object })
  async closings() {
    const items = await this.db.query(`SELECT ym, entries, debit_sum::text AS "debitSum", note, closed_at AS "closedAt" FROM acct_closings ORDER BY ym DESC LIMIT 24`);
    return { items, current: kstYm() };
  }

  @Post('closings')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_CLOSE', 'SETTING')
  @ApiOperation({ summary: '월 마감 (v10.382 · SUPER)', description: '이번 달 전 · 한 번 · 마감 전에 전표를 한 번 더 만듦. 마감한 달에는 전표가 들어가지 않고, 늦게 온 돈 흐름은 오늘 날짜(late)로 들어갑니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_CLOSED — 이미 마감' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_CLOSE_FUTURE — 이번 달 · 다음 달' })
  async close(@Body() dto: AcctCloseDto) {
    if (dto.ym >= kstYm()) throw new PolicyViolation('ACCT_CLOSE_FUTURE', '이번 달과 앞으로의 달은 마감할 수 없습니다(달이 끝난 뒤).');
    const [had] = await this.db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [dto.ym]);
    if (had) throw new AppError(409, { code: 'ACCT_CLOSED', message: '이미 마감한 달입니다.' });
    const made = await runJournal(this.db);
    const [r] = await this.db.query<{ n: number; d: string }>(
      `INSERT INTO acct_closings (ym, entries, debit_sum, note, closed_by)
       SELECT $1, count(DISTINCT e.id)::int, coalesce(sum(l.debit), 0), nullif($2, ''), $3
         FROM acct_entries e LEFT JOIN acct_lines l ON l.entry_id = e.id WHERE e.ym = $1
       RETURNING entries AS n, debit_sum::text AS d`, [dto.ym, (dto.note ?? '').trim().slice(0, 200), RequestCtx.actorId() ?? null]);
    return { ok: true, ym: dto.ym, entries: Number(r?.n ?? 0), debitSum: Number(r?.d ?? 0), madeNow: made.total, note: `${dto.ym} 을 마감했습니다 — 전표 ${Number(r?.n ?? 0)}장.` };
  }

  /* ── v10.383 신고 자료 ── */
  @Get('tax/vat')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false, example: '2026-4', description: '해 · 분기(YYYY-1 ~ 4) · 비우면 이번 분기' })
  @ApiOperation({ summary: '부가세 신고 자료 (v10.383)', description: '분기 전표에서 — 증빙(세금계산서 · 카드 · PG · 증빙 없음)별 과세 공급가 · 세액 · 면세 매출 · 돈 흐름별. 신고서 칸 이름은 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  vat(@Query('q') q?: string) { return vatSummary(this.db, q); }

  @Get('tax/withholding')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '원천세 신고 자료 (v10.383)', description: '그 달 지급한 포인트 출금(사업소득) — 사람 수 · 지급액 · 소득세 · 지방소득세 · 실지급 · 올해 누계. 사람별 자료(주민등록번호)는 지급 › 「신고 자료」 CSV.' })
  @ApiOkResponse({ type: Object })
  withholding(@Query('ym') ym?: string) { return withholdingSummary(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('tax/invoices')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '세금계산서 발행 대상 (v10.383)', description: '그 달 발행해야 할 것 — 정액 노출 · 리드 캐시(지금은 사용 월 합 — 충전 때 발행은 ⑩) · 광고 청구 · 입점 수수료 · 발행함 / 아직 · 간주(간주 모드) · 번호. 발행은 각 화면(정액 노출 · 리드 캐시는 전자세금계산서 · 간주).' })
  @ApiOkResponse({ type: Object })
  invoices(@Query('ym') ym?: string) { return taxInvoices(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('tax/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'kind', required: true, enum: ['VAT', 'WHT_YEAR'] })
  @ApiQuery({ name: 'period', required: true, example: '2026-4', description: 'VAT 는 YYYY-분기 · WHT_YEAR 는 YYYY' })
  @ApiOperation({ summary: '신고 자료 CSV (v10.383 · 내려받기 승인)', description: 'VAT — 분기 전표 줄(증빙 · 공급가 · 세액 · 면세) / WHT_YEAR — 올해 사람별 포인트 출금 합(이름 · 가린 이메일 · 건수 · 지급액 · 소득세 · 지방소득세 · 실지급 · 지급명세서 자료). 주민등록번호는 지급 › 「신고 자료」.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async taxExport(@Query('kind') kind: string, @Query('period') period: string) {
    if (kind === 'VAT') {
      const v = await vatSummary(this.db, period);
      if (!v.ok) throw new PolicyViolation('ACCT_PERIOD', '분기는 YYYY-1 ~ YYYY-4 로 적어 주십시오.');
      const csv = toCsv(['분기', '증빙', '돈 흐름', '과세 공급가', '세액', '면세 매출', '전표 수'],
        v.rows.map((r) => [v.q, r.evidenceKo, r.label, r.supply, r.vat, r.exempt, r.entries]));
      return { filename: `vat-${v.q}.csv`, csv, rows: v.rows.length, note: `${v.q} 분기 부가세 자료를 내려받았습니다.` };
    }
    if (kind === 'WHT_YEAR' && /^\d{4}$/.test(period ?? '')) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT coalesce(c.holder_name, a.name) AS name, a.email::text AS email, count(*)::int AS n, sum(c.points)::bigint AS gross,
                sum(c.income_tax)::bigint AS it, sum(c.local_tax)::bigint AS lt, sum(c.net_amount)::bigint AS net
           FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
          WHERE c.status = 'PAID' AND to_char(c.paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY') = $1
          GROUP BY coalesce(c.holder_name, a.name), a.email ORDER BY gross DESC`, [period]);
      const mask = (e: unknown) => String(e ?? '').replace(/^(.{2}).*(@.*)$/, '$1***$2');
      const csv = toCsv(['해', '이름', '이메일(가림)', '건수', '지급액', '소득세', '지방소득세', '실지급'],
        rows.map((r) => [period, r.name, mask(r.email), r.n, r.gross, r.it, r.lt, r.net]));
      return { filename: `withholding-${period}.csv`, csv, rows: rows.length, note: `${period} 원천세(사람별 합) 자료를 내려받았습니다.` };
    }
    throw new PolicyViolation('ACCT_PERIOD', '종류(VAT · WHT_YEAR)와 기간을 확인해 주십시오.');
  }

  /* ── v10.384 경영 보고서 ── */
  @Get('report')
  @Roles(...VIEW)
  @ApiQuery({ name: 'months', required: false, example: 12 })
  @ApiOperation({ summary: '경영 보고서 (v10.384)', description: '전표에서 — 달마다 매출(공급가 · 돈 흐름별) · 비용 · 이익 · 부가세 · 현금 들어옴(PG · 계좌) · 나감 · 지난달 대비. 전표 시작일(acct.start_on) 뒤만.' })
  @ApiOkResponse({ type: Object })
  report(@Query('months') m?: string) { return acctReport(this.db, Math.min(24, Math.max(1, Number(m) || 12))); }

  /* ── v10.388 은행 거래 내역 맞추기 ── */
  @Post('bank/upload')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_UPLOAD', 'SETTING')
  @ApiOperation({ summary: '통장 거래 내역 올리기 (v10.388)', description: '인터넷뱅킹 거래내역 CSV(엑셀 저장) 글자 — 머리줄 이름으로 거래일 · 입금 · 출금 · 잔액 · 내용 · 메모 칸을 찾음 · 같은 줄은 한 번 · 못 읽은 줄 수. 크면 기간을 나눠 올림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_CSV_HEAD · BANK_CSV_EMPTY · BANK_CSV_SIZE · BANK_CSV_TOO_MANY' })
  bankUpload(@Body() dto: BankUploadDto) { return uploadBank(this.db, dto.csv, dto.filename ?? null, dto.bank ?? null, RequestCtx.actorId() ?? null); }

  @Get('bank')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '은행 맞추기 (v10.388)', description: '그 달 통장 줄(맞춤 · 맞출 것 없음 · 남음) · 남은 줄의 후보 전표(같은 방향 · 같은 금액 · 날짜 ±acct.bank_match_days · 이름 비슷하면 위) · 장부에만 있는 보통예금 줄 · 마지막 잔액 · 올린 기록.' })
  @ApiOkResponse({ type: Object })
  bank(@Query('ym') ym?: string) { return bankMonth(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Post('bank/auto-match')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_MATCH', 'SETTING')
  @ApiOperation({ summary: '자동 맞춤 (v10.388)', description: '그 달 남은 줄 중 후보가 하나뿐이고 이름도 같은 줄만 맞춤.' })
  @ApiOkResponse({ type: Object })
  bankAuto(@Body() dto: YmDto) { return bankAutoMatch(this.db, dto.ym, RequestCtx.actorId() ?? null); }

  @Post('bank/:id/match')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_MATCH', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '통장 줄 맞춤 (v10.388)', description: 'entryId = 그 전표와 맞춤(같은 금액의 보통예금 줄이 있어야 · 전표당 한 줄) · ignore = 맞출 것 없음(사유) · clear = 풀기(사유).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BANK_MATCHED · BANK_ENTRY_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_REASON · BANK_ENTRY · ACCT_BANK_MISMATCH' })
  bankMatch(@Param('id') id: string, @Body() dto: BankMatchDto) { return bankMatch(this.db, id, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.389 전표 양식 ── */
  @Get('formats')
  @Roles('SUPER', 'PAYOUT', 'ADMIN')
  @ApiOperation({ summary: '전표 CSV 양식 (v10.389)', description: '양식(칸 순서 · 칸 이름 · 날짜 모양 · 차변/대변 표시 · 기본) · 고를 수 있는 칸 · 고칠 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async formats() {
    return { items: await listFormats(this.db), fields: FIELDS, dateStyles: DATE_STYLES, canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER',
             note: '회계 프로그램의 올리기 양식 파일을 받으면 칸 순서 · 이름을 그대로 맞춰 기본으로 두십시오.' };
  }

  @Post('formats/preview')
  @HttpCode(200)
  @Roles(...VIEW)
  @ApiOperation({ summary: '양식 미리보기 (v10.389)', description: '보기 전표 1장(3줄 · 실제 전표 아님)을 그 양식으로 — 저장하지 않음.' })
  @ApiOkResponse({ type: Object })
  preview(@Body() dto: AcctFormatDto) {
    const c = checkFormat(dto);
    const f = { id: '0', isDefault: false, header: dto.header !== false, ...c } as never;
    const sample = [
      { date: '2026-11-05', no: '101', line: 1, code: '108', name: '외상매출금', debit: 110000, credit: 0, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
      { date: '2026-11-05', no: '101', line: 2, code: '404', name: '용역매출', debit: 0, credit: 100000, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
      { date: '2026-11-05', no: '101', line: 3, code: '255', name: '부가세예수금', debit: 0, credit: 10000, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
    ];
    const { head, body } = renderRows(f, sample, EV_KO);
    return { head, rows: body, csv: dto.header !== false ? toCsv(head, body) : toCsv((body[0] ?? []).map(String), body.slice(1)) };
  }

  @Post('formats')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_FORMAT_SET', 'SETTING')
  @ApiOperation({ summary: '전표 양식 만들기 (v10.389 · SUPER)', description: '이름 · 칸 · 날짜 모양 · 차변/대변 표시 · 기본으로(하나만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_FORMAT_NAME — 같은 이름' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FORMAT' })
  async addFormat(@Body() dto: AcctFormatDto) { return this.saveFormat(null, dto); }

  @Patch('formats/:id')
  @Roles('SUPER')
  @Audit('ACCT_FORMAT_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '전표 양식 고치기 (v10.389 · SUPER)', description: '칸 · 이름 · 날짜 모양 · 차변/대변 표시 · 기본으로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FORMAT' })
  async setFormat(@Param('id') id: string, @Body() dto: AcctFormatDto) {
    if (!/^\d{1,9}$/.test(id ?? '')) throw new NotFound('없는 양식입니다.');
    return this.saveFormat(id, dto);
  }

  private async saveFormat(id: string | null, dto: AcctFormatDto) {
    const c = checkFormat(dto);
    const actor = RequestCtx.actorId() ?? null;
    return this.db.transaction(async () => {
      const [dup] = await this.db.query(`SELECT 1 FROM acct_export_formats WHERE name = $1 AND ($2::bigint IS NULL OR id <> $2::bigint)`, [c.name, id]);
      if (dup) throw new AppError(409, { code: 'ACCT_FORMAT_NAME', message: '같은 이름의 양식이 있습니다.' });
      if (dto.isDefault) await this.db.query(`UPDATE acct_export_formats SET is_default = false WHERE is_default AND ($1::bigint IS NULL OR id <> $1::bigint)`, [id]);
      const args = [c.name, JSON.stringify(c.columns), c.dateStyle, c.dcStyle, c.dcDebit, c.dcCredit, dto.header !== false, actor];
      const [r] = id
        ? await this.db.query<{ id: string }>(
            `UPDATE acct_export_formats SET name = $1, columns = $2::jsonb, date_style = $3, dc_style = $4, dc_debit = $5, dc_credit = $6, header = $7, updated_by = $8, updated_at = now(),
                    is_default = CASE WHEN $10::boolean THEN true ELSE is_default END
              WHERE id = $9::bigint RETURNING id::text AS id`, [...args, id, !!dto.isDefault])
        : await this.db.query<{ id: string }>(
            `INSERT INTO acct_export_formats (name, columns, date_style, dc_style, dc_debit, dc_credit, header, updated_by, is_default)
             VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`, [...args, !!dto.isDefault]);
      if (!r) throw new NotFound('없는 양식입니다.');
      return { ok: true, id: r.id, note: `양식 「${c.name}」을 저장했습니다${dto.isDefault ? ' — 기본 양식입니다' : ''}.` };
    });
  }

  /* ── v10.390 월 결산 · 신고 기한 ── */
  @Get('month')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '월 결산 요약 (v10.390)', description: '그 달 전표 수 · 매출 · 비용 · 이익 · 부가세 · 원천세 · 현금 · 통장 맞춤 · 세금계산서 남음 · 할 일(전표 실패 · 통장 · 세금계산서 · 마감) · 다가오는 신고 기한.' })
  @ApiOkResponse({ type: Object })
  month(@Query('ym') ym?: string) { return monthSummary(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('deadlines')
  @Roles(...VIEW)
  @ApiOperation({ summary: '신고 기한 (v10.390)', description: '이번 달 · 다음 달 원천세(10일) · 부가세(acct.vat_months 의 25일) — 주말 · 공휴일이면 다음 영업일 · 남은 날 · 알림 설정.' })
  @ApiOkResponse({ type: Object })
  deadlines() { return deadlines(this.db); }

  /* ── v10.391 세금계산서(광고 청구 · 입점 수수료) ── */
  @Post('tax/invoices/request')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('TAXINV_REQUEST', 'INVOICE')
  @ApiOperation({ summary: '세금계산서 발행 요청 (v10.391)', description: '광고 청구(AD · 공급가 · 부가세 그대로) · 입점 수수료(COMMISSION · 수수료 + 수수료 부가세) — 금액 · 공급받는 자를 지금 값으로 고정. 발행은 POST /admin/etax/{ad|commission}/{id}/send(ADMIN · SUPER · 지금은 간주).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINV_REQUESTED · TAXINV_HAS_NO' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TAXINV_NOT_ELIGIBLE' })
  taxInvoiceRequest(@Body() dto: TaxInvoiceRequestDto) { return requestTaxInvoice(this.db, dto.kind, dto.sourceId, RequestCtx.actorId() ?? null); }

  @Post('tax/invoices/:id/cancel')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('TAXINV_REQUEST_CANCEL', 'INVOICE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '발행 요청 취소 (v10.391)', description: '아직 보내지 않은 요청만(보낸 것은 전자세금계산서 「취소 · 수정 발행」) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINV_NOT_CANCELABLE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TAXINV_REASON' })
  taxInvoiceCancel(@Param('id') id: string, @Body() dto: TaxInvoiceCancelDto) { return cancelTaxInvoiceRequest(this.db, id, dto.reason); }
}
