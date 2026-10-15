import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
         ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsNotEmpty, IsOptional, IsString,
         IsUUID, Matches, MaxLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { ConsultService } from './consult.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class ConsultCategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'CSL_INTERIOR' }) code!: string;
  @ApiProperty({ example: '인테리어' }) name!: string;
  @ApiProperty({ enum: ['APPROVED', 'PENDING'], description: 'PENDING 은 「준비 중」 — 신청을 받지 않습니다' }) status!: string;
  @ApiProperty({ enum: ['OPEN', 'GATED'], description: 'GATED 는 자격 확인 업체만 받습니다' }) publishMode!: string;
  @ApiProperty({ enum: ['LEAD', 'LISTING_FEE'], description: 'LISTING_FEE 는 월 정액 노출형 — 상담 신청 없이 업체 목록만 보여 줍니다(법률 · 세무)' }) consultMode!: string;
  @ApiProperty({ description: '지금 받을 수 있는 인증업체 수 (정액 노출형은 노출 중인 업체 수)' }) partnerCount!: number;
}
export class ConsultRegionDto {
  @ApiProperty({ example: '서울' }) sido!: string;
  @ApiProperty({ description: '그 시 · 도에서 받을 수 있는 인증업체 수(정액 노출형은 게재 중인 사무소 수)' }) partnerCount!: number;
}
export class ConsultRulesDto {
  @ApiProperty({ description: '한 신청을 전달하는 업체 수(lead.assign.target)', example: 1 }) deliverTo!: number;
  @ApiProperty({ description: '인증번호 유효 시간(분)', example: 5 }) otpMinutes!: number;
  @ApiProperty({ description: '인증번호를 틀릴 수 있는 횟수', example: 5 }) otpMaxTries!: number;
  @ApiProperty({ description: '같은 번호로 하루에 신청할 수 있는 횟수(lead.intake.daily_limit)', example: 5 }) dailyLimit!: number;
  @ApiProperty({ description: '업체가 이 시간 안에 열지 않으면 다른 업체로 넘어갑니다(lead.assign.view_ttl_hours)', example: 24 }) viewTtlHours!: number;
}
export class ConsultCategoryDetailDto extends ConsultCategoryDto {
  @ApiProperty({ type: ConsultRegionDto, isArray: true, description: '받는 지역 — 업체 수 많은 순. 업체 이름 · 연락처는 내보내지 않습니다' }) regions!: ConsultRegionDto[];
  @ApiPropertyOptional({ type: ConsultRulesDto, nullable: true, description: '진행 규칙. 월 정액 노출형(법률 · 세무)은 상담 신청을 받지 않아 null' }) rules?: ConsultRulesDto | null;
}
export class ConsultCreateDto {
  @ApiPropertyOptional({ format: 'uuid', description: '상담 업종(categories.id). categoryCode 와 둘 중 하나' })
  @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ example: 'CSL_CLEANING', description: '상담 업종 코드. categoryId 와 둘 중 하나' })
  @IsOptional() @IsString() @Matches(/^CSL_[A-Z_]{2,30}$/) categoryCode?: string;
  @ApiProperty({ example: '홍길동' }) @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
  @ApiProperty({ example: '010-1234-5678' }) @IsString() @Matches(/^[0-9\- ]{10,14}$/) phone!: string;
  @ApiProperty({ example: 'name@example.com', description: 'v10.28 — 필수. 휴대폰 확인을 마친 뒤 업체가 연락처를 열 때 함께 전달 · 암호화 보관' })
  @IsString() @MaxLength(120) @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: '이메일 형식을 확인해 주십시오.' }) email!: string;
  @ApiProperty({ example: '경기도' }) @IsString() @IsNotEmpty() @MaxLength(20) sido!: string;
  @ApiPropertyOptional({ example: '성남시' }) @IsOptional() @IsString() @MaxLength(20) sigungu?: string;
  @ApiPropertyOptional({ description: '원하는 상담 내용 (1000자 이내)' })
  @IsOptional() @IsString() @MaxLength(1000) memo?: string;
  @ApiProperty({ description: '개인정보 제3자 제공 동의 — 이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용을 인증업체 1곳에 · 6개월 보관' }) @StrictBoolean() agree!: boolean;
}
export class ConsultCreatedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'PENDING_VERIFY' }) state!: string;
  @ApiProperty() expiresInMinutes!: number;
  @ApiProperty() note!: string;
  @ApiPropertyOptional({ description: '**개발 환경 · 알림톡 연동 전에만** 내려갑니다. 운영에서는 오지 않습니다' })
  devCode?: string;
}
export class ConsultVerifyDto {
  @ApiProperty({ example: '123456' }) @IsString() @Matches(/^[0-9]{6}$/) code!: string;
}
export class ConsultDeliverDto {
  @ApiProperty({ enum: ['DELIVERED', 'NO_PARTNER'] }) state!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: '전달된 상담 신청(리드) 번호. NO_PARTNER 면 없습니다' }) leadId?: string | null;
  @ApiProperty() note!: string;
}
export class AxisApplyDto {
  @ApiProperty({ example: ['EQUIP', 'CONSULT'], description: 'EQUIP · RE · SOLAR · CONSULT' })
  @IsArray() @ArrayNotEmpty() @IsIn(['EQUIP', 'RE', 'SOLAR', 'CONSULT'], { each: true }) axes!: string[];
}
export class AxisStateDto {
  @ApiProperty({ enum: ['EQUIP', 'RE', 'SOLAR', 'CONSULT'] }) axis!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] }) state!: string;
  @ApiProperty({ enum: ['APPLY', 'BULK_MIGRATION', 'ADMIN'] }) source!: string;
  @ApiPropertyOptional({ description: '반려 사유 · 일괄 이관 사유' }) reason?: string;
}
export class AxisDecideDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: '반려 시 필수(5자 이상). 신청자에게 그대로 보입니다' })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * SB-MAL-CSL-010 안심소개 상담 신청 (D018)
 *
 * **로그인 없이 신청합니다** — 소비자는 회원이 아니라 정보주체입니다(A-00R2).
 * 휴대폰 확인을 마쳐야 리드가 생기고 업체 1곳에 갑니다(INV-12 · INV-L1).
 * 로그인한 채 신청하면 「내 상담 신청」(GET /me/consult-requests)에도 남습니다.
 */
@ApiTags('MAL')
@Controller('api/v1/consult')
export class ConsultController {
  constructor(private readonly svc: ConsultService) {}

  @Get('categories')
  @ApiOperation({ summary: '상담 업종 목록', description: '공개 업종과 「준비 중」 업종을 함께 내립니다. 준비 중은 신청을 받지 않습니다.' })
  @ApiOkResponse({ type: ConsultCategoryDto, isArray: true })
  categories() { return this.svc.categories(); }

  @Get('categories/:code')
  @ApiOperation({ summary: '상담 업종 상세', description: '목록의 그 줄에 **받는 지역(시 · 도별 업체 수)** 과 **진행 규칙**을 더해 내립니다(SB-MAL-CSL-025). 숫자는 목록과 같은 기준으로 셉니다. 업체 이름 · 연락처는 내보내지 않습니다.' })
  @ApiParam({ name: 'code', example: 'CSL_CLEANING' })
  @ApiOkResponse({ type: ConsultCategoryDetailDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — 없는 업종 · 보관한 업종 · 상담 축이 아닌 분류', type: ErrorDto })
  category(@Param('code') code: string) { return this.svc.category(code); }

  @Post('requests')
  @ApiOperation({ summary: '상담 신청', description: '인증번호를 보냅니다. 확인 전에는 업체에 아무것도 가지 않습니다. 같은 번호 하루 한도(lead.intake.daily_limit) · 같은 번호 같은 업종 24시간 중복을 막습니다.' })
  @ApiOkResponse({ type: ConsultCreatedDto })
  @ApiResponse({ status: 409, description: 'DUPLICATE_REQUEST', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CONSENT_REQUIRED · PHONE_INVALID · CATEGORY_REQUIRED · TOO_MANY_REQUESTS · NOTIFY_NOT_READY · CONSULT_AXIS · CONSULT_CLOSED · CONSULT_DIRECTORY_ONLY', type: ErrorDto })
  create(@Body() dto: ConsultCreateDto) { return this.svc.createRequest(dto); }

  @Post('requests/:id/verify')
  @ApiOperation({ summary: '휴대폰 확인 → 업체 1곳 전달', description: '5분 · 5회. 받을 업체가 없으면 NO_PARTNER 로 끝나고 연락처는 넘기지 않습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ConsultDeliverDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'EXPIRED · OTP_LOCKED · OTP_EXPIRED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'OTP_MISMATCH', type: ErrorDto })
  verify(@Param('id') id: string, @Body() dto: ConsultVerifyDto) { return this.svc.verify(id, dto.code); }
}

/** SB-PTC-CTR-100 입점 신청 — 축별 입점 (안심소개 파트너센터 · D018) */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner/axes')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
export class PartnerAxisController {
  constructor(private readonly svc: ConsultService) {}

  @Get()
  @ApiOperation({ summary: '내 축별 입점 상태' })
  @ApiOkResponse({ type: AxisStateDto, isArray: true })
  mine() { return this.svc.myAxes(); }

  @Post()
  @ApiOperation({ summary: '축별 입점 신청', description: '반려된 축만 다시 낼 수 있습니다. 부동산은 중개사 인증이 있어야 승인됩니다.' })
  @ApiOkResponse({ type: AxisStateDto, isArray: true })
  @ApiResponse({ status: 422, description: 'IDENTITY_REQUIRED · AXIS_INVALID', type: ErrorDto })
  @Audit('PARTNER_AXIS_APPLY', 'PARTNER')
  apply(@Body() dto: AxisApplyDto) { return this.svc.applyAxes(dto.axes); }
}

/** SB-ADM-PTN-020 입점 승인 — 축별 판정 (D018) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/partner-axes')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PartnerAxisAdminController {
  constructor(private readonly svc: ConsultService) {}

  @Get()
  @ApiOperation({ summary: '축별 입점 신청 목록' })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] })
  list(@Query('state') state?: string) { return this.svc.admAxes(state); }

  @Post(':id/decide')
  @ApiOperation({ summary: '축별 입점 승인 · 반려', description: '반려는 사유 5자 이상, 부동산 승인은 중개사 인증이 필요합니다(DB 가 막습니다).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @Audit('PARTNER_AXIS_DECIDE', 'PARTNER')
  decide(@Param('id') id: string, @Body() dto: AxisDecideDto) { return this.svc.admDecide(id, dto.approve, dto.reason); }
}
