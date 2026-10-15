import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { CARRIERS, HealthOrdersService } from './health-orders.service';

export class ShipDto {
  @ApiProperty({ enum: CARRIERS as unknown as string[] }) @IsIn(CARRIERS as unknown as string[]) carrier!: string;
  @ApiProperty({ description: '송장번호 — 숫자 10 ~ 14자리' }) @IsString() @Matches(/^[0-9]{10,14}$/) trackingNo!: string;
}
export class AdvanceDto {
  @ApiProperty({ enum: ['IN_TRANSIT', 'DELIVERED'] }) @IsIn(['IN_TRANSIT', 'DELIVERED']) state!: 'IN_TRANSIT' | 'DELIVERED';
}

export class AdminOrderRowDto {
  @ApiProperty() orderNo!: string;
  @ApiProperty({ enum: ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'] }) status!: string;
  @ApiProperty() total!: number;
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) shippedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) confirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['BUYER', 'AUTO'] }) confirmedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '배송 완료 주문의 자동 구매확정 시각' }) confirmDue!: string | null;
  @ApiPropertyOptional({ nullable: true }) itemName!: string | null;
  @ApiProperty() itemCount!: number;
  @ApiPropertyOptional({ nullable: true }) carrier!: string | null;
  @ApiPropertyOptional({ nullable: true }) trackingNo!: string | null;
  @ApiPropertyOptional({ nullable: true }) shipState!: string | null;
  @ApiPropertyOptional({ nullable: true }) shipAt!: string | null;
  @ApiProperty({ description: '처리 중인 취소 · 반품 신청이 있음' }) openReturn!: boolean;
}
export class AdminOrderCountsDto {
  @ApiProperty() toShip!: number; @ApiProperty() shipping!: number; @ApiProperty() delivered!: number; @ApiProperty() confirmed!: number;
}
export class AdminOrderListDto {
  @ApiProperty({ type: AdminOrderCountsDto }) counts!: AdminOrderCountsDto;
  @ApiProperty({ type: [String] }) carriers!: string[];
  @ApiProperty({ type: [AdminOrderRowDto] }) items!: AdminOrderRowDto[];
}
export class ShipResultDto {
  @ApiProperty() orderNo!: string; @ApiProperty() status!: string;
  @ApiPropertyOptional() carrier?: string; @ApiPropertyOptional() trackingNo?: string;
  @ApiPropertyOptional({ nullable: true }) deliveredAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) confirmDue?: string | null;
  @ApiProperty() note!: string;
}
export class ConfirmResultDto {
  @ApiProperty() orderNo!: string; @ApiProperty({ enum: ['CONFIRMED'] }) status!: string;
  @ApiProperty() confirmedAt!: string; @ApiProperty() already!: boolean; @ApiProperty() note!: string;
}

/**
 * v10.28 (G-147 · G-194) 운영 「소개몰 주문」 — 발송 처리 · 송장 고치기 · 단계. 본사 운영자만. 처리마다 감사 기록.
 */
@ApiTags('HEALTH-ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin/health/orders')
@Roles('ADMIN', 'SUPER')
export class HealthOrdersAdminController {
  constructor(private readonly svc: HealthOrdersService) {}

  @Get()
  @ApiOperation({ summary: '소개몰 주문 — 발송할 것 · 배송중 · 배송 완료 · 구매확정' })
  @ApiQuery({ name: 'status', required: false, enum: ['PAID', 'SHIPPED', 'DELIVERED', 'CONFIRMED'] }) @ApiQuery({ name: 'q', required: false, description: '주문번호 일부' })
  @ApiOkResponse({ type: AdminOrderListDto })
  list(@Query('status') status?: string, @Query('q') q?: string) { return this.svc.adminList(status, q); }

  @Post(':no/ship')
  @ApiOperation({ summary: '발송 처리 — 택배사 · 송장번호 → 「배송중」' }) @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'NOT_SHIPPABLE · CANCEL_REQUESTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'BAD_CARRIER · BAD_TRACKING_NO', type: ErrorDto })
  @ApiOkResponse({ type: ShipResultDto })
  @Audit('HLT_ORDER_SHIP', 'HLT_ORDER')
  ship(@Param('no') no: string, @Body() dto: ShipDto) { return this.svc.ship(no, dto.carrier, dto.trackingNo); }

  @Post(':no/tracking')
  @ApiOperation({ summary: '송장 고치기 — 배송중일 때만(전 기록은 남음)' }) @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'NOT_SHIPPING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'BAD_CARRIER · BAD_TRACKING_NO', type: ErrorDto })
  @ApiOkResponse({ type: ShipResultDto })
  @Audit('HLT_ORDER_TRACKING_FIX', 'HLT_ORDER')
  fix(@Param('no') no: string, @Body() dto: ShipDto) { return this.svc.fixTracking(no, dto.carrier, dto.trackingNo); }

  @Post(':no/advance')
  @ApiOperation({ summary: '배송 단계 — 간선 이동 · 배송 완료(구매확정 · 반품 기한의 기준)' }) @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'NOT_SHIPPING', type: ErrorDto })
  @ApiOkResponse({ type: ShipResultDto })
  @Audit('HLT_ORDER_ADVANCE', 'HLT_ORDER')
  advance(@Param('no') no: string, @Body() dto: AdvanceDto) { return this.svc.advance(no, dto.state); }
}

/** v10.28 — 구매자의 구매확정(배송 완료 7일 뒤에는 자동) */
@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health/orders')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
export class HealthOrderConfirmController {
  constructor(private readonly svc: HealthOrdersService) {}

  @Post(':no/confirm')
  @ApiOperation({ summary: '구매확정', description: '배송 완료 · 처리 중인 취소·반품 신청이 없을 때. 이미 확정이면 already:true. 확정 뒤에도 법정 기간 안의 반품 · 교환 신청은 받습니다.' })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'NOT_DELIVERED · RETURN_IN_PROGRESS', type: ErrorDto })
  @ApiOkResponse({ type: ConfirmResultDto })
  @Audit('HLT_ORDER_CONFIRM', 'HLT_ORDER')
  confirm(@Param('no') no: string) { return this.svc.confirm(no); }
}
