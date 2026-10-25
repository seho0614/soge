import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JobName, SchedulerService } from './scheduler.service';
import { Roles } from '../core/auth';
import { Forbidden } from '../core/errors';
import { ErrorDto } from '../common/dto/common.dto';
import { Audit } from '../core/audit.interceptor';

const JOBS = [
  'sla_alert','k_alert','promo_expiry','expire_badges',
  'deal_auto_confirm','settlement_audit','attribution_archive','pii_purge',
  'subscription_billing','risk_scan','notify_dispatch','contract_nudge','ad_expiry_notice',
  'event_close', 'lead_assign', 'hlt_auto_confirm', 'hlt_rank', 'lead_cash_auto',
  'directory_expiry',   /* v10.33 (D092) 정액 노출 만료 안내 · 자동 종료 */
  'geo_backfill',       /* v10.46 (D099) 매물 좌표 채우기(카카오 로컬) · 지도 사용 off 면 건너뜀 */
  'translate_jobs',     /* v10.104 (D118) 등록 글 자동 번역 · 스위치 · 월 상한이 막으면 건너뜀 */
  'review_shadow',      /* v10.106 (D120) AI 검수 보조(병행) — 의견만 저장 · 스위치 · 월 상한이 막으면 건너뜀 */
  'agent_chat_purge',   /* v10.109 (D121) AI 상담 대화 보관 기간(5년) 지난 것 정리 */
] as const;

export class RunJobDto {
  @ApiProperty({ enum: JOBS })
  @IsIn(JOBS) job!: JobName;
}

export class JobResultDto {
  @ApiProperty({ enum: JOBS }) job!: string;
  @ApiProperty({ example: 3 }) affected!: number;
  @ApiProperty({ nullable: true }) detail!: unknown;
  @ApiProperty({ example: 42 }) ms!: number;
}

/**
 * 정기 작업 트리거. EventBridge 가 호출합니다.
 * 앱 내 cron 을 쓰지 않는 이유: ECS 태스크가 2개면 두 번 실행됩니다.
 */
@ApiTags('ADM')
@ApiBearerAuth()
/* 컨트롤러 수준 @Roles 를 두지 않습니다.
 * 사람이 부르는 경로(POST /)와 EventBridge 가 부르는 경로(POST /run)의
 * 인증 방식이 다르기 때문입니다. 각 메서드에 붙입니다. */
@Controller('api/v1/admin/jobs')
export class WorkerController {
  constructor(private readonly scheduler: SchedulerService) {}

  /* EventBridge 는 사람이 아닙니다.
   *
   * 스케줄러에 SUPER 계정의 JWT 를 심으면 두 가지가 나쁩니다 —
   * 만료되면 배치가 조용히 멈추고, 새면 관리자 전 권한이 넘어갑니다.
   *
   * 그래서 이 경로만 여는 전용 토큰을 둡니다.
   * 할 수 있는 것은 job 실행뿐이고, 다른 관리자 API 는 열리지 않습니다. */
  private jobTokenOk(header?: string): boolean {
    const expected = process.env.JOB_TOKEN;
    if (!expected || expected.length < 32) return false;   // 미설정이면 항상 거부
    if (!header) return false;
    const got = header.replace(/^Bearer\s+/i, '');
    // 길이가 다르면 비교 자체를 하지 않습니다(타이밍 노출 방지).
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  @Post()
  @Roles('SUPER')
  @ApiOperation({
    summary: '정기 작업 실행 (사람)',
    description:
      '멱등하게 설계돼 있어 중복 호출해도 안전합니다. ' +
      'settlement_audit 는 정합성만 점검합니다. 플랫폼은 지급하지 않으므로 이체가 없습니다(INV-11).',
  })
  @ApiOkResponse({ type: JobResultDto })
  @Audit('JOB_RUN', 'JOB')
  run(@Body() dto: RunJobDto) {
    return this.scheduler.run(dto.job);
  }

  /**
   * EventBridge 전용 경로.
   *
   * 전용 토큰으로만 열리며 job 실행 외에는 아무것도 할 수 없습니다.
   * JOB_TOKEN 이 없거나 32자 미만이면 **항상 거부**합니다 —
   * 설정을 빠뜨린 채 배포하면 배치가 안 도는 편이 낫습니다.
   * 아무나 부를 수 있는 것보다는 그렇습니다.
   */
  /**
   * 지금 돌아야 할 것을 알아서 실행합니다.
   *
   * 스케줄러는 이 하나만 매분 부르면 됩니다 — 어떤 작업을 언제 돌릴지는
   * DB(job_schedules)가 정합니다. 주기를 바꾸는 데 배포가 필요 없습니다.
   */
  @Post('tick')
  @ApiOperation({
    summary: '지금 돌아야 할 배치 실행 (스케줄러 전용)',
    description:
      '`X-Job-Token` 으로 인증합니다. 매분 불러도 안전합니다 — ' +
      '같은 시간대의 같은 작업은 DB 유일 제약 때문에 한 번만 실행됩니다. ' +
      '스케줄러가 둘이어도 두 번 돌지 않습니다.',
  })
  @ApiResponse({ status: 403, description: '토큰 불일치', type: ErrorDto })
  @Audit('JOB_TICK', 'JOB')
  async tick(@Headers('x-job-token') token?: string) {
    if (!this.jobTokenOk(token)) {
      throw new Forbidden('JOB_TOKEN_INVALID', '작업 실행 권한이 없습니다.');
    }
    return this.scheduler.tick();
  }

  @Post('run')
  @ApiOperation({
    summary: '정기 작업 실행 (EventBridge 전용)',
    description:
      '`X-Job-Token` 헤더로 인증합니다. 사람 계정 토큰을 스케줄러에 심지 않기 위해서입니다 — ' +
      '만료되면 배치가 조용히 멈추고, 새면 관리자 전 권한이 넘어갑니다. ' +
      '이 토큰으로는 job 실행만 됩니다.',
  })
  @ApiOkResponse({ type: JobResultDto })
  @ApiResponse({ status: 403, description: '토큰 불일치 또는 JOB_TOKEN 미설정', type: ErrorDto })
  @Audit('JOB_RUN', 'JOB')
  runByToken(@Body() dto: RunJobDto, @Headers('x-job-token') token?: string) {
    if (!this.jobTokenOk(token)) {
      throw new Forbidden('JOB_TOKEN_INVALID', '작업 실행 권한이 없습니다.');
    }
    return this.scheduler.run(dto.job);
  }
}
