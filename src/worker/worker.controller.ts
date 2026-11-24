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
  'hlt_settle_weekly',  /* v10.168 (D157) 소개몰 주 정산 마감 */
  'launch_watch',       /* v10.170 (D159) 시험 결제 주문 알림 */
  'launch_digest',      /* v10.171 (D160) 운영 하루 요약 */
  'owner_todo_weekly',  /* v10.249 (D203) 대표 할 일 주간 알림 — 월요일 09:05 · 아직인 줄만 텔레그램 · 슬랙 */
  'cs_weekly',          /* v10.352 (D234) 고객센터 주간 보고 — 월요일 09:10 · 텔레그램 · 슬랙 · 운영자 게시판 */
  'security_monthly',   /* v10.354 (D235) 월간 보안 보고 — 매일 09:20 · 지난달 것을 아직 안 보냈으면 */
  'directory_expiry',   /* v10.33 (D092) 정액 노출 만료 안내 · 자동 종료 */
  'seller_license_watch', /* v10.223 (D193) 입점 서류 만료 30 · 7일 전 알림 · 만료일 운영 알림 */
  'hlt_rate_schedule',  /* v10.275 (D208) 수수료율 인상 예약 시행 — 매일 00:05 */
  'notice_schedule',    /* v10.282 (D211) 예약 공지 알림 — 10분마다 */
  'setting_schedule',   /* v10.377 (D241) 설정 예약 변경 — 5분마다 */
  'gwan_maint',         /* v10.706 (D323) 관 점검 시간 — 1분마다 */
  'page_link_check',    /* v10.750 (D327) 깨진 링크 — 매일 05:10 */
  'withdraw_grace_mail', /* v10.378 (D241) 탈퇴 유예 끝 하루 전 메일 — 매시간 */
  'maint_notice',       /* v10.379 (D241) 점검 예정 회원 알림 — 10분마다 */
  'acct_journal',       /* v10.382 (D242) 자동 전표 — 매시간 */
  'acct_deadline',      /* v10.390 (D244) 신고 기한 · 지난달 마감 알림 — 매일 09:15 */
  'acct_cashflow',      /* v10.394 (D245) 자금 흐름 90일 · 잔액 모자람 알림 — 매일 09:20 */
  'acct_stock',         /* v10.395 (D245) 직판 재고 수불부 출고 · 반입 — 매시간 */
  'acct_cashplan',      /* v10.476 (D266) 12개월 자금 계획 · 모자라는 달 알림 — 매일 09:35 · acct.cashplan_alert on 일 때 */
  'acct_reorder',       /* v10.478 (D266) 안전 재고 · 재주문 초안 — 매시간 · acct.reorder on 일 때(발주는 사람이) */
  'acct_depreciation',  /* v10.398 (D246) 감가상각 — 매일 03:40 */
  'hrx_ot_week',        /* v10.471 (D265) 주 52시간 경고 — 매일 09:50 · 이번 주 연장 · 휴일 근로가 경고 시간을 넘은 직원 수 */
  'acct_budget',        /* v10.399 (D246) 예산 넘음 알림 — 매일 09:25 */
  'acct_aging',         /* v10.401 (D247) 받을 돈 · 갚을 돈 오래됨 알림 */
  'acct_pg_check',      /* v10.404 (D248) PG 정산 늦음 알림 — 매일 09:25 */
  'acct_contracts',     /* v10.409 (D249) 계약 만기 알림 */
  'lgl_due',            /* v10.486 ~ 489 (D269) 법무 기한 알림(인허가 갱신 · 사건 기일 · 보험 만기 · 검토 늦음) — 매일 09:50 */
  'acct_taxinbox',      /* v10.432 (D255) 매입 세금계산서 가져오기 — 매일 08:10(켜져 있을 때) */
  'ops_report',         /* v10.412 (D250) 업무 보고 — 매일 07:00 전날 일보 · 월요일 주보 · 1일 월보 */
  'acct_dunning',       /* v10.436 (D256) 미수금 독촉(acct.dunning on 일 때만 메일) · 지난 입금 예정 표시 — 매일 09:35 */
  'acct_accrual',       /* v10.439 (D257) 고정비 자동 전표 · 매입 맞춤 · 빠진 매입 알림 — 매일 01:20 */
  'acct_card_limit',    /* v10.453 (D261) 법인카드 한도 알림 — 매일 09:40 · acct.card_alert on 일 때 */
  'qlt_lot_alloc',      /* v10.495 (D271) 재고 로트 붙이기 — 매시간 · 로트 관리 상품의 출고(배송 뒤) · 반입 · 줄이는 실사 */
  'qlt_daily',          /* v10.495 · 496 (D271) 로트 유통기한 임박 · 지남 · 클레임 재발 알림 — 매일 07:20 */
  'mkt_campaign_send',  /* v10.483 (D268) 문자 · 메일 캠페인 — 5분마다 · campaign.enabled on 일 때만(처음 off) */
  'mkx_push_send',      /* v10.538 (D283) 웹 푸시 보내기 — 1분마다 · push.send on 일 때만(처음 off · ASSUME) */
  'mkx_groupbuy',       /* v10.540 (D283) 소개몰 공동구매 확정 · 실패(기존 취소 신청) · 마감 — 10분마다 */
  'mkx_daily',          /* v10.539 (D283) 재구매 알림(mkx.rebuy on · 처음 off) · 웹 푸시 기록 정리 — 매일 10:05 */
  'papi_hook_send',     /* v10.521 (D278) 파트너 웹훅 보내기 — 1분마다 · papi.enabled · papi.hook_enabled on 일 때만(처음 off · ASSUME) */
  'papi_daily',         /* v10.521 (D278) 파트너 API 하루 정리 — 매일 03:50 · 기록 정리 · 키 기한 · 틀린 키 몰림 */
  'pbulk_match',        /* v10.522 (D278) 직원 일괄 등록 짝 맞춤 — 15분마다 · 초대 메일은 pbulk.invite_mail on 일 때만 */
  'vsx_visit',          /* v10.542 (D284) 매물 방문 예약 — 매시간 · 지난 칸 요청 저절로 취소 · 전날 알림 · vsx.enabled on 일 때만 */
  'papi_usage',         /* v10.545 (D284) 오픈 API 하루 사용량 — 매일 03:40 · 청구서 초안은 papi.bill_enabled on · papi.bill_day 일부터 */
  'bi_daily',           /* v10.535 (D282) BI 일별 집계 — 매일 04:50 · 어제까지 3일 다시 셈 · bi.keep_days 지난 줄 지움 */
  'mall_statement',     /* v10.532 (D281) 입점 판매자 월 정산서 — 매일 09:10 · mall.statement_day 일부터 지난달 · 메일은 mall.statement_mail on 일 때만(처음 off · 같은 달 한 번) */
  'smq_daily',          /* v10.577 · 579 상품 문의 답 기한 넘김(smq.qna on) · 판매자 평가 · 경고 · 노출 제한 제안(smq.penalty on) · 기간 끝난 제한 풀기 — 매일 09:20 */
  'prx_hourly',         /* v10.518 · 520 (D277) 추천 이벤트 기간 끝 · 광고 소재 비교 기간 끝(결과 고정) — 매시간 */
  'prx_ad_report',      /* v10.519 (D277) 광고 성과 보고서 — 매일 08:10 · 주기(prx.ad_report_cycle 하루 · 주 · 달)의 지난 기간 없는 것만 · prx.ad_report_mail on 이면 메일(처음 off) */
  'bzx_daily',          /* v10.609 (docs/751) 파트너 계약 — 매일 09:35 · 만기 알림 · 만기 지남 정리 · 서명 없음 알림 */
  'bzx_frequent',       /* v10.610 · 613 (docs/752 · 755) — 10분마다 · 광고 예산 알림 · 자동 정지(bzx.ad_autopause) · 법인카드 사용 알림(bzx.card_notify) */
  'sec_daily_purge',    /* v10.485 (D268) 보안 기록 정리 — 매일 04:55 · 1년 지난 접속 나라 · 30일 캐시 · 하루 지난 패스키 문제 */
  'upt_daily',          /* v10.497 (D272) 가동 감시 · 간편 로그인 정리 — 매일 04:50 · 감시 결과 보관 날수 · 지난 state · 이어서 표 · 180일 기록 */
  'opz_daily',          /* v10.556 · 557 (D288) 운영 4 — 매일 09:10 · 되돌아보기 기한 · 오래 기록 없는 장애 · 이달 뉴스레터 없음 알림만 */
  'grw_daily',          /* v10.597 · 599 회원 · 성장 — 매일 08:00 · 알림 하루 요약(grw.digest on 일 때만) · 가입 단계 수 보관 끝 */
  'mall_benefit_expire', /* v10.479 (D267) 소개몰 적립금 · 상품권 소멸 — 매일 00:20 · 적립금 30일 전 회원 알림 */
  'mall_tier_recalc',   /* v10.480 (D267) 소개몰 회원 등급 다시 셈 — 매일 05:20 · mall.tiers on 일 때 */
  'mall_subscribe',     /* v10.481 (D267) 소개몰 정기 배송 — 매일 07:10 · mall.subscribe · mall.order_open on 일 때만(처음 off · 간주) */
  'mall_cash_receipt',  /* v10.506 (D274) 소개몰 현금영수증 발급 · 취소 — 10분마다 · mall.cash_receipt on 일 때만(처음 off · 간주) */
  'plz_badge_month',    /* v10.507 (D274) 소개광장 이번 달 점수 · 지난달 마감 배지 — 매일 03:30 · 배지는 plaza.ranking on 일 때 */
  'mlx_daily_purge',    /* v10.505 · 506 · 508 (D274) 재입고 기한 · 현금영수증 번호 보관 끝 · 사용 통계 보관 끝 — 매일 04:35 */
  'mbx_price_digest',   /* v10.503 (D273) 가격 변동 묶음 알림 — 매일 08:30 · 가격 알림 스위치 on 일 때만 */
  'mbx_daily',          /* v10.501 ~ 504 (D273) 최근 본 · 회원 대화 보관 기간 · 탈퇴 회원 기록 정리 — 매일 04:35 */
  'sal_opp_remind',     /* v10.466 (D264) 영업 기회 다음 할 일 알림 — 매일 08:50 · sales.opp_remind on 일 때 */
  'acct_bank_feed',     /* v10.467 (D264) 은행 거래내역 자동 조회 — 매일 06:40 · acct.bank_feed on 일 때만(처음 off) */
  'hr_training_due',    /* v10.458 (D262) 법정 의무교육 기한 알림 — 매일 09:45 */
  'hr_applicant_purge', /* v10.461 (D262) 불합격 · 철회 지원자 서류 자동 파기 — 매일 04:50 */
  'acct_biz_check',     /* v10.431 (D254) 거래처 휴폐업 다시 조회 — 매일 06:10 · 스위치 on 일 때만 */
  'corp_doc_due',       /* v10.425 (D253) 사내 문서 만료 알림 — 매일 09:30 */
  'prr_daily',          /* v10.566 · 568 권한 정기 점검 · 입사퇴사 — 매일 09:20 · 분기 거둘 후보(prr.review_auto on) · 흐름 기한 넘김 알림 · 거두기 없음 */
  'hra_daily',          /* v10.581 ~ 584 13차 — 매일 09:50 · 연차 촉진 · 꼭 읽을 사내 공지 기한 · 회계 마감 남은 일(스위치 모두 처음 off) */
  'ofc_task_due',       /* v10.463 (D263) 업무 요청 기한 지남 수 알림 — 매일 09:10 · ofc.task_due_alert on 일 때 */
  'opx_archive',        /* v10.509 (D275) 기록 장기 보관 — 매일 04:20 · opx.archive on 일 때 · 묶음 · S3 · 복원 확인 · 파기 · DB 정리(설정 > 0) */
  'opx_risk_events',    /* v10.510 (D275) 이상 거래 점수 — 5분 · 매물 등록 · 신고 접수로 표시된 계정 */
  'opx_risk_daily',     /* v10.510 (D275) 이상 거래 점수 — 매일 04:50 · 최근 계정 다시 셈 */
  'sfx_daily',          /* v10.546 ~ 548 (D285) 매일 05:20 · 오래된 기기 표지 · 번역 메모리 지움 · 서류 보관 만료 알림은 sfx.retention_alert on 일 때만 */
  'sec2_tick',          /* v10.590 ~ 593 (docs/732 ~ 735) 10분마다 · 운영자 이상 행동(07시 뒤 하루 한 번 · sec2.anomaly_watch on) · 「내가 아니에요」 몰림 · 정리 */
  'acct_insurance',     /* v10.422 (D252) 4대보험 취득 · 상실 신고 기한 알림 — 매일 09:35 */
  'its_key_expiry',     /* v10.490 (D270) 외부 연동 키 만료 · 교체 알림 — 매일 08:40 · its.key_alert on 일 때 */
  'its_office_daily',   /* v10.491 ~ 493 (D270) IT 자산 갱신 알림 · 자동 갱신일 옮김 · 제안 접수 대기 수 · 기간 지난 설문 마감 — 매일 08:55 */
  'ops_board_purge',    /* v10.286 (D213) 운영자 게시판 보관 기간 정리 — 매일 04:40 */
  'geo_backfill',       /* v10.46 (D099) 매물 좌표 채우기(카카오 로컬) · 지도 사용 off 면 건너뜀 */
  'translate_jobs',     /* v10.104 (D118) 등록 글 자동 번역 · 스위치 · 월 상한이 막으면 건너뜀 */
  'review_shadow',      /* v10.106 (D120) AI 검수 보조(병행) — 의견만 저장 · 스위치 · 월 상한이 막으면 건너뜀 */
  'town_pick_daily',    /* v10.211 (D188) 동네픽 AI 후보 — 매일 06:00 · 승인 전 비공개 · 스위치 · 월 상한이 막으면 건너뜀 */
  'agent_chat_purge',   /* v10.109 (D121) AI 상담 대화 보관 기간(5년) 지난 것 정리 */
  'esign_poll',         /* v10.143 (D139) 전자계약 만료 · 업체 상태 맞추기 */
  'safenum_release',    /* v10.145 (D141) 기한 지난 050 번호 돌려주기 */
  'lsx_daily',          /* v10.513 · 514 (D276) 저장한 검색 묶음 알림 · 매물 만료 예고 · 만료로 내림 — 매일 08:10 · 스위치 꺼져 있으면 아무것도 안 함 */
  'lpx_hourly',         /* v10.549 · 551 (D286) 기한 지난 · 내려간 매물의 열린 가격 제안 만료 · 끝 날짜 지난 자리 비움 정리 — 매시간 · 스위치와 상관없이 */
  'lpx_stats_daily',    /* v10.552 (D286) 지역별 시세 통계 이번 달 · 지난달 다시 셈 · 빠진 달 채움 — 매일 04:50 · lpx.stats on 일 때만 */
  'lsq_daily',          /* v10.602 ~ 604 (docs/744 ~ 746) 후기 요청 · CSV 묶음 정리 · 검색 클릭 보관 정리 — 매일 10:20 · 후기 요청은 lsq.review_ask on 일 때만 */
  'lsq_track',          /* v10.607 (docs/749) 배송 추적 — 매시간 · lsq.track on 일 때만 · 처음 ASSUME(간주) */
  'lsx_hourly',         /* v10.515 · 516 (D276) 효과 끝난 끌어올림 정리 · 매물 AI 요약 초안 — 매시간 */
  'csx_daily',          /* v10.529 (D280) 이탈 위험 신호 다시 셈 — 매일 06:20 · csx.churn on 일 때만 */
  'csx_hourly',         /* v10.528 (D280) 1:1 문의 자동 AI 초안 — 매시간 · csx.ai_draft_auto on · AI 통로 CSX_DRAFT 열림일 때만 */
  'lsy_hourly',         /* v10.524 · 525 (D279) 중복 매물 짝 찾기 · 사진 품질 검사 · 사진 속 연락처 AI — 매시간 · 스위치 꺼져 있으면 아무것도 안 함 */
  'lsy_triage',         /* v10.527 (D279) 신고 규칙 · AI 분류 — 10분마다 · 스위치 꺼져 있으면 아무것도 안 함 */
  'mtr_hourly',         /* v10.573 · 574 이의 제기 기한 넘김 알림 · 가짜 후기 탐지 — 매시간 · 스위치 꺼져 있으면 탐지 안 함 */
  'mtr_daily',          /* v10.575 · 576 소개자 신뢰 점수 셈 · 휴면 전 알림 · 휴면 전환 — 매일 04:40 · 스위치 꺼져 있으면 아무것도 안 함 */
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
