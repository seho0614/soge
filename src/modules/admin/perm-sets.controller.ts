import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { LEVELS } from './perm.service';
import {
  conflictList, createTask, permStaffList, roleGroupSets, saveConflict, saveRoleGroupSets, saveTaskGroupFull, saveTaskInfo, taskGroupList, taskList,
} from './perm-sets';
import { PERM_MODES, modeView, setMode, unmappedRoutes } from './perm-mode';

/* ---------------------------------------------------------------------
 * v10.562 · 563 · 564 (D291 · docs/704 · 705 · 706) 업무 목록 → 업무그룹 → 권한그룹 → 사원에게 부여 · 판정 바꾸기 — 모두 SUPER
 *   (perm.controller.ts 와 같은 앞머리 /admin/perm · 주소가 겹치지 않게 나눔 — 옛 PATCH tasks/{key} · PATCH task-groups/{key} · PUT role-groups/{key} 는 그대로)
 *   GET  /admin/perm/tasks                       업무 목록(이름 · 설명 · 수준 · 켜짐 · 업무그룹 여럿 · 주소 연결 수)
 *   POST /admin/perm/tasks                       업무 더하기(탭에는 있는데 업무에 없는 것)
 *   PUT  /admin/perm/tasks/{key}                 이름 · 설명 · 수준 · 켜고 끄기
 *   GET  /admin/perm/task-groups                 업무그룹 · 든 업무
 *   PUT  /admin/perm/task-groups/{key}           업무그룹 만들기 · 고치기 · 끄기 · 업무 넣고 빼기(여러 그룹에 들 수 있음)
 *   GET  /admin/perm/role-groups/{key}/sets      권한그룹 세트(업무그룹 × 수준) · 업무 더하기/빼기 · 실제 여는 업무 · 조합
 *   PUT  /admin/perm/role-groups/{key}/sets      권한그룹 만들기 · 고치기(조합 어긋나면 422 PERM_CONFLICT)
 *   GET  /admin/perm/conflicts · PUT /admin/perm/conflicts/{code}   함께 못 갖는 조합
 *   GET  /admin/perm/staff                       사원 권한(사원마다 권한그룹 · 개별 · 실제 업무 수 · 조합 어긋남) — 저장은 옛 PUT /admin/perm/accounts/{id}(조합 검사 더함)
 *   GET  /admin/perm/mode · PUT /admin/perm/mode 판정 방식 ROLE · COMPARE · GROUPS(GROUPS 는 조건)
 *   GET  /admin/perm/unmapped-routes             연결 안 된 /admin 주소(실행 중 데코레이터)
 * ------------------------------------------------------------------- */

const TASK_RE = /^[a-z][a-z0-9-]{1,40}$/;
const TGROUP_RE = /^[a-z][a-z0-9_]{1,30}$/;

export class PermTaskCreateDto {
  @ApiProperty({ example: 'staff-list' }) @IsString() @Matches(TASK_RE) key!: string;
  @ApiProperty({ example: '운영자 목록' }) @IsString() @Length(1, 60) name!: string;
  @ApiProperty({ example: 'acl' }) @IsString() @Matches(TGROUP_RE) groupKey!: string;
  @ApiPropertyOptional({ example: '운영 역할이 있는 계정 목록' }) @IsOptional() @IsString() @Length(0, 300) description?: string;
  @ApiPropertyOptional({ enum: LEVELS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(LEVELS as unknown as string[], { each: true }) levels?: string[];
  @ApiProperty({ example: '탭 새로 생김' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermTaskInfoDto {
  @ApiPropertyOptional({ example: '운영자 목록' }) @IsOptional() @IsString() @Length(1, 60) name?: string;
  @ApiPropertyOptional({ example: '설명' }) @IsOptional() @IsString() @Length(0, 300) description?: string;
  @ApiPropertyOptional({ enum: LEVELS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(LEVELS as unknown as string[], { each: true }) levels?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ example: '설명 고침' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermTaskGroupFullDto {
  @ApiProperty({ example: '돈 보기' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ example: 5000 }) @IsOptional() @IsInt() @Min(0) @Max(100000) sort?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ example: '정산 · 회계 보기 묶음' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
  @ApiPropertyOptional({ example: ['settlement', 'acct-journal'], isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(600) @IsString({ each: true }) tasks?: string[];
  @ApiProperty({ example: '업무그룹 새로 둠' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermSetDto {
  @ApiProperty({ example: 'admacc' }) @IsString() @Matches(TGROUP_RE) taskGroupKey!: string;
  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS as unknown as string[]) level!: string;
}
export class PermSetItemDto {
  @ApiProperty({ example: 'acct-bank' }) @IsString() @Matches(TASK_RE) taskKey!: string;
  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS as unknown as string[]) level!: string;
  @ApiPropertyOptional({ enum: ['ALLOW', 'DENY'] }) @IsOptional() @IsIn(['ALLOW', 'DENY']) effect?: string;
}
export class PermRoleSetsDto {
  @ApiProperty({ example: '회계 담당' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ enum: ['STAFF', 'MANAGER'] }) @IsOptional() @IsIn(['STAFF', 'MANAGER']) kind?: string;
  @ApiPropertyOptional({ example: '매입 · 경비' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ type: [PermSetDto] }) @IsArray() @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => PermSetDto) sets!: PermSetDto[];
  @ApiPropertyOptional({ type: [PermSetItemDto] }) @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => PermSetItemDto) items?: PermSetItemDto[];
  @ApiProperty({ example: '회계 담당 새로 둠' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermConflictDto {
  @ApiProperty({ example: '정산 승인 ↔ 지급 실행' }) @IsString() @Length(1, 60) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ example: ['settlement:APPROVE'], isArray: true }) @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) a!: string[];
  @ApiProperty({ example: ['fin-transfer:EDIT'], isArray: true }) @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) b!: string[];
  @ApiProperty({ example: '겸직 금지 옮김' }) @IsString() @Length(1, 400) reason!: string;
}
export class PermModeDto {
  @ApiProperty({ enum: PERM_MODES }) @IsIn(PERM_MODES as unknown as string[]) mode!: string;
  @ApiProperty({ example: 'COMPARE 하루 · 다름 0 확인' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/perm')
@Roles('SUPER')
@ApiResponse({ status: 403, description: '권한 없음(SUPER 만)', type: ErrorDto })
export class PermSetsController {
  constructor(private readonly db: DatabaseService, private readonly modules: ModulesContainer) {}
  private get actor() { return RequestCtx.actorId() ?? null; }

  @Get('tasks')
  @ApiOperation({ summary: '업무 목록 (v10.562 · SUPER)', description: '업무(탭) · 이름 · 설명 · 수준 · 켜짐 · 기본 메뉴 그룹 · 든 업무그룹(여럿) · 주소 연결 수(0 이면 「주소 연결 없음」) · 쓰는 권한그룹 수.' })
  @ApiOkResponse({ type: Object })
  tasks() { return taskList(this.db); }

  @Post('tasks')
  @HttpCode(200)
  @Audit('PERM_TASK_CREATE', 'SETTING')
  @ApiOperation({ summary: '업무 더하기 (v10.562 · SUPER)', description: '탭 목록에는 있는데 업무 표에 없는 것 · 메뉴 그룹 업무그룹에도 넣음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_TASK · PERM_GROUP · PERM_LEVELS · PERM_NAME · PERM_REASON' })
  createTask(@Body() dto: PermTaskCreateDto) { return createTask(this.db, dto, this.actor); }

  @Put('tasks/:key')
  @Audit('PERM_TASK_INFO', 'SETTING')
  @ApiParam({ name: 'key', example: 'acct-purchase' })
  @ApiOperation({ summary: '업무 이름 · 설명 · 수준 · 켜고 끄기 (v10.562 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_LEVELS · PERM_NAME · PERM_REASON' })
  saveTaskInfo(@Param('key') key: string, @Body() dto: PermTaskInfoDto) { return saveTaskInfo(this.db, key, dto, this.actor); }

  @Get('task-groups')
  @ApiOperation({ summary: '업무그룹 목록 (v10.562 · SUPER)', description: '업무그룹 · 든 업무(여러 그룹에 든 업무도) · 메뉴 그룹 여부 · 쓰는 권한그룹 수.' })
  @ApiOkResponse({ type: Object })
  taskGroups() { return taskGroupList(this.db); }

  @Put('task-groups/:key')
  @Audit('PERM_TASK_GROUP_SAVE', 'SETTING')
  @ApiParam({ name: 'key', example: 'money_view' })
  @ApiOperation({ summary: '업무그룹 만들기 · 고치기 (v10.562 · SUPER)', description: '이름 · 순서 · 켜고 끄기 · 메모 · 든 업무(통째로 · 업무 하나가 여러 업무그룹에 들 수 있음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_GROUP · PERM_TASK · PERM_ITEMS · PERM_NAME · PERM_REASON' })
  saveTaskGroup(@Param('key') key: string, @Body() dto: PermTaskGroupFullDto) { return saveTaskGroupFull(this.db, key, dto, this.actor); }

  @Get('role-groups/:key/sets')
  @ApiParam({ name: 'key', example: 'R_PAYOUT' })
  @ApiOperation({ summary: '권한그룹 세트 · 실제 여는 업무 (v10.562 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  roleGroupSets(@Param('key') key: string) { return roleGroupSets(this.db, key); }

  @Put('role-groups/:key/sets')
  @Audit('PERM_ROLE_GROUP_SETS', 'SETTING')
  @ApiParam({ name: 'key', example: 'ACCT_STAFF' })
  @ApiOperation({ summary: '권한그룹 만들기 · 고치기 — 업무그룹 × 수준 (v10.562 · SUPER)', description: '세트(업무그룹 × 수준) · 업무 더하기(ALLOW) · 빼기(DENY)를 통째로 · 같은 거래에서 펼쳐 함께 못 갖는 조합이면 422 PERM_CONFLICT(되돌림).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_KEY · PERM_GROUP · PERM_TASK · PERM_ITEMS · PERM_CONFLICT · PERM_NAME · PERM_REASON' })
  saveRoleGroupSets(@Param('key') key: string, @Body() dto: PermRoleSetsDto) { return saveRoleGroupSets(this.db, key, dto, this.actor); }

  @Get('conflicts')
  @ApiOperation({ summary: '함께 못 갖는 조합 (v10.562 · SUPER)' })
  @ApiOkResponse({ type: Object })
  conflicts() { return conflictList(this.db); }

  @Put('conflicts/:code')
  @Audit('PERM_CONFLICT_SET', 'SETTING')
  @ApiParam({ name: 'code', example: 'C710_APPROVE_PAY' })
  @ApiOperation({ summary: '조합 규칙 만들기 · 고치기 (v10.562 · SUPER)', description: 'A 쪽 · B 쪽 「업무:수준」 목록 · 켜고 끄기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_KEY · PERM_TASK · PERM_ITEMS · PERM_NAME · PERM_REASON' })
  saveConflict(@Param('code') code: string, @Body() dto: PermConflictDto) { return saveConflict(this.db, code, dto, this.actor); }

  @Get('staff')
  @ApiOperation({ summary: '사원 권한 목록 (v10.563 · SUPER)', description: '운영 역할 계정마다 붙은 권한그룹(기한) · 개별 수 · 실제 업무 수 · 조합 어긋남 · 연결 직원. 고치기는 PUT /admin/perm/accounts/{id}.' })
  @ApiOkResponse({ type: Object })
  staff() { return permStaffList(this.db); }

  @Get('mode')
  @ApiOperation({ summary: '판정 방식 (v10.564 · SUPER)', description: 'perm.mode(ROLE · COMPARE · GROUPS) · 연결 안 된 /admin 주소 수 · 최근 24시간 「다름」 수 · 최근 다름 50 · GROUPS 로 바꿀 수 있는지.' })
  @ApiOkResponse({ type: Object })
  mode() { return modeView(this.db, this.modules); }

  @Put('mode')
  @Audit('PERM_MODE_SET', 'SETTING')
  @ApiOperation({ summary: '판정 방식 바꾸기 (v10.564 · SUPER)', description: 'GROUPS 는 연결 안 된 /admin 주소 0 · 최근 24시간 다름 0 일 때만(아니면 422 PERM_MODE_NOT_READY) · 되돌리기는 언제든 · 사유 · 바뀐 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PERM_MODE · PERM_MODE_NOT_READY · PERM_REASON' })
  setMode(@Body() dto: PermModeDto) { return setMode(this.db, this.modules, dto.mode, dto.reason, this.actor); }

  @Get('unmapped-routes')
  @ApiOperation({ summary: '연결 안 된 /admin 주소 (v10.564 · SUPER)', description: '운영 역할만 요구하고 SUPER 전용이 아닌데 perm_route_map 에 없는 주소(실행 중 데코레이터 · 500줄).' })
  @ApiOkResponse({ type: Object })
  unmapped() { return unmappedRoutes(this.db, this.modules); }
}
