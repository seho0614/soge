import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.577 ~ 580 (docs/719 ~ 722) 12차 소개몰 · 파트너 — 입력 형식
 *   ★ DTO 이름은 src 전체에서 고유(Smq 앞머리) · 쓰는 DTO 를 먼저 적음(ts-node 선언 순서 — 규칙 4) · 응답은 @ApiOkResponse({ type: Object })(smx 와 같음)
 *   기준 값 정규식은 DB site_settings.value_pattern · common.ts SMQ_RULE_PATTERNS 와 같음(규칙 2)
 * ------------------------------------------------------------------- */

/** 판매자 답 쓰기 · 고치기(판매자센터) — 2 ~ 2,000자(hlt_qna.answer 검사와 같음) */
export class SmqQnaAnswerDto {
  @ApiProperty({ example: '문의 고맙습니다. 이 상품은 하루 한 알 드시면 됩니다.', description: '2 ~ 2,000자' }) @IsString() @Length(2, 2000) body!: string;
}

/** 문의 · 답 보이기 · 가리기(운영) */
export class SmqQnaDecideDto {
  @ApiProperty({ enum: ['QUESTION', 'ANSWER'], description: 'QUESTION 문의 글 · ANSWER 답' }) @IsIn(['QUESTION', 'ANSWER']) target!: 'QUESTION' | 'ANSWER';
  @ApiProperty({ enum: ['SHOW', 'HIDE'] }) @IsIn(['SHOW', 'HIDE']) action!: 'SHOW' | 'HIDE';
  @ApiPropertyOptional({ description: '가리는 사유(HIDE 때 2 ~ 300자)' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** 끝난 달 다시 셈(운영) */
export class SmqRecalcDto {
  @ApiProperty({ example: '2026-10', description: 'YYYY-MM · 끝난 달만' }) @IsString() @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/) ym!: string;
}

/** 노출 제한 승인 · 반려 · 풀기(운영) */
export class SmqLimitDecideDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'LIFT'] }) @IsIn(['APPROVE', 'REJECT', 'LIFT']) action!: 'APPROVE' | 'REJECT' | 'LIFT';
  @ApiPropertyOptional({ description: '메모(승인은 선택 · 반려 · 풀기는 2 ~ 300자 사유)' }) @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** 기준 값 고치기(SUPER) — 보낸 칸만 바뀜(안 보낸 칸은 undefined 로 들어와 서버가 거름 — 규칙 11) */
export class SmqRulesSaveDto {
  @ApiPropertyOptional({ example: '10', description: '배송 지연 기준 퍼센트 1 ~ 100' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-9][0-9]|100)$/) latePct?: string;
  @ApiPropertyOptional({ example: '5', description: '판매자 사정 취소 · 반품 기준 퍼센트 1 ~ 100' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-9][0-9]|100)$/) cancelPct?: string;
  @ApiPropertyOptional({ example: '20', description: '문의 답 늦음 기준 퍼센트 1 ~ 100' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-9][0-9]|100)$/) qnaPct?: string;
  @ApiPropertyOptional({ example: '10', description: '평가 표본 주문 수 1 ~ 1000' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-9][0-9]{1,2}|1000)$/) minOrders?: string;
  @ApiPropertyOptional({ example: '3', description: '발송 기한 일 1 ~ 14' }) @IsOptional() @IsString() @Matches(/^([1-9]|1[0-4])$/) shipDays?: string;
  @ApiPropertyOptional({ example: '2', description: '노출 제한 제안 — 잇달아 경고 달 수 2 ~ 6' }) @IsOptional() @IsString() @Matches(/^[2-6]$/) limitMonths?: string;
  @ApiPropertyOptional({ example: '30', description: '노출 제한 기간 일 1 ~ 90' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-8][0-9]|90)$/) limitDays?: string;
  @ApiPropertyOptional({ example: '48', description: '상품 문의 답 기한 시간 1 ~ 168' }) @IsOptional() @IsString() @Matches(/^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$/) qnaDueHours?: string;
  @ApiPropertyOptional({ description: '노출 제한 실제 적용(smq.penalty_exposure) — true 켬 · false 끔' }) @IsOptional() @StrictBoolean() exposure?: boolean;
}
