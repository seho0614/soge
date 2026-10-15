import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateQuestionDto {
  @ApiProperty({
    minLength: 5, maxLength: 500,
    description: '공개 문의입니다. 연락처를 쓰면 마스킹됩니다',
  })
  @IsString() @MinLength(5) @MaxLength(500) question!: string;
}

export class AnswerQuestionDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString() @MinLength(1) @MaxLength(1000) answer!: string;
}

export class QuestionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '연락처는 마스킹된 상태로 옵니다' }) question!: string;
  @ApiProperty({ nullable: true }) answer!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) answeredAt!: string | null;
  @ApiProperty({ example: '㈜대한기계', description: '질문자 표시명. 개인은 마스킹' })
  askerName!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ description: '요청자가 이 매물의 주인인지. 답변 버튼 노출 판단' })
  canAnswer!: boolean;
}
