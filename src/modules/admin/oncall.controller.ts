import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { OPS_ROLES } from '../identity/mfa.service';

/* ---------------------------------------------------------------------
 * v10.358 (D236 · docs/492) — 급한 알림 당번 · 위험감지 › 「운영 알림」 맨 위
 *
 *   ADMIN·SUPER  GET /admin/oncall          요일(1 월 ~ 7 일 · 한국)마다 당번 · 오늘 · 개인 텔레그램 있음 · (SUPER) 고를 수 있는 운영자
 *   SUPER        PUT /admin/oncall/{dow}    당번 정하기 · 비우기(accountId 없으면 비움 · 감사 ONCALL_SET)
 *   보내기: 정기 작업 launch_watch 가 급한 알림(CRITICAL)을 당번 개인 텔레그램으로 · 30분 안에 「확인」이 없으면 SUPER 개인 텔레그램으로 한 번.
 * ------------------------------------------------------------------- */

export class OncallSetDto {
  @ApiPropertyOptional({ format: 'uuid', description: '당번 운영자(비우면 그 요일 당번 없음)' }) @IsOptional() @IsUUID() accountId?: string;
}

const DOW = ['', '월', '화', '수', '목', '금', '토', '일'];

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/oncall')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OncallController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '급한 알림 당번 (v10.358)', description: '요일마다 당번(가린 메일 · 이름) · 개인 텔레그램 있음 · 오늘 요일 · SUPER 에게는 고를 수 있는 운영자 목록.' })
  @ApiOkResponse({ type: Object })
  async list() {
    const rows = await this.db.query<{ dow: number; accountId: string | null; email: string | null; name: string | null; chat: boolean }>(
      `SELECT o.dow, o.account_id AS "accountId", a.email::text AS email, a.name, (s.telegram_chat IS NOT NULL) AS chat
         FROM staff_oncall o LEFT JOIN accounts a ON a.id = o.account_id LEFT JOIN staff_access s ON s.account_id = o.account_id
        ORDER BY o.dow`);
    const [t] = await this.db.query<{ dow: number }>(`SELECT extract(isodow FROM now() AT TIME ZONE 'Asia/Seoul')::int AS dow`);
    const [me] = await this.db.query<{ sup: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = 'SUPER') AS sup`, [RequestCtx.actorId() ?? null]);
    const staff = me?.sup ? await this.db.query<{ id: string; email: string; name: string | null; chat: boolean }>(
      `SELECT DISTINCT a.id, a.email::text AS email, a.name, (s.telegram_chat IS NOT NULL) AS chat
         FROM accounts a JOIN account_roles r ON r.account_id = a.id LEFT JOIN staff_access s ON s.account_id = a.id
        WHERE r.role = ANY($1::text[]) AND a.status = 'ACTIVE' ORDER BY a.email::text`, [OPS_ROLES]) : [];
    return {
      today: t?.dow ?? null, canEdit: !!me?.sup,
      rows: rows.map((r) => ({ ...r, label: DOW[r.dow] ?? String(r.dow), email: maskMail(r.email) })),
      staff: staff.map((x) => ({ ...x, email: maskMail(x.email) })),
    };
  }

  @Put(':dow')
  @Roles('SUPER')
  @Audit('ONCALL_SET', 'SETTING')
  @ApiParam({ name: 'dow', example: 1, description: '요일 1 월 ~ 7 일' })
  @ApiOperation({ summary: '당번 정하기 (v10.358 · SUPER)', description: '운영 역할이 있는 운영자만 · 비우면 그 요일 당번 없음(지금처럼 대화방에만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '쓰지 않음(문서 규칙)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ONCALL_DOW · ONCALL_NOT_STAFF — 운영 역할이 없는 계정', type: ErrorDto })
  async set(@Param('dow', ParseIntPipe) dow: number, @Body() dto: OncallSetDto) {
    if (!(dow >= 1 && dow <= 7)) throw new PolicyViolation('ONCALL_DOW', '요일은 1(월) ~ 7(일)입니다.');
    const id = dto.accountId ?? null;
    if (id) {
      const [ok] = await this.db.query(`SELECT 1 FROM account_roles WHERE account_id = $1 AND role = ANY($2::text[]) LIMIT 1`, [id, OPS_ROLES]);
      if (!ok) throw new PolicyViolation('ONCALL_NOT_STAFF', '운영 역할이 있는 운영자만 당번이 될 수 있습니다.');
    }
    await this.db.query(`UPDATE staff_oncall SET account_id = $2, updated_by = $3, updated_at = now() WHERE dow = $1`, [dow, id, RequestCtx.actorId() ?? null]);
    return { ok: true, dow, accountId: id, note: `${DOW[dow]}요일 당번을 ${id ? '정했습니다' : '비웠습니다'}.` };
  }
}
