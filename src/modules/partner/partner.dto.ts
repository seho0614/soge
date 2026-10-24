/* v10.96 (리팩토링) — 파트너 컨트롤러 4개(partner · partner-admin · qualification · broker-admin)가 같이 쓰는 입력 · 응답 형식(DTO). partner.controller.ts 에서 글자 그대로 옮김 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

export class BrokerStateDto {
  @ApiProperty({ description: '신청한 적이 있는가' }) applied!: boolean;
  @ApiProperty({
    description: '국토부 연동 전이라 대조를 건너뛴 상태인가. ' +
      '**true 면 번호가 실제와 맞는지 확인하지 않았습니다.**',
  })
  assumed!: boolean;
  @ApiPropertyOptional() licenseNo?: string;
  @ApiPropertyOptional() officeName?: string;
  @ApiPropertyOptional() ceoName?: string;
  @ApiPropertyOptional({ description: 'SUBMITTED · PENDING · VERIFIED · REJECTED · EXPIRED' })
  state?: string;
  @ApiPropertyOptional({ description: 'MATCH · MISMATCH · NOT_FOUND. 비면 미조회' })
  lookupResult?: string;
  @ApiPropertyOptional({ description: 'API 실제 조회 · ASSUMED 간주 · MANUAL 수기 (D008)' })
  lookupSource?: string;
  @ApiPropertyOptional({ description: '대조 설명 — 불일치 항목 · 조회 실패 사유' })
  lookupDetail?: string;
  @ApiProperty({ description: '국토부 조회 연동이 설정돼 있는가 (D008)' })
  lookupConfigured!: boolean;
  @ApiPropertyOptional({ description: '재확인 기한. 지나면 인증이 풀립니다' })
  recheckDue?: string;
  @ApiPropertyOptional() rejectReason?: string;
}

export class BrokerApplyDto {
  @ApiProperty({ description: '개설등록번호. 예) 11110-2026-00001' })
  @IsString() @MaxLength(40)
  licenseNo!: string;

  @ApiProperty({ description: '사무소 상호' })
  @IsString()
  officeName!: string;

  @ApiProperty({ description: '대표자명' })
  @IsString()
  ceoName!: string;
}

export class ServiceCreateDto {
  @ApiProperty({ example: '공장 지붕 태양광 EPC' }) @IsString() title!: string;
  @ApiProperty() @IsString() body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  /* v10.31 (W5 · CTR-210 위자드) — 아래가 하나라도 있으면 위자드 등록: 업종의 등록 방식이 정해져 있어야 합니다 */
  @ApiPropertyOptional({ description: '위자드로 등록(true)' }) @IsOptional() wizard?: boolean;
  @ApiPropertyOptional({ description: '주요 타겟' }) @IsOptional() @IsString() @MaxLength(300) target?: string;
  @ApiPropertyOptional({ enum: ['QUOTE', 'CALL', 'VISIT', 'CHAT'] }) @IsOptional() @IsIn(['QUOTE', 'CALL', 'VISIT', 'CHAT']) receiveMode?: string;
  @ApiPropertyOptional({ description: '최고 확인비용(S) — 업종 기준 단가 이상' }) @IsOptional() @IsInt() @Min(1) @Max(100000) topFee?: number;
  @ApiPropertyOptional({ description: '성사 소개비율 0.05 ~ 0.12' }) @IsOptional() @IsNumber() @Min(0.05) @Max(0.12) referralRate?: number;
  @ApiPropertyOptional({ description: '재소개 보너스(건당 원)' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) rebateBonus?: number;
  @ApiPropertyOptional({ description: '견적 매트릭스 [{row, col, amount}]' }) @IsOptional() @IsArray() matrix?: Array<{ row: string; col: string; amount: number }>;
  @ApiPropertyOptional({ description: '상세페이지 블록 [{kind, body}]' }) @IsOptional() @IsArray() blocks?: Array<{ kind: string; body?: string; fileId?: string }>;
}
export class RegionsDto {
  @ApiProperty({ example: [{ sido: '경기', sigungu: '화성시' }],
    description: '시·군·구까지만 씁니다. 상세주소는 매칭에 쓰지 않습니다' })
  @IsArray() regions!: Array<{ sido: string; sigungu: string }>;
}
export class ServiceReviewDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: '반려 시 필수. 이용자에게 그대로 보입니다' })
  @IsOptional() @IsString() reason?: string;
}
export class VoidFeeDto {
  @ApiProperty({ example: 'RSK-02', description: '위험감지 규칙 코드' })
  @IsString() ruleCode!: string;
}
/* ── D003 파트너 운영 목록 (2026-10-02) ─────────────────────────────── */
export class PartnerRejectDto {
  @ApiProperty({ example: '사업자등록증의 업태가 신청 업종과 다릅니다 — 업태를 맞춰 다시 신청해 주십시오',
    description: '신청자에게 그대로 보입니다' })
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class FeeDisputeDto {
  @ApiProperty({ enum: ['FALSE_INFO', 'UNREACHABLE', 'DUPLICATE', 'OUT_OF_SCOPE'],
    description: '허위 정보 · 연락 불가 · 중복 리드 · 지역·분야 밖. **상담 결렬은 사유가 아닙니다**' })
  @IsIn(['FALSE_INFO', 'UNREACHABLE', 'DUPLICATE', 'OUT_OF_SCOPE']) reasonCode!: string;
  @ApiProperty({ example: '안내된 번호가 결번입니다. 3회 통화 시도(10/1 10:02 · 13:40 · 17:15)' })
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional({ description: '근거 — 통화 기록 캡처 링크 · 문자 발송 내역 등' })
  @IsOptional() @IsString() @MaxLength(2000) evidence?: string;
}
export class VoidAcceptDto {
  @ApiProperty({ example: 'RSK-02', description: '위험감지 규칙 코드 — 무효의 근거' })
  @IsString() @IsNotEmpty() ruleCode!: string;
  @ApiPropertyOptional({ description: '판정 메모' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class VoidDismissDto {
  @ApiProperty({ example: '통화 기록상 연결된 뒤 상담이 결렬된 건입니다 — 상담 결렬은 반려 사유가 아닙니다',
    description: '파트너에게 그대로 보입니다' })
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class BrokerDecideDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED']) state!: 'VERIFIED' | 'REJECTED';
  @ApiPropertyOptional({ description: '반려 시 필수. 신청자에게 그대로 보입니다' })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PartnerOkDto {
  @ApiPropertyOptional() id?: string;
  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional() note?: string;
}
