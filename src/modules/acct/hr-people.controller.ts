import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { myEmployee } from './hr';
import { KIND_CODE_RE, TRAINING_METHODS, addRecords, decideRecord, kinds, myTraining, setKind, submitMyTraining, trainingBoard, voidRecord } from './hr-training';
import { TEMPLATE_CODE_RE, TEMPLATE_KINDS, addTemplate, cancelContract, checkContract, contractOne, contracts, createContract, myContract, myContracts, sendContract, signMyContract, templates } from './hr-contract';
import { GRADES, advanceCycle, createCycle, cycleDetail, cycles, managerReview, myReviews, saveMySelf, setMyGoals } from './hr-review';
import { APPLICANT_EMAIL_RE, EMP_TYPES, SOURCES, STAGES, addApplicant, addInterview, createPosting, hireApplicant, moveStage, postingDetail, purgeNow, recruitBoard, updateInterview, updatePosting } from './hr-recruit';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * ㉛ 인사 3 (D262 · docs/596 ~ 599) — 대표 11/20 「다음개발 ㉛」
 *   본인(운영 역할 누구나 · 직원과 연결된 계정 · 세무사 제외 — D259 내 인사와 같음)
 *     GET  /admin/me/hr/more                        내 인사 더 — 의무교육 · 근로계약서 · 평가
 *     POST /admin/me/hr/training                    이수 제출(증빙 필수)
 *     GET  /admin/me/hr/contracts/{id}              내 계약서(보낸 것 · 서명본)
 *     POST /admin/me/hr/contracts/{id}/sign         서명(간주 · 시험 서명 · 이름 = 직원 이름)
 *     PUT  /admin/me/hr/reviews/{cycleId}/goals     내 목표(목표 단계 · 가중치 합 100)
 *     POST /admin/me/hr/reviews/{cycleId}/self      자기 평가 저장 · 제출
 *   관리자(ADMIN · SUPER) — 모두 /admin/hr 아래라 세무사(ACCOUNTANT · /admin/acct GET 만)는 못 봄
 *     v10.458 의무교육   GET /admin/hr/training · GET /admin/hr/training/kinds · PUT /admin/hr/training/kinds/{code}(SUPER)
 *                        POST /admin/hr/training/records · POST …/records/{id}/decide · POST …/records/{id}/void
 *     v10.459 근로계약서 GET /admin/hr/contracts · GET|POST /admin/hr/contracts/templates · POST /admin/hr/contracts · GET /admin/hr/contracts/{id}
 *                        POST …/{id}/send · POST …/{id}/check · POST …/{id}/cancel
 *     v10.460 평가       GET|POST /admin/hr/reviews · GET /admin/hr/reviews/{id} · POST …/{id}/advance · PUT …/{id}/employees/{employeeId}
 *     v10.461 채용       GET /admin/hr/recruit · POST /admin/hr/recruit/postings · PUT|GET …/postings/{id} · POST /admin/hr/recruit/applicants
 *                        POST …/applicants/{id}/stage · …/interviews · …/hire · …/purge · PUT /admin/hr/recruit/interviews/{id}
 * ------------------------------------------------------------------- */

const SELF = ['REVIEWER', 'ADMIN', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d{1,18}$/;

/* ── v10.458 의무교육 DTO ── */
export class HreKindDto {
  @ApiPropertyOptional({ example: '직장 내 성희롱 예방교육' }) @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional({ example: '남녀고용평등법 제13조 — 연 1회 이상' }) @IsOptional() @IsString() @Length(0, 200) basis?: string;
  @ApiPropertyOptional({ enum: [6, 12], description: '6 반기 · 12 연' }) @IsOptional() @IsInt() @IsIn([6, 12]) cycleMonths?: number;
  @ApiPropertyOptional({ example: 1, description: '기간마다 최소 이수 시간(0.1 ~ 40)' }) @IsOptional() @IsNumber() @Min(0.1) @Max(40) minHours?: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() active?: boolean;
  @ApiPropertyOptional({ example: 50 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}
export class HreRecordDto {
  @ApiProperty({ type: [String], example: ['1', '2'], description: '직원 번호(1 ~ 200명)' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) @Matches(ID_RE, { each: true }) employeeIds!: string[];
  @ApiProperty({ example: 'SEXUAL_HARASSMENT' }) @IsString() @Matches(KIND_CODE_RE) kind!: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) doneOn!: string;
  @ApiProperty({ example: 1 }) @IsNumber() @Min(0.1) @Max(40) hours!: number;
  @ApiPropertyOptional({ enum: TRAINING_METHODS }) @IsOptional() @IsIn(TRAINING_METHODS as unknown as string[]) method?: string;
  @ApiPropertyOptional({ example: '사내 집합 교육' }) @IsOptional() @IsString() @Length(0, 100) provider?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '증빙(POST /files · HR_DOC)' }) @IsOptional() @IsUUID() fileId?: string;
  @ApiPropertyOptional({ example: '전 직원 집합 교육' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HreMyRecordDto {
  @ApiProperty({ example: 'PRIVACY' }) @IsString() @Matches(KIND_CODE_RE) kind!: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) doneOn!: string;
  @ApiProperty({ example: 1 }) @IsNumber() @Min(0.1) @Max(40) hours!: number;
  @ApiPropertyOptional({ enum: TRAINING_METHODS }) @IsOptional() @IsIn(TRAINING_METHODS as unknown as string[]) method?: string;
  @ApiPropertyOptional({ example: '고용노동부 온라인 교육' }) @IsOptional() @IsString() @Length(0, 100) provider?: string;
  @ApiProperty({ format: 'uuid', description: '이수증(POST /files · HR_DOC · 본인이 올린 것)' }) @IsUUID() fileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HreDecideDto {
  @ApiProperty({ enum: ['CONFIRM', 'REJECT'] }) @IsIn(['CONFIRM', 'REJECT']) decision!: string;
  @ApiPropertyOptional({ example: '이수증 날짜가 다름', description: '돌려보낼 때 2자 이상' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
}
export class HreReasonDto {
  @ApiProperty({ example: '잘못 넣음' }) @IsString() @Length(2, 200) reason!: string;
}

/* ── v10.459 근로계약서 DTO ── */
export class HreTemplateDto {
  @ApiProperty({ example: 'STANDARD' }) @IsString() @Matches(TEMPLATE_CODE_RE) code!: string;
  @ApiProperty({ example: '표준 근로계약서' }) @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional({ enum: TEMPLATE_KINDS }) @IsOptional() @IsIn(TEMPLATE_KINDS as unknown as string[]) kind?: string;
  @ApiProperty({ description: '본문(자리표 {{name}} · {{startOn}} · {{wage}} …)' }) @IsString() @Length(20, 20000) body!: string;
}
export class HreTermsDto {
  @ApiPropertyOptional({ example: '(주)한국바이오헬스케어 소개뱅크 사업부' }) @IsOptional() @IsString() @Length(0, 200) company?: string;
  @ApiProperty({ example: '2026-12-01' }) @Matches(YMD_RE) startOn!: string;
  @ApiPropertyOptional({ example: '2027-11-30' }) @IsOptional() @Matches(YMD_RE) endOn?: string;
  @ApiPropertyOptional({ example: '본사 사무실' }) @IsOptional() @IsString() @Length(0, 200) place?: string;
  @ApiPropertyOptional({ example: '운영 · 고객 응대' }) @IsOptional() @IsString() @Length(0, 200) duties?: string;
  @ApiPropertyOptional({ example: '09:00 ~ 18:00' }) @IsOptional() @IsString() @Length(0, 200) workTime?: string;
  @ApiPropertyOptional({ example: '12:00 ~ 13:00' }) @IsOptional() @IsString() @Length(0, 200) breakTime?: string;
  @ApiPropertyOptional({ example: '월 ~ 금' }) @IsOptional() @IsString() @Length(0, 200) workDays?: string;
  @ApiPropertyOptional({ example: '일요일' }) @IsOptional() @IsString() @Length(0, 200) holiday?: string;
  @ApiPropertyOptional({ example: '월급' }) @IsOptional() @IsString() @Length(0, 200) wageType?: string;
  @ApiPropertyOptional({ example: '3,000,000' }) @IsOptional() @Matches(/^[0-9,]{1,15}$/) wage?: string;
  @ApiPropertyOptional({ example: '25' }) @IsOptional() @Matches(/^([1-9]|[12][0-9]|3[01])$/) payDay?: string;
  @ApiPropertyOptional({ example: '근로자 명의 예금 통장에 입금' }) @IsOptional() @IsString() @Length(0, 200) payMethod?: string;
}
export class HreContractDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) employeeId!: string;
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) templateId!: string;
  @ApiPropertyOptional({ example: '2026 근로계약서' }) @IsOptional() @IsString() @Length(0, 100) title?: string;
  @ApiProperty({ type: HreTermsDto }) @ValidateNested() @Type(() => HreTermsDto) terms!: HreTermsDto;
}
export class HreSignDto {
  @ApiProperty({ example: '홍길동', description: '직원 이름과 같아야 함' }) @IsString() @Length(1, 40) signerName!: string;
  @ApiProperty({ example: true }) @StrictBoolean() agree!: boolean;
  @ApiPropertyOptional({ description: '본 본문 지문(다르면 409)' }) @IsOptional() @Matches(/^[0-9a-f]{64}$/) docHash?: string;
}

/* ── v10.460 평가 DTO ── */
export class HreCycleDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(4) quarter!: number;
  @ApiPropertyOptional({ example: '2026년 4분기 평가' }) @IsOptional() @IsString() @Length(0, 60) title?: string;
  @ApiPropertyOptional({ example: '2026-10-15' }) @IsOptional() @Matches(YMD_RE) goalDue?: string;
  @ApiPropertyOptional({ example: '2027-01-10' }) @IsOptional() @Matches(YMD_RE) reviewDue?: string;
}
export class HreGoalDto {
  @ApiProperty({ example: '고객 문의 하루 안 답변 95%' }) @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional({ example: '1:1 문의 처리 지표' }) @IsOptional() @IsString() @Length(0, 200) measure?: string;
  @ApiProperty({ example: 50 }) @IsInt() @Min(1) @Max(100) weight!: number;
}
export class HreGoalsDto {
  @ApiProperty({ type: [HreGoalDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => HreGoalDto) goals!: HreGoalDto[];
}
export class HreScoreDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) goalId!: string;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(5) score!: number;
  @ApiPropertyOptional({ example: '목표보다 조금 넘김' }) @IsOptional() @IsString() @Length(0, 300) note?: string;
}
export class HreSelfDto {
  @ApiPropertyOptional({ type: [HreScoreDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => HreScoreDto) scores?: HreScoreDto[];
  @ApiPropertyOptional({ example: '분기 동안 한 일' }) @IsOptional() @IsString() @Length(0, 1000) comment?: string;
  @ApiPropertyOptional({ example: false, description: 'true 면 제출(뒤 못 고침 · 모든 목표 점수 필요)' }) @IsOptional() @StrictBoolean() submit?: boolean;
}
export class HreMgrDto {
  @ApiPropertyOptional({ type: [HreScoreDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => HreScoreDto) scores?: HreScoreDto[];
  @ApiPropertyOptional({ example: '잘함' }) @IsOptional() @IsString() @Length(0, 1000) comment?: string;
  @ApiPropertyOptional({ enum: GRADES }) @IsOptional() @IsIn(GRADES as unknown as string[]) grade?: string;
}

/* ── v10.461 채용 DTO ── */
export class HrePostingDto {
  @ApiProperty({ example: '운영 담당 채용' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: '운영' }) @IsOptional() @IsString() @Length(0, 60) dept?: string;
  @ApiPropertyOptional({ enum: EMP_TYPES }) @IsOptional() @IsIn(EMP_TYPES as unknown as string[]) empType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) opensOn!: string;
  @ApiProperty({ example: '2026-12-20' }) @Matches(YMD_RE) closesOn!: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'CLOSED'] }) @IsOptional() @IsIn(['DRAFT', 'OPEN', 'CLOSED']) state?: string;
}
export class HrePostingEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) dept?: string;
  @ApiPropertyOptional({ enum: EMP_TYPES }) @IsOptional() @IsIn(EMP_TYPES as unknown as string[]) empType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(YMD_RE) opensOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(YMD_RE) closesOn?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'CLOSED'] }) @IsOptional() @IsIn(['DRAFT', 'OPEN', 'CLOSED']) state?: string;
}
export class HreApplicantDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) postingId!: string;
  @ApiProperty({ example: '김지원' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ example: 'apply@example.com' }) @IsOptional() @IsString() @Length(0, 200) @Matches(APPLICANT_EMAIL_RE) email?: string;
  @ApiPropertyOptional({ example: '01012345678' }) @IsOptional() @IsString() @Length(0, 20) phone?: string;
  @ApiPropertyOptional({ enum: SOURCES }) @IsOptional() @IsIn(SOURCES as unknown as string[]) source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) memo?: string;
  @ApiPropertyOptional({ type: [String], description: '서류(POST /files · HR_DOC · 본인이 새로 올린 것 · 3개)' }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID('all', { each: true }) fileIds?: string[];
}
export class HreStageDto {
  @ApiProperty({ enum: STAGES.filter((s) => s !== 'HIRED') }) @IsIn(STAGES.filter((s) => s !== 'HIRED')) stage!: string;
  @ApiPropertyOptional({ example: '경력 맞지 않음' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HreInterviewDto {
  @ApiProperty({ example: '2026-11-25T10:00:00+09:00' }) @IsString() @Length(10, 40) at!: string;
  @ApiPropertyOptional({ example: '본사 회의실' }) @IsOptional() @IsString() @Length(0, 100) place?: string;
  @ApiPropertyOptional({ example: '대표 · 운영 팀장' }) @IsOptional() @IsString() @Length(0, 200) interviewers?: string;
}
export class HreInterviewEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 40) at?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) place?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) interviewers?: string;
  @ApiPropertyOptional({ enum: ['PASS', 'FAIL', 'HOLD'] }) @IsOptional() @IsIn(['PASS', 'FAIL', 'HOLD']) result?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
}
export class HreHireDto {
  @ApiProperty({ example: '2026-12-01' }) @Matches(YMD_RE) joinedOn!: string;
  @ApiPropertyOptional({ example: 3000000 }) @IsOptional() @IsInt() @Min(0) @Max(100000000) monthlyBase?: number;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Max(11) dependents?: number;
}

/** DTO 선택 칸(안 보내면 undefined)을 걸러 냄 — { ...옛값, ...dto } 로 덮지 않게(점검 3 교훈) */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
const actor = () => RequestCtx.actorId() ?? null;

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HrPeopleController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 본인 ── */
  @Get('me/hr/more')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 인사 더 — 의무교육 · 근로계약서 · 평가 (v10.458 ~ 460)', description: '연결된 직원의 지금 기간 의무교육 이수 · 내 이수 기록 · 받은 근로계약서 · 최근 평가 4개(상사 점수 · 등급은 닫은 뒤만). 연결 안 됐으면 linked=false.' })
  @ApiOkResponse({ type: Object })
  async more() {
    const me = await myEmployee(this.db, actor());
    if (!me) return { linked: false, note: '이 계정에 연결된 직원이 없습니다 — SUPER 에게 연결을 부탁하십시오(회계 › 인사 › 근태).' };
    return { linked: true, employee: { id: me.id, name: me.name }, training: await myTraining(this.db, me.id), contracts: await myContracts(this.db, me.id), reviews: await myReviews(this.db, me.id) };
  }

  @Post('me/hr/training')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '의무교육 이수 제출 (v10.458)', description: '본인 · 증빙 파일(HR_DOC · 본인이 올린 것) 필수 · 관리자가 확인하면 이수로 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · TRAINING_FILE · TRAINING_DATE · TRAINING_HOURS · TRAINING_KIND_OFF' })
  submitTraining(@Body() dto: HreMyRecordDto) { return submitMyTraining(this.db, actor(), defined(dto) as HreMyRecordDto); }

  @Get('me/hr/contracts/:id')
  @Roles(...SELF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '내 근로계약서 (v10.459)', description: '보낸 것 · 서명본만 · 본문 · 지문 · 서명 시각 · 서명 길(간주면 법적 전자서명 아님 표시).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED' })
  myContract(@Param('id') id: string) { return myContract(this.db, actor(), id); }

  @Post('me/hr/contracts/:id/sign')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('HR_CONTRACT_SIGN', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근로계약서 서명 (v10.459)', description: '간주(ASSUME) · STUB · MOCK 만 화면 안 서명 · 이름 = 직원 이름 · 동의 필수 · HTTP 는 업체 화면(409 ESIGN_EXTERNAL).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE · ESIGN_EXTERNAL · CONTRACT_HASH' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · CONTRACT_AGREE · CONTRACT_SIGNER' })
  sign(@Param('id') id: string, @Body() dto: HreSignDto) { return signMyContract(this.db, actor(), id, dto, RequestCtx.get()?.userAgent ?? null); }

  @Put('me/hr/reviews/:cycleId/goals')
  @Roles(...SELF)
  @ApiParam({ name: 'cycleId', example: '1' })
  @ApiOperation({ summary: '내 분기 목표 (v10.460)', description: '목표 단계에서만 · 통째로 바꿈 · 1 ~ 10개 · 가중치 합 100.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · REVIEW_GOALS · REVIEW_WEIGHT' })
  goals(@Param('cycleId') cycleId: string, @Body() dto: HreGoalsDto) { return setMyGoals(this.db, actor(), cycleId, dto.goals); }

  @Post('me/hr/reviews/:cycleId/self')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'cycleId', example: '1' })
  @ApiOperation({ summary: '자기 평가 (v10.460)', description: '평가 단계에서만 · 점수 1 ~ 5 · 의견 · submit=true 면 제출(모든 목표 점수 필요 · 뒤 못 고침).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REVIEW_STATE · REVIEW_SUBMITTED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · REVIEW_GOALS · REVIEW_GOAL · REVIEW_SCORE' })
  self(@Param('cycleId') cycleId: string, @Body() dto: HreSelfDto) { return saveMySelf(this.db, actor(), cycleId, defined(dto)); }

  /* ── v10.458 의무교육(관리자) ── */
  @Get('hr/training')
  @Roles('ADMIN')
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiOperation({ summary: '법정 의무교육 현황 (v10.458)', description: '종류마다 그 해 기간(연 · 반기) · 직원별 확인 시간 · 이수 · 기한 상태(DUE · OVERDUE) · 기다리는 제출 · 최근 기록 100줄.' })
  @ApiOkResponse({ type: Object })
  training(@Query('year') year?: string) { return trainingBoard(this.db, year); }

  @Get('hr/training/kinds')
  @Roles('ADMIN')
  @ApiOperation({ summary: '의무교육 종류 (v10.458)', description: '코드 · 이름 · 근거 · 주기(6 · 12달) · 최소 시간 · 쓰는지 — 처음 4개는 일반 원칙 값.' })
  @ApiOkResponse({ type: Object })
  async kindList() { return { items: await kinds(this.db), methods: TRAINING_METHODS }; }

  @Put('hr/training/kinds/:code')
  @Roles('SUPER')
  @Audit('HR_TRAINING_KIND_SET', 'SETTING')
  @ApiParam({ name: 'code', example: 'SAFETY' })
  @ApiOperation({ summary: '의무교육 종류 고치기 · 더하기 (v10.458 · SUPER)', description: '없는 코드면 새로(이름 · 주기 · 최소 시간 필수) · 이수 기록이 있으면 주기는 못 바꿈(409).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRAINING_KIND_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRAINING_KIND' })
  setKind(@Param('code') code: string, @Body() dto: HreKindDto) { return setKind(this.db, code, defined(dto), actor()); }

  @Post('hr/training/records')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_TRAINING_ADD', 'SETTING')
  @ApiOperation({ summary: '의무교육 이수 등록 (v10.458)', description: '여러 직원 한 번에(집합 교육) · 확인으로 들어감 · 등록하는 관리자 본인 줄은 제출로(다른 관리자 확인).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRAINING_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRAINING_EMPLOYEES · TRAINING_DATE · TRAINING_HOURS · TRAINING_FILE · TRAINING_KIND_OFF' })
  addRecords(@Body() dto: HreRecordDto) { return addRecords(this.db, defined(dto) as HreRecordDto, actor()); }

  @Post('hr/training/records/:id/decide')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_TRAINING_DECIDE', 'SETTING', { pick: ['ok', 'id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이수 제출 확인 · 돌려보냄 (v10.458)', description: '본인 것 아님(403 HR_SELF) · 제출 상태만 · 돌려보냄은 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRAINING_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRAINING_REASON · TRAINING_DECISION' })
  decide(@Param('id') id: string, @Body() dto: HreDecideDto) { return decideRecord(this.db, id, dto.decision, dto.reason, actor()); }

  @Post('hr/training/records/:id/void')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_TRAINING_VOID', 'SETTING', { pick: ['ok', 'id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이수 기록 무효 (v10.458)', description: '확인한 줄만 · 본인 것 아님 · 사유 · 기록은 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRAINING_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRAINING_REASON' })
  voidRec(@Param('id') id: string, @Body() dto: HreReasonDto) { return voidRecord(this.db, id, dto.reason, actor()); }

  /* ── v10.459 근로계약서(관리자) ── */
  @Get('hr/contracts')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['DRAFT', 'SENT', 'SIGNED', 'CANCELED'] })
  @ApiOperation({ summary: '근로계약서 목록 (v10.459)', description: '계약서 · 상태 · 서명 길 · 지금 서명 길(hr.contract_esign · esign.provider) · 준비 여부 · 직원(계정 연결).' })
  @ApiOkResponse({ type: Object })
  contractList(@Query('state') state?: string) { return contracts(this.db, state); }

  @Get('hr/contracts/templates')
  @Roles('ADMIN')
  @ApiOperation({ summary: '근로계약서 양식 (v10.459)', description: '코드 · 판 · 본문 · 쓰는 판 · 조건 칸 이름.' })
  @ApiOkResponse({ type: Object })
  templateList() { return templates(this.db); }

  @Post('hr/contracts/templates')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_CONTRACT_TEMPLATE', 'SETTING')
  @ApiOperation({ summary: '근로계약서 양식 새 판 (v10.459)', description: '같은 코드면 판 +1(옛 판은 쓰지 않음) · 본문은 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CONTRACT_TEMPLATE' })
  addTemplate(@Body() dto: HreTemplateDto) { return addTemplate(this.db, defined(dto) as HreTemplateDto, actor()); }

  @Post('hr/contracts')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_CONTRACT_CREATE', 'SETTING', { pick: ['ok', 'id', 'docHash'] })
  @ApiOperation({ summary: '근로계약서 초안 (v10.459)', description: '직원 · 양식 판 · 조건 → 본문 · SHA-256 지문 고정(못 고침 · 취소하고 새로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CONTRACT_INPUT · CONTRACT_TEMPLATE_OFF' })
  create(@Body() dto: HreContractDto) {
    return createContract(this.db, { employeeId: dto.employeeId, templateId: dto.templateId, title: dto.title, terms: defined(dto.terms ?? ({} as HreTermsDto)) as Record<string, unknown> }, actor());
  }

  @Get('hr/contracts/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근로계약서 한 장 (v10.459 · 인쇄용)', description: '본문 · 지문 · 상태 · 서명 기록(서명본).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  contract(@Param('id') id: string) { return contractOne(this.db, id); }

  @Post('hr/contracts/:id/send')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_CONTRACT_SEND', 'SETTING', { pick: ['ok', 'id', 'signMode', 'stub'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근로계약서 보내기 (v10.459)', description: '초안만 · 직원 계정 연결 필요 · 서명 길 = hr.contract_esign off 면 간주 · on 이면 esign.provider(HTTP 키 없으면 422 NOT_READY).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE · CONTRACT_HASH · ESIGN_FAILED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'NOT_READY · HR_NOT_LINKED' })
  send(@Param('id') id: string) { return sendContract(this.db, id, actor()); }

  @Post('hr/contracts/:id/check')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근로계약서 업체 상태 확인 (v10.459)', description: 'HTTP 로 보낸 것만 업체 상태를 읽어 서명 · 취소 반영 · 화면 안 서명이면 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE · ESIGN_FAILED · CONTRACT_HASH' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'NOT_READY' })
  check(@Param('id') id: string) { return checkContract(this.db, id); }

  @Post('hr/contracts/:id/cancel')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_CONTRACT_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근로계약서 취소 (v10.459)', description: '초안 · 보낸 것만 · 사유 · 서명본은 취소 못 함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CONTRACT_REASON' })
  cancel(@Param('id') id: string, @Body() dto: HreReasonDto) { return cancelContract(this.db, id, dto.reason); }

  /* ── v10.460 평가(관리자) ── */
  @Get('hr/reviews')
  @Roles('ADMIN')
  @ApiOperation({ summary: '인사 평가 차례 (v10.460)', description: '해 · 분기 · 상태 · 목표 적은 직원 · 자기 평가 제출 · 등급 정한 수 · 등급 기준.' })
  @ApiOkResponse({ type: Object })
  reviewList() { return cycles(this.db); }

  @Post('hr/reviews')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_REVIEW_CYCLE', 'SETTING')
  @ApiOperation({ summary: '평가 차례 만들기 (v10.460)', description: '해 · 분기 하나에 하나(있으면 409) · 목표 단계로 시작.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REVIEW_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REVIEW_INPUT' })
  createCycle(@Body() dto: HreCycleDto) { return createCycle(this.db, defined(dto) as HreCycleDto, actor()); }

  @Get('hr/reviews/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '평가 차례 한눈에 (v10.460)', description: '그 분기 다닌 직원마다 목표 · 가중치 합 · 자기 점수 · 상사 점수 · 가중 평균 · 등급 제안 · 결과.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  cycle(@Param('id') id: string) { return cycleDetail(this.db, id); }

  @Post('hr/reviews/:id/advance')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_REVIEW_ADVANCE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '평가 차례 다음 단계 (v10.460)', description: '목표 → 평가 → 닫음(앞으로만 · 닫으면 못 고침 · 직원에게 결과 보임).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REVIEW_INPUT' })
  advance(@Param('id') id: string) { return advanceCycle(this.db, id, actor()); }

  @Put('hr/reviews/:id/employees/:employeeId')
  @Roles('ADMIN')
  @Audit('HR_REVIEW_MANAGER', 'SETTING', { pick: ['ok', 'cycleId', 'employeeId', 'mgrAvg', 'suggested', 'grade'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'employeeId', example: '1' })
  @ApiOperation({ summary: '상사 평가 (v10.460)', description: '평가 단계에서만 · 본인 아님(403 HR_SELF) · 목표 점수 1 ~ 5 · 의견 · 등급(S ~ D · 점수 먼저).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REVIEW_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REVIEW_GOAL · REVIEW_SCORE · REVIEW_GRADE' })
  manager(@Param('id') id: string, @Param('employeeId') employeeId: string, @Body() dto: HreMgrDto) { return managerReview(this.db, id, employeeId, defined(dto), actor()); }

  /* ── v10.461 채용(관리자) ── */
  @Get('hr/recruit')
  @Roles('ADMIN')
  @ApiOperation({ summary: '채용 한눈에 (v10.461)', description: '공고 · 단계별 지원자 수 · 다가오는 면접 · 파기 기다림 · 보관 기간(hr.applicant_retention_days).' })
  @ApiOkResponse({ type: Object })
  recruit() { return recruitBoard(this.db); }

  @Post('hr/recruit/postings')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_POSTING_CREATE', 'SETTING')
  @ApiOperation({ summary: '채용 공고 만들기 (v10.461)', description: '제목 · 부서 · 고용 형태 · 기간 · 처음 초안.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  createPosting(@Body() dto: HrePostingDto) { return createPosting(this.db, defined(dto), actor()); }

  @Put('hr/recruit/postings/:id')
  @Roles('ADMIN')
  @Audit('HR_POSTING_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '채용 공고 고치기 · 열기 · 마감 (v10.461)', description: '마감한 공고는 못 고침 · 연 공고는 초안으로 못 돌림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  editPosting(@Param('id') id: string, @Body() dto: HrePostingEditDto) { return updatePosting(this.db, id, defined(dto)); }

  @Get('hr/recruit/postings/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '채용 공고 · 지원자 (v10.461)', description: '지원자(연락처 가림 · 서류 파일 번호) · 단계 · 파기 예정일 · 면접.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  posting(@Param('id') id: string) { return postingDetail(this.db, id); }

  @Post('hr/recruit/applicants')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_APPLICANT_ADD', 'SETTING', { pick: ['ok', 'id'] })
  @ApiOperation({ summary: '지원자 넣기 (v10.461)', description: '이름 + 메일 또는 휴대폰 · 서류 3개(HR_DOC · 본인이 새로 올린 것) · 초안 공고는 안 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT · RECRUIT_FILE' })
  addApplicant(@Body() dto: HreApplicantDto) { return addApplicant(this.db, defined(dto) as HreApplicantDto, actor()); }

  @Post('hr/recruit/applicants/:id/stage')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_APPLICANT_STAGE', 'SETTING', { pick: ['ok', 'id', 'stage', 'purgeDueOn'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '지원 단계 (v10.461)', description: '앞으로만 · 불합격 · 철회면 파기 예정일(결정일 + 보관 기간).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE · RECRUIT_PURGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_STAGE' })
  stage(@Param('id') id: string, @Body() dto: HreStageDto) { return moveStage(this.db, id, dto.stage, dto.note); }

  @Post('hr/recruit/applicants/:id/interviews')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_INTERVIEW_ADD', 'SETTING', { pick: ['ok', 'id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '면접 일정 (v10.461)', description: '끝나지 않은 지원자 · 지원 · 서류 단계면 면접 단계로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE · RECRUIT_PURGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  interview(@Param('id') id: string, @Body() dto: HreInterviewDto) { return addInterview(this.db, id, defined(dto) as HreInterviewDto, actor()); }

  @Put('hr/recruit/interviews/:id')
  @Roles('ADMIN')
  @Audit('HR_INTERVIEW_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '면접 결과 · 고치기 (v10.461)', description: '시각 · 장소 · 면접관 · 결과(PASS · FAIL · HOLD) · 메모 · 파기한 지원자는 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_PURGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  editInterview(@Param('id') id: string, @Body() dto: HreInterviewEditDto) { return updateInterview(this.db, id, defined(dto)); }

  @Post('hr/recruit/applicants/:id/hire')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_APPLICANT_HIRE', 'SETTING', { pick: ['ok', 'id', 'employeeId'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '합격 → 직원 대장 (v10.461)', description: '끝나지 않은 지원자 · 직원 대장 줄(이름 · 입사일 · 월 기본급 · 부양가족) 만들고 연결.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE · RECRUIT_PURGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  hire(@Param('id') id: string, @Body() dto: HreHireDto) { return hireApplicant(this.db, id, defined(dto) as HreHireDto, actor()); }

  @Post('hr/recruit/applicants/:id/purge')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '지원자 지금 파기 (v10.461)', description: '불합격 · 철회만 · 서류 파일 지움 · 연락처 · 메모 비움 · 파기 기록 · 감사 기록 HR_APPLICANT_PURGE(되돌릴 수 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECRUIT_STATE · RECRUIT_PURGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECRUIT_INPUT' })
  purge(@Param('id') id: string) { return purgeNow(this.db, id, actor()); }
}
