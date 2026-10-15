import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MyListingCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['DRAFT','IN_REVIEW','PUBLISHED','REJECTED','SUSPENDED','ARCHIVED'] })
  status!: string;
  @ApiProperty({ example: '검수 중' }) statusLabel!: string;
  @ApiProperty({ description: '수정 시 함께 보냅니다' }) version!: number;
  @ApiProperty({ nullable: true }) desiredFee!: number | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({
    nullable: true, example: 'THIN_CONTENT',
    description: '가장 최근 반려 사유. 재제출 동선의 근거입니다',
  })
  lastRejectReason!: string | null;
}

export class FavoriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) desiredFee!: number | null;
  @ApiProperty({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'] }) gwanCode!: string;
  @ApiProperty({ format: 'date-time' }) addedAt!: string;
}

export class FavoriteResultDto {
  @ApiProperty({ description: '변경 후 상태' }) liked!: boolean;
}
