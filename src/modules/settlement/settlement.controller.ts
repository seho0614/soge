import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class ReconcileDto {
  @ApiProperty({ description: '모든 단계가 맞으면 true' }) ok!: boolean;
  @ApiProperty({ description: '1단계 — settlements 합계' }) stage1!: unknown;
  @ApiProperty({ description: '2단계 — deals.agreed_fee 합계' }) stage2!: unknown;
  @ApiProperty({ description: '3단계 — INV-9 · INV-11 위반 스윕' }) stage3!: unknown;
  @ApiProperty({ type: [String], description: '불일치 사유' }) mismatches!: string[];
}

export class PaidMarkDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) paid_marked_by!: string | null;
  @ApiProperty({ nullable: true }) paid_marked_at!: string | null;
  @ApiProperty() note!: string;
}

/**
 * SB-ADM-STL-010 정산 조회
 *
 * 이전 판본에는 배치 생성·이체 실행 엔드포인트가 있었습니다.
 * 에스크로 폐지(INV-11) 이후에도 남아 있던 잔재이며 제거했습니다.
 * 플랫폼은 지급을 승인하지도, 실행하지도 않습니다.
 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/settlement-ledger')
@Roles('SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Get()
  @ApiOperation({ summary: '정산 목록' })
  batches() { return this.svc.batches(); }

  @Get('reconcile')
  @ApiOperation({
    summary: '원장 대조',
    description:
      '정산 합계와 약정 합계를 서로 다른 경로로 계산해 비교합니다. ' +
      '두 값이 갈리면 트리거를 우회한 보정이 있었다는 뜻입니다(INV-9R). ' +
      '아울러 자금 수탁·공제 컬럼이 되살아났는지 스키마를 훑습니다(INV-11).',
  })
  @ApiOkResponse({ type: ReconcileDto })
  reconcile() { return this.svc.reconcile(); }

  @Post(':id/paid')
  @ApiOperation({
    summary: '지급 완료 표시',
    description:
      '**당사자가 "받았다"고 표시하는 기록입니다.** 플랫폼이 지급을 확인해 준 값이 아닙니다. ' +
      '플랫폼은 자금을 수탁하지 않으므로 확인해 줄 수단이 없습니다(INV-11). ' +
      '당사자 여부와 표시자 불변은 DB 트리거가 집행합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PaidMarkDto })
  @ApiResponse({ status: 403, description: 'PERM — 당사자가 아님', type: ErrorDto })
  @Audit('SETTLEMENT_PAID_MARK', 'SETTLEMENT')
  markPaid(@Param('id') id: string) { return this.svc.markPaid(id); }
}
