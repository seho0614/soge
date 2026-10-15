import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ExemptDto {
  @ApiProperty({ example: 'RSK-06', description: '어느 규칙' })
  @IsString() @Length(3, 20)
  ruleCode!: string;

  @ApiProperty({ example: 'acct:U-4471', description: '무엇을 예외로' })
  @IsString() @Length(2, 200)
  subject!: string;

  /* ★ 사유가 없으면 나중에 "이게 왜 예외지" 에 답할 수 없습니다. */
  @ApiProperty({
    example: '같은 그룹 계열사라 정상입니다',
    description: '왜 정상인지. **다섯 자 이상** 적으십시오.',
  })
  @IsString() @Length(5, 300)
  reason!: string;

  @ApiPropertyOptional({
    example: 90,
    description: '기한(일). 비우면 기본값이 붙습니다 — 영구 예외는 두지 않습니다.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(3650)
  days?: number;
}
