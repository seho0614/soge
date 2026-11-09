import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional,
         ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
export class RejectDto {
  @ApiProperty({ minLength: 2, maxLength: 300, example: '예금주 이름이 회원 이름과 다름 — 계좌를 다시 확인해 주십시오' })
  @IsString() @Length(2, 300) reason!: string;
}
export class PayoutRowDto {
  @ApiProperty({ enum: ['PARTNER', 'HEALTH', 'POINT'] }) kind!: string;
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
export class PointCashoutSettingDto {
  @ApiProperty({ example: 10000 }) min!: number;
  @ApiProperty({ nullable: true, example: '8.8', description: '원천징수율(%) · 비어 있으면 출금 신청을 받지 않음' }) taxRate!: string | null;
  @ApiProperty({ description: '주민등록번호 받기(point.cashout_tax_id) — 켜기는 SUPER · 처리방침 게시 뒤' }) taxIdOn!: boolean;
}
export class PayoutDeskDto {
  @ApiProperty({ type: [PayoutRowDto], description: '확정 · 지급 대기' }) queue!: PayoutRowDto[];
  @ApiProperty({ type: [PayoutRowDto], description: '확정 전(DRAFT) — 운영이 확정' }) drafts!: PayoutRowDto[];
  @ApiProperty({ type: [PayoutRowDto], description: '최근 지급 50건' }) paid!: PayoutRowDto[];
  @ApiProperty({ type: PointCashoutSettingDto, description: 'v10.219 포인트 출금 기준(바꾸기는 SUPER · 운영 설정 point.cashout_*)' }) pointSetting!: PointCashoutSettingDto;
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

  @Get('point-report')
  @Roles('PAYOUT')   // SUPER 는 AuthGuard 가 통과 — 주민등록번호 원문이 들어 있어 ADMIN 은 안 됨
  @ApiOperation({
    summary: '포인트 출금 신고 자료 (지급 담당 · SUPER)',
    description: 'v10.219 (D190) — 그달(한국 시각)에 지급된 포인트 출금 · 소득세 · 지방소득세 · 주민등록번호(등록된 경우) · CSV(엑셀용). ' +
      '감사 기록에는 달 · 건수만 남고, 개인정보 접속기록에 받는 사람마다 EXPORT 가 남습니다.',
  })
  @ApiQuery({ name: 'month', example: '2026-11' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    month: { type: 'string' }, filename: { type: 'string' }, csv: { type: 'string' }, note: { type: 'string' },
    total: { type: 'object', properties: { count: { type: 'integer' }, points: { type: 'integer' }, incomeTax: { type: 'integer' },
      localTax: { type: 'integer' }, withholding: { type: 'integer' }, netAmount: { type: 'integer' }, missingTaxId: { type: 'integer' } } } } } })
  @ApiResponse({ status: 422, description: 'REPORT_MONTH', type: ErrorDto })
  pointReport(@Query('month') month: string) { return this.svc.pointReport(month); }

  @Post(':kind/:id/confirm')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '정산 확정 (운영)', description: 'DRAFT → CONFIRMED(포인트 출금은 REQUESTED → CONFIRMED). 확정자가 기록되고, 그 사람은 지급할 수 없습니다.' })
  @ApiParam({ name: 'kind', enum: ['partner', 'health', 'point'] })
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
  @ApiParam({ name: 'kind', enum: ['partner', 'health', 'point'] })
  @ApiOkResponse({ type: PayoutActionDto })
  @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('PAYOUT_PAY', 'SETTLEMENT')
  pay(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.svc.pay(kind, id, dto.ref, dto.memo);
  }

  @Post(':kind/:id/reject')
  @Roles('ADMIN', 'PAYOUT')
  @ApiOperation({ summary: '포인트 출금 반려 (운영 · 지급 담당)', description: 'v10.219 (D190) — 신청 · 확정 상태의 포인트 출금을 사유와 함께 반려. 포인트는 출금 가능 잔액으로 돌아갑니다. kind 는 point 만.' })
  @ApiParam({ name: 'kind', enum: ['point'] })
  @ApiOkResponse({ type: PayoutActionDto })
  @ApiResponse({ status: 422, description: 'REJECT_POINT_ONLY · REASON_REQUIRED · NOT_OPEN', type: ErrorDto })
  @Audit('PAYOUT_REJECT', 'SETTLEMENT')
  reject(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.svc.reject(kind, id, dto.reason);
  }
}
