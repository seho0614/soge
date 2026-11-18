import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { AdminService } from './admin.service';

/* ---------------------------------------------------------------------
 * v10.377 (D241 · docs/513) 설정 예약 변경
 *   ADMIN·SUPER   GET   /admin/setting-schedules              기다리는 예약 · 최근 20 · 예약할 수 있는가(SUPER)
 *   SUPER         POST  /admin/setting-schedules              키 · 값 · 시각(한국) · 사유 → 그 시각에 정기 작업 setting_schedule(5분마다)이 바꿈
 *   SUPER         POST  /admin/setting-schedules/{id}/cancel  취소(사유)
 *
 *   바꿀 때는 운영 화면 「전체 설정」과 같은 검사(AdminService.updateSetting)를 예약한 SUPER 이름으로 거침 —
 *   바뀐 기록 · 중요 설정 알림이 그대로 남고, 그때 검사에 걸리면 바꾸지 않고 운영 알림 SETTING_SCHEDULE_FAIL.
 *   예약할 수 없는 키: 비밀 값 · 주문 받기(확인 문구 · 꺼질 시각이 따로) · 사이트 점검(점검 예약 상자가 따로).
 * ------------------------------------------------------------------- */

const KST_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const NO_SCHEDULE = ['mall.order_open', 'mall.order_open_until'];
export const scheduleBlocked = (key: string) =>
  AdminService.isSecretKey(key) || NO_SCHEDULE.includes(key) || key.startsWith('site.maintenance_');

export class SettingScheduleDto {
  @ApiProperty({ example: 'member.withdraw_grace_days', description: '설정 키' }) @IsString() @Matches(/^[a-z][a-z0-9_.]{1,99}$/) key!: string;
  @ApiProperty({ example: '7', description: '바꿀 값(형식은 지금 검사 · 그때 다시 검사)' }) @IsString() @Length(0, 2000) value!: string;
  @ApiProperty({ example: '2026-12-01T00:00', description: '바꿀 시각(한국 시각 · 10분 뒤 ~ 90일 안 · 5분마다 도는 정기 작업이라 최대 5분 늦을 수 있음)' }) @Matches(KST_TS) at!: string;
  @ApiProperty({ example: '처리방침 1.2 시행일 — 탈퇴 유예 7일', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class ScheduleCancelDto {
  @ApiProperty({ example: '시행일이 바뀜', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}

const reasonOk = (r: string, code: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsPlanController {
  constructor(private readonly db: DatabaseService) {}

  @Get('setting-schedules')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '설정 예약 변경 목록 (v10.377)', description: '기다리는 예약(시각 순 · 지금 값과 함께) · 최근 20(바꿈 · 실패 · 취소) · 예약할 수 있는가(SUPER). 비밀 값 키는 예약할 수 없음.' })
  @ApiOkResponse({ type: Object })
  async list(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    const rows = await this.db.query<Record<string, unknown> & { by: string | null; state: string }>(
      `SELECT s.id::text AS id, s.setting_key AS key, s.value, to_char(s.run_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS "runAt",
              s.reason, a.email::text AS by, s.created_at AS "createdAt", (SELECT value FROM site_settings x WHERE x.key = s.setting_key) AS "nowValue",
              CASE WHEN s.canceled_at IS NOT NULL THEN 'CANCELED' WHEN s.result IS NOT NULL THEN s.result ELSE 'WAITING' END AS state,
              s.done_at AS "doneAt", s.result_note AS "resultNote", s.canceled_at AS "canceledAt", s.cancel_reason AS "cancelReason"
         FROM setting_schedules s LEFT JOIN accounts a ON a.id = s.created_by
        ORDER BY (s.canceled_at IS NULL AND s.done_at IS NULL) DESC,
                 CASE WHEN s.canceled_at IS NULL AND s.done_at IS NULL THEN s.run_at END ASC, s.id DESC
        LIMIT 40`);
    const out = rows.map((r) => ({ ...r, by: maskMail(r.by) }));
    return { waiting: out.filter((r) => r.state === 'WAITING'), recent: out.filter((r) => r.state !== 'WAITING').slice(0, 20), canEdit: (p?.roles ?? []).includes('SUPER') };
  }

  @Post('setting-schedules')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SETTING_SCHEDULE', 'SETTING')
  @ApiOperation({ summary: '설정 예약 변경 (v10.377 · SUPER)', description: '그 시각(한국 · 10분 뒤 ~ 90일 안)에 정기 작업이 운영 화면과 같은 검사로 바꿈. 키마다 기다리는 예약은 하나. 값 형식은 지금 한 번 · 그때 한 번 더 봄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없는 키' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SETTING_SCHEDULE_EXISTS — 이 키에 기다리는 예약이 있음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SETTING_SCHEDULE_KEY(비밀 값 · 주문 받기 · 점검) · SETTING_SCHEDULE_TIME · SETTING_FORMAT · SETTING_SCHEDULE_SAME · SETTING_SCHEDULE_REASON' })
  async create(@Body() dto: SettingScheduleDto) {
    const reason = reasonOk(dto.reason, 'SETTING_SCHEDULE_REASON');
    if (scheduleBlocked(dto.key)) throw new PolicyViolation('SETTING_SCHEDULE_KEY', '비밀 값 · 소개몰 주문 받기 · 사이트 점검 설정은 예약할 수 없습니다(각 화면에서 바로 바꾸십시오).');
    const [m] = await this.db.query<{ ok: boolean; example: string | null; cur: string | null }>(
      `SELECT (is_required_for_open OR value_pattern IS NULL OR $2 ~ value_pattern) AS ok, value_example AS example, value AS cur FROM site_settings WHERE key = $1`, [dto.key, dto.value]);
    if (!m) throw new NotFound('없는 설정 키입니다.');
    if (!m.ok) throw new PolicyViolation('SETTING_FORMAT', `값의 형식이 맞지 않습니다${m.example ? ` (예: ${m.example})` : ''}.`);
    if ((m.cur ?? '') === dto.value) throw new PolicyViolation('SETTING_SCHEDULE_SAME', '지금 값과 같습니다.');
    const at = `${dto.at}+09:00`;
    const [ck] = await this.db.query<{ ok: boolean }>(
      `SELECT ($1::timestamptz >= now() + interval '10 minutes' AND $1::timestamptz <= now() + interval '90 days') AS ok`, [at]).catch(() => [{ ok: false }]);
    if (!ck?.ok) throw new PolicyViolation('SETTING_SCHEDULE_TIME', '시각은 지금부터 10분 뒤 ~ 90일 안(한국 시각)으로 정하십시오.');
    const [w] = await this.db.query(`SELECT 1 FROM setting_schedules WHERE setting_key = $1 AND canceled_at IS NULL AND done_at IS NULL`, [dto.key]);
    if (w) throw new AppError(409, { code: 'SETTING_SCHEDULE_EXISTS', message: '이 키에 기다리는 예약이 있습니다 — 먼저 취소하십시오.' });
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO setting_schedules (setting_key, value, run_at, reason, created_by) VALUES ($1, $2, $3::timestamptz, $4, $5) RETURNING id::text AS id`,
      [dto.key, dto.value, at, reason, RequestCtx.actorId() ?? null]);
    return { ok: true, id: r!.id, key: dto.key, at: dto.at, note: `${dto.at.replace('T', ' ')}(한국 시각)에 「${dto.key}」를 바꿉니다 — 최대 5분 늦을 수 있고, 그때 검사에 걸리면 바꾸지 않고 운영 알림이 뜹니다.` };
  }

  @Post('setting-schedules/:id/cancel')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SETTING_SCHEDULE_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: 1 })
  @ApiOperation({ summary: '설정 예약 취소 (v10.377 · SUPER)', description: '기다리는 예약만 · 지우지 않고 취소한 때 · 사람 · 사유를 남깁니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 이미 끝남' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SETTING_SCHEDULE_REASON' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: ScheduleCancelDto) {
    const reason = reasonOk(dto.reason, 'SETTING_SCHEDULE_REASON');
    const r = await this.db.query(
      `UPDATE setting_schedules SET canceled_at = now(), canceled_by = $2, cancel_reason = $3 WHERE id = $1 AND canceled_at IS NULL AND done_at IS NULL RETURNING id`,
      [id, RequestCtx.actorId() ?? null, reason]);
    if (!r.length) throw new NotFound('없거나 이미 끝난 예약입니다.');
    return { ok: true, id: String(id), note: '예약을 취소했습니다.' };
  }
}

/**
 * 정기 작업 setting_schedule(5분마다) — 시각이 된 예약을 예약한 SUPER 이름으로 AdminService.updateSetting 에 넘김.
 *   예약한 사람이 더는 SUPER 가 아니거나 · 키가 그새 예약 금지가 되었거나 · 검사에 걸리면 FAILED(바꾸지 않음).
 */
export async function applyDueSettingSchedules(db: DatabaseService, admin: AdminService) {
  const due = await db.query<{ id: string; key: string; value: string; reason: string; by: string | null; sup: boolean }>(
    `SELECT s.id::text AS id, s.setting_key AS key, s.value, s.reason, s.created_by::text AS by,
            EXISTS (SELECT 1 FROM account_roles r JOIN accounts a ON a.id = r.account_id
                     WHERE r.account_id = s.created_by AND r.role = 'SUPER' AND a.status = 'ACTIVE') AS sup
       FROM setting_schedules s WHERE s.canceled_at IS NULL AND s.done_at IS NULL AND s.run_at <= now()
      ORDER BY s.run_at, s.id LIMIT 20`);
  const applied: string[] = [], failed: Array<{ id: string; key: string; why: string }> = [];
  for (const d of due) {
    let why: string | null = null;
    if (!d.by || !d.sup) why = '예약한 사람이 더는 SUPER 가 아님';
    else if (scheduleBlocked(d.key)) why = '예약할 수 없는 키';
    else {
      try {
        await RequestCtx.run({ requestId: `setting-schedule-${d.id}`, actorId: d.by, actorRole: 'SUPER' },
          () => admin.updateSetting(d.key, d.value, `예약 #${d.id} — ${d.reason}`.slice(0, 200)));
      } catch (e) {
        const r = (e as { getResponse?: () => unknown })?.getResponse?.() as { code?: string; message?: string } | undefined;
        why = `${r?.code ?? 'ERROR'}: ${r?.message ?? (e as Error)?.message ?? e}`;
      }
    }
    await db.query(
      `UPDATE setting_schedules SET done_at = now(), result = $2, result_note = $3 WHERE id = $1::bigint AND canceled_at IS NULL AND done_at IS NULL`,
      [d.id, why ? 'FAILED' : 'APPLIED', (why ?? '바꿈').slice(0, 400)]);
    if (why) failed.push({ id: d.id, key: d.key, why: why.slice(0, 200) }); else applied.push(`${d.key} #${d.id}`);
  }
  return { applied, failed };
}
