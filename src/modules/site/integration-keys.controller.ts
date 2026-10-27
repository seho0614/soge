import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IntegrationSecretService } from '../../common/integration/secret.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.128 (D128 · docs/192) — 외부 연동 키를 운영 화면에서
 *
 *   SUPER   GET    /admin/integration-keys                 연동 키 목록(끝 4자리 · 어디서 왔는지)   (SB-ADM-SIT-080)
 *   SUPER   PUT    /admin/integration-keys/:code/:name     넣기 · 바꾸기(암호화 저장 · 바로 반영)
 *   SUPER   DELETE /admin/integration-keys/:code/:name     지우기(.env 값으로 되돌아감)
 *   공개    GET    /site-settings/payment                  결제창(토스) 공개 키 — 사용자 웹이 빌드 없이 받음(지도 키 /site-settings/map 과 같은 자리)
 * ------------------------------------------------------------------- */

export class IntegrationKeyStateDto {
  @ApiProperty({ example: 'PG' }) code!: string;
  @ApiProperty({ example: '전자결제(토스페이먼츠)' }) integration!: string;
  @ApiProperty({ example: 'TOSS_SECRET_KEY' }) name!: string;
  @ApiProperty({ example: '시크릿 키' }) label!: string;
  @ApiProperty({ description: '공개 키(브라우저에 나감 — 결제창 · 카카오 JS)' }) isPublic!: boolean;
  @ApiProperty({ enum: ['REAL', 'STUB', 'NONE'], description: 'REAL = 실제로 부름 · STUB = 연동 구현 전 · NONE = 업체 미정' }) adapter!: string;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'], description: 'ADMIN = 운영 화면에서 넣음(먼저 씀) · ENV = .env · NONE = 없음' }) source!: string;
  @ApiPropertyOptional({ nullable: true, example: '••••••ab12' }) masked!: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}
export class IntegrationKeySetDto {
  @ApiProperty({ minLength: 8, maxLength: 512, description: '업체 콘솔에서 복사한 키 — 형식은 키마다 DB 가 봄(INTEG_SECRET_FORMAT)' })
  @IsString() @MinLength(8) @MaxLength(512) value!: string;
}
export class PaymentClientKeyDto {
  @ApiPropertyOptional({ nullable: true, description: '토스 결제창 클라이언트 키(공개). null 이면 시험 결제(스텁)' }) clientKey!: string | null;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('SUPER')
export class IntegrationKeysController {
  constructor(private readonly keys: IntegrationSecretService) {}

  @Get('integration-keys')
  @ApiOperation({ summary: '외부 연동 키 목록', description: '키 값은 내보내지 않습니다 — 끝 4자리와 어디서 왔는지(운영 화면 · .env · 없음)만. 운영 화면 키가 먼저 쓰입니다.' })
  @ApiOkResponse({ type: IntegrationKeyStateDto, isArray: true })
  list() { return this.keys.list(); }

  @Put('integration-keys/:code/:name')
  @ApiOperation({ summary: '외부 연동 키 넣기 · 바꾸기', description: '암호화해 저장하고 바로 반영합니다. 넣은 뒤에는 다시 볼 수 없습니다 — 끝 4자리만.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'name' })
  @ApiOkResponse({ type: IntegrationKeyStateDto, isArray: true })
  @ApiResponse({ status: 422, description: 'INTEG_SECRET_FORMAT — 키 형식이 아님', type: ErrorDto })
  @Audit('INTEGRATION_KEY_SET', 'INTEGRATION')
  set(@Param('code') code: string, @Param('name') name: string, @Body() dto: IntegrationKeySetDto) { return this.keys.set(code, name, dto.value); }

  @Delete('integration-keys/:code/:name')
  @ApiOperation({ summary: '외부 연동 키 지우기', description: '지우면 .env 값을 쓰고, 그것도 없으면 그 연동은 간주 모드 · 시험 · 「준비 중」으로 돕니다.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'name' })
  @ApiOkResponse({ type: IntegrationKeyStateDto, isArray: true })
  @Audit('INTEGRATION_KEY_CLEAR', 'INTEGRATION')
  clear(@Param('code') code: string, @Param('name') name: string) { return this.keys.clear(code, name); }
}

@ApiTags('HOM')
@Controller('api/v1')
export class PaymentClientKeyController {
  constructor(private readonly keys: IntegrationSecretService) {}

  @Get('site-settings/payment')
  @ApiOperation({ summary: '결제창(토스) 공개 키', description: '브라우저에 나가는 공개 키입니다(비밀 키 아님). 운영 화면에서 넣은 값 → .env · 없으면 null(시험 결제).' })
  @ApiOkResponse({ type: PaymentClientKeyDto })
  clientKey() { return { clientKey: this.keys.tossClientKey() }; }
}
