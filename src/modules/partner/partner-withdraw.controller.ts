import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PartnerWithdrawService } from './partner-withdraw.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.224 (D194 · docs/359) — 안심소개 · 제휴 파트너 본인 해지(대표 계정만 · 돈이 남아 있으면 막음 · 다시 신청 가능) */

export class PartnerWithdrawDto {
  @ApiProperty({ enum: ['MAL', 'AFF'], description: 'MAL 안심소개 파트너 · AFF 제휴 파트너 — 한쪽만 해지해도 다른 자격은 그대로' })
  @IsIn(['MAL', 'AFF']) track!: 'MAL' | 'AFF';
  @ApiPropertyOptional({ description: '탈퇴 까닭(선택)' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class PartnerWithdrawTrackDto {
  @ApiProperty() status!: string;
  @ApiProperty({ description: '지금 해지할 수 있음' }) can!: boolean;
  @ApiProperty({ type: String, isArray: true, description: '막는 것(없으면 빈 목록)' }) why!: string[];
}
export class PartnerWithdrawCheckDto {
  @ApiPropertyOptional({ type: PartnerWithdrawTrackDto, nullable: true, description: '안심소개 자격(해지할 것이 없으면 null)' }) mal!: PartnerWithdrawTrackDto | null;
  @ApiPropertyOptional({ type: PartnerWithdrawTrackDto, nullable: true, description: '제휴 자격(해지할 것이 없으면 null)' }) aff!: PartnerWithdrawTrackDto | null;
}
export class PartnerWithdrawResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['MAL', 'AFF'] }) track!: string;
  @ApiProperty({ enum: ['WITHDRAWN'] }) status!: string;
  @ApiProperty() note!: string;
}

@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner/withdraw')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class PartnerWithdrawController {
  constructor(private readonly svc: PartnerWithdrawService) {}

  @Get()
  @ApiOperation({ summary: '파트너 해지 가능 여부', description: '안심소개 · 제휴 자격마다 지금 해지할 수 있는지와 막는 것(미납 이용료 · 유상 잔액 · 처리 중 환불 · 정산 전 주문 · 지급 안 끝난 정산).' })
  @ApiOkResponse({ type: PartnerWithdrawCheckDto })
  check() { return this.svc.check(); }

  @Post()
  @ApiOperation({ summary: '파트너 본인 해지', description: '대표 계정만. 안심소개는 축 입점도 함께 해지하고 자동 충전을 끕니다. 제휴는 링크를 모두 끕니다. 다시 하려면 신청부터 다시.' })
  @ApiOkResponse({ type: PartnerWithdrawResultDto })
  @ApiResponse({ status: 403, description: 'NOT_OWNER', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'BAD_STATE · PARTNER_OPEN_MONEY', type: ErrorDto })
  @Audit('PARTNER_WITHDRAW', 'PARTNER')
  withdraw(@Body() dto: PartnerWithdrawDto) { return this.svc.withdraw(dto.track, dto.reason); }
}
