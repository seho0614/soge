import { Body, Controller, Get, HttpCode, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import {
  LEVELS, accountDetail, myPerms, overview, permChanges, roleGroupDetail, saveAccount, saveRoleGroup, saveTask, saveTaskGroup, shadowLog, widenLog,
} from './perm.service';

/* ---------------------------------------------------------------------
 * v10.441 ~ 444 (D258 · docs/578 ~ 581) 업무별 권한 관리 — 운영 화면 「사무」 › 「권한 관리」(SUPER)
 *   GET  /admin/perm/me                        내 업무 · 수준 · 검사 모드(운영자 누구나 — 화면이 메뉴 · 단추를 고름)
 *   GET  /admin/perm/overview                  업무그룹 · 업무 · 권한그룹 · 운영자(SUPER)
 *   GET  /admin/perm/role-groups/{key}         권한그룹 항목(SUPER)
 *   PUT  /admin/perm/role-groups/{key}         권한그룹 만들기 · 고치기(항목 통째로 · 사유 · 감사 PERM_ROLE_GROUP_SET)
 *   PATCH /admin/perm/task-groups/{key}        업무그룹 이름 · 순서(감사 PERM_TASK_GROUP_SET)
 *   PATCH /admin/perm/tasks/{key}              업무의 업무그룹 · 쓰기(감사 PERM_TASK_SET)
 *   GET   /admin/perm/widen-log                권한 넓히기로 통과한 요청(perm.allow_widen · 처음 off)
 *   GET  /admin/perm/accounts/{id}             개인권한 · 미리보기(SUPER)
 *   PUT  /admin/perm/accounts/{id}             구분 · 그룹(기한) · 개별 더하기/빼기(감사 PERM_ACCOUNT_SET)
 *   GET  /admin/perm/shadow?days=7             막혔을(막은) 요청 기록
 *   GET  /admin/perm/changes                   바꾼 기록
 *   검사 모드(perm.enforce)는 「전체 설정」에서 — perm.* 은 SUPER 만 바꿈(admin.service).
 * ------------------------------------------------------------------- */

const STAFF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;   // SUPER 는 늘 통과

export class PermItemDto {
  @ApiProperty({ example: 'acct-purchase' }) @IsString() @Matches(/^[a-z][a-z0-9-]{1,40}$/) taskKey!: string;
  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS as unknown as string[]) level!: string;
}
export class PermRoleGroupDto {
  @ApiProperty({ example: '회계 담당' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ enum: ['STAFF', 'MANAGER'] }) @IsOptional() @IsIn(['STAFF', 'MANAGER']) kind?: string;
  @ApiPropertyOptional({ example: '매입 · 경비 · 재고' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ type: [PermItemDto] }) @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => PermItemDto) items!: PermItemDto[];
  @ApiProperty({ example: '회계 담당 새로 둠' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermTaskGroupDto {
  @ApiProperty({ example: '회계' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ example: 40 }) @IsOptional() @IsInt() @Min(0) @Max(100000) sort?: number;
  @ApiProperty({ example: '이름 바꿈' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermTaskDto {
  @ApiPropertyOptional({ example: 'admacc' }) @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_]{1,30}$/) groupKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ example: '업무그룹 옮김' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermAccountGroupDto {
  @ApiProperty({ example: 'R_PAYOUT' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,40}$/) key!: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsString() @Length(0, 30) expiresAt?: string | null;
}
export class PermOverrideDto {
  @ApiProperty({ example: 'acct-purchase' }) @IsString() @Matches(/^[a-z][a-z0-9-]{1,40}$/) taskKey!: string;
  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS as unknown as string[]) level!: string;
  @ApiProperty({ enum: ['ALLOW', 'DENY'] }) @IsIn(['ALLOW', 'DENY']) effect!: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsString() @Length(0, 30) expiresAt?: string | null;
  @ApiPropertyOptional({ example: '연말 결산 돕기' }) @IsOptional() @IsString() @Length(0, 400) reason?: string;
}
export class PermAccountDto {
  @ApiPropertyOptional({ enum: ['STAFF', 'MANAGER'] }) @IsOptional() @IsIn(['STAFF', 'MANAGER']) kind?: string;
  @ApiPropertyOptional({ type: [PermAccountGroupDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PermAccountGroupDto) groups?: PermAccountGroupDto[];
  @ApiPropertyOptional({ type: [PermOverrideDto] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PermOverrideDto) overrides?: PermOverrideDto[];
  @ApiProperty({ example: '회계 담당으로 옮김' }) @IsString() @Length(1, 400) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/perm')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PermController {
  constructor(private readonly db: DatabaseService) {}

  @Get('me')
  @Roles(...STAFF)
  @ApiOperation({ summary: '내 업무 권한 (v10.444)', description: '내 업무 · 수준 · 검사 모드(OFF · SHADOW · ON) · SUPER 여부. 화면이 메뉴 · 탭 · 「고치기」 단추를 고를 때 씀.' })
  @ApiOkResponse({ type: Object })
  me() { const c = RequestCtx.get(); return myPerms(this.db, RequestCtx.actorId() ?? '', c?.actorRole === 'SUPER' ? ['SUPER'] : []); }

  @Get('overview')
  @Roles('SUPER')
  @ApiOperation({ summary: '권한 관리 한눈에 (v10.443 · SUPER)', description: '업무그룹 · 업무(탭) · 권한그룹(항목 수 · 붙은 사람) · 운영자(역할 · 구분 · 그룹 · 개별 수) · 검사 모드.' })
  @ApiOkResponse({ type: Object })
  overview() { return overview(this.db); }

  @Get('role-groups/:key')
  @Roles('SUPER')
  @ApiParam({ name: 'key', example: 'R_PAYOUT' })
  @ApiOperation({ summary: '권한그룹 항목 (v10.443 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  roleGroup(@Param('key') key: string) { return roleGroupDetail(this.db, key); }

  @Put('role-groups/:key')
  @Roles('SUPER')
  @Audit('PERM_ROLE_GROUP_SET', 'SETTING')
  @ApiParam({ name: 'key', example: 'ACCT_STAFF' })
  @ApiOperation({ summary: '권한그룹 만들기 · 고치기 (v10.443 · SUPER)', description: '업무 × 수준(VIEW · EDIT · APPROVE · EXPORT) 항목을 통째로 바꿈 · 사유 · 바꾼 기록 · 운영 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_KEY · PERM_TASK · PERM_ITEMS · PERM_REASON' })
  saveRoleGroup(@Param('key') key: string, @Body() dto: PermRoleGroupDto) { return saveRoleGroup(this.db, key, dto, RequestCtx.actorId() ?? null); }

  @Patch('task-groups/:key')
  @Roles('SUPER')
  @Audit('PERM_TASK_GROUP_SET', 'SETTING')
  @ApiParam({ name: 'key', example: 'admacc' })
  @ApiOperation({ summary: '업무그룹 이름 · 순서 (v10.443 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_REASON' })
  saveTaskGroup(@Param('key') key: string, @Body() dto: PermTaskGroupDto) { return saveTaskGroup(this.db, key, dto, RequestCtx.actorId() ?? null); }

  @Patch('tasks/:key')
  @Roles('SUPER')
  @Audit('PERM_TASK_SET', 'SETTING')
  @ApiParam({ name: 'key', example: 'acct-purchase' })
  @ApiOperation({ summary: '업무의 업무그룹 · 쓰기 (v10.443 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_REASON' })
  saveTask(@Param('key') key: string, @Body() dto: PermTaskDto) { return saveTask(this.db, key, dto, RequestCtx.actorId() ?? null); }

  @Get('accounts/:id')
  @Roles('SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '개인권한 · 미리보기 (v10.443 · SUPER)', description: '역할 · 구분 · 그룹(기한) · 개별 더하기/빼기 · 지금 권한(업무 · 수준).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  account(@Param('id') id: string) { return accountDetail(this.db, id); }

  @Put('accounts/:id')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PERM_ACCOUNT_SET', 'ACCOUNT')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '개인권한 저장 (v10.443 · SUPER)', description: '구분(STAFF · MANAGER) · 권한그룹(기한) · 개별 더하기/빼기를 통째로 · 관리자 권한그룹은 MANAGER 에게만(DB) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_KIND · PERM_DATE · PERM_REASON' })
  saveAccount(@Param('id') id: string, @Body() dto: PermAccountDto) { return saveAccount(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Get('shadow')
  @Roles('SUPER')
  @ApiQuery({ name: 'days', required: false, example: '7' })
  @ApiOperation({ summary: '막혔을(막은) 요청 기록 (v10.442 · SUPER)', description: 'perm.enforce SHADOW 때 「권한그룹대로라면 막혔을」 요청 · ON 때 막은 요청(같은 사람 · 주소 10분에 한 번).' })
  @ApiOkResponse({ type: Object })
  shadow(@Query('days') days?: string) { return shadowLog(this.db, Number(days ?? 7)); }

  @Get('changes')
  @Roles('SUPER')
  @ApiOperation({ summary: '권한 바꾼 기록 (v10.443 · SUPER)' })
  @ApiOkResponse({ type: Object })
  changes() { return permChanges(this.db).then((items) => ({ items })); }

  @Get('widen-log')
  @Roles('SUPER')
  @ApiOperation({ summary: '권한 넓히기로 통과한 요청 (v10.442 · SUPER)', description: 'perm.allow_widen = on · perm.enforce = ON 일 때 역할로는 막히지만 권한그룹 · 개인권한으로 통과한 요청(최근 100 · 같은 사람 · 주소 10분에 한 번).' })
  @ApiOkResponse({ type: Object })
  widenLog() { return widenLog(this.db); }
}
