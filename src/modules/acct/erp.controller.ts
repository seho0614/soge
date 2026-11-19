import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { MailService } from '../../common/mail/mail.service';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ALL_SOURCES } from './sources';
import { DOC_KINDS, TAX_TYPES, company, convertDoc, createDoc, docDetail, listDocs, poPrint, requestDocInvoice, reviseDoc, setDocState } from './salesdocs';
import { addDept, addProject, deptPnl, deptsView, setRuleDept, tagEntry, taggedEntries, tagSource, updateDept, updateProject } from './depts';
import { addWarehouse, findBarcode, listBarcodes, listWarehouses, setBarcode, transferStock, updateWarehouse, whAdjust, whStock, whStockIn } from './warehouse';
import { addPromise, closePromise, dunningView, previewDunning, sendDunning, setTemplate } from './dunning';

/* ---------------------------------------------------------------------
 * v10.433 ~ 436 (D256 · docs/570 ~ 573) 내부 ERP 완성 — 대표 11/19 「이카운트 연동은 보류 → 그냥 내부 시스템으로」
 *   v10.433  GET/POST /admin/acct/sales-docs · GET /sales-docs/{id} · POST /sales-docs/{id}/revise · /convert · /state · /tax-invoice
 *            GET /admin/acct/sales-docs/po/{id}/print (㉑ 발주서 인쇄) · GET /admin/acct/erp/company
 *   v10.434  GET/POST /admin/acct/depts · PATCH /depts/{id} · POST /admin/acct/projects · PATCH /projects/{id} · PUT /admin/acct/depts/rules
 *            GET /admin/acct/tags/entries?ym= · POST /admin/acct/tags/entry/{id} · POST /admin/acct/tags/source · GET /admin/acct/dept-pnl
 *   v10.435  GET/POST /admin/acct/warehouses · PATCH /warehouses/{id} · GET /warehouses/stock · POST /warehouses/transfer · /in · /adjust
 *            GET /admin/acct/barcodes · POST /barcodes/{optionId} · GET /barcodes/find?code=
 *   v10.436  GET /admin/acct/dunning · PUT /dunning/templates/{stage} · POST /dunning/preview · /dunning/send · POST /admin/acct/receipt-promises · /{id}/close
 *   보기 SUPER · PAYOUT(바코드 · 문서 보기는 ADMIN 도) · 설정 · 독촉 보내기 · 실사 SUPER.
 * ------------------------------------------------------------------- */

const VIEW = ['SUPER', 'PAYOUT'] as const;
const DOCS = ['SUPER', 'PAYOUT', 'ADMIN'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class SalesDocLineDto {
  @ApiProperty({ example: '컨설팅 1회' }) @IsString() @Length(1, 120) item!: string;
  @ApiPropertyOptional({ example: '2시간' }) @IsOptional() @IsString() @Length(0, 80) spec?: string;
  @ApiProperty({ example: 1 }) @IsNumber() @Min(0.001) @Max(1_000_000_000) qty!: number;
  @ApiPropertyOptional({ example: '회' }) @IsOptional() @IsString() @Length(0, 10) unit?: string;
  @ApiProperty({ example: 500000, description: '단가(공급가 · 원)' }) @IsInt() @Min(0) @Max(1_000_000_000_000) unitPrice!: number;
  @ApiPropertyOptional({ enum: TAX_TYPES, description: 'TAXABLE 과세(부가세 10%) · EXEMPT 면세 · ZERO 영세' }) @IsOptional() @IsIn(TAX_TYPES as unknown as string[]) taxType?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '직판 옵션(선택)' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId?: string;
}
export class SalesDocDto {
  @ApiProperty({ enum: DOC_KINDS }) @IsIn(DOC_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: '3', description: '거래처 번호(거래처 대장)' }) @IsString() @Matches(/^\d{1,18}$/) partyId!: string;
  @ApiProperty({ example: '11월 컨설팅' }) @IsString() @Length(1, 120) title!: string;
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @Matches(YMD) issuedOn?: string;
  @ApiPropertyOptional({ example: '2026-12-20', description: '견적 유효일' }) @IsOptional() @Matches(YMD) validUntil?: string;
  @ApiPropertyOptional({ example: '2026-12-31', description: '결제 기한' }) @IsOptional() @Matches(YMD) dueOn?: string;
  @ApiPropertyOptional({ example: 'REV_SALES', description: '매출 계정(종류 REVENUE)' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) revenueRole?: string;
  @ApiPropertyOptional({ example: '선금 30%' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiProperty({ type: [SalesDocLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SalesDocLineDto) lines!: SalesDocLineDto[];
}
export class SalesDocReviseDto {
  @ApiPropertyOptional({ example: '11월 컨설팅(수정)' }) @IsOptional() @IsString() @Length(1, 120) title?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @Matches(YMD) dueOn?: string;
  @ApiPropertyOptional({ example: '2026-12-20' }) @IsOptional() @Matches(YMD) validUntil?: string;
  @ApiPropertyOptional({ example: '수량 바꿈' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiProperty({ type: [SalesDocLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SalesDocLineDto) lines!: SalesDocLineDto[];
}
export class SalesDocConvertDto {
  @ApiProperty({ enum: ['ORDER', 'STATEMENT'] }) @IsIn(['ORDER', 'STATEMENT']) to!: string;
}
export class SalesDocStateDto {
  @ApiProperty({ enum: ['SENT', 'ACCEPTED', 'CANCELED'] }) @IsIn(['SENT', 'ACCEPTED', 'CANCELED']) state!: string;
  @ApiPropertyOptional({ example: '거래 취소' }) @IsOptional() @IsString() @Length(0, 400) reason?: string;
}
export class DeptAddDto {
  @ApiProperty({ example: 'MALL' }) @IsString() @Matches(/^[A-Za-z0-9_]{2,20}$/) code!: string;
  @ApiProperty({ example: '소개몰' }) @IsString() @Length(1, 60) name!: string;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}
export class DeptPatchDto {
  @ApiPropertyOptional({ example: '소개몰 사업부' }) @IsOptional() @IsString() @Length(0, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}
export class ProjectAddDto {
  @ApiProperty({ example: 'LEAD-2026' }) @IsString() @Matches(/^[A-Za-z0-9_-]{2,30}$/) code!: string;
  @ApiProperty({ example: '리드관 2026' }) @IsString() @Length(1, 80) name!: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) deptId?: string;
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(YMD) startsOn?: string;
  @ApiPropertyOptional({ example: '2027-03-31' }) @IsOptional() @Matches(YMD) endsOn?: string;
}
export class ProjectPatchDto {
  @ApiPropertyOptional({ example: '리드관 2026(연장)' }) @IsOptional() @IsString() @Length(0, 80) name?: string;
  @ApiPropertyOptional({ example: '2027-06-30' }) @IsOptional() @Matches(YMD) endsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() closed?: boolean;
}
export class DeptRuleItemDto {
  @ApiProperty({ example: 'MALL_SALE' }) @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) source!: string;
  @ApiPropertyOptional({ example: '2', description: '비우면 지움' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) deptId?: string;
}
export class DeptRulesDto {
  @ApiProperty({ type: [DeptRuleItemDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DeptRuleItemDto) items!: DeptRuleItemDto[];
  @ApiProperty({ example: '사업부별 손익 시작' }) @IsString() @Length(1, 400) reason!: string;
}
export class EntryTagDto {
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) deptId?: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) projectId?: string;
  @ApiProperty({ example: '소개몰 광고비' }) @IsString() @Length(1, 400) reason!: string;
}
export class SourceTagDto extends EntryTagDto {
  @ApiProperty({ example: 'PURCHASE' }) @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) source!: string;
  @ApiProperty({ example: '12' }) @IsString() @Length(1, 120) sourceKey!: string;
}
export class WarehouseAddDto {
  @ApiProperty({ example: 'BUSAN' }) @IsString() @Matches(/^[A-Za-z0-9_-]{2,20}$/) code!: string;
  @ApiProperty({ example: '부산 창고' }) @IsString() @Length(1, 60) name!: string;
  @ApiPropertyOptional({ example: '부산시 …' }) @IsOptional() @IsString() @Length(0, 200) address?: string;
}
export class WarehousePatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
export class WhTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId!: string;
  @ApiProperty({ example: '1' }) @IsString() @Matches(/^\d{1,18}$/) fromWh!: string;
  @ApiProperty({ example: '2' }) @IsString() @Matches(/^\d{1,18}$/) toWh!: string;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @Matches(YMD) movedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class WhInDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId!: string;
  @ApiProperty({ example: '2' }) @IsString() @Matches(/^\d{1,18}$/) whId!: string;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiProperty({ example: 12000 }) @IsNumber() @Min(0.01) @Max(1_000_000_000) unitCost!: number;
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @Matches(YMD) movedOn?: string;
  @ApiPropertyOptional({ example: '12' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) purchaseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class WhAdjustDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId!: string;
  @ApiProperty({ example: '2' }) @IsString() @Matches(/^\d{1,18}$/) whId!: string;
  @ApiProperty({ example: 8, description: '센 수량' }) @IsInt() @Min(0) @Max(1_000_000) counted!: number;
  @ApiPropertyOptional({ example: 12000, description: '재고 0 에서 늘릴 때 단가' }) @IsOptional() @IsNumber() @Min(0.01) @Max(1_000_000_000) unitCost?: number;
  @ApiProperty({ example: '월말 실사' }) @IsString() @Length(1, 400) reason!: string;
}
export class BarcodeSetDto {
  @ApiPropertyOptional({ example: 'SGB-A1-01', description: '비우면 「상품 코드-옵션 순서」' }) @IsOptional() @IsString() @Matches(/^([0-9A-Za-z-]{4,32})?$/) code?: string;
}
export class DunningTplDto {
  @ApiProperty({ example: 30 }) @IsInt() @Min(1) @Max(365) days!: number;
  @ApiProperty({ example: '[{company}] 대금 결제 안내' }) @IsString() @Length(2, 120) subject!: string;
  @ApiProperty({ example: '{party} 담당자님께 …' }) @IsString() @Length(10, 3000) body!: string;
}
export class DunningPartyDto {
  @ApiProperty({ example: '(주)거래처' }) @IsString() @Length(1, 120) party!: string;
}
export class PromiseAddDto {
  @ApiProperty({ example: '(주)거래처' }) @IsString() @Length(1, 120) party!: string;
  @ApiProperty({ example: 1100000 }) @IsInt() @Min(1) @Max(1_000_000_000_000) amount!: number;
  @ApiProperty({ example: '2026-11-30' }) @Matches(YMD) dueOn!: string;
  @ApiPropertyOptional({ example: '전화로 약속' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class PromiseCloseDto {
  @ApiProperty({ enum: ['KEPT', 'BROKEN', 'CANCELED'] }) @IsIn(['KEPT', 'BROKEN', 'CANCELED']) state!: string;
  @ApiProperty({ example: '11/30 입금 확인' }) @IsString() @Length(1, 400) note!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class ErpController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  /* ── v10.433 견적서 · 주문서 · 거래명세서 ── */
  @Get('sales-docs')
  @Roles(...DOCS)
  @ApiQuery({ name: 'kind', required: false, enum: DOC_KINDS }) @ApiQuery({ name: 'state', required: false }) @ApiQuery({ name: 'partyId', required: false }) @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '견적서 · 주문서 · 거래명세서 목록 (v10.433)', description: '마지막 판만 · 거래처 · 매출 계정 고르기 목록 함께.' })
  @ApiOkResponse({ type: Object })
  docs(@Query('kind') kind?: string, @Query('state') state?: string, @Query('partyId') partyId?: string, @Query('ym') ym?: string) { return listDocs(this.db, { kind, state, partyId, ym }); }

  @Get('sales-docs/po/:id/print')
  @Roles(...DOCS)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '발주서 인쇄 모양 (v10.433)', description: '㉑ 국내 구매 발주(acct_pos) · 회사 정보(footer.*) · 공급가 · 부가세 10%.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  po(@Param('id') id: string) { return poPrint(this.db, id); }

  @Get('erp/company')
  @Roles(...DOCS)
  @ApiOperation({ summary: '인쇄 머리 회사 정보 (v10.433)', description: '설정 footer.company_name · biz_reg_no · ceo_name · address · phone.' })
  @ApiOkResponse({ type: Object })
  company() { return company(this.db); }

  @Get('sales-docs/:id')
  @Roles(...DOCS)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '문서 자세히 · 인쇄 (v10.433)', description: '품목 줄 · 판 · 이어 만든 문서 · 다음에 만들 수 있는 종류 · 회사 정보.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  doc(@Param('id') id: string) { return docDetail(this.db, id); }

  @Post('sales-docs')
  @Roles(...DOCS)
  @HttpCode(200)
  @Audit('ACCT_DOC_ADD', 'SETTING')
  @ApiOperation({ summary: '문서 만들기 (v10.433)', description: '초안 · 번호 Q/O/S-YYMM-0001 · 공급가 = 수량 × 단가 · 부가세는 과세 줄 10%(원 미만 버림).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DOC' })
  addDoc(@Body() dto: SalesDocDto) { return createDoc(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('sales-docs/:id/revise')
  @Roles(...DOCS)
  @HttpCode(200)
  @Audit('ACCT_DOC_ADD', 'SETTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '문서 고치기 = 새 판 (v10.433)', description: '초안 · 보냄만 · 옛 판은 보관(superseded_by).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DOC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DOC' })
  revise(@Param('id') id: string, @Body() dto: SalesDocReviseDto) { return reviseDoc(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('sales-docs/:id/convert')
  @Roles(...DOCS)
  @HttpCode(200)
  @Audit('ACCT_DOC_ADD', 'SETTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '이어 만들기 (v10.433)', description: '견적 → 주문 · 거래명세서 / 주문 → 거래명세서 · 품목 그대로 · 앞 문서는 확정.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DOC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DOC' })
  convert(@Param('id') id: string, @Body() dto: SalesDocConvertDto) { return convertDoc(this.db, id, dto.to, RequestCtx.actorId() ?? null); }

  @Post('sales-docs/:id/state')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_DOC_STATE', 'SETTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '문서 상태 (v10.433)', description: '보냄 · 확정 · 취소(사유). 거래명세서 확정 = 매출 전표(다음 전표 작업) · 확정 뒤 취소 = 반대 전표 · 세금계산서 발행한 것은 취소 막음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DOC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DOC · ACCT_REASON' })
  state(@Param('id') id: string, @Body() dto: SalesDocStateDto) { return setDocState(this.db, id, dto.state, dto.reason); }

  @Post('sales-docs/:id/tax-invoice')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_DOC_TAXINV', 'SETTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '거래명세서 세금계산서 발행 요청 (v10.433)', description: '확정한 거래명세서 → acct_tax_invoices(kind SALES_DOC) · 보내기는 /admin/etax/sales-doc/{id}/send.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DOC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DOC' })
  taxInvoice(@Param('id') id: string) { return requestDocInvoice(this.db, id, RequestCtx.actorId() ?? null); }

  /* ── v10.434 부서 · 프로젝트 ── */
  @Get('depts')
  @Roles(...VIEW)
  @ApiOperation({ summary: '부서 · 프로젝트 · 돈 흐름 기본 부서 (v10.434)', description: '꼬리표 차례: 전표 > 근거 > 돈 흐름 기본.' })
  @ApiOkResponse({ type: Object })
  depts() { return deptsView(this.db, ALL_SOURCES.map((s) => ({ name: s.name, label: s.label }))); }

  @Post('depts')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_DEPT_SET', 'SETTING')
  @ApiOperation({ summary: '부서 더하기 (v10.434 · SUPER)', description: '코드 대문자 · 숫자 · 밑줄 · 지우지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DEPT · ACCT_DEPT_DUP' })
  addDept(@Body() dto: DeptAddDto) { return addDept(this.db, dto); }

  @Patch('depts/:id')
  @Roles('SUPER')
  @Audit('ACCT_DEPT_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '부서 고치기 (v10.434 · SUPER)', description: '이름 · 쓰기 · 순서.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  patchDept(@Param('id') id: string, @Body() dto: DeptPatchDto) { return updateDept(this.db, id, dto); }

  @Put('depts/rules')
  @Roles('SUPER')
  @Audit('ACCT_DEPT_SET', 'SETTING')
  @ApiOperation({ summary: '돈 흐름 기본 부서 (v10.434 · SUPER)', description: '자동 전표가 어느 부서 몫인지(꼬리표가 없을 때) · 사유 · 바꾼 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_TAG · ACCT_REASON' })
  rules(@Body() dto: DeptRulesDto) { return setRuleDept(this.db, dto.items, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('projects')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_DEPT_SET', 'SETTING')
  @ApiOperation({ summary: '프로젝트 더하기 (v10.434 · SUPER)', description: '코드 · 이름 · 부서 · 기간.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PROJECT · ACCT_PROJECT_DUP' })
  addProject(@Body() dto: ProjectAddDto) { return addProject(this.db, dto); }

  @Patch('projects/:id')
  @Roles('SUPER')
  @Audit('ACCT_DEPT_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '프로젝트 고치기 (v10.434 · SUPER)', description: '이름 · 끝나는 날 · 끝남.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  patchProject(@Param('id') id: string, @Body() dto: ProjectPatchDto) { return updateProject(this.db, id, dto); }

  @Get('tags/entries')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', example: '2026-11' })
  @ApiOperation({ summary: '그 달 전표 · 꼬리표 (v10.434)', description: '전표 · 근거 · 돈 흐름 기본 부서를 같이.' })
  @ApiOkResponse({ type: Object })
  async entries(@Query('ym') ym: string) { return { ym, items: await taggedEntries(this.db, ym) }; }

  @Post('tags/entry/:id')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TAG_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '123' })
  @ApiOperation({ summary: '전표 꼬리표 (v10.434)', description: '부서 · 프로젝트(둘 다 비우면 지움) · 사유 · 바꾼 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_TAG · ACCT_REASON' })
  tagEntry(@Param('id') id: string, @Body() dto: EntryTagDto) { return tagEntry(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('tags/source')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TAG_SET', 'SETTING')
  @ApiOperation({ summary: '근거 꼬리표 (v10.434)', description: '매입(PURCHASE) · 경비(EXPENSE_APPROVED) · 수동 전표(MANUAL) 번호에 미리 · 전표가 생기면 그대로 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_TAG · ACCT_REASON' })
  tagSource(@Body() dto: SourceTagDto) { return tagSource(this.db, dto, RequestCtx.actorId() ?? null); }

  @Get('dept-pnl')
  @Roles(...VIEW)
  @ApiQuery({ name: 'from', example: '2026-11-01' }) @ApiQuery({ name: 'to', example: '2026-11-30' }) @ApiQuery({ name: 'by', required: false, enum: ['dept', 'project'] })
  @ApiOperation({ summary: '부서 · 프로젝트별 손익 (v10.434)', description: '계정 종류로 매출 · 비용 · 이익 · 해 마감 전표 뺌 · 「정하지 않음」 따로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_TAG' })
  pnl(@Query('from') from: string, @Query('to') to: string, @Query('by') by?: string) { return deptPnl(this.db, from, to, by ?? 'dept'); }

  /* ── v10.435 창고 · 바코드 ── */
  @Get('warehouses')
  @Roles(...VIEW)
  @ApiOperation({ summary: '창고 (v10.435)', description: '본 창고는 늘 있음 · 창고별 수량 합.' })
  @ApiOkResponse({ type: Object })
  warehouses() { return listWarehouses(this.db); }

  @Get('warehouses/stock')
  @Roles(...VIEW)
  @ApiQuery({ name: 'wh', required: false, example: '1' })
  @ApiOperation({ summary: '창고별 재고 (v10.435)', description: '옵션 × 창고 수량 · 회사 전체 평균 단가 · 바코드.' })
  @ApiOkResponse({ type: Object })
  stock(@Query('wh') wh?: string) { return whStock(this.db, wh); }

  @Post('warehouses')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_WH_SET', 'SETTING')
  @ApiOperation({ summary: '창고 더하기 (v10.435 · SUPER)', description: '코드 · 이름 · 주소.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WH · ACCT_WH_DUP' })
  addWh(@Body() dto: WarehouseAddDto) { return addWarehouse(this.db, dto); }

  @Patch('warehouses/:id')
  @Roles('SUPER')
  @Audit('ACCT_WH_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '2' })
  @ApiOperation({ summary: '창고 고치기 (v10.435 · SUPER)', description: '이름 · 주소 · 끄기(본 창고 · 재고 남은 창고는 못 끔).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_WH_STOCK' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WH' })
  patchWh(@Param('id') id: string, @Body() dto: WarehousePatchDto) { return updateWarehouse(this.db, id, dto); }

  @Post('warehouses/transfer')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_WH_TRANSFER', 'SETTING')
  @ApiOperation({ summary: '창고 간 이동 (v10.435)', description: '원가 전표 없음 · 보내는 창고 수량을 넘지 못함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_WH_STOCK' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WH' })
  transfer(@Body() dto: WhTransferDto) { return transferStock(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('warehouses/in')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_STOCK_IN', 'SETTING')
  @ApiOperation({ summary: '창고 입고 (v10.435)', description: '⑫ 입고와 같음(이동평균 · 매입 번호면 입고 전표 없음) · 창고만 적음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WH' })
  whIn(@Body() dto: WhInDto) { return whStockIn(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('warehouses/adjust')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_STOCK_ADJUST', 'SETTING')
  @ApiOperation({ summary: '창고 실사 (v10.435 · SUPER)', description: '센 수량 → 차이만 실사 조정(매출원가 조정 전표) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WH · ACCT_REASON' })
  whAdjust(@Body() dto: WhAdjustDto) { return whAdjust(this.db, dto, RequestCtx.actorId() ?? null); }

  @Get('barcodes')
  @Roles(...DOCS)
  @ApiOperation({ summary: '바코드 (v10.435)', description: '직판 옵션 · 정한 바코드(인쇄 화면에서 Code128 그림).' })
  @ApiOkResponse({ type: Object })
  async barcodes() { return { items: await listBarcodes(this.db) }; }

  @Get('barcodes/find')
  @Roles(...DOCS)
  @ApiQuery({ name: 'code', example: 'SGB-A1-01' })
  @ApiOperation({ summary: '바코드 찾기 (v10.435)', description: '읽은 글자 → 옵션 · 창고별 수량.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  find(@Query('code') code: string) { return findBarcode(this.db, code); }

  @Post('barcodes/:optionId')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_BARCODE_ADD', 'SETTING')
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiOperation({ summary: '바코드 정하기 (v10.435)', description: '비우면 「상품 코드-옵션 순서」 · 한 번 정하면 바꾸지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_BARCODE_SET' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_BARCODE · ACCT_BARCODE_DUP' })
  setBarcode(@Param('optionId') optionId: string, @Body() dto: BarcodeSetDto) { return setBarcode(this.db, optionId, dto.code, RequestCtx.actorId() ?? null); }

  /* ── v10.436 미수금 독촉 · 입금 예정 ── */
  @Get('dunning')
  @Roles(...VIEW)
  @ApiOperation({ summary: '미수금 독촉 (v10.436)', description: '거래처별 받을 돈 · 단계 · 메일(가림) · 마지막 보냄 · 입금 예정 · 자동 보내기 켜짐 여부(acct.dunning).' })
  @ApiOkResponse({ type: Object })
  dunning() { return dunningView(this.db); }

  @Put('dunning/templates/:stage')
  @Roles('SUPER')
  @Audit('ACCT_DUNNING_TPL', 'SETTING')
  @ApiParam({ name: 'stage', example: '1' })
  @ApiOperation({ summary: '독촉 문안 (v10.436 · SUPER)', description: '단계 날수(1 < 2 < 3) · 제목 · 본문({party} {amount} {oldest} {days} {company} {phone}).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DUNNING' })
  tpl(@Param('stage') stage: string, @Body() dto: DunningTplDto) { return setTemplate(this.db, Number(stage), dto, RequestCtx.actorId() ?? null); }

  @Post('dunning/preview')
  @Roles(...VIEW)
  @HttpCode(200)
  @ApiOperation({ summary: '독촉 메일 미리 보기 (v10.436)', description: '보내지 않음 · 기록 안 함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DUNNING_EARLY' })
  preview(@Body() dto: DunningPartyDto) { return previewDunning(this.db, dto.party); }

  @Post('dunning/send')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_DUNNING_SEND', 'SETTING')
  @ApiOperation({ summary: '독촉 메일 보내기 (v10.436 · SUPER)', description: '기존 메일 길 · 메일 없음 · 준비 안 됨도 기록 · 주소는 가려 남김.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DUNNING_EARLY' })
  send(@Body() dto: DunningPartyDto) { return sendDunning(this.db, this.mail, dto.party, RequestCtx.actorId() ?? null); }

  @Post('receipt-promises')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PROMISE_SET', 'SETTING')
  @ApiOperation({ summary: '입금 예정 넣기 (v10.436)', description: '거래처 약속 → 자금 흐름 예정(IN) 함께.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PROMISE' })
  addPromise(@Body() dto: PromiseAddDto) { return addPromise(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('receipt-promises/:id/close')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PROMISE_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '입금 예정 닫기 (v10.436)', description: '지킴 · 어김 · 취소(사유) · 자금 흐름 예정은 취소.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_PROMISE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PROMISE · ACCT_REASON' })
  closePromise(@Param('id') id: string, @Body() dto: PromiseCloseDto) { return closePromise(this.db, id, dto, RequestCtx.actorId() ?? null); }
}
