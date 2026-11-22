import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags, type ApiPropertyOptions } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { CODE_RE, ID_RE, YMD_RE } from './lgl-common';
import { addLicense, closeLicense, licenseBoard, licenseKinds, licenseOne, renewLicense, setLicenseKind, updateLicense } from './lgl-licenses';
import { REVIEW_KINDS, REVIEW_RISKS, addOpinion, addReview, cancelReview, decideReview, linkReview, reviewBoard, reviewOne } from './lgl-reviews';
import { AT_RE, CASE_KINDS, CASE_RESULTS, CASE_SIDES, COST_KINDS, HEARING_KINDS, addCase, addCost, addHearing, caseBoard, caseOne, closeCase, updateCase, updateHearing, voidCost } from './lgl-cases';
import { INS_BOOK_MODES, INS_KINDS, INS_PAY_MODES, INS_POST_KINDS, addPolicy, endPolicy, insuranceBoard, insuranceJournal, insuranceOne, updatePolicy } from './lgl-insurance';
import { legalDue } from './lgl-due';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/624 ~ 627) — 대표 11/20 · 운영 화면 사무 › 인허가 · 계약 검토 · 소송 · 분쟁 · 회사 보험
 *   주소는 모두 /admin/legal 아래 — 세무사(ACCOUNTANT · /admin/acct GET 만)는 못 봄(사건 상대 · 계약 내용은 법무 정보).
 *   역할: 운영 관리자(ADMIN · SUPER 늘 통과) · 종류 고치기 · 계약 검토 결정은 SUPER · 보험 목록 · 전표 초안은 지급 담당(PAYOUT)도.
 *   v10.486 인허가   GET /admin/legal/licenses · GET /admin/legal/licenses/{id} · POST /admin/legal/licenses · PUT /admin/legal/licenses/{id}
 *                    POST …/licenses/{id}/renew · POST …/licenses/{id}/close · PUT /admin/legal/license-kinds/{code}(SUPER) · GET /admin/legal/due
 *   v10.487 계약 검토 GET /admin/legal/reviews · GET …/reviews/{id} · POST /admin/legal/reviews · POST …/reviews/{id}/opinions
 *                    POST …/reviews/{id}/decide(SUPER) · POST …/reviews/{id}/cancel · POST …/reviews/{id}/link
 *   v10.488 사건     GET /admin/legal/cases · GET …/cases/{id} · POST /admin/legal/cases · PUT …/cases/{id} · POST …/cases/{id}/hearings
 *                    PUT /admin/legal/hearings/{id} · POST …/cases/{id}/costs · POST /admin/legal/costs/{id}/void · POST …/cases/{id}/close
 *   v10.489 보험     GET /admin/legal/insurance · GET …/insurance/{id} · POST /admin/legal/insurance · PUT …/insurance/{id}
 *                    POST …/insurance/{id}/end · POST …/insurance/{id}/journal(지급 담당 · SUPER)
 * ------------------------------------------------------------------- */

const LIST_FILES: ApiPropertyOptions = { type: [String], description: 'POST /files(LGL_DOC · SUPER · ADMIN)로 올린 파일' };

/* ── v10.486 인허가 DTO ── */
export class LglLicenseDto {
  @ApiProperty({ example: 'MAIL_ORDER' }) @IsString() @Matches(CODE_RE) kind!: string;
  @ApiPropertyOptional({ example: '통신판매업 신고(본사)' }) @IsOptional() @IsString() @Length(0, 100) title?: string;
  @ApiPropertyOptional({ example: '제2026-서울강남-0000호' }) @IsOptional() @IsString() @Length(0, 60) licenseRef?: string;
  @ApiPropertyOptional({ example: '강남구청' }) @IsOptional() @IsString() @Length(0, 100) authority?: string;
  @ApiPropertyOptional({ example: '2026-01-15' }) @IsOptional() @Matches(YMD_RE) registeredOn?: string;
  @ApiPropertyOptional({ example: 12, description: '갱신 주기(달) · 비우면 종류 값 · null 이면 없음' }) @IsOptional() @IsInt() @Min(1) @Max(120) cycleMonths?: number | null;
  @ApiPropertyOptional({ example: '2027-01-31' }) @IsOptional() @Matches(YMD_RE) nextDueOn?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '담당(운영 역할 계정)' }) @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional(LIST_FILES) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional({ example: '등록면허세 1월' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class LglLicenseEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) licenseRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) authority?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) registeredOn?: string;
  @ApiPropertyOptional({ description: 'null 이면 주기 없음' }) @IsOptional() @IsInt() @Min(1) @Max(120) cycleMonths?: number | null;
  @ApiPropertyOptional({ description: '빈 글자면 지움' }) @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) nextDueOn?: string;
  @ApiPropertyOptional({ description: '빈 글자면 담당 지움' }) @IsOptional() @Matches(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i) ownerId?: string;
  @ApiPropertyOptional(LIST_FILES) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class LglRenewDto {
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) doneOn!: string;
  @ApiPropertyOptional({ example: '2027-11-20', description: '비우면 (지난 갱신일 · 처리일) + 주기' }) @IsOptional() @Matches(YMD_RE) nextDueOn?: string;
  @ApiPropertyOptional(LIST_FILES) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional({ example: '등록면허세 납부' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class LglReasonDto {
  @ApiProperty({ example: '사업 종료' }) @IsString() @Length(2, 200) reason!: string;
}
export class LglKindDto {
  @ApiPropertyOptional({ example: '통신판매업 신고' }) @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional({ example: '관할 시 · 군 · 구청' }) @IsOptional() @IsString() @Length(0, 100) authority?: string;
  @ApiPropertyOptional({ example: 12, description: 'null 이면 갱신 없음' }) @IsOptional() @IsInt() @Min(1) @Max(120) cycleMonths?: number | null;
  @ApiPropertyOptional({ example: '전자상거래법 제12조' }) @IsOptional() @IsString() @Length(0, 300) basis?: string;
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() active?: boolean;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}

/* ── v10.487 계약 검토 DTO ── */
export class LglReviewDto {
  @ApiProperty({ example: '물류 위탁 계약' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ enum: REVIEW_KINDS }) @IsOptional() @IsIn(REVIEW_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ example: '(주)물류' }) @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @ApiPropertyOptional({ example: '1', description: '⑯ 계약 대장 번호(갱신 · 변경 · 해지는 필수)' }) @IsOptional() @Matches(ID_RE) contractId?: string;
  @ApiPropertyOptional({ example: 12000000 }) @IsOptional() @IsInt() @Min(0) @Max(100000000000) amount?: number;
  @ApiPropertyOptional({ example: '2026-11-30' }) @IsOptional() @Matches(YMD_RE) wantedOn?: string;
  @ApiPropertyOptional({ example: '손해배상 한도 · 해지 조항 확인' }) @IsOptional() @IsString() @Length(0, 2000) summary?: string;
  @ApiProperty({ type: [String], description: '계약서(POST /files · LGL_DOC · 1 ~ 5개)' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds!: string[];
}
export class LglOpinionDto {
  @ApiPropertyOptional({ enum: REVIEW_RISKS }) @IsOptional() @IsIn(REVIEW_RISKS as unknown as string[]) risk?: string;
  @ApiProperty({ example: '제9조 손해배상 한도가 없음 — 계약금액 한도로 고칠 것' }) @IsString() @Length(2, 4000) body!: string;
  @ApiPropertyOptional({ example: false, description: '외부 변호사 의견을 옮겨 적음' }) @IsOptional() @StrictBoolean() outside?: boolean;
  @ApiPropertyOptional({ type: [String], description: '수정본(LGL_DOC · 3개)' }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID('all', { each: true }) fileIds?: string[];
}
export class LglDecideDto {
  @ApiProperty({ description: '승인(true) · 반려(false)' }) @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ example: '수정본으로 진행', description: '반려는 2자 이상' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class LglLinkDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) contractId!: string;
}

/* ── v10.488 사건 DTO ── */
export class LglCaseDto {
  @ApiPropertyOptional({ example: '2026가단12345' }) @IsOptional() @IsString() @Length(0, 60) caseRef?: string;
  @ApiProperty({ example: '물품대금 청구' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ enum: CASE_KINDS }) @IsOptional() @IsIn(CASE_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ enum: CASE_SIDES }) @IsOptional() @IsIn(CASE_SIDES as unknown as string[]) ourSide?: string;
  @ApiPropertyOptional({ example: '(주)상대' }) @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @ApiPropertyOptional({ example: '서울중앙지방법원' }) @IsOptional() @IsString() @Length(0, 100) forum?: string;
  @ApiPropertyOptional({ example: '법무법인 ○○ 변호사' }) @IsOptional() @IsString() @Length(0, 120) counsel?: string;
  @ApiPropertyOptional({ example: 30000000 }) @IsOptional() @IsInt() @Min(0) @Max(1000000000000) claimAmount?: number | null;
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @Matches(YMD_RE) openedOn?: string;
  @ApiPropertyOptional({ type: [String], description: '서류(LGL_DOC · 10개)' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) memo?: string;
}
export class LglCaseEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) caseRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) title?: string;
  @ApiPropertyOptional({ enum: CASE_SIDES }) @IsOptional() @IsIn(CASE_SIDES as unknown as string[]) ourSide?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) forum?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) counsel?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000000000) claimAmount?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) memo?: string;
}
export class LglHearingDto {
  @ApiProperty({ example: '2026-12-10T14:00', description: '시간대 없으면 한국 시각' }) @IsString() @Matches(AT_RE) at!: string;
  @ApiPropertyOptional({ enum: HEARING_KINDS }) @IsOptional() @IsIn(HEARING_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ example: '동관 456호 법정' }) @IsOptional() @IsString() @Length(0, 100) place?: string;
  @ApiPropertyOptional({ example: '1차 변론' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class LglHearingEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(AT_RE) at?: string;
  @ApiPropertyOptional({ enum: HEARING_KINDS }) @IsOptional() @IsIn(HEARING_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) place?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) note?: string;
  @ApiPropertyOptional({ enum: ['PLANNED', 'DONE', 'CANCELED'] }) @IsOptional() @IsIn(['PLANNED', 'DONE', 'CANCELED']) state?: string;
  @ApiPropertyOptional({ example: '다음 기일 지정' }) @IsOptional() @IsString() @Length(0, 400) outcome?: string;
}
export class LglCostDto {
  @ApiPropertyOptional({ enum: COST_KINDS }) @IsOptional() @IsIn(COST_KINDS as unknown as string[]) kind?: string;
  @ApiProperty({ example: 3300000 }) @IsInt() @Min(1) @Max(10000000000) amount!: number;
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) paidOn!: string;
  @ApiPropertyOptional({ example: '1', description: '경비 청구 번호(매입과 둘 중 하나)' }) @IsOptional() @Matches(ID_RE) expenseClaimId?: string;
  @ApiPropertyOptional({ example: '1', description: '매입 번호(세금계산서 받은 대리인 보수 등)' }) @IsOptional() @Matches(ID_RE) purchaseId?: string;
  @ApiPropertyOptional({ example: '착수금' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class LglCloseCaseDto {
  @ApiProperty({ enum: CASE_RESULTS }) @IsIn(CASE_RESULTS as unknown as string[]) result!: string;
  @ApiPropertyOptional({ example: '원고 청구 기각' }) @IsOptional() @IsString() @Length(0, 1000) resultNote?: string;
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @Matches(YMD_RE) closedOn?: string;
}

/* ── v10.489 보험 DTO ── */
export class LglPolicyDto {
  @ApiPropertyOptional({ enum: INS_KINDS }) @IsOptional() @IsIn(INS_KINDS as unknown as string[]) kind?: string;
  @ApiProperty({ example: '영업배상책임보험' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ example: '○○화재' }) @IsString() @Length(1, 100) insurer!: string;
  @ApiPropertyOptional({ example: 'P-2026-0001' }) @IsOptional() @IsString() @Length(0, 60) policyRef?: string;
  @ApiPropertyOptional({ example: 100000000 }) @IsOptional() @IsInt() @Min(0) @Max(1000000000000) coverage?: number | null;
  @ApiProperty({ example: 1200000 }) @IsInt() @Min(1) @Max(10000000000) premium!: number;
  @ApiProperty({ example: '2026-12-01' }) @Matches(YMD_RE) startsOn!: string;
  @ApiProperty({ example: '2027-12-01' }) @Matches(YMD_RE) endsOn!: string;
  @ApiPropertyOptional({ enum: INS_PAY_MODES }) @IsOptional() @IsIn(INS_PAY_MODES as unknown as string[]) payMode?: string;
  @ApiPropertyOptional({ enum: INS_BOOK_MODES, description: '월납은 바로 비용만' }) @IsOptional() @IsIn(INS_BOOK_MODES as unknown as string[]) bookMode?: string;
  @ApiPropertyOptional({ example: '1', description: '갱신하는 옛 증권 번호' }) @IsOptional() @Matches(ID_RE) renewedFrom?: string;
  @ApiPropertyOptional({ type: [String], description: '증권 · 약관(LGL_DOC · 5개)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class LglPolicyEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) insurer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) policyRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000000000) coverage?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class LglJournalDto {
  @ApiProperty({ enum: INS_POST_KINDS, description: 'PAY 일시납 낼 때 · AMORT 달마다 넘김(선급비용) · MONTHLY 월납' }) @IsIn(INS_POST_KINDS as unknown as string[]) kind!: string;
  @ApiPropertyOptional({ example: '2026-12', description: 'AMORT · MONTHLY 는 필수' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) ym?: string;
  @ApiPropertyOptional({ example: '2026-12-01', description: '전표 날짜(비우면 시작일 · 그 달 말일 · 낼 날)' }) @IsOptional() @Matches(YMD_RE) on?: string;
}

/** DTO 선택 칸(안 보내면 undefined)을 걸러 냄 — { ...옛값, ...dto } 로 덮지 않게(점검 3 교훈) */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
const actor = () => RequestCtx.actorId() ?? null;

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/legal')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LegalController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.486 인허가 ── */
  @Get('licenses')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'CLOSED'] })
  @ApiOperation({ summary: '회사 인허가 · 신고 목록 (v10.486)', description: '종류 · 번호 · 기관 · 다음 갱신일 · 남은 날 · 알림 차례(60 · 30 · 7일) · 담당 · 서류 · 종류 표.' })
  @ApiOkResponse({ type: Object })
  licenses(@Query('state') state?: string) { return licenseBoard(this.db, state); }

  @Get('licenses/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인허가 하나 · 갱신 기록 (v10.486)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  licenseOne(@Param('id') id: string) { return licenseOne(this.db, id); }

  @Post('licenses')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_LICENSE_ADD', 'SETTING')
  @ApiOperation({ summary: '인허가 넣기 (v10.486)', description: '주기 · 다음 갱신일을 비우면 종류 주기 · 신고일 + 주기(오늘 뒤 첫 날).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_LICENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_LICENSE_KIND · LGL_TITLE · LGL_DATE · LGL_CYCLE · LGL_FILE · LGL_OWNER' })
  addLicense(@Body() dto: LglLicenseDto) { return addLicense(this.db, defined(dto), actor()); }

  @Put('licenses/:id')
  @Roles('ADMIN')
  @Audit('LGL_LICENSE_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인허가 고치기 (v10.486)', description: '번호 · 기관 · 신고일 · 주기 · 다음 갱신일 · 담당 · 서류 · 메모 — 종류는 못 바꿈 · 끝낸 것 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_LICENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_DATE · LGL_CYCLE · LGL_FILE · LGL_OWNER' })
  updateLicense(@Param('id') id: string, @Body() dto: LglLicenseEditDto) { return updateLicense(this.db, id, defined(dto)); }

  @Post('licenses/:id/renew')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_LICENSE_RENEW', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인허가 갱신 · 재신고 · 납부 기록 (v10.486)', description: '쌓기만 · 다음 갱신일 바뀜 · 그 인허가 알림 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_LICENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_DATE · LGL_FILE' })
  renew(@Param('id') id: string, @Body() dto: LglRenewDto) { return renewLicense(this.db, id, defined(dto), actor()); }

  @Post('licenses/:id/close')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_LICENSE_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인허가 끝냄 (v10.486)', description: '폐업 · 반납 · 사유 · 되돌리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_LICENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_REASON' })
  closeLicense(@Param('id') id: string, @Body() dto: LglReasonDto) { return closeLicense(this.db, id, dto.reason); }

  @Put('license-kinds/:code')
  @Roles('SUPER')
  @Audit('LGL_LICENSE_KIND_SET', 'SETTING')
  @ApiParam({ name: 'code', example: 'MAIL_ORDER' })
  @ApiOperation({ summary: '인허가 종류 고치기 · 더하기 (v10.486 · SUPER)', description: '없는 코드면 새로(이름 필수) · 기관 · 갱신 주기 · 근거 · 쓰는지 — 처음 값은 일반 원칙(법무 확인).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_LICENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_LICENSE_KIND · LGL_CYCLE' })
  async setKind(@Param('code') code: string, @Body() dto: LglKindDto) { return setLicenseKind(this.db, code, defined(dto), actor()); }

  @Get('license-kinds')
  @Roles('ADMIN')
  @ApiOperation({ summary: '인허가 종류 (v10.486)', description: '코드 · 이름 · 기관 · 갱신 주기 · 근거 · 쓰는지.' })
  @ApiOkResponse({ type: Object })
  async kinds() { return { items: await licenseKinds(this.db) }; }

  @Get('due')
  @Roles('ADMIN')
  @ApiQuery({ name: 'days', required: false, example: '60' })
  @ApiOperation({ summary: '다가오는 법무 기한 (v10.486 ~ 489)', description: '지난 30일 + 앞으로 N일(처음 60) — 인허가 갱신 · 사건 기일 · 보험 만기 · 계약 검토 희망일.' })
  @ApiOkResponse({ type: Object })
  due(@Query('days') days?: string) { return legalDue(this.db, days); }

  /* ── v10.487 계약 검토 ── */
  @Get('reviews')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @ApiOperation({ summary: '계약 검토 요청 목록 (v10.487)', description: '요청 · 의견 수 · 가장 높은 위험 · 늦음 · 계약 대장(연결 고르기 최근 200).' })
  @ApiOkResponse({ type: Object })
  reviews(@Query('state') state?: string) { return reviewBoard(this.db, state); }

  @Get('reviews/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 검토 하나 · 의견 (v10.487)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  reviewOne(@Param('id') id: string) { return reviewOne(this.db, id); }

  @Post('reviews')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_REVIEW_ADD', 'SETTING')
  @ApiOperation({ summary: '계약 검토 요청 (v10.487)', description: '계약서 파일 1 ~ 5개(LGL_DOC) · 갱신 · 변경 · 해지는 계약 대장 계약 필수 · 검토 희망일은 오늘부터.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_AMOUNT · LGL_DATE · LGL_FILE · LGL_REVIEW_LINK' })
  addReview(@Body() dto: LglReviewDto) { return addReview(this.db, defined(dto), actor()); }

  @Post('reviews/:id/opinions')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_REVIEW_OPINION', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 검토 의견 (v10.487)', description: '요청한 사람 아님(403 LGL_SELF) · 위험 · 외부 변호사 의견 표시 · 첫 의견이면 REVIEWED.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_OPINION · LGL_FILE' })
  opinion(@Param('id') id: string, @Body() dto: LglOpinionDto) { return addOpinion(this.db, id, defined(dto), actor()); }

  @Post('reviews/:id/decide')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('LGL_REVIEW_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 검토 승인 · 반려 (v10.487 · SUPER)', description: '요청한 사람 아님 · 의견이 있어야 함(409) · 반려는 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_REASON' })
  decide(@Param('id') id: string, @Body() dto: LglDecideDto) { return decideReview(this.db, id, defined(dto), actor()); }

  @Post('reviews/:id/cancel')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_REVIEW_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 검토 취소 (v10.487)', description: '결정 전 · 요청한 사람 · SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_ROLE' })
  cancel(@Param('id') id: string) { return cancelReview(this.db, id, actor()); }

  @Post('reviews/:id/link')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_REVIEW_LINK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 검토 ↔ 계약 대장 연결 (v10.487)', description: '한 번 · 바꾸지 않음 · 반려 · 취소한 요청은 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_REVIEW_LINK · LGL_REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_REVIEW_LINK' })
  link(@Param('id') id: string, @Body() dto: LglLinkDto) { return linkReview(this.db, id, dto.contractId); }

  /* ── v10.488 사건 ── */
  @Get('cases')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['OPEN', 'CLOSED'] })
  @ApiOperation({ summary: '소송 · 분쟁 사건 대장 (v10.488)', description: '사건 · 다음 기일 · 지난 예정 기일 수 · 비용 합 · 60일 안 기일.' })
  @ApiOkResponse({ type: Object })
  cases(@Query('state') state?: string) { return caseBoard(this.db, state); }

  @Get('cases/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사건 하나 · 기일 · 비용 (v10.488)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  caseOne(@Param('id') id: string) { return caseOne(this.db, id); }

  @Post('cases')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_CASE_ADD', 'SETTING')
  @ApiOperation({ summary: '사건 넣기 (v10.488)', description: '회사가 당사자인 사건만 · 서류 LGL_DOC 10개.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_CASE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_DATE · LGL_AMOUNT · LGL_FILE' })
  addCase(@Body() dto: LglCaseDto) { return addCase(this.db, defined(dto), actor()); }

  @Put('cases/:id')
  @Roles('ADMIN')
  @Audit('LGL_CASE_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사건 고치기 (v10.488)', description: '번호 · 우리 쪽 · 상대 · 기관 · 대리인 · 소가 · 서류 · 메모 — 종류 · 시작일 못 바꿈 · 끝낸 것 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_CASE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_AMOUNT · LGL_FILE' })
  updateCase(@Param('id') id: string, @Body() dto: LglCaseEditDto) { return updateCase(this.db, id, defined(dto)); }

  @Post('cases/:id/hearings')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_HEARING_ADD', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기일 넣기 (v10.488)', description: '변론 · 기한 · 조정 · 그 밖 · 7 · 1일 전 운영 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_CASE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_HEARING_AT' })
  addHearing(@Param('id') id: string, @Body() dto: LglHearingDto) { return addHearing(this.db, id, defined(dto), actor()); }

  @Put('hearings/:id')
  @Roles('ADMIN')
  @Audit('LGL_HEARING_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기일 고치기 · 끝남 · 취소 (v10.488)', description: '예정일 때만 · 끝남 · 취소는 되돌리지 않음 · 알림 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_HEARING_STATE · LGL_CASE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_HEARING_AT · LGL_HEARING_STATE' })
  updateHearing(@Param('id') id: string, @Body() dto: LglHearingEditDto) { return updateHearing(this.db, id, defined(dto)); }

  @Post('cases/:id/costs')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_COST_ADD', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사건 비용 넣기 (v10.488)', description: '경비 청구 또는 매입 하나에 연결(같은 전표 두 번 409) · 전표는 회계 화면이 만듦.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_COST_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_AMOUNT · LGL_DATE · LGL_COST_LINK' })
  addCost(@Param('id') id: string, @Body() dto: LglCostDto) { return addCost(this.db, id, defined(dto), actor()); }

  @Post('costs/:id/void')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_COST_VOID', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사건 비용 무효 (v10.488)', description: '사유 · 기록은 남음 · 연결 전표는 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_COST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_REASON' })
  voidCost(@Param('id') id: string, @Body() dto: LglReasonDto) { return voidCost(this.db, id, dto.reason); }

  @Post('cases/:id/close')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_CASE_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사건 끝냄 (v10.488)', description: '결과 · 한 줄 · 끝난 날 · 남은 예정 기일 취소 · 되돌리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_CASE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_CASE_RESULT · LGL_DATE' })
  closeCase(@Param('id') id: string, @Body() dto: LglCloseCaseDto) { return closeCase(this.db, id, defined(dto)); }

  /* ── v10.489 보험 ── */
  @Get('insurance')
  @Roles('ADMIN', 'PAYOUT')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'ENDED'] })
  @ApiOperation({ summary: '회사 보험 증권 목록 (v10.489)', description: '종류 · 보험사 · 보험료 · 기간 · 남은 날 · 갱신 여부 · 만기 알림 날수.' })
  @ApiOkResponse({ type: Object })
  insurance(@Query('state') state?: string) { return insuranceBoard(this.db, state); }

  @Get('insurance/:id')
  @Roles('ADMIN', 'PAYOUT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보험 증권 하나 · 달마다 전표 계획 · 만든 초안 (v10.489)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  insuranceOne(@Param('id') id: string) { return insuranceOne(this.db, id); }

  @Post('insurance')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_INSURANCE_ADD', 'SETTING')
  @ApiOperation({ summary: '보험 증권 넣기 · 갱신 (v10.489)', description: '갱신은 renewedFrom(한 번 · 409) · 월납은 바로 비용 · 기간 10년 안.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_INSURANCE_RENEW' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_INSURER · LGL_AMOUNT · LGL_DATE · LGL_FILE · LGL_INSURANCE_RENEW' })
  addPolicy(@Body() dto: LglPolicyDto) { return addPolicy(this.db, defined(dto), actor()); }

  @Put('insurance/:id')
  @Roles('ADMIN')
  @Audit('LGL_INSURANCE_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보험 증권 고치기 (v10.489)', description: '이름 · 보험사 · 증권 번호 · 보장 · 서류 · 메모 — 보험료 · 기간 · 방법은 못 고침(끝내고 새로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_INSURANCE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_TITLE · LGL_INSURER · LGL_AMOUNT · LGL_FILE' })
  updatePolicy(@Param('id') id: string, @Body() dto: LglPolicyEditDto) { return updatePolicy(this.db, id, defined(dto)); }

  @Post('insurance/:id/end')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('LGL_INSURANCE_END', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보험 증권 끝냄 (v10.489)', description: '해지 · 만기 · 사유 · 되돌리지 않음 · 만기 알림 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_INSURANCE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_REASON' })
  endPolicy(@Param('id') id: string, @Body() dto: LglReasonDto) { return endPolicy(this.db, id, dto.reason); }

  @Post('insurance/:id/journal')
  @Roles('PAYOUT')
  @HttpCode(200)
  @Audit('LGL_INSURANCE_JOURNAL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보험료 전표 초안 (v10.489 · 지급 담당 · SUPER)', description: '수동 전표 요청으로 올림(쓴 사람이 아닌 SUPER 승인) · 같은 (증권 · 종류 · 달) 살아 있는 초안 409 · 마감한 달 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LGL_POSTING_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LGL_POSTING · ACCT_MANUAL · ACCT_MANUAL_CLOSED' })
  journal(@Param('id') id: string, @Body() dto: LglJournalDto) { return insuranceJournal(this.db, id, defined(dto), actor()); }
}
