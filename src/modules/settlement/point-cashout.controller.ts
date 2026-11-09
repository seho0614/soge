import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { PointCashoutService } from './point-cashout.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class CashoutRequestDto {
  @ApiProperty({ example: 10000, description: '출금할 포인트(1포인트 = 1원)' })
  @IsInt() @Min(1) @Max(10_000_000) points!: number;
  @ApiProperty({ format: 'uuid', description: '확인을 마친 본인 받을 계좌(/me/payout-accounts)' })
  @IsUUID() payoutAccountId!: string;
}

const REQ = {
  type: 'object', properties: {
    id: { type: 'string', format: 'uuid' }, points: { type: 'integer' }, taxRate: { type: 'string' },
    withholding: { type: 'integer' }, netAmount: { type: 'integer' },
    status: { type: 'string', enum: ['REQUESTED', 'CONFIRMED', 'PAID', 'REJECTED', 'CANCELED'] },
    bankName: { type: 'string' }, last4: { type: 'string', nullable: true },
    requestedAt: { type: 'string' }, paidAt: { type: 'string', nullable: true }, closedReason: { type: 'string', nullable: true },
  },
};

/**
 * v10.219 (D190 · docs/352) — 포인트 출금. SB-MYP-INT-030(나의공간 › 소개 활동 · 포인트)에서 씁니다.
 * 확정 · 지급 · 반려는 운영 화면 지급 데스크(/admin/payouts/point/…).
 */
@ApiTags('MY')
@ApiBearerAuth()
@Controller('api/v1/me/points/cashout')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
export class PointCashoutController {
  constructor(private readonly svc: PointCashoutService) {}

  @Get()
  @ApiOperation({
    summary: '포인트 출금 — 내 정보',
    description: '출금할 수 있는 포인트 · 최소 금액 · 원천징수율(비어 있으면 신청을 받지 않음) · 확인된 받을 계좌 · 내 신청 20건 · ' +
      '신청을 못 하는 까닭(blocker: TAX_UNSET · IDENTITY · OPEN · ACCOUNT · BELOW_MIN).',
  })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    cashable: { type: 'integer' }, min: { type: 'integer' }, taxRate: { type: 'string', nullable: true },
    identityVerified: { type: 'boolean' }, open: { type: 'boolean' }, blocker: { type: 'string', nullable: true },
    accounts: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', format: 'uuid' }, bankName: { type: 'string' }, last4: { type: 'string' }, holderName: { type: 'string' }, isStub: { type: 'boolean' } } } },
    requests: { type: 'array', items: REQ } } } })
  mine() { return this.svc.mine(); }

  @Post()
  @ApiOperation({
    summary: '포인트 출금 신청',
    description: '원천징수(10원 미만 버림)를 뺀 금액이 운영 확정 · 지급 뒤 계좌로 갑니다. ' +
      'DB 가 막는 것: 잔액 초과 · 최소 미만 · 처리 중 신청 · 확인 안 된 · 남의 계좌 · 본인인증 전 · 원천징수율 비어 있음(422 POINT_RULE).',
  })
  @ApiOkResponse({ schema: REQ })
  @ApiResponse({ status: 422, description: 'POINT_RULE · INVALID_POINTS', type: ErrorDto })
  @Audit('POINT_CASHOUT_REQUEST', 'POINT_CASHOUT')
  request(@Body() dto: CashoutRequestDto) { return this.svc.request(dto.points, dto.payoutAccountId); }

  @Post(':id/cancel')
  @ApiOperation({ summary: '포인트 출금 신청 취소', description: '운영이 확정하기 전(신청 상태)에만. 포인트는 그대로 남습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } } } })
  @ApiResponse({ status: 422, description: 'NOT_CANCELABLE', type: ErrorDto })
  @Audit('POINT_CASHOUT_CANCEL', 'POINT_CASHOUT')
  cancel(@Param('id', ParseUUIDPipe) id: string) { return this.svc.cancel(id); }
}
