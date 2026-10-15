import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CorrectDto {
  @ApiProperty({ example: 42, description: '어느 분류 기록을 고치나' })
  @IsInt() @Min(1)
  logId!: number;

  @ApiProperty({ example: 'FR', description: '사람이 고른 분류' })
  @IsString() @Length(2, 20)
  toCode!: string;

  @ApiPropertyOptional({ description: '왜 고쳤는지' })
  @IsOptional() @IsString() @Length(2, 200)
  reason?: string;
}

export class RevertDto {
  @ApiProperty({
    example: '2026-09-23T00:00:00Z',
    description: '이 시각 이후의 학습을 되돌립니다',
  })
  @IsString()
  since!: string;
}
