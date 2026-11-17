import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { DatabaseService } from '../../db/database.service';
import { NotFound } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.334 (D226 · docs/465) — 고객센터 질문 펼침 · 「도움이 되었나요?」(공개 · 로그인 없이)
 *
 *   공개  POST /faq/:id/view      펼친 횟수 +1(그날 줄)
 *         POST /faq/:id/helpful   예(yes true) · 아니오(false) +1
 *   사람 정보는 남기지 않습니다(하루 셈만). 같은 브라우저 하루 한 번은 화면이 막습니다. 숨긴 질문은 404.
 * ------------------------------------------------------------------- */

export class FaqHelpfulDto {
  @ApiProperty({ description: 'true = 도움이 됨 · false = 도움이 안 됨' }) @IsBoolean() yes!: boolean;
}
export class FaqCountResultDto {
  @ApiProperty() ok!: boolean;
}

@ApiTags('HOM')
@Controller('api/v1/faq')
export class FaqFeedbackController {
  constructor(private readonly db: DatabaseService) {}

  private async bump(id: string, col: 'views' | 'yes' | 'no') {
    const [f] = await this.db.query(`SELECT 1 FROM faqs WHERE id = $1::uuid AND is_active`, [id]);
    if (!f) throw new NotFound('그 질문이 없습니다.');
    await this.db.query(
      `INSERT INTO faq_daily (faq_id, day, ${col}) VALUES ($1::uuid, (now() AT TIME ZONE 'Asia/Seoul')::date, 1)
       ON CONFLICT (faq_id, day) DO UPDATE SET ${col} = faq_daily.${col} + 1`, [id]);
    return { ok: true };
  }

  @Post(':id/view')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '고객센터 질문 펼침 +1', description: '하루 셈만(사람 정보 없음). 운영 화면 「많이 찾는 질문 후보」(최근 30일 펼침 순)의 근거.' })
  @ApiOkResponse({ type: FaqCountResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 숨긴 질문' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  view(@Param('id', ParseUUIDPipe) id: string) { return this.bump(id, 'views'); }

  @Post(':id/helpful')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '고객센터 질문 「도움이 되었나요?」', description: 'yes true = 예 · false = 아니오 +1(하루 셈 · 사람 정보 없음).' })
  @ApiOkResponse({ type: FaqCountResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 숨긴 질문' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  helpful(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FaqHelpfulDto) { return this.bump(id, dto.yes ? 'yes' : 'no'); }
}
