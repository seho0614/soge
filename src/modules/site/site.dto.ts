import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

export class GwanAdminDto {
  @ApiProperty({ example: 'MNY' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true, format: 'date-time' }) openedAt!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: '노출 중인 매물' }) publishedListings!: number;
  @ApiProperty({ description: '승인된 업종' }) categories!: number;
  @ApiProperty({ description: '검수 대기' }) reviewPending!: number;
}

export class CreateGwanDto {
  @ApiProperty({ example: 'LED', description: '대문자 3자. 만든 뒤 바꿀 수 없습니다' })
  @Matches(/^[A-Z]{3}$/) code!: string;

  @ApiProperty({ minLength: 2, maxLength: 20 })
  @IsString() @MinLength(2) @MaxLength(20) name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdateGwanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({
    description: '비활성으로 바꾸면 그 관의 등록·노출이 즉시 멈춥니다',
  })
  @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class AdSlotDto {
  @ApiProperty() code!: string;
  @ApiProperty({ nullable: true }) gwanCode!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) width!: number | null;
  @ApiProperty({ nullable: true }) height!: number | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ description: '게재 중인 광고' }) activePlacements!: number;
}

export class AdPlacementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slotCode!: string;
  @ApiProperty({ nullable: true }) advertiserName!: string | null;
  @ApiProperty({ nullable: true }) imageKey!: string | null;
  @ApiProperty({ nullable: true }) linkUrl!: string | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty() impressions!: number;
  @ApiProperty() clicks!: number;
}

export class CreateAdDto {
  @ApiProperty() @IsString() slotCode!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsString() advertiserBusinessId?: string;
  @ApiPropertyOptional({ description: 'S3 key' }) @IsOptional() @IsString() imageKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() linkUrl?: string;
  @ApiProperty({ format: 'date-time' }) @IsString() startsAt!: string;
  @ApiProperty({ format: 'date-time' }) @IsString() endsAt!: string;
}

export class NoticeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) gwanCode!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() isPinned!: boolean;
  @ApiProperty({ nullable: true, format: 'date-time' }) publishedAt!: string | null;
}

export class CreateNoticeDto {
  @ApiPropertyOptional({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'], description: '비우면 전체 공지' })
  @IsOptional() @IsString() gwanCode?: string;
  @ApiProperty() @IsString() @MinLength(2) title!: string;
  @ApiProperty() @IsString() body!: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isPinned?: boolean;
  @ApiPropertyOptional({ description: '지정하면 그 시각에 공개됩니다' })
  @IsOptional() @IsString() publishedAt?: string;
}

export class HubDto {
  @ApiProperty({ type: GwanAdminDto, isArray: true }) gwans!: GwanAdminDto[];
  @ApiProperty({ description: '전체 노출 매물' }) totalListings!: number;
  @ApiProperty({ description: '전체 거래' }) totalDeals!: number;
  @ApiProperty({ description: '오픈 차단 항목' }) openBlockers!: number;
}

export class ScopeDto {
  @ApiProperty({ description: '설정·정책의 적용 범위' }) key!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['GLOBAL', 'GWAN'], description: 'GLOBAL 은 전 관에 영향을 줍니다' })
  scope!: string;
  @ApiProperty({ description: '이 값을 바꾸면 영향받는 대상' }) affects!: string;
}

/* 20261002 — 검증 데코레이터가 없어 whitelist 가 필드를 모두 지웠고,
 * PATCH 가 200 을 주면서 **보낸 값을 버렸습니다**(BO 화면 구성 실측). 부분 수정도 받습니다. */
export class LayoutDto {
  @ApiPropertyOptional({ description: '메인 화면 섹션 순서' })
  @IsOptional() @IsArray() @IsString({ each: true }) sections!: string[];
  @ApiPropertyOptional({ description: '관 노출 순서' })
  @IsOptional() @IsArray() @IsString({ each: true }) gwanOrder!: string[];
}

export class IntegrationDto {
  @ApiProperty({ example: 'NTS' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty({ nullable: true, description: '선정한 사업자' }) provider!: string | null;
  @ApiProperty({ enum: ['NOT_STARTED','CONTRACT','IP_PENDING','TESTING','LIVE','FAILED'] })
  status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ description: '발신 IP 화이트리스트가 필요한가' }) requiresIp!: boolean;
  @ApiProperty({ nullable: true }) egressIp!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) ipRequestedAt!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) ipApprovedAt!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Secrets Manager 키 이름입니다. **값은 저장하지 않습니다**',
  })
  secretKeyName!: string | null;
  @ApiProperty({ description: '키가 등록됐는지. 값 자체는 여기 없습니다' })
  secretRegistered!: boolean;
  @ApiProperty({ nullable: true, description: '리드타임(주)' }) leadTimeWeeks!: number | null;
  @ApiProperty({ description: 'true 면 LIVE 가 아닐 때 오픈이 막힙니다' }) blocksOpen!: boolean;
  @ApiProperty({ nullable: true }) memo!: string | null;
  @ApiProperty({ description: '남은 예상 기간(주)' }) estWeeksRemaining!: number;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ enum: ['NOT_STARTED','CONTRACT','IP_PENDING','TESTING','LIVE','FAILED'] })
  @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ description: '선정한 사업자' })
  @IsOptional() @IsString() provider?: string;
  @ApiPropertyOptional({ description: '등록 신청한 발신 IP' })
  @IsOptional() @IsString() egressIp?: string;
  @ApiPropertyOptional({ description: 'IP 심사 신청일' })
  @IsOptional() @IsString() ipRequestedAt?: string;
  @ApiPropertyOptional({ description: 'IP 승인일' })
  @IsOptional() @IsString() ipApprovedAt?: string;
  @ApiPropertyOptional({
    description: 'Secrets Manager 에 키를 넣었는지. **키 값은 보내지 마십시오**',
  })
  @IsOptional() @StrictBoolean() secretRegistered?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
}

export class BannedWordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() word!: string;
  @ApiProperty({ enum: ['EXACT','CONTAINS','REGEX'] }) matchType!: string;
  @ApiProperty({ enum: ['BLOCK','WARN'], description: 'BLOCK 은 등록 거부, WARN 은 사람이 봄' })
  severity!: string;
  @ApiProperty({ nullable: true, description: '특정 관에만 적용' }) gwanCode!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class CreateBannedWordDto {
  @ApiProperty() @IsString() @MinLength(1) word!: string;
  @ApiPropertyOptional({ enum: ['EXACT','CONTAINS','REGEX'], default: 'CONTAINS' })
  @IsOptional() @IsString() matchType?: string;
  @ApiProperty({ enum: ['BLOCK','WARN'] }) @IsString() severity!: string;
  @ApiPropertyOptional({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @IsOptional() @IsString() gwanCode?: string;
}

export class GwanOrderItem {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty({ description: '작을수록 앞' }) @IsInt() @Min(0) sortOrder!: number;
}

export class GwanOrderDto {
  @ApiProperty({ type: GwanOrderItem, isArray: true,
    description: '전체를 한 번에 보내십시오 — 하나씩 바꾸면 순서가 겹칩니다.' })
  @IsArray() items!: GwanOrderItem[];
}

export class LandingDto {
  @ApiPropertyOptional({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'],
    description: '비우면 메인. 중지된 관은 지정할 수 없습니다.' })
  @IsOptional() @IsString() gwanCode?: string | null;
  @ApiPropertyOptional({ description: '가입 직후 첫 로그인만 다르게 보낼 때' })
  @IsOptional() @StrictBoolean() forNewMember?: boolean;
}
