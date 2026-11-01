import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { HealthTenantService, SELLER_LICENSE_KINDS } from './health-tenant.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.165 (D155 · docs/256) — 소개몰 입점 신청 · 운영 심사(꺼진 채로 · 개인 · 사업자 모두 · 판매대금은 판매자 직접 귀속) */

export class SellerLicenseDto {
  @ApiProperty({ enum: SELLER_LICENSE_KINDS, description: '서류 종류 — 사업자등록 · 통신판매업 · 식품 판매 · 건강기능식품 · 의료기기 · 화장품책임판매업 · 브랜드 권리' })
  @IsIn([...SELLER_LICENSE_KINDS]) kind!: string;
  @ApiProperty({ description: '서류 번호' }) @IsString() @MinLength(2) @MaxLength(60) licenseNo!: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedAt?: string;
  @ApiPropertyOptional({ format: 'date', description: '유효기간이 있으면' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresAt?: string;
}
export class SellerApplyDto {
  @ApiProperty({ enum: ['TENANT', 'BRAND'], description: 'TENANT 일반 입점 · BRAND 브랜드 직영관(브랜드 권리 증빙 필요)' })
  @IsIn(['TENANT', 'BRAND']) type!: string;
  @ApiProperty({ description: '상호(가게 이름)' }) @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @ApiProperty({ description: '개인 판매자(사업자등록 없음) — P2P · 개인도 신청 가능' }) @StrictBoolean() personal!: boolean;
  @ApiPropertyOptional({ example: '123-45-67890', description: '사업자면 꼭' })
  @IsOptional() @Matches(/^[0-9]{3}-[0-9]{2}-[0-9]{5}$/) bizRegNo?: string;
  @ApiProperty({ description: '대표자(개인이면 본인) 이름' }) @IsString() @MinLength(2) @MaxLength(40) ceoName!: string;
  @ApiPropertyOptional({ description: '통신판매업 신고번호(신고 대상이면)' }) @IsOptional() @IsString() @MaxLength(60) ecomRegNo?: string;
  @ApiProperty({ description: '고객 응대 전화' }) @Matches(/^[0-9-]{8,15}$/) csTel!: string;
  @ApiProperty({ description: '반품 받을 주소' }) @IsString() @MinLength(5) @MaxLength(200) returnAddr!: string;
  @ApiPropertyOptional({ description: '사업장(또는 연락) 주소' }) @IsOptional() @IsString() @MaxLength(200) addr?: string;
  @ApiPropertyOptional({ type: SellerLicenseDto, isArray: true })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SellerLicenseDto) licenses?: SellerLicenseDto[];
}
export class SellerApproveDto {
  @ApiPropertyOptional({ description: '이 판매자만의 판매수수료율(%) — 비우면 갈래 기본값', minimum: 0, maximum: 50 })
  @IsOptional() @IsNumber() @Min(0) @Max(50) commissionRate?: number;
}
export class SellerRejectDto {
  @ApiProperty({ description: '반려 사유 — 신청자에게 그대로 보임' }) @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class TenantConfigDto {
  @ApiProperty({ description: '입점 신청 켜짐(mall.tenant)' }) enabled!: boolean;
}
export class MySellerDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: '본인확인 마침' }) identityVerified!: boolean;
  @ApiProperty({ description: '지금 시행 중인 입점 약관(HLT_SELLER)에 동의함' }) consent!: boolean;
  @ApiPropertyOptional({ type: Object, nullable: true, description: '신청 · 판매자 정보(없으면 null) — status PENDING · ACTIVE · PAUSED · BLOCKED · REJECTED' })
  seller!: Record<string, unknown> | null;
}
export class SellerDecisionDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'REJECTED'] }) status!: string;
}

@ApiTags('HEALTH')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class HealthTenantController {
  constructor(private readonly svc: HealthTenantService) {}

  @Get('health/tenant/config')
  @ApiOperation({ summary: '소개몰 입점 — 켜짐', description: '꺼져 있으면 사용자 웹에 「입점 신청」이 나오지 않습니다(v10.165).' })
  @ApiOkResponse({ type: TenantConfigDto })
  config() { return this.svc.config(); }

  @ApiBearerAuth()
  @Get('me/health/seller')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 입점 신청', description: '켜짐 · 본인확인 · 입점 약관 동의 · 신청 상태와 반려 사유.' })
  @ApiOkResponse({ type: MySellerDto })
  mine() { return this.svc.mine(); }

  @ApiBearerAuth()
  @Post('me/health/seller')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 신청', description: '개인 · 사업자 모두. 심사 중이거나 반려된 신청은 고쳐서 다시 냅니다(서류는 새로 낸 것으로 바뀜).' })
  @ApiOkResponse({ type: MySellerDto })
  @ApiResponse({ status: 409, description: 'SELLER_EXISTS · SELLER_BLOCKED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'TENANT_OFF · IDENTITY_REQUIRED · TENANT_CONSENT_REQUIRED · BIZ_REG_REQUIRED · BRAND_PROOF_REQUIRED', type: ErrorDto })
  @Audit('HLT_SELLER_APPLY', 'HLT_SELLER')
  apply(@Body() dto: SellerApplyDto) { return this.svc.apply(dto); }

  /* ── 운영 ── */

  @ApiBearerAuth()
  @Get('admin/health/sellers/applications')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '소개몰 입점 신청', description: '심사 대기(오래된 것부터) · 최근 90일 반려. 서류 번호 · 유효기간 · 신청 회원 · 본인확인.' })
  @ApiOkResponse({ type: Object, isArray: true })
  applications() { return this.svc.applications(); }

  @ApiBearerAuth()
  @Post('admin/health/sellers/:id/approve')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 승인', description: '서류를 확인한 것으로 남깁니다. 판매(결제)는 하위가맹점 ID 를 채운 뒤에 열립니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SellerDecisionDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @Audit('HLT_SELLER_APPROVE', 'HLT_SELLER')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerApproveDto) { return this.svc.approve(id, dto.commissionRate); }

  @ApiBearerAuth()
  @Post('admin/health/sellers/:id/reject')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 반려', description: '사유는 신청자에게 그대로 보이고, 신청자는 고쳐서 다시 신청할 수 있습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SellerDecisionDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('HLT_SELLER_REJECT', 'HLT_SELLER')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerRejectDto) { return this.svc.reject(id, dto.reason); }
}
