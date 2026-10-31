import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';
import { TownVerifyService } from './town-verify.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';

/* v10.164 (D154 · docs/253) — 소개광장 동네 인증(꺼진 채로 · 좌표는 저장하지 않음 · 감사 기록에 본문을 넣지 않음) */

export class TownVerifyDto {
  @ApiProperty({ description: '위도 — 행정동을 찾는 데 한 번만 쓰고 저장하지 않음' }) @IsNumber() @Min(33) @Max(39) lat!: number;
  @ApiProperty({ description: '경도 — 행정동을 찾는 데 한 번만 쓰고 저장하지 않음' }) @IsNumber() @Min(124) @Max(132) lng!: number;
}
export class TownConfigDto {
  @ApiProperty({ description: '동네 인증 켜짐(community.town_verify)' }) enabled!: boolean;
  @ApiProperty({ example: 30 }) days!: number;
}
export class TownDto {
  @ApiProperty({ example: '1168064000' }) admCode!: string;
  @ApiProperty({ example: '서울특별시 강남구 역삼1동' }) admName!: string;
  @ApiProperty({ format: 'date-time' }) verifiedAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class MyTownDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: '지금 시행 중인 위치기반서비스 이용약관(LOCATION)에 동의함' }) consent!: boolean;
  @ApiPropertyOptional({ type: TownDto, nullable: true }) town!: TownDto | null;
}
export class TownRemoveDto {
  @ApiProperty() removed!: number;
}

@ApiTags('HOM')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class TownVerifyController {
  constructor(private readonly svc: TownVerifyService) {}

  @Get('community/town/config')
  @ApiOperation({ summary: '동네 인증 — 켜짐', description: '꺼져 있으면 사용자 웹에 단추가 나오지 않습니다(v10.164).' })
  @ApiOkResponse({ type: TownConfigDto })
  config() { return this.svc.config(); }

  @ApiBearerAuth()
  @Get('me/town')
  @Roles('MEMBER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 동네 인증', description: '만료 전 인증 · 위치기반 약관 동의 여부.' })
  @ApiOkResponse({ type: MyTownDto })
  mine() { return this.svc.mine(); }

  @ApiBearerAuth()
  @Post('me/town/verify')
  @Roles('MEMBER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '동네 인증하기', description: '휴대폰 위치 한 번 → 행정동 코드 · 이름만 저장(30일). 좌표는 저장 · 기록하지 않습니다.' })
  @ApiOkResponse({ type: MyTownDto })
  @ApiResponse({ status: 422, description: 'TOWN_VERIFY_OFF · TOWN_CONSENT_REQUIRED · TOWN_GEO_NOT_READY · TOWN_NOT_FOUND', type: ErrorDto })
  verify(@Body() dto: TownVerifyDto) { return this.svc.verify(dto.lat, dto.lng); }

  @ApiBearerAuth()
  @Delete('me/town')
  @Roles('MEMBER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '동네 인증 지우기', description: '언제든 지울 수 있습니다.' })
  @ApiOkResponse({ type: TownRemoveDto })
  remove() { return this.svc.remove(); }
}
