import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound, PolicyViolation } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.783 (D329 · docs/891) 택배사 조회 주소 확인 — 송장 입력(판매자 · 운영) · 회원 「택배사에서 보기」는 이미 있음(v10.31 D061 hlt_carriers · health-checkout trackUrl)
 *   빠져 있던 것: 조회 주소가 「운영 확인 전」(checked_at 비어 있음)인데 운영 화면에서 보거나 고칠 곳이 없었음
 *   → 운영 화면 › 소개몰 주문 아래 「택배사 조회 주소」 — 주소 고치기({no} 자리 · https · DB CHECK) · 「확인함」(지금 시각) · 시험 송장으로 열어 보기
 * ------------------------------------------------------------------- */
export class HltCarrierDto {
  @ApiProperty() name!: string;
  @ApiProperty({ description: '{no} = 송장번호' }) trackUrl!: string;
  @ApiPropertyOptional({ nullable: true }) checkedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}
export class HltCarrierUrlDto {
  @ApiProperty({ example: 'https://trace.cjlogistics.com/next/tracking.html?wblNo={no}' })
  @IsString() @MaxLength(300) @Matches(/^https:\/\/\S*\{no\}\S*$/, { message: 'https 로 시작하고 {no}(송장번호 자리)가 든 주소여야 합니다.' }) trackUrl!: string;
}

@Injectable()
export class HltCarriersService {
  constructor(private readonly db: DatabaseService) {}
  list() {
    return this.db.query(`SELECT name, track_url AS "trackUrl", checked_at AS "checkedAt", note FROM hlt_carriers ORDER BY name`);
  }
  async setUrl(name: string, url: string) {
    if (!/^https:\/\//.test(url) || !url.includes('{no}')) throw new PolicyViolation('CARRIER_URL', 'https 로 시작하고 {no}(송장번호 자리)가 든 주소여야 합니다.');
    const r = await this.db.query(`UPDATE hlt_carriers SET track_url = $2, checked_at = NULL, note = '주소 고침 — 다시 확인 필요' WHERE name = $1 RETURNING name`, [name, url]);
    if (!r.length) throw new NotFound('없는 택배사입니다.');
    return this.list();
  }
  async check(name: string) {
    const r = await this.db.query(`UPDATE hlt_carriers SET checked_at = now(), note = '운영 확인함' WHERE name = $1 RETURNING name`, [name]);
    if (!r.length) throw new NotFound('없는 택배사입니다.');
    return this.list();
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/hlt-carriers')
@Roles('ADMIN', 'SUPER')
export class HltCarriersController {
  constructor(private readonly svc: HltCarriersService) {}

  @Get()
  @ApiOperation({ summary: '택배사 조회 주소 (v10.783)', description: '이름 · 조회 주소({no}) · 운영 확인 시각.' })
  @ApiOkResponse({ type: [HltCarrierDto] })
  list() { return this.svc.list(); }

  @Put(':name')
  @ApiOperation({ summary: '택배사 조회 주소 고치기 (v10.783)', description: 'https · {no} 자리 · 고치면 확인 시각을 지움(다시 확인).' })
  @ApiParam({ name: 'name' })
  @ApiOkResponse({ type: [HltCarrierDto] })
  @ApiResponse({ status: 422, description: 'CARRIER_URL', type: ErrorDto })
  @Audit('HLT_CARRIER_URL', 'SETTING')
  setUrl(@Param('name') name: string, @Body() dto: HltCarrierUrlDto) { return this.svc.setUrl(name, dto.trackUrl); }

  @Post(':name/check')
  @HttpCode(200)
  @ApiOperation({ summary: '택배사 조회 주소 확인함 (v10.783)', description: '시험 송장으로 열어 본 뒤 — 확인 시각을 지금으로.' })
  @ApiParam({ name: 'name' })
  @ApiOkResponse({ type: [HltCarrierDto] })
  @Audit('HLT_CARRIER_CHECK', 'SETTING')
  check(@Param('name') name: string) { return this.svc.check(name); }
}
