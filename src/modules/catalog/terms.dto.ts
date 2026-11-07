import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

const TERM_STATUS = ['DRAFT', 'LEGAL_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;

/** v10.204 (D181 · docs/326) — 필수 약관 지금 시행 중인 판의 동의 현황(활동 중 계정 기준 · v_term_not_agreed 와 같은 셈) */
export class TermConsentDto {
  @ApiProperty({ example: 300, description: '대상 — 활동 중(ACTIVE) 계정 수' }) target!: number;
  @ApiProperty({ example: 120, description: '이 판에 동의한 활동 중 계정' }) agreed!: number;
  @ApiProperty({ example: 180, description: '아직 동의 안 함 — 다음 로그인 때 동의 화면' }) missing!: number;
}

export class TermDetailDto {
  @ApiProperty({ example: 'SERVICE' }) code!: string;
  @ApiProperty({ example: '1.0' }) version!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '미작성이면 빈 문자열' }) body!: string;
  @ApiProperty({ enum: TERM_STATUS }) status!: string;
  @ApiProperty({ description: '필수 약관은 미발행 시 오픈을 막습니다' }) isRequired!: boolean;
  @ApiProperty({
    nullable: true,
    example: 'B-12 · C-07 통신판매중개자 지위 확정 후 조항 확정',
    description: '무엇 때문에 못 쓰는지. 법무 회신이 오면 이 항목이 해소됩니다',
  })
  blockedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', description: '미발행이면 infinity' })
  effectiveFrom!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '이 판에서 바뀐 점(재동의 화면) — v10.159' })
  changeNote?: string | null;
  @ApiPropertyOptional({ description: '시행 예정 — 게시됐지만 시행일 전이고 앞 판이 아직 시행 중(v10.161 · D151)' })
  scheduled?: boolean;
  @ApiPropertyOptional({ enum: ['ALL', 'PARTNER'], description: '대상 — 제휴(PARTNER) 약관은 회원 알림 없음(v10.162)' })
  audience?: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: '게시한 때(v10.162 · D152) — v10.162 전 게시 판은 비어 있음' })
  publishedAt?: string | null;
  @ApiPropertyOptional({ description: '회원에게 불리한 변경으로 게시(v10.162 · D152)' })
  isAdverse?: boolean;
  @ApiPropertyOptional({ type: TermConsentDto, nullable: true, description: '필수 약관의 지금 시행 중인 판만 — 동의 현황(v10.204)' })
  consent?: TermConsentDto | null;
}

/** 법무 회신 반영. 초안 저장과 발행을 나눕니다. */
export class UpsertTermDto {
  @ApiProperty({ example: '1.1', description: '기존 버전을 덮지 않고 새 버전을 만듭니다' })
  @IsString() version!: string;

  @ApiProperty({ minLength: 10 })
  @IsString() title!: string;

  @ApiProperty({ minLength: 50, description: '약관 전문' })
  @IsString() @MinLength(50) body!: string;

  @ApiPropertyOptional({ description: '필수 동의 여부. 미지정이면 기존 값 유지' })
  @IsOptional() @StrictBoolean() isRequired?: boolean;

  @ApiPropertyOptional({ maxLength: 300, description: '이 판에서 바뀐 점 — 재동의 화면 「바뀐 점」에 보임(v10.159). 비우면 그대로' })
  @IsOptional() @IsString() @MaxLength(300) changeNote?: string;
}

export class PublishTermDto {
  @ApiProperty({ example: '1.1' })
  @IsString() version!: string;

  @ApiProperty({
    format: 'date-time',
    description: '시행일. 과거로 넣지 마십시오 — 동의 이력의 기준이 됩니다',
  })
  @IsDateString() effectiveFrom!: string;

  @ApiPropertyOptional({ description: '회원에게 불리한 변경(v10.162 · D152) — 앞 판이 있으면 시행일은 30일 뒤 이후(422 TERM_ADVERSE_30D · 이용약관 제14조)' })
  @IsOptional() @StrictBoolean() adverse?: boolean;
}

/** v10.161 (D151) — 시행 예정 판 게시 취소 */
export class UnscheduleTermDto {
  @ApiProperty({ example: '1.1' })
  @IsString() version!: string;
}

export class TermPublishResultDto {
  @ApiProperty() code!: string;
  @ApiProperty() version!: string;
  @ApiProperty({ enum: TERM_STATUS }) status!: string;
  @ApiPropertyOptional({ description: '시행 예정으로 게시됨 — 앞 판은 시행일까지 게시 그대로 · 재동의는 시행일부터(v10.161)' }) scheduled?: boolean;
  @ApiPropertyOptional({ description: '이번에 보관으로 바뀐 앞 판 수(시행일이 지난 경우 · v10.161)' }) archived?: number;
  @ApiPropertyOptional({ description: '「약관 변경 안내」 알림을 만든 회원 수(시행 예정일 때 · 설정 terms.notify_members · v10.162)' }) notified?: number;
  @ApiProperty({
    example: 12,
    description: '발행 후 남은 오픈 차단 항목 수. 0 이 되면 이 관문은 통과입니다',
  })
  remainingBlockers!: number;
}

/** v10.205 (docs/328) — 게시 전에 보는 영향(처음 게시는 시행일이 미래여도 게시하는 순간 시행 · D151) */
export class TermPublishPreviewDto {
  @ApiProperty({ example: 'PRIVACY' }) code!: string;
  @ApiProperty({ example: '1.0' }) version!: string;
  @ApiProperty({ example: '개인정보처리방침' }) title!: string;
  @ApiProperty({ description: '지금 시행 중인(또는 첫 판으로 예정된) 판이 없음 — 시행일을 미래로 넣어도 게시하는 순간 「지금 판」' }) first!: boolean;
  @ApiPropertyOptional({ nullable: true, example: null, description: '지금 시행 중인 판 번호(없으면 null)' }) current!: string | null;
  @ApiProperty({ description: '필수 약관(동의 항목)' }) required!: boolean;
  @ApiProperty({ example: 300, description: '필수 약관이면 동의해야 하는 활동 중(ACTIVE) 계정 수(v_term_not_agreed 와 같은 대상) · 아니면 0' }) target!: number;
  @ApiProperty({ description: '처리방침이고 국외 이전 조항이 있으며 지금은 AI 가 잠겨 있음 — 이 판이 시행되면 AI 잠금이 풀림' }) aiUnlock!: boolean;
  @ApiProperty({ type: [String], example: ['AI 키 없음', '월 상한 0'], description: 'aiUnlock 일 때 빠진 것(AI 키 없음 · 월 상한 0 · AI 전체 꺼짐) · 아니면 빈 목록' }) aiGaps!: string[];
  @ApiProperty({ example: '검수 보조 꺼짐 · AI 상담 꺼짐', description: 'aiUnlock 일 때 스위치 상태 · 아니면 빈 문자열' }) aiSwitches!: string;
  @ApiProperty({ type: [String], example: ['카카오(카카오 키 있음)'], description: 'v10.206 — 처리방침 · 위탁 안내일 때 지금 쓰는 외부 서비스 중 이 판의 위탁 목록에 없는 것 · 아니면 빈 목록' }) outsourceGaps!: string[];
}

/* v10.206 (docs/330) — 위탁 목록 점검 */
export class OutsourceDocStateDto {
  @ApiProperty({ example: 'PRIVACY' }) code!: string;
  @ApiProperty({ example: '개인정보처리방침' }) title!: string;
  @ApiPropertyOptional({ nullable: true, description: '시행 중인 판' }) current!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '게시 전 초안(가장 높은 판)' }) draft!: string | null;
  @ApiProperty({ enum: ['CURRENT', 'DRAFT', 'NONE'], description: '시행 중인 판에 있음 · 초안에만 있음 · 둘 다 없음' }) state!: string;
}
export class OutsourceServiceDto {
  @ApiProperty({ example: '카카오' }) name!: string;
  @ApiProperty({ description: '지금 쓰는가' }) used!: boolean;
  @ApiProperty({ example: '카카오 키 있음' }) why!: string;
  @ApiProperty({ type: [OutsourceDocStateDto] }) docs!: OutsourceDocStateDto[];
}
export class OutsourceCheckDto {
  @ApiProperty({ type: [OutsourceServiceDto] }) services!: OutsourceServiceDto[];
  @ApiProperty({ type: [String], description: '쓰는 중인데 위탁 목록에 없음(초안에도 없음)' }) lines!: string[];
  @ApiProperty({ type: [String], description: '게시 전 초안에만 있음 — 게시하면 해소' }) pending!: string[];
}

export class OpenBlockerDto {
  @ApiProperty({ enum: ['SETTING', 'TERM', 'FOOTER', 'INTEGRATION', 'ASSUME', 'READY'] }) kind!: string;
  @ApiProperty() item!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['CEO', 'VENDOR', 'SCREEN', 'DATE'], description: 'v10.200 — 누가: 대표 결정 · 업체 대기 · 운영 화면에서 바로 · 날짜만' }) owner!: string;
  @ApiProperty({ description: 'v10.200 — 풀리는 방법 한 줄' }) how!: string;
}

/** v10.146 (D142 · docs/225) — 오픈 준비 점검 한 줄. required 이고 ok 가 아니면 오픈 차단(READY)에도 올라갑니다. */
export class OpenReadinessDto {
  @ApiProperty({ example: 'IDENTITY' }) code!: string;
  @ApiProperty({ example: '본인인증 방식' }) label!: string;
  @ApiProperty({ description: 'true 꼭(오픈 차단) · false 권장(꺼져 있어도 오픈은 됨)' }) required!: boolean;
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: 'identity.provider = STUB' }) nowValue!: string;
  @ApiProperty({ example: 'NICE 계약 → 키 3개 → 방식 NICE (docs/214)' }) todo!: string;
  @ApiProperty({ nullable: true, description: '고칠 운영 화면 탭', example: 'integrations' }) go!: string | null;
}

/** v10.150 (D144 · docs/230) — 오픈일 넣기 */
export class SetOpenDateDto {
  @ApiProperty({ example: '2026-12-15', description: '오픈일(YYYY-MM-DD · 한국 시간 · 오늘 이후). 빈 문자열이면 지움(홍보 기간 종료일은 그대로 둠)' })
  @IsString() @Matches(/^$|^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, { message: '날짜는 YYYY-MM-DD 형식입니다.' })
  date!: string;
}

/** v10.150 — 오픈일과 그에 맞춘 날짜들(서버가 계산 · 한국 시간) */
export class OpenDateDto {
  @ApiProperty({ nullable: true, example: '2026-12-15' }) openDate!: string | null;
  @ApiProperty({ nullable: true, example: '2027-03-15', description: '홍보 기간 종료일(request.view.limit_from) — 이날부터 요청 열람 한도가 자동 적용' }) promoEndsOn!: string | null;
  @ApiProperty({ nullable: true, example: '2026-12-08', description: '약관 게시 마감(시행 7일 전 · 약관 제14조)' }) termsPublishBy!: string | null;
  @ApiProperty({ nullable: true, example: '2026-11-15', description: '불리한 변경이 있으면 게시 마감(시행 30일 전)' }) termsUnfavorableBy!: string | null;
  @ApiProperty({ nullable: true, description: '오늘부터 오픈일까지 남은 날(한국 시간)' }) daysLeft!: number | null;
  @ApiProperty({ description: '게시된 약관 중 시행일이 오픈일과 다른 것 수(오픈일이 있을 때만)' }) termsOtherDate!: number;
}


/** v10.201 (docs/318) — 법무 검토 묶음 한 약관 요약 */
export class ReviewPackItemDto {
  @ApiProperty({ example: 'SERVICE' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: '1.1' }) version!: string;
  @ApiProperty({ enum: ['DRAFT', 'LEGAL_REVIEW'] }) status!: string;
  @ApiProperty({ nullable: true, description: '비교 기준(지금 게시판) · 없으면 처음 게시' }) baseVersion!: string | null;
  @ApiProperty({ type: [String], description: '남은 〔미확정〕 표시' }) holes!: string[];
  @ApiProperty({ description: '게시판에 더한 줄 수(처음 게시면 0)' }) added!: number;
  @ApiProperty({ description: '게시판에서 뺀 줄 수' }) removed!: number;
  @ApiProperty({ nullable: true }) blockedBy!: string | null;
}

/** v10.201 (docs/318) — 법무 검토 묶음(게시 안 된 초안 전부 · HTML 한 파일 · 읽기만) */
export class ReviewPackDto {
  @ApiProperty({ example: 'sogaebank_terms_legal_review_20261106.html' }) fileName!: string;
  @ApiProperty({ example: '2026-11-06', description: '한국 날짜' }) day!: string;
  @ApiProperty({ type: [ReviewPackItemDto] }) items!: ReviewPackItemDto[];
  @ApiProperty({ description: '내려받을 HTML 문서 전체(바깥 글꼴 · 그림 · 스크립트 없음)' }) html!: string;
}
