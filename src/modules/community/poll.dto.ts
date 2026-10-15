import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID,
  Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

/** 그림 주소 — 사이트 안 경로(/…) 또는 https 주소만. DB 제약과 같은 규칙입니다 */
const IMG = /^(\/[A-Za-z0-9_./-]{1,200}|https:\/\/[^\s]{4,250})$/;

export const POLL_KINDS = ['VS', 'ASK', 'USED'] as const;
export const POLL_STATES = ['DRAFT', 'OPEN', 'CLOSED', 'HIDDEN'] as const;

export class PollVoteDto {
  @ApiProperty({ description: '고른 보기' })
  @IsUUID()
  optionId!: string;
}

export class PollOptionInputDto {
  @ApiProperty({ example: 'A 브랜드' })
  @IsString() @Length(1, 40)
  label!: string;

  @ApiPropertyOptional({ example: '흡입력 강함', description: '보기 아래 한 줄(비교해요)' })
  @IsOptional() @IsString() @Length(0, 40)
  sub?: string;

  @ApiPropertyOptional({ example: '/home/d/vs-a.png', description: '보기 그림(비교해요) — /경로 또는 https 주소' })
  @IsOptional() @Matches(IMG, { message: '그림 주소는 /경로 또는 https:// 로 시작해야 합니다.' })
  image?: string;
}

export class CreatePollDto {
  @ApiProperty({ enum: POLL_KINDS, description: 'VS 비교해요(보기 2개) · ASK 궁금해요(2 ~ 8개) · USED 써본 의견이 필요해요(2 ~ 5개)' })
  @IsIn(POLL_KINDS as unknown as string[])
  kind!: string;

  @ApiProperty({ example: '둘 중 어떤 제품이 더 좋을까요?' })
  @IsString() @Length(4, 80)
  title!: string;

  @ApiPropertyOptional({ example: '실제 사용자들의 솔직한 의견을 기다려요.' })
  @IsOptional() @IsString() @Length(0, 200)
  description?: string;

  @ApiPropertyOptional({ example: '/home/d/poll-bags.png', description: '카드 옆 그림(궁금해요 · 써본 의견)' })
  @IsOptional() @Matches(IMG, { message: '그림 주소는 /경로 또는 https:// 로 시작해야 합니다.' })
  image?: string;

  @ApiProperty({ type: [PollOptionInputDto] })
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => PollOptionInputDto)
  options!: PollOptionInputDto[];

  @ApiPropertyOptional({ description: '메인 「이건 어때?」에 낼지 — 종류마다 순서가 가장 앞선 열린 투표 1건이 나옵니다' })
  @IsOptional() @StrictBoolean()
  showOnHome?: boolean;

  @ApiPropertyOptional({ example: 0, description: '순서(작을수록 앞)' })
  @IsOptional() @IsInt() @Min(0) @Max(9999)
  sort?: number;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59+09:00', description: '마감 시각(선택). 비우면 닫을 때까지 받습니다' })
  @IsOptional() @IsISO8601()
  endsAt?: string;
}

export class UpdatePollDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(4, 80)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(/^$|^(\/[A-Za-z0-9_./-]{1,200}|https:\/\/[^\s]{4,250})$/, { message: '그림 주소는 /경로 또는 https:// 로 시작해야 합니다.' })
  image?: string;

  @ApiPropertyOptional({ enum: POLL_STATES, description: 'OPEN 열기 · CLOSED 마감 · HIDDEN 감추기(사유 필요) · DRAFT 준비 중(표가 없을 때만)' })
  @IsOptional() @IsIn(POLL_STATES as unknown as string[])
  state?: string;

  @ApiPropertyOptional({ description: '감추는 사유(5자 이상) — state=HIDDEN 일 때' })
  @IsOptional() @IsString() @Length(5, 200)
  hiddenReason?: string;

  @ApiPropertyOptional() @IsOptional() @StrictBoolean()
  showOnHome?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999)
  sort?: number;

  @ApiPropertyOptional({ description: '마감 시각. 빈 문자열이면 마감 없음' })
  @IsOptional() @Matches(/^$|^\d{4}-\d{2}-\d{2}/, { message: '마감 시각 형식이 맞지 않습니다.' })
  endsAt?: string;

  @ApiPropertyOptional({ type: [PollOptionInputDto], description: '보기 전체 교체 — **표가 들어오기 전에만** 됩니다' })
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => PollOptionInputDto)
  options?: PollOptionInputDto[];
}

export class PollOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() sort!: number;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ nullable: true }) sub!: string | null;
  @ApiPropertyOptional({ nullable: true }) image!: string | null;
  @ApiProperty({ description: '실제 표 수' }) votes!: number;
}

export class PollDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: POLL_KINDS }) kind!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) image!: string | null;
  @ApiProperty({ enum: POLL_STATES }) state!: string;
  @ApiProperty({ description: '지금 표를 받는가(열림 · 마감 전)' }) open!: boolean;
  @ApiPropertyOptional({ nullable: true }) endsAt!: string | null;
  @ApiProperty({ description: '실제 참여 수(표 수 합)' }) total!: number;
  @ApiProperty({ type: [PollOptionDto] }) options!: PollOptionDto[];
  @ApiPropertyOptional({ nullable: true, description: '내가 고른 보기(회원은 계정, 비로그인은 방문자 키 기준). 아직이면 null' })
  myOptionId!: string | null;
}

export class PollVoteResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: '투표했습니다.' }) note!: string;
  @ApiProperty({ type: PollDto, description: '투표한 뒤의 상태 — 참여 수 · 보기별 표 · 내가 고른 보기' }) poll!: PollDto;
}

export class PollAdminDto extends PollDto {
  @ApiProperty({ description: '메인에 내기를 켰는가' }) showOnHome!: boolean;
  @ApiProperty({ description: '순서(작을수록 앞)' }) sort!: number;
  @ApiPropertyOptional({ nullable: true, description: '감춘 사유' }) hiddenReason!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ description: '지금 메인 카드에 나가는 중인가 — 종류마다 1건' }) onHome!: boolean;
}

export class PollAdminListDto {
  @ApiProperty({ type: [PollAdminDto] }) items!: PollAdminDto[];
  @ApiProperty({ description: '비로그인도 투표할 수 있는가 (설정 poll.guest_vote)' }) guestVote!: boolean;
  @ApiProperty({ description: '같은 인터넷 주소에서 비로그인으로 하루에 넣을 수 있는 표 — 투표 1건당 (설정 poll.guest_ip_daily_limit)' }) guestIpDailyLimit!: number;
}

export class PollWriteResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: POLL_STATES }) state!: string;
  @ApiPropertyOptional() note?: string;
}
