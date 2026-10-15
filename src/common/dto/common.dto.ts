import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 오류 응답 규격. 모든 4xx·5xx 가 이 형태입니다.
 * code 는 프런트가 분기하는 대상이므로 메시지가 바뀌어도 유지됩니다.
 */
export class ErrorDto {
  @ApiProperty({ example: 'RESTRICTED_CATEGORY', description: '분기용 상수' })
  code!: string;

  @ApiProperty({ example: '보험 상품의 모집·중개는 보험업법상 등록된 자만 가능합니다.' })
  message!: string;

  @ApiPropertyOptional({ example: 'categoryId', description: '형식 오류 시 대상 필드' })
  field?: string;

  @ApiPropertyOptional({ description: '부가 정보' })
  details?: unknown;
}

/** 커서 페이지네이션. offset 은 쓰지 않습니다 — 목록 갱신 시 항목을 건너뜁니다. */
export class PageDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ nullable: true, example: 'eyJzb3J0VmFsdWUiOi4uLn0', description: '다음 페이지 커서. null 이면 마지막' })
  nextCursor!: string | null;
}

export class CursorQueryDto {
  @ApiPropertyOptional({ description: '이전 응답의 nextCursor' })
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  limit?: number;
}

/** 코드 라벨. 프런트가 상태 문구를 하드코딩하지 않도록 서버가 내려 줍니다. */
export class CodeEntryDto {
  @ApiProperty({ example: 'PUBLISHED' })
  code!: string;

  @ApiProperty({ example: '노출 중' })
  label!: string;

  @ApiPropertyOptional({ example: '노출 중', description: '목록·배지용 축약' })
  shortLabel?: string | null;

  @ApiPropertyOptional({ enum: ['neutral','info','success','warning','danger','muted'] })
  tone?: string | null;
}
