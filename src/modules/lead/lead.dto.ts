import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

/* ★ DTO 에 검증 데코레이터가 없으면 whitelist 가 필드를 지웁니다 — 전부 붙입니다. */

export class LeadAssignDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid',
    description: '보낼 파트너. 비우면 후보 순서(공정 순환)대로 빈자리만큼 고릅니다. 하나라도 조건 밖이면 전부 거부합니다' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true })
  partnerIds?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 10, description: 'partnerIds 없이 자동으로 고를 때 몇 곳(기본: 목표 수까지)' })
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}

export class LeadReassignDto {
  @ApiProperty({ type: [String], format: 'uuid', description: '거둘 배정(deliveryId). 아직 열람하지 않은 배정만 거둘 수 있습니다' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true })
  deliveryIds!: string[];

  @ApiProperty({ example: '업체가 휴업 중이라 연락 불가 — 다른 업체로 넘김', description: '거둔 업체에 그대로 알립니다' })
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: '새로 보낼 파트너. 비우면 거둔 수만큼 자동으로 고릅니다' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true })
  partnerIds?: string[];
}

export class LeadCloseDto {
  @ApiProperty({ example: '장난 신청 — 연락처 결번 확인', description: '종료 사유. 아직 안 연 배정은 함께 거둡니다' })
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export const LEAD_QUEUE_STATES = ['QUEUE', 'OPEN', 'ASSIGNED', 'UNMATCHED', 'CLOSED', 'LEGACY', 'ALL'] as const;

export class LeadOkDto {
  @ApiPropertyOptional() id?: string;
  @ApiPropertyOptional() assignState?: string;
  @ApiPropertyOptional() note?: string;
}
