import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createHmac } from 'node:crypto';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { RequestCtx } from '../../core/request-context';
import { AppError } from '../../core/errors';
import { ErrorDto } from '../../common/dto/common.dto';
import { TouchDto, TouchResultDto } from './attribution.dto';

/** 미리보기 로봇(카카오톡 · 페이스북 링크 미리보기 등)은 사람이 아닙니다 — 유입으로 세지 않습니다 */
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests/i;
const VISITOR = /^[A-Za-z0-9-]{8,64}$/;

/**
 * 소개코드 유입 기록 (D010 · INV-2) — SB-MAL-DTL-010 등 `?ref=` 로 들어오는 모든 화면.
 *
 * ★ 전에는 유입을 기록하는 길이 없었습니다. 목록 API 의 Swagger 에 `X-Ref-Code` 헤더 설명만 있고
 *   실제 처리는 없어서, `?ref=` 공유 링크가 아무 일도 하지 않았고 거래에 소개자가 붙을 수 없었습니다.
 *   사용자 웹(middleware)이 `?ref=` 를 보면 이 API 를 부릅니다.
 *
 * 로그인 없이 부릅니다(대부분의 유입은 비로그인). 로그인 상태면 토큰의 계정도 함께 남습니다.
 * 비로그인 유입은 로그인 · 가입 때 visitorKey 연결(AttributionEngine.link)로 계정에 이어집니다.
 */
@ApiTags('HOM')
@Controller('api/v1/attribution')
export class AttributionController {
  constructor(private readonly attribution: AttributionEngine) {}

  @Post('touch')
  @HttpCode(200)
  @ApiOperation({
    summary: '소개코드 유입 기록',
    description:
      '`?ref=코드` 로 들어온 방문을 기록합니다. 이 방문자가 90일 안에 문의해 거래가 생기면 코드 주인이 소개자가 됩니다(first-touch).\n\n' +
      '**오류 없이 recorded:false** 로 끝나는 경우 — 없는·폐기·만료 코드(INVALID_CODE) · 코드 주인 본인(SELF) · ' +
      '24시간 안에 같은 방문자·같은 코드(DUPLICATE, DB 트리거 trg_attr_dedupe_24h 가 보장) · 미리보기 로봇(BOT). ' +
      '유입 경로를 막지 않기 위해 화면은 결과와 무관하게 정상 진행합니다.\n\n' +
      'IP 는 날짜를 섞은 해시로만 남깁니다(원문 저장 없음).',
  })
  @ApiHeader({ name: 'X-Visitor-Key', required: true, description: '사이트 방문자 쿠키(sgb_visitor) 값 — 영문·숫자·하이픈 8~64자' })
  @ApiOkResponse({ type: TouchResultDto })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'VALIDATION_ERROR — 코드 형식 · 방문자 키 없음/형식 오류' })
  async touch(
    @Body() dto: TouchDto,
    @Headers('x-visitor-key') visitorKey?: string,
    @Headers('user-agent') ua?: string,
    @Headers('referer') referer?: string,
    @Headers('x-forwarded-for') xff?: string,
    @Ip() ip?: string,
  ): Promise<TouchResultDto> {
    if (!visitorKey || !VISITOR.test(visitorKey)) {
      throw new AppError(400, {
        code: 'VALIDATION_ERROR', field: 'X-Visitor-Key',
        message: '방문자 키(X-Visitor-Key)가 없거나 형식이 맞지 않습니다.',
      });
    }
    if (!ua || BOT_UA.test(ua)) return { recorded: false, reason: 'BOT' };

    const addr = (xff?.split(',')[0]?.trim() || ip) ?? '';
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // 한국 날짜
    const secret = process.env.JWT_SECRET ?? process.env.ENC_KEY ?? 'sgb';
    const ipHash = addr ? createHmac('sha256', secret).update(`${day}|${addr}`).digest('hex') : undefined;

    const r = await this.attribution.record({
      code: dto.code.toUpperCase(),
      visitorKey,
      accountId: RequestCtx.actorId() ?? null,
      channel: 'WEB',
      landingUrl: dto.landingUrl,
      referer: referer ? referer.slice(0, 500) : undefined,
      ipHash,
    });
    return { recorded: r.recorded, reason: r.reason, windowDays: r.windowDays };
  }
}
