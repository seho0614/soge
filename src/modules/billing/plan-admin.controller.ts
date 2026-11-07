import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PlanAdminService } from './plan-admin.service';

/* ---------------------------------------------------------------------
 * v10.207 (D184 · docs/332) — 요금제 금액 · 한도 (운영 화면 › 청구 현황 SB-ADM-BIL-010 안의 한 구역)
 *
 *   ADMIN·SUPER  GET /admin/billing/plans          요금제 · 이용 중 구독 수 · 원래 금액이 묶인 구독 수 · 최근 변경 20건
 *   SUPER        PUT /admin/billing/plans/:code    금액 · 한도 바꾸기(사유 필수) · 올리면 이용 중 구독은 원래 금액 · 감사 PLAN_SAVE
 * ------------------------------------------------------------------- */

export class PlanRowDto {
  @ApiProperty({ example: 'STANDARD' }) code!: string;
  @ApiProperty({ example: '스탠다드' }) name!: string;
  @ApiProperty({ example: 49000 }) monthlyPrice!: number;
  @ApiProperty({ example: 3, description: '월 포함 소개코드' }) includedCodes!: number;
  @ApiProperty({ example: 30000, description: '추가 소개코드 건당 금액' }) extraCodePrice!: number;
  @ApiPropertyOptional({ nullable: true, example: 50, description: '소개 제안 월 한도 — null 은 무제한' }) proposalLimit!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 30, description: '요청 열람 월 한도 — null 은 무제한 · 무료 요금제는 운영 설정을 따름' }) requestViews!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 20, description: '매물 슬롯 — null 은 무제한' }) listingSlots!: number | null;
  @ApiProperty({ example: 1, description: '우선노출 칸' }) prioritySlots!: number;
  @ApiProperty({ example: 20000, description: '성사 수수료' }) successFee!: number;
  @ApiProperty({ description: '이용 중(ACTIVE · PAST_DUE) 구독 수' }) subscribers!: number;
  @ApiProperty({ description: '원래 금액이 묶여 지금 금액보다 적게 내는 구독 수' }) locked!: number;
}
export class PlanChangeDto {
  @ApiProperty() id!: string;
  @ApiProperty() planCode!: string;
  @ApiProperty({ example: '2026-11-07 15:30' }) at!: string;
  @ApiProperty({ description: '바꾼 운영자 이메일' }) by!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ description: '이번에 원래 금액을 묶은 구독 수' }) locked!: number;
  @ApiProperty({ description: '내린 금액이 다음 결제부터 적용되는 구독 수' }) lowered!: number;
  @ApiPropertyOptional({ nullable: true, example: 'monthly_price 49000 → 59000' }) diff!: string | null;
}
export class PlanListDto {
  @ApiProperty({ type: [PlanRowDto] }) plans!: PlanRowDto[];
  @ApiProperty({ type: [PlanChangeDto] }) changes!: PlanChangeDto[];
}
export class PlanSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) monthly_price?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) included_codes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) extra_code_price?: number;
  @ApiPropertyOptional({ nullable: true, description: 'null 은 무제한' }) @ValidateIf((_o, v) => v !== null && v !== undefined) @IsInt() @Min(0) proposal_limit?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'null 은 무제한' }) @ValidateIf((_o, v) => v !== null && v !== undefined) @IsInt() @Min(0) request_views_per_month?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'null 은 무제한' }) @ValidateIf((_o, v) => v !== null && v !== undefined) @IsInt() @Min(0) listing_slots?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) priority_slot_count?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) success_fee?: number;
  @ApiProperty({ example: '오픈 요금 확정', minLength: 2, maxLength: 200 }) @IsString() @MinLength(2) @MaxLength(200) reason!: string;
}
export class PlanSaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() code!: string;
  @ApiProperty({ description: '올렸을 때 — 원래 금액을 묶은 이용 중 구독 수' }) locked!: number;
  @ApiProperty({ description: '내렸을 때 — 다음 결제부터 새 금액인 구독 수' }) lowered!: number;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/billing/plans')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PlanAdminController {
  constructor(private readonly plans: PlanAdminService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '요금제 금액 · 한도 · 최근 변경', description: '금액은 오픈 전에 대표가 정함(D184). 올린 금액은 새 구독부터.' })
  @ApiOkResponse({ type: PlanListDto })
  list() { return this.plans.list(); }

  @Put(':code')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('PLAN_SAVE', 'BILLING')
  @ApiParam({ name: 'code', example: 'STANDARD' })
  @ApiOperation({ summary: '요금제 금액 · 한도 바꾸기(SUPER)', description: '올리면 이용 중 구독은 원래 금액(갱신은 작은 값) · 내리면 모두 다음 결제부터. 무료 ↔ 유료 전환은 막음.' })
  @ApiOkResponse({ type: PlanSaveResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLAN_REASON 사유 · PLAN_VALUE 값 · PLAN_RULE 무료 ↔ 유료 · 무료 열람 한도' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없는 요금제' })
  save(@Param('code') code: string, @Body() dto: PlanSaveDto) {
    const { reason, ...vals } = dto;
    return this.plans.save(code, vals as Record<string, unknown>, reason);
  }
}
