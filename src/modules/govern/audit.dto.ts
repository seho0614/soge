import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class ReviewSignalDto {
  @ApiProperty({ example: 'PII_NIGHT', description: '어느 징후를 보았나' })
  @IsString() @Length(2, 40)
  signalCode!: string;

  @ApiProperty({
    enum: ['NORMAL', 'WATCH', 'ESCALATED', 'ACTION_TAKEN'],
    description: 'NORMAL(정상) · WATCH(지켜봄) · ESCALATED(윗선 보고) · ACTION_TAKEN(조치함)',
  })
  @IsIn(['NORMAL', 'WATCH', 'ESCALATED', 'ACTION_TAKEN'])
  verdict!: string;

  /* ★ 열 자 미만이면 v_audit_review_thin 에 잡힙니다.
   *   "이상 없음" 은 나중에 아무 근거가 되지 않습니다. */
  @ApiProperty({
    example: '본인 확인 결과 야근 중 정산 처리였습니다',
    description: '왜 그렇게 판단했는지. **열 자 이상** 적으십시오.',
  })
  @IsString() @Length(10, 500)
  reason!: string;

  @ApiPropertyOptional({ description: '조치하셨다면 무엇을' })
  @IsOptional() @IsString() @Length(2, 300)
  actionTaken?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40)
  targetKind?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 64)
  targetId?: string;
}
