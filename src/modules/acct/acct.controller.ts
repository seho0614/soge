import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { SOURCES, runJournal } from './journal';
import { acctReport, taxInvoices, vatSummary, withholdingSummary } from './acct-reports';

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
  @ApiOperation({ summary: '전표 CSV (v10.382 · 내려받기 승인)', description: '회계 프로그램 올리기용 일반 양식 — 일자 · 전표번호 · 줄 · 계정코드 · 계정명 · 차변 · 대변 · 거래처 · 적요 · 증빙 · 근거. 엑셀에서 열림(UTF-8 BOM). 대표 회계 프로그램 양식은 양식 파일을 받은 뒤 맞춤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_YM' })
  async export(@Query('ym') ym: string) {
    if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_YM', '달은 YYYY-MM 으로 적어 주십시오.');
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT e.entry_date::text AS date, e.id::text AS no, row_number() OVER (PARTITION BY e.id ORDER BY l.id)::int AS line,
              coalesce(a.ext_code, '') AS code, coalesce(a.ext_name, a.name) AS name, l.debit, l.credit, coalesce(e.party, '') AS party, coalesce(e.memo, '') AS memo,
              e.evidence, e.source || ':' || e.source_key AS src
         FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
        WHERE e.ym = $1 ORDER BY e.entry_date, e.id, l.id`, [ym]);
    const EV: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '' };
    const csv = toCsv(['일자', '전표번호', '줄', '계정코드', '계정명', '차변', '대변', '거래처', '적요', '증빙', '근거'],
      rows.map((r) => [r.date, r.no, r.line, r.code, r.name, r.debit, r.credit, r.party, r.memo, EV[String(r.evidence)] ?? '', r.src]));
    return { filename: `journal-${ym}.csv`, csv, rows: rows.length, note: `${ym} 전표 ${rows.length}줄을 내려받았습니다.` };
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
}
