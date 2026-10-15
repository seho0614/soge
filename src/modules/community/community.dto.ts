import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/* ★ NOTICE 는 여기 없습니다. 공지는 운영만 쓰므로 이 경로로
 *   받지 않습니다 — 트리거도 막지만 입구에서 거르는 편이 낫습니다. */
export class CreatePostDto {
  @ApiProperty({ enum: ['REVIEW', 'TRADE', 'QNA'], example: 'QNA' })
  @IsIn(['REVIEW', 'TRADE', 'QNA'])
  board!: string;

  @ApiProperty({ example: '소개비 세금계산서는 누가 끊나요' })
  @IsString() @Length(2, 100)
  title!: string;

  @ApiProperty({ example: '소개비를 받으면 세금계산서를 누가 발행하는지 궁금합니다.' })
  @IsString() @Length(10, 10000)
  body!: string;

  @ApiPropertyOptional({ description: '소개 후기일 때 필수 — 성사된 내 거래' })
  @IsOptional() @IsUUID()
  dealId?: string;

  @ApiPropertyOptional({ enum: ['USER', 'AI'], description: '누가 게시판을 골랐나' })
  @IsOptional() @IsIn(['USER', 'AI'])
  classifiedBy?: string;
}

export class UpdatePostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 10000)
  body?: string;

  @ApiPropertyOptional({ enum: ['REVIEW', 'TRADE', 'QNA'] })
  @IsOptional() @IsIn(['REVIEW', 'TRADE', 'QNA'])
  board?: string;
}

export class CreateCommentDto {
  @ApiProperty({ example: '사업소득이면 소개자가 직접 발행합니다.' })
  @IsString() @Length(2, 2000)
  body!: string;

  @ApiPropertyOptional({ description: '대댓글일 때 — 1단계까지' })
  @IsOptional() @IsUUID()
  parentId?: string;
}

export class CommunityClassifyDto {
  @ApiProperty() @IsString() @Length(1, 100)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 10000)
  body?: string;
}
