import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class PromptSearchDto {
  @ApiProperty({
    example: '10평 이내 상가 급매 있어?',
    description: '자유 문장. **계정 정보는 함께 보내지 않습니다**(INV-SCH1).',
  })
  @IsString() @Length(1, 200)
  q!: string;

  @ApiPropertyOptional({ description: '특정 관 안에서만 찾을 때' })
  @IsOptional() @IsString() @Length(2, 8)
  gwan?: string;
}

/* v10.30 — GET /search/suggest 의 응답 모양(문서용). v10.29 에서 이 API 를 만들 때 응답 정의가 없어 통합 검정의 문서 정합성 「구현된 API 에 응답 스키마」에 걸렸습니다.
 *   응답 자체는 그대로입니다(search.service.ts suggest). */
export class SuggestIntroducerDto {
  @ApiProperty({ example: '김OO', description: '이름은 첫 글자만 내보냅니다' }) alias!: string;
  @ApiProperty({ example: 'VERIFIED', description: '소개자 등급(REGION_PARTNER · TOP · EXPERT · VERIFIED · SEED)' }) grade!: string;
  @ApiProperty({ type: [String], example: ['서울 강남구'], description: '활동 지역 · 최대 3' }) regions!: string[];
  @ApiProperty({ type: [String], example: ['인테리어'], description: '분야(제한업종 낱말 제외) · 최대 3' }) categories!: string[];
}
export class SearchSuggestDto {
  @ApiProperty({ type: [String], example: ['사무실 인테리어'], description: '추천 검색어 — 결과가 나온 말만 · 제한업종 낱말 제외 · 최대 8' }) keywords!: string[];
  @ApiProperty({ type: [String], example: ['인테리어 · 시공'], description: '업종 이름(승인된 것) · 최대 12' }) categories!: string[];
  @ApiProperty({ type: [SuggestIntroducerDto], description: '소개자 — q 가 있을 때만 · 최대 4' }) introducers!: SuggestIntroducerDto[];
}

/* v10.31 — POST /search/log (검색어 집계) */
export class SearchLogDto {
  @ApiProperty({ example: '사무실 인테리어', description: '제출한 검색어. 원문은 저장하지 않습니다 — 공개 목록에 있는 낱말만 셉니다.' })
  @IsString() @Length(1, 100)
  q!: string;
}
