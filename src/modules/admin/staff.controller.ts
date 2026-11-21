import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { employeeRoles, revokeAll, staffList } from './staff';

/* ---------------------------------------------------------------------
 * v10.561 ~ 563 (D291 · docs/703 · 705) 직원 · 권한 › 운영자 목록 — 회원 · 직원 분리 A안
 *   GET  /admin/staff                          운영자 목록(ADMIN · SUPER 읽기 · 역할 보유자 GET /admin/reports/roles 와 같은 범위 · 메일 원문은 SUPER)
 *   GET  /admin/staff/employees/{id}/roles     직원(급여 대장) 계정에 남은 운영 역할(SUPER · 퇴사 뒤 「거둘까요?」)
 *   POST /admin/staff/{accountId}/revoke-all   운영 역할 모두 거두기(SUPER · 사유 · 감사 STAFF_ROLE_REVOKE_ALL · STAFF_LEFT_ROLE 풀림)
 *   주소는 /admin/acct/ 밖 — 세무사(ACCOUNTANT · 회계 GET 읽기)는 못 봄(계약 규칙 8).
 * ------------------------------------------------------------------- */

export class StaffRevokeAllDto {
  @ApiProperty({ example: '11/30 퇴사 — 운영 역할 거둠' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/staff')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class StaffAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: '운영자 목록 (v10.561)', description: '운영 역할이 있는 계정만 — 역할 · 기한 · 연결 직원(직원 연결 없음 · 퇴사했는데 역할 남음 표시) · 2단계 · 마지막 로그인 · 붙은 권한그룹 수. SUPER 에게만 메일 원문과 연결 안 된 직원 목록(역할 줄 때 고르기).' })
  @ApiOkResponse({ type: Object })
  list() { return staffList(this.db, RequestCtx.get()?.actorRole === 'SUPER'); }

  @Get('employees/:id/roles')
  @Roles('SUPER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '직원 계정에 남은 운영 역할 (v10.563 · SUPER)', description: '급여 › 직원 「퇴사」 뒤 화면이 「운영 역할도 거둘까요?」를 물을 때.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  employeeRoles(@Param('id') id: string) { return employeeRoles(this.db, id); }

  @Post(':accountId/revoke-all')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('STAFF_ROLE_REVOKE_ALL', 'ACCOUNT')
  @ApiParam({ name: 'accountId', format: 'uuid' })
  @ApiOperation({ summary: '운영 역할 모두 거두기 (v10.563 · SUPER)', description: '사유 필수 · 권한 변경 기록에 사유 · 처리자 · 자기 자신 403 · 마지막 SUPER 409 · 퇴사 알림 STAFF_LEFT_ROLE 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'NO_SUCH_ROLE · STAFF_LAST_SUPER' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'STAFF_REASON' })
  revokeAll(@Param('accountId') accountId: string, @Body() dto: StaffRevokeAllDto) { return revokeAll(this.db, accountId, dto.reason, RequestCtx.actorId() ?? null); }
}
