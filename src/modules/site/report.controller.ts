import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty,
         ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { ReportService } from './report.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class RoleSetDto {
  @ApiProperty() @IsString() accountId!: string;
  @ApiProperty({ enum: ['REVIEWER', 'ADMIN', 'SUPER'] }) @IsString() role!: string;
  @ApiProperty({ description: 'true 부여 · false 회수' }) @StrictBoolean() grant!: boolean;
  @ApiProperty({ description: '사고가 나면 첫 질문이 "누가 왜 줬는가"입니다' })
  @IsString() reason!: string;
}
export class ReportDto {
  @ApiPropertyOptional() signal?: string;
  @ApiPropertyOptional() value?: number;
  @ApiPropertyOptional() meaning?: string;
  @ApiPropertyOptional() note?: string;
}

/** SB-ADM-DSH-010 하위 — 경영 지표 · 권한 관리 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/reports')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class ReportController {
  constructor(private readonly svc: ReportService) {}

  @Get('daily')
  @ApiOperation({
    summary: '일자별 지표 (30일)',
    description: '숫자가 0으로 떨어진 날이 있으면 그날 무언가 멈춘 것입니다.',
  })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  daily() { return this.svc.daily(); }

  @Get('signals')
  @ApiOperation({
    summary: '어긋남 신호',
    description:
      '**시스템은 정상인데 사업이 새는 형태**를 봅니다. ' +
      '오류로는 안 잡히고 숫자로만 보입니다.',
  })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  signals() { return this.svc.signals(); }

  @Get('revenue')
  @ApiOperation({
    summary: '매출 요약',
    description:
      '구독료가 매출의 전부입니다. 리드 이용료는 별도이고, ' +
      '**소개비는 당사자 직접 지급이라 매출이 아닙니다**(INV-9R).',
  })
  @ApiOkResponse({ type: ReportDto })
  revenue() { return this.svc.revenue(); }

  @Get('roles')
  @ApiOperation({ summary: '권한 보유자' })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  holders() { return this.svc.holders(); }

  @Get('roles/changes')
  @ApiOperation({
    summary: '권한 변경 이력',
    description: '기록은 수정·삭제할 수 없습니다. DB 가 막습니다.',
  })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  changes() { return this.svc.changes(); }

  @Post('roles')
  @Roles('SUPER')
  @ApiOperation({
    summary: '권한 부여 · 회수',
    description:
      '관리자 역할을 주면 검수·정산·제재 권한이 함께 갑니다. ' +
      '**자기 권한은 바꿀 수 없고**, 마지막 SUPER 는 회수되지 않습니다 — ' +
      '다 지우면 아무도 권한을 줄 수 없어 복구가 막힙니다.',
  })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · SELF_GRANT', type: ErrorDto })
  @ApiOkResponse({ type: ReportDto })
  @Audit('ROLE_SET', 'ACCOUNT')
  setRole(@Body() dto: RoleSetDto) {
    return this.svc.setRole(dto.accountId, dto.role, dto.grant, dto.reason);
  }

  @Get('pending')
  @ApiOperation({
    summary: '결정 대기 항목',
    description:
      '오픈을 막지는 않지만 **그 위에 무엇을 쌓으면 안 되는지**를 알려 줍니다. ' +
      'HIGH 는 법무 회신 결과에 따라 작업이 통째로 버려질 수 있는 것입니다 — ' +
      '착수 전에 확인하십시오.',
  })
  @ApiOkResponse({ type: ReportDto, isArray: true })
  pending() { return this.svc.pendingDecisions(); }

  @Get('not-agreed')
  @ApiOperation({
    summary: '약관 미동의 회원',
    description:
      '약관을 새로 발행하면 **기존 회원은 자동으로 동의한 상태가 되지 않습니다.** ' +
      '발행 직후 전원이 여기 뜨는 것은 정상이며, 재동의를 받아야 줄어듭니다.',
  })
  @ApiOkResponse({ type: ReportDto })
  notAgreed() { return this.svc.notAgreed(); }
}
