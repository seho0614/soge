import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail() email!: string;

  @ApiProperty({ minLength: 10 })
  @IsString() password!: string;

  @ApiPropertyOptional({
    description:
      '브라우저가 보관한 방문자 키. 로그인 시 귀속 연결에 씁니다. ' +
      '이 값이 없으면 비로그인 상태의 소개코드 유입이 유실됩니다 (INV-2)',
  })
  @IsOptional() @IsString() visitorKey?: string;
}

export class SignupDto extends LoginDto {
  @ApiProperty({ minLength: 2, maxLength: 40 })
  @IsString() @MinLength(2) name!: string;

  @ApiPropertyOptional({ description: '동의한 약관 코드. 필수 약관 누락 시 422' })
  @IsOptional() agreedTerms?: string[];

  /* v10.31 — 시안 가입 3단계 「부서 · 직위」(선택) */
  @ApiPropertyOptional({ maxLength: 60, example: '사업개발팀 팀장' })
  @IsOptional() @IsString() @MaxLength(60) jobTitle?: string;
}

export class RefreshDto {
  @ApiProperty({ description: '로그인 응답의 refreshToken' })
  @IsString() refreshToken!: string;
}

export class PrincipalDto {
  @ApiProperty({ format: 'uuid' }) accountId!: string;
  @ApiProperty({ type: [String], example: ['MEMBER'] }) roles!: string[];
  @ApiProperty({ nullable: true, format: 'date-time' }) identityVerifiedAt!: string | null;
  @ApiProperty({
    nullable: true, format: 'date-time',
    description: '소개비 수령 자격의 기준일 (INV-10). null 이면 정산 불가',
  })
  businessVerifiedAt!: string | null;
  @ApiProperty({ description: '유효 구독 여부. 코드 발급 게이트 (INV-8)' })
  hasActiveSubscription!: boolean;
}

export class TokenDto {
  @ApiProperty({ description: 'access. 15분' }) accessToken!: string;
  @ApiProperty({ description: 'refresh. 14일. HttpOnly 쿠키로도 내려갑니다' }) refreshToken!: string;
  @ApiProperty({ type: PrincipalDto }) principal!: PrincipalDto;
}

export class MeSummaryDto {
  @ApiProperty({ type: PrincipalDto }) principal!: PrincipalDto;
  @ApiProperty({ example: 3 }) unreadNotifications!: number;
  @ApiProperty({ example: 12, description: '노출 중인 내 매물' }) publishedListings!: number;
  @ApiProperty({ example: 2, description: '진행 중인 거래' }) openDeals!: number;
  @ApiProperty({
    nullable: true, example: 'IDENTITY_REQUIRED',
    description: '지금 사용자가 막혀 있는 이유. null 이면 제약 없음',
  })
  blockedBy!: string | null;
  /* v10.31 — 머리줄 「👤 이름」(인증 사업자면 회사명) · 문의 답변 이메일(본인 것) */
  @ApiProperty({ nullable: true, example: '(주)소개하니컴퍼니' }) displayName!: string | null;
  @ApiProperty({ nullable: true, example: 'biz@example.com' }) email!: string | null;
}

export class CreateBusinessDto {
  @ApiProperty({ example: '1234567890', description: '하이픈 없는 10자리' })
  @IsString() bizRegNo!: string;

  @ApiProperty() @IsString() companyName!: string;
  @ApiProperty() @IsString() ceoName!: string;
  @ApiPropertyOptional({ description: '옛 자유 입력 주소. 신규는 아래 구조화 필드를 씁니다' })
  @IsOptional() @IsString() address?: string;

  /* Daum 우편번호 서비스 결과.
   *
   * 자유 입력 한 줄로 받으면 "서울 강남구 테헤란로 1" 과
   * "서울시 강남 테헤란로1길" 이 다른 값으로 쌓입니다.
   * 소개 매칭의 절반이 지역이므로 그러면 매칭이 되지 않습니다.
   *
   * 매칭에는 sido · sigungu 만 씁니다.
   * addressDetail(동·호수)은 그 자체로 개인을 가리킬 수 있어 쓰지 않습니다. */
  @ApiPropertyOptional({ example: '06234', description: '우편번호 5자리' })
  @IsOptional() @IsString() @Matches(/^[0-9]{5}$/, { message: '우편번호는 5자리 숫자입니다.' })
  zipcode?: string;

  @ApiPropertyOptional({ description: '도로명 주소' })
  @IsOptional() @IsString() addressRoad?: string;

  @ApiPropertyOptional({ description: '지번 주소' })
  @IsOptional() @IsString() addressJibun?: string;

  @ApiPropertyOptional({ example: '서울', description: '시·도 — 지역 매칭에 사용' })
  @IsOptional() @IsString() sido?: string;

  @ApiPropertyOptional({ example: '강남구', description: '시·군·구 — 지역 매칭에 사용' })
  @IsOptional() @IsString() sigungu?: string;

  @ApiPropertyOptional({ description: '상세주소. 매칭·통계에 사용하지 않습니다' })
  @IsOptional() @IsString() addressDetail?: string;

  /* v10.31 — 시안 가입 2단계(개인 사업자 · 법인 사업자) */
  @ApiPropertyOptional({ enum: ['SOLE', 'CORP'], description: '가입 유형. CORP 이면 법인등록번호 13자리가 필수입니다' })
  @IsOptional() @IsIn(['SOLE', 'CORP']) type?: 'SOLE' | 'CORP';

  @ApiPropertyOptional({ example: '1101111234567', description: '법인등록번호 13자리(하이픈 허용)' })
  @IsOptional() @IsString() @MaxLength(20) corpRegNo?: string;

  @ApiPropertyOptional({ example: '도소매', description: '업태' })
  @IsOptional() @IsString() @MaxLength(60) bizType?: string;

  @ApiPropertyOptional({ example: '전자상거래', description: '종목' })
  @IsOptional() @IsString() @MaxLength(60) bizItem?: string;
}

/** v10.31 — 가입 2단계 「인증하기」(계정 만들기 전 조회) */
export class SignupBizCheckDto {
  @ApiProperty({ example: '123-45-67890', description: '사업자등록번호 10자리(하이픈 허용)' })
  @IsString() @MaxLength(20) bizRegNo!: string;
}

export class BizCheckResultDto {
  @ApiProperty({ example: '1234567890' }) bizRegNo!: string;
  @ApiProperty({ enum: ['VALID', 'CLOSED', 'SUSPENDED', 'UNKNOWN'] }) status!: string;
  @ApiProperty({ description: '모의 조회면 true — 화면에 「모의 조회」로 표시' }) stub!: boolean;
  @ApiProperty({ nullable: true, description: '국세청 상태 문구' }) detail!: string | null;
  @ApiProperty({ description: '이미 가입된 사업자등록번호' }) taken!: boolean;
  @ApiProperty({ description: '다음 단계로 갈 수 있는지(계속사업자 · 미가입)' }) ok!: boolean;
}

export class BusinessResultDto {
  @ApiProperty({ format: 'uuid' }) businessId!: string;
  @ApiProperty({ format: 'uuid', description: '검수 큐 항목. 사업자 승인은 전건 수동입니다' })
  reviewId!: string;
  @ApiProperty({ example: 'IN_REVIEW' }) status!: string;
  @ApiProperty({
    description: 'NTS 실연동 여부. false 면 스텁 결과이므로 화면에 표시하십시오',
  })
  ntsVerified!: boolean;
}

export class TermDto {
  @ApiProperty({ example: 'SERVICE' }) code!: string;
  @ApiProperty({ example: '1.0' }) version!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() isRequired!: boolean;
  @ApiPropertyOptional({ description: 'v10.28 (G-218) — 알림(동의를 받지 않는 안내 · 예: 개인정보 처리 위탁)' }) isNotice?: boolean;
  @ApiPropertyOptional({ description: 'v10.103 — 참고용 번역이 얹혔는지(효력은 한국어 원문 · 한국어 화면에는 없음)' }) translated?: boolean;
}

/** v10.161 (D151) — 시행 예정 약관(바뀔 글 · 시행일 · 바뀐 점) */
export class UpcomingTermDto {
  @ApiProperty({ example: 'SERVICE' }) code!: string;
  @ApiProperty({ example: '1.1' }) version!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '시행 예정 판의 전문' }) body!: string;
  @ApiProperty({ format: 'date-time' }) effectiveFrom!: string;
  @ApiPropertyOptional({ nullable: true, description: '이 판에서 바뀐 점' }) changeNote?: string | null;
  @ApiProperty({ example: '1.0', nullable: true, description: '지금 시행 중인 판' }) currentVersion!: string | null;
  @ApiPropertyOptional({ description: '알림(동의를 받지 않는 안내)' }) isNotice?: boolean;
}
