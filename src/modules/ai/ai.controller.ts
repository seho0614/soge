import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { AiService } from './ai.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class ClassifyDto {
  @ApiProperty({ description: '분류할 문장' }) @IsString() text!: string;
}

export class ClassifyFeedbackDto {
  @ApiProperty({ description: '분류에 쓴 문장' }) @IsString() text!: string;
  @ApiPropertyOptional({ description: '시스템이 제안한 분류 코드' })
  @IsOptional() @IsString() suggested?: string;
  @ApiProperty({ description: '이용자가 실제로 고른 분류 코드' }) @IsString() chosen!: string;
}

export class RecommendDto {
  @ApiProperty({ description: '후보 목록. 각 후보의 scores 는 항목별 0~100' })
  @IsArray() candidates!: Array<{ id: string; name?: string; scores: Record<string, number> }>;
  @ApiPropertyOptional({ description: '가중치 임시 변경. 만지면 순위가 즉시 바뀝니다' })
  @IsOptional() @IsObject() weights?: Record<string, number>;
}

export class RaiseAlertDto {
  @ApiProperty() @IsString() rule!: string;
  @ApiProperty() @IsString() subject!: string;
  @ApiProperty() @IsString() detail!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
}

/**
 * SB-AIS-CLS-010 분류 · SB-AIS-REC-010 추천
 *
 * 학습 모델이 아닙니다. 어휘 가중치 합산입니다.
 * 응답에 engine · limits 를 실어 그 사실을 화면이 아니라 계약으로 밝힙니다.
 */

/* 응답 스키마. 없으면 문서에 "무엇이 돌아오는지"가 비고,
 * 프런트가 추측으로 붙입니다. */
export class AiOkDto {
  @ApiProperty() engine!: string;
  @ApiPropertyOptional() limits?: string;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } }) candidates?: unknown[];
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } }) weights?: unknown[];
}


export class ClassifyFeedbackResultDto {
  @ApiProperty({ example: true }) recorded!: boolean;
  @ApiPropertyOptional({ description: '제안과 다르면 어휘 조정 신호가 됩니다' }) note?: string;
}


export class MatchPartDto {
  @ApiProperty({ description: '원점수 0~100' }) raw!: number;
  @ApiProperty({ description: '가중치' }) weight!: number;
  @ApiProperty({ description: '가중 점수' }) points!: number;
}

export class MatchCandidateDto {
  @ApiProperty() partnerId!: string;
  @ApiProperty() company!: string;
  @ApiProperty({ description: '총점' }) total!: number;
  @ApiProperty({ description: '항목별 내역', type: Object }) parts!: Record<string, MatchPartDto>;
}

export class MatchResultDto {
  @ApiProperty() leadId!: string;
  @ApiProperty({ type: Object, isArray: true }) weights!: Array<Record<string, unknown>>;
  @ApiProperty({ type: MatchCandidateDto, isArray: true }) candidates!: MatchCandidateDto[];
  @ApiProperty() note!: string;
}

export class PersonaDto {
  @ApiPropertyOptional({ description: '동의가 없으면 null 입니다' })
  segment!: string | null;
  @ApiProperty() consented!: boolean;
  @ApiProperty() note!: string;
}

@ApiTags('AI')
@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly svc: AiService) {}

  @Post('classify')
  @ApiOperation({
    summary: '자동 분류',
    description:
      '어휘집 가중치를 더해 후보 3개를 냅니다. ' +
      '**제한업종·금칙어는 점수를 매기기 전에 막습니다**(INV-6) — ' +
      '점수를 먼저 매기면 "무엇으로 분류될 뻔했는가"가 로그에 남습니다. ' +
      '어휘집에 없으면 억지로 고르지 않고 분류하지 못했다고 답합니다.',
  })
  @ApiOkResponse({ type: AiOkDto })
  classify(@Body() dto: ClassifyDto) { return this.svc.classify(dto.text); }

  @Post('classify/feedback')
  @ApiOperation({
    summary: '분류 선택 기록',
    description:
      '이용자가 실제로 고른 분류를 남깁니다. 제안과 다르면 그 조합이 쌓이고, ' +
      '같은 조합이 반복되면 **어휘 가중치를 손봐야 한다는 신호**입니다. ' +
      '이 기록이 없으면 분류기가 좋아지는지 나빠지는지 알 수 없습니다.',
  })
  @ApiOkResponse({ type: ClassifyFeedbackResultDto })
  feedback(@Body() dto: ClassifyFeedbackDto) {
    return this.svc.feedback(dto.text, dto.suggested ?? null, dto.chosen);
  }

  @Get('recommend/weights')
  @ApiOperation({ summary: '추천 가중치', description: '데이터입니다. 만지면 순위가 바뀝니다.' })
  @ApiOkResponse({ type: AiOkDto })
  weights() { return this.svc.weights(); }

  /* v10.31 — 시안 SB-AIS-REC-010: 내 요청의 사업자 후보 · 5항목 점수(실제 자료). 요청한 본인 · 운영만 */
  @Get('recommend/request')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '내 요청의 추천 후보',
    description: '요청 id(없으면 내 최근 요청)의 사업자 후보와 항목 점수(loc · cat · win · spd · trust · 0~100) · 기본 가중치 총점. ' +
      '후보 · 점수는 서버가 계산합니다(fn_request_candidates). 광고는 들어가지 않습니다.',
  })
  @ApiQuery({ name: 'id', required: false, description: '요청 id' })
  @ApiResponse({ status: 403, description: 'NOT_REQUEST_OWNER', type: ErrorDto })
  requestCandidates(@Query('id') id?: string) {
    return this.svc.requestCandidates(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  }

  @Post('recommend')
  @ApiOperation({
    summary: '추천 점수 계산',
    description:
      '5항목 가중 합산입니다. 협업 필터링이 아닙니다. ' +
      '**광고(스폰서)는 이 점수에 들어가지 않고 순위에도 끼지 않습니다** — 표시광고법.',
  })
  @ApiResponse({ status: 422, description: 'NO_CANDIDATE', type: ErrorDto })
  recommend(@Body() dto: RecommendDto) {
    return this.svc.recommend(dto.candidates, dto.weights);
  }
}

/** SB-ADM-RSK-010 위험감지 (운영) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/risk')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class RiskController {
  constructor(private readonly svc: AiService) {}

  @Get('rules')
  @ApiOperation({
    summary: '위험 규칙',
    description:
      '규칙 원문과 오탐 가능성을 함께 냅니다. ' +
      '규칙에 없는 수법은 못 잡으므로 숨기지 않습니다.',
  })
  rules() { return this.svc.rules(); }

  @Get('alerts')
  @ApiOperation({ summary: '경보 목록', description: '근거·규칙 원문·오탐 가능성을 함께 봅니다.' })
  alerts(@Query('state') state?: string) { return this.svc.alerts(state); }

  @Post('alerts')
  @ApiOperation({
    summary: '경보 기록',
    description: '내용은 나중에 고칠 수 없습니다 — 처리 상태만 바뀝니다.',
  })
  @Audit('RISK_ALERT_RAISE', 'RISK')
  raise(@Body() dto: RaiseAlertDto) { return this.svc.raise(dto); }

  @Post('alerts/:id/close')
  @ApiOperation({
    summary: '경보 처리',
    description:
      '`FALSE_POSITIVE` 를 별도 상태로 둡니다. ' +
      '오탐을 CLOSED 로 묻으면 규칙이 얼마나 헛짚는지 알 수 없습니다.',
  })
  @ApiParam({ name: 'id' })
  @Audit('RISK_ALERT_CLOSE', 'RISK')
  close(@Param('id') id: string, @Query('state') state?: string) {
    return this.svc.closeAlert(id, state === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'CLOSED');
  }

  @Get('classify-health')
  @ApiOperation({
    summary: '분류기 상태',
    description:
      '정확도 · 못 잡은 입력 · 제안과 갈린 조합 · 미연결 분류를 함께 냅니다. ' +
      '**못 잡은 입력이 곧 추가해야 할 어휘**입니다.',
  })
  classifyHealth() { return this.svc.health(); }

  @Get('rule-health')
  @ApiOperation({
    summary: '규칙별 오탐률',
    description: '규칙을 고칠지 판단하는 근거입니다. 오탐이 잦은 규칙은 운영이 무시하기 시작합니다.',
  })
  health() { return this.svc.ruleHealth(); }

}

/**
 * 서버 계산 AI.
 *
 * 접두어가 `/api/v1` 입니다 — 위험감지 컨트롤러(`/admin/risk`) 아래에
 * 두면 주소가 `admin/risk/ai/match` 가 되어 권한도 용도도 어긋납니다.
 */
@ApiTags('AI')
@Controller('api/v1')
export class AiServerController {
  constructor(private readonly svc: AiService) {}
  @Get('ai/match/:leadId')
  @ApiOperation({
    summary: 'AI 추천 결과 (서버 계산)',
    description:
      '리드에 맞는 파트너 후보와 점수입니다. **점수를 클라이언트가 보내지 ' +
      '않습니다** — 리드 배정이 이 점수로 정해지므로, 보낼 수 있게 두면 ' +
      '자기를 1등으로 만들 수 있습니다. ' +
      '지역·업종·성사 이력·응답 속도·열람률을 서버가 계산합니다.',
  })
  @ApiParam({ name: 'leadId' })
  @ApiOkResponse({ type: MatchResultDto })
  match(@Param('leadId') id: string) { return this.svc.match(id); }

  @Get('me/persona')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiOperation({
    summary: '내 성향 세그먼트',
    description:
      '동의하지 않으셨으면 segment 가 null 입니다 — **동의 없이 계산해 두지 ' +
      '않습니다.** 등록하신 관과 활동으로 정해지며, 철회하면 즉시 사라집니다.',
  })
  @ApiOkResponse({ type: PersonaDto })
  myPersona() { return this.svc.myPersona(); }

}
