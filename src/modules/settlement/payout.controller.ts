import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional,
         ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { PayoutService } from './payout.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class PayDto {
  @ApiProperty({ example: 'KB-20261001-000123', description: '이체 참조 — 은행 거래번호 등. 대사(對査)의 근거입니다' })
  @IsString() @Length(3, 80) ref!: string;
  @ApiPropertyOptional({ description: '메모 (소개몰 정산만 저장)' })
  @IsOptional() @IsString() @Length(0, 300) memo?: string;
}
export class PayoutRowDto {
  @ApiProperty({ enum: ['PARTNER', 'HEALTH'] }) kind!: string;
  @ApiProperty() id!: string;
  @ApiPropertyOptional() sub?: string;
  @ApiProperty() payee!: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiProperty() amount!: number;
  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional() ready?: boolean;
  @ApiPropertyOptional({ description: '지급 못 하는 이유' }) blocker?: string;
}
export class PayoutSummaryDto {
  @ApiProperty() waiting!: number;
  @ApiProperty() ready!: number;
  @ApiProperty() readyAmount!: number;
  @ApiProperty() drafts!: number;
}
export class PayoutDeskDto {
  @ApiProperty({ type: [PayoutRowDto], description: '확정 · 지급 대기' }) queue!: PayoutRowDto[];
  @ApiProperty({ type: [PayoutRowDto], description: '확정 전(DRAFT) — 운영이 확정' }) drafts!: PayoutRowDto[];
  @ApiProperty({ type: [PayoutRowDto], description: '최근 지급 50건' }) paid!: PayoutRowDto[];
  @ApiProperty({ type: PayoutSummaryDto }) summary!: PayoutSummaryDto;
  @ApiProperty() note!: string;
}
export class PayoutActionDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() ref?: string;
  @ApiProperty() note!: string;
}

/**
 * 지급 데스크 — SB-ADM-PAY-010 (2026-10-01 결정 Q1).
 *
 * ★ 지급 담당(PAYOUT) 계정은 전에 BO 에서 할 수 있는 일이 없었습니다.
 *   확정·지급 API 자체가 없어 제휴 수수료 · 소개몰 정산이 DRAFT 에서 멈춰 있었습니다.
 */
@ApiTags('PAYOUT')
@ApiBearerAuth()
@Controller('api/v1/admin/payouts')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PayoutController {
  constructor(private readonly svc: PayoutService) {}

  @Get()
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '지급 데스크', description: '지급 대기 · 확정 전 · 최근 지급. 지급 못 하는 건은 이유(blocker)를 적습니다.' })
  @ApiOkResponse({ type: PayoutDeskDto })
  desk() { return this.svc.desk(); }

  @Post(':kind/:id/confirm')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '정산 확정 (운영)', description: 'DRAFT → CONFIRMED. 확정자가 기록되고, 그 사람은 지급할 수 없습니다.' })
  @ApiParam({ name: 'kind', enum: ['partner', 'health'] })
  @ApiOkResponse({ type: PayoutActionDto })
  @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('PAYOUT_CONFIRM', 'SETTLEMENT')
  confirm(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(kind, id);
  }

  @Post(':kind/:id/pay')
  @Roles('PAYOUT')   // SUPER 는 AuthGuard 가 통과시킵니다(2026-10-21 결정) — 자기가 확정한 건은 DB 2인 원칙이 막음
  @ApiOperation({
    summary: '지급 기록 (지급 담당 · SUPER)',
    description: 'CONFIRMED → PAID. **이체 참조가 필수**이고 되돌릴 수 없습니다. ' +
      '인증된 계좌가 없거나(제휴) 하위가맹점 ID 가 없으면(소개몰) DB 가 막습니다.',
  })
  @ApiParam({ name: 'kind', enum: ['partner', 'health'] })
  @ApiOkResponse({ type: PayoutActionDto })
  @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('PAYOUT_PAY', 'SETTLEMENT')
  pay(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.svc.pay(kind, id, dto.ref, dto.memo);
  }
}
