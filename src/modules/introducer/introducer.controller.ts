import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../core/auth';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
         ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { IntroducerService } from './introducer.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Audit } from '../../core/audit.interceptor';

export class RespondDto {
  @ApiProperty({ example: 'KNOW',
    enum: ['KNOW', 'CHECKING', 'DONT_KNOW', 'NOT_MY_FIELD'],
    description: '제가 알아요 · 확인해 보겠습니다 · 잘 모릅니다 · 관심 없는 분야' })
  @IsIn(['KNOW', 'CHECKING', 'DONT_KNOW', 'NOT_MY_FIELD']) answer!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
}
export class InviteDto {
  @ApiProperty({ example: '한빛이사 김대표',
    description: '상대방 표기명. 이 이름만 저장되고 연락처는 저장하지 않습니다' })
  @IsString() inviteeLabel!: string;
  @ApiPropertyOptional({ enum: ['SELF', 'SMS', 'ALIMTALK', 'EMAIL'], default: 'SELF',
    description: 'SELF 는 소개자가 링크를 직접 전달합니다 — 플랫폼이 연락처를 받지 않습니다' })
  @IsOptional() @IsIn(['SELF', 'SMS', 'ALIMTALK', 'EMAIL']) channel?: string;
}
export class IntroProfileDto {
  @ApiPropertyOptional({ type: [String], description: '소개 분야 — 업종 코드(categories.code) 10개까지' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) categories?: string[];
  @ApiPropertyOptional({ type: [String], description: '활동 지역 — 「서울 금천구」처럼 시 · 도 + 시 · 군 · 구 10개까지' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) regions?: string[];
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) headline?: string;
}
export class ConsentDto {
  @ApiProperty({ description: 'true 동의 · false 거절' }) @StrictBoolean() agree!: boolean;
}
export class IntroOkDto {
  @ApiPropertyOptional() id?: string;
  @ApiPropertyOptional() state?: string;
  @ApiPropertyOptional() note?: string;
}

/**
 * SB-MYP-INT-* 소개자 활동
 *
 * 흐름: 맞춤 요청 → "제가 알아요" → 초대 → **상대방 동의** → 연결
 */
@ApiTags('MY')
@ApiBearerAuth()
@Controller('api/v1/me/introducer')
/* ★ /me/** 는 **본인 것만** 보이는 자리입니다.
 *   표시가 없으면 토큰 없이도 200 이 나가고, 나중에 그 안에
 *   개인정보를 담는 순간 조용히 샙니다.
 *   역할이 아니라 **로그인 여부**만 봅니다 — 특정 역할을 요구하면
 *   사업자가 못 들어가는 곳이 생깁니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
export class IntroducerController {
  constructor(private readonly svc: IntroducerService) {}

  @Get('matched')
  @ApiOperation({
    summary: '내게 맞는 요청',
    description: '등록하신 분야·지역에 맞는 요청만 보여드립니다. 이미 답한 것은 빠집니다.',
  })
  @ApiOkResponse({ type: IntroOkDto })
  matched() { return this.svc.matched(); }

  @Get('profile')
  @ApiOperation({ summary: '내 소개 분야 · 지역 (v10.31 · 시안 칩)', description: '분야 = 업종 코드, 지역 = 시 · 군 · 구 코드. 이름을 함께 돌려줍니다.' })
  @ApiOkResponse({ type: IntroOkDto })
  profile() { return this.svc.profile(); }

  @Patch('profile')
  @ApiOperation({ summary: '소개 분야 · 지역 바꾸기 (v10.31 · 「분야 추가 · 지역 추가」)',
    description: '없는 코드는 받지 않습니다(422 BAD_CATEGORY · BAD_REGION). 처음이면 소개자 프로필(새싹 소개자)을 만듭니다. 맞춤 요청은 분야로 거릅니다.' })
  @ApiOkResponse({ type: IntroOkDto })
  @Audit('INTRO_PROFILE', 'ACCOUNT')
  updateProfile(@Body() dto: IntroProfileDto) { return this.svc.updateProfile(dto); }

  @Get('profile/options')
  @ApiOperation({ summary: '분야 · 지역 고르기 목록', description: '승인된 업종(소개몰 제외) · 시 · 도 17곳(시 · 군 · 구는 글로 적음)' })
  @ApiOkResponse({ type: IntroOkDto })
  profileOptions() { return this.svc.profileOptions(); }

  @Get('grades')
  @ApiOperation({ summary: '소개자 등급 기준표 (v10.31 · 시안 「등급」 표)', description: '새싹 ~ 지역 파트너의 기준 · 혜택. now 는 내 등급.' })
  @ApiOkResponse({ type: IntroOkDto, isArray: true })
  grades() { return this.svc.grades(); }

  @Post('respond')
  @ApiOperation({
    summary: '요청에 응답',
    description:
      '모른다는 답도 남깁니다 — 그 데이터가 소개자별 분야를 좁혀 줍니다. ' +
      '등급은 응답 건수가 아니라 수락률과 만족도로 정해집니다.',
  })
  @ApiOkResponse({ type: IntroOkDto })
  @Audit('INTRO_RESPOND', 'REQUEST')
  respond(@Body() dto: RespondDto & { requestId: string }) {
    return this.svc.respond((dto as any).requestId, dto.answer, dto.memo);
  }

  @Post('invite')
  @ApiOperation({
    summary: '초대 보내기',
    description:
      '**기본은 소개자 직접 전달(SELF)입니다** — 플랫폼이 상대방 연락처를 받지 않습니다. ' +
      '대행 발송은 연락처를 받되 발송 직후 지웁니다. ' +
      '토큰 원문은 이 응답에만 실리고 DB 에는 해시만 둡니다.',
  })
  @ApiResponse({ status: 422, description: 'CHANNEL_NOT_READY', type: ErrorDto })
  @ApiOkResponse({ type: IntroOkDto })
  @Audit('INTRO_INVITE', 'INVITE')
  invite(@Body() dto: InviteDto & { requestId: string }) {
    return this.svc.invite((dto as any).requestId, dto.inviteeLabel, dto.channel ?? 'SELF');
  }

  @Get('channels')
  @ApiOperation({
    summary: '초대 전달 방법',
    description:
      '준비된 채널만 고를 수 있습니다. 계약·인증이 끝나지 않은 채널로 보내면 ' +
      '발송은 성공으로 기록되고 상대방만 못 받습니다 — 가장 발견하기 어려운 실패입니다.',
  })
  @ApiOkResponse({ type: IntroOkDto, isArray: true })
  channels() { return this.svc.channels(); }

  @Get('invites')
  @ApiOperation({ summary: '보낸 초대' })
  @ApiOkResponse({ type: IntroOkDto, isArray: true })
  invites() { return this.svc.invites(); }

  @Get('activity')
  @ApiOperation({
    summary: '활동 · 등급',
    description: '등급은 보낸 건수가 아니라 수락률과 만족도로 정해집니다.',
  })
  @ApiOkResponse({ type: IntroOkDto })
  activity() { return this.svc.activity(); }
}

@ApiTags('MY')
@ApiBearerAuth()
@Controller('api/v1/me/points')
/* ★ /me/** 는 **본인 것만** 보이는 자리입니다.
 *   표시가 없으면 토큰 없이도 200 이 나가고, 나중에 그 안에
 *   개인정보를 담는 순간 조용히 샙니다.
 *   역할이 아니라 **로그인 여부**만 봅니다 — 특정 역할을 요구하면
 *   사업자가 못 들어가는 곳이 생깁니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
export class PointsController {
  constructor(private readonly svc: IntroducerService) {}

  @Get()
  @ApiOperation({
    summary: '포인트',
    description:
      '**적립과 사용 가능을 나눠 냅니다.** 섞으면 "왜 못 쓰냐"는 문의가 그대로 옵니다 — ' +
      '유효한 연결이 확인돼야 열립니다.',
  })
  @ApiOkResponse({ type: IntroOkDto })
  points() { return this.svc.points(); }
}

/**
 * SB-HOM-INV-010 초대 확인 · 동의
 *
 * **초대받은 사람은 아직 회원이 아닙니다.** 가입을 먼저 요구하면
 * 대부분 여기서 나갑니다 — 동의가 먼저입니다.
 */
@ApiTags('HOM')
@Controller('api/v1/invites')
export class InviteController {
  constructor(private readonly svc: IntroducerService) {}

  @Get(':token')
  @ApiOperation({
    summary: '초대 확인 (비회원)',
    description:
      '로그인 없이 확인하실 수 있습니다. 동의 전에는 요청자가 회원님의 연락처를 알지 못합니다.',
  })
  @ApiParam({ name: 'token' })
  @ApiResponse({ status: 409, description: 'NO_SUCH_INVITE', type: ErrorDto })
  @ApiOkResponse({ type: IntroOkDto })
  view(@Param('token') token: string) { return this.svc.viewInvite(token); }

  @Post(':token/consent')
  @ApiOperation({
    summary: '동의 · 거절',
    description:
      '동의하면 연결이 생깁니다. **동의 기록은 되돌릴 수 없습니다** — ' +
      '나중에 "동의한 적 없다"는 분쟁의 근거입니다. ' +
      '거절하셔도 불이익이 없고, 소개자에게는 거절 사실만 전달됩니다.',
  })
  @ApiParam({ name: 'token' })
  @ApiResponse({ status: 409, description: 'EXPIRED · NO_SUCH_INVITE', type: ErrorDto })
  @ApiOkResponse({ type: IntroOkDto })
  @Audit('INVITE_CONSENT', 'INVITE')
  consent(@Param('token') token: string, @Body() dto: ConsentDto) {
    return this.svc.consent(token, dto.agree);
  }
}
