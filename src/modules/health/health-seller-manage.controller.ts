import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { HealthSellerManageService } from './health-seller-manage.service';
import { SellerLicenseDto } from './health-tenant.controller';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.223 (D193 · docs/358) — 소개몰 판매자 관리(운영 ADMIN · SUPER 만 · 판매자 본인 폐점 · 정보 변경 요청) */

export class SellerStatusActionDto {
  @ApiProperty({ enum: ['PAUSE', 'RESUME', 'BLOCK', 'CLOSE'], description: 'PAUSE 일시 정지 · RESUME 다시 열기 · BLOCK 이용 제한(다시 신청 불가) · CLOSE 폐점' })
  @IsIn(['PAUSE', 'RESUME', 'BLOCK', 'CLOSE']) action!: 'PAUSE' | 'RESUME' | 'BLOCK' | 'CLOSE';
  @ApiProperty({ description: '사유 — 판매자에게 그대로 보임' }) @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class SellerRateDto {
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 50, description: '이 판매자만의 판매수수료율(%) — 비우면(null) 갈래 기본값' })
  @IsOptional() @IsNumber() @Min(0) @Max(50) rate?: number | null;
  @ApiProperty({ description: '바꾸는 사유 — 판매자에게 알림' }) @IsString() @MinLength(2) @MaxLength(300) reason!: string;
}
export class SellerChangeDecideDto {
  @ApiProperty({ description: 'true 승인(그대로 반영) · false 반려' }) @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: '반려 사유(반려면 꼭) — 판매자에게 그대로 보임' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class SellerChangeRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(40) ceoName?: string;
  @ApiPropertyOptional({ example: '123-45-67890' }) @IsOptional() @Matches(/^[0-9]{3}-[0-9]{2}-[0-9]{5}$/) bizRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) ecomRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9-]{8,15}$/) csTel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(200) returnAddr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) addr?: string;
  @ApiPropertyOptional({ type: SellerLicenseDto, isArray: true, description: '서류를 바꾸면 이 목록으로 통째로 바뀜(새 유효기간 포함)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SellerLicenseDto) licenses?: SellerLicenseDto[];
  @ApiPropertyOptional({ description: '운영에 남기는 말' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class SellerCloseDto {
  @ApiPropertyOptional({ description: '폐점 까닭(선택)' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class SellerAccountDto {
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED'] }) status!: string;
  @ApiPropertyOptional({ nullable: true, description: '정지 사유(정지 중일 때)' }) statusReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) statusAt!: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true, description: '가장 최근 정보 변경 요청' }) change!: Record<string, unknown> | null;
  @ApiProperty({ type: String, isArray: true, description: '폐점을 막는 것(없으면 빈 목록)' }) closeBlockers!: string[];
}
export class SellerManageResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional() note?: string;
}

@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class HealthSellerManageController {
  constructor(private readonly svc: HealthSellerManageService) {}

  /* ── 판매자 본인 ── */

  @Get('me/health/seller/account')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 계정', description: '정지 사유 · 최근 정보 변경 요청 · 폐점을 막는 것(진행 중 주문 · 취소 · 반품 · 정산).' })
  @ApiOkResponse({ type: SellerAccountDto })
  @ApiResponse({ status: 403, description: 'NOT_SELLER', type: ErrorDto })
  account() { return this.svc.account(); }

  @Post('me/health/seller/change-request')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 정보 변경 요청', description: '운영 승인 뒤에 바뀝니다. 대기 중인 요청은 한 건만.' })
  @ApiOkResponse({ type: SellerAccountDto })
  @ApiResponse({ status: 409, description: 'CHANGE_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NO_CHANGE · BAD_LICENSES · BAD_BIZ_REG', type: ErrorDto })
  @Audit('HLT_SELLER_CHANGE_REQUEST', 'HLT_SELLER')
  requestChange(@Body() dto: SellerChangeRequestDto) {
    const { note, ...fields } = dto;
    return this.svc.requestChange(fields as Record<string, unknown>, note);
  }

  @Post('me/health/seller/change-request/cancel')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '정보 변경 요청 거두기' })
  @ApiOkResponse({ type: SellerAccountDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  cancelChange() { return this.svc.cancelChange(); }

  @Post('me/health/seller/close')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '폐점(판매자 탈퇴)', description: '진행 중 주문 · 처리 안 끝난 취소 · 반품 · 정산 안 끝난 돈이 있으면 막습니다. 판매 중 상품은 모두 내립니다. 다시 입점은 새로 신청.' })
  @ApiOkResponse({ type: SellerManageResultDto })
  @ApiResponse({ status: 409, description: 'SELLER_OPEN_WORK', type: ErrorDto })
  @Audit('HLT_SELLER_CLOSE_SELF', 'HLT_SELLER')
  closeSelf(@Body() dto: SellerCloseDto) { return this.svc.closeSelf(dto.reason); }

  /* ── 운영 ── */

  @Get('admin/health/sellers/change-requests')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 정보 변경 요청', description: '대기 중인 요청 — 바꿀 값과 지금 값을 나란히.' })
  @ApiOkResponse({ type: Object, isArray: true })
  changeRequests() { return this.svc.changeRequests(); }

  @Post('admin/health/sellers/change-requests/:id/decide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 정보 변경 승인 · 반려', description: '승인하면 그대로 반영합니다(서류는 새 목록으로 바꾸고 확인한 것으로). 반려 사유는 판매자에게 보입니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SellerManageResultDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @Audit('HLT_SELLER_CHANGE_DECIDE', 'HLT_SELLER')
  decideChange(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerChangeDecideDto) { return this.svc.decideChange(id, dto.approve, dto.reason); }

  @Get('admin/health/sellers/:id/history')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 관리 기록', description: '상태 · 사유 · 수수료율 바꾼 기록 · 정보 변경 요청 · 폐점을 막는 것.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  history(@Param('id', ParseUUIDPipe) id: string) { return this.svc.history(id); }

  @Post('admin/health/sellers/:id/status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 정지 · 다시 열기 · 이용 제한 · 폐점', description: '사유 필수 · 판매자에게 알림. 정지 · 제한 · 폐점이면 판매 중 상품을 내리고, 다시 열면 그때 내린 것을 되돌립니다(판매 조건이 맞는 것만). 폐점은 끝낼 일이 있으면 막습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SellerManageResultDto })
  @ApiResponse({ status: 409, description: 'BAD_STATE · SELLER_OPEN_WORK', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('HLT_SELLER_STATUS', 'HLT_SELLER')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerStatusActionDto) { return this.svc.setStatus(id, dto.action, dto.reason); }

  @Post('admin/health/sellers/:id/commission')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 수수료율 바꾸기', description: '사유 필수 · 판매자에게 알림 · 기록. 수수료는 주문 때 박히므로 새 주문부터 적용됩니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SellerManageResultDto })
  @ApiResponse({ status: 409, description: 'BAD_STATE · SAME_RATE', type: ErrorDto })
  @Audit('HLT_SELLER_RATE', 'HLT_SELLER')
  setRate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerRateDto) { return this.svc.setRate(id, dto.rate ?? null, dto.reason); }
}
