import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { AccountSecurityService } from '../identity/account-security.service';

/* ---------------------------------------------------------------------
 * v10.369 ~ 371 (D239 · docs/504 ~ 506)
 *   운영 역할     PATCH /admin/me/password              내 비밀번호 바꾸기(회원 역할 없어도 · v10.360 규칙 · 다른 기기 로그아웃)
 *   ADMIN·SUPER   GET   /admin/alert-mutes              잠시 끈 알림(지금 · 최근 20) · 끌 수 있는가
 *   SUPER         POST  /admin/alert-mutes              알림 종류 끄기(1 · 4 · 24시간 · 사유 · 감사 ALERT_MUTE)
 *   SUPER         POST  /admin/alert-mutes/{id}/lift    일찍 풀기(사유 · 감사 ALERT_UNMUTE)
 *   ADMIN·SUPER   GET   /admin/maintenance              점검 예약 · 지금 점검 중인가
 *   SUPER         POST  /admin/maintenance              점검 예약(시작 · 끝(12시간까지) · 안내 글 · 사유 · 감사 SITE_MAINTENANCE_SET)
 *   SUPER         POST  /admin/maintenance/clear        점검 지우기 · 끝내기(사유 · 감사 SITE_MAINTENANCE_CLEAR)
 * ------------------------------------------------------------------- */

const OPS_ROLES = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;   // v10.437 세무사도 내 비밀번호 · 휴대폰 · 텔레그램
const KST_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;   // 화면은 한국 시각 「YYYY-MM-DDTHH:MM」

export class StaffPasswordDto {
  @ApiProperty({ description: '지금 비밀번호' }) @IsString() @Length(1, 100) currentPassword!: string;
  @ApiProperty({ minLength: 12, description: '새 비밀번호 — 운영 역할은 12자 이상 · 최근 3개 다시 쓰기 금지' }) @IsString() @Length(10, 100) newPassword!: string;
}
export class AlertMuteDto {
  @ApiProperty({ example: 'NGINX_NOT_APPLIED', description: '알림 종류(AUDIT_CHAIN_BROKEN 은 끌 수 없음)' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,59}$/) code!: string;
  @ApiProperty({ enum: [1, 4, 24], description: '끌 시간' }) @IsIn([1, 4, 24]) hours!: number;
  @ApiProperty({ example: 'Nginx 작업 중', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class OpsReasonDto {
  @ApiProperty({ example: '작업 끝', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class MaintenanceDto {
  @ApiProperty({ example: '2026-11-20T02:00', description: '시작(한국 시각)' }) @Matches(KST_TS) from!: string;
  @ApiProperty({ example: '2026-11-20T04:00', description: '끝(한국 시각 · 시작 뒤 12시간까지)' }) @Matches(KST_TS) until!: string;
  @ApiPropertyOptional({ example: '서비스 개선 작업 중입니다.', description: '안내 글(200자까지 · 비면 기본)' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
  @ApiPropertyOptional({ example: 'We are improving the service.', description: '영어 안내 글(200자까지)' }) @IsOptional() @IsString() @Length(0, 400) noteEn?: string;
  @ApiProperty({ example: 'v10.368 운영 적용', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
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
export class OpsStaffController {
  constructor(private readonly db: DatabaseService, private readonly sec: AccountSecurityService) {}

  /* ── ① 내 비밀번호 ── */
  @Patch('me/password')
  @Roles(...OPS_ROLES)
  @ApiOperation({ summary: '운영자 내 비밀번호 바꾸기 (v10.369)', description: '회원 역할이 없는 운영자도. 규칙은 v10.360 그대로(12자 · 최근 3개 다시 쓰기 금지 · 지금 비밀번호 5번 틀리면 30분 잠김). 성공하면 새 증표 · 다른 기기 로그아웃 · 감사 PASSWORD_CHANGE.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CURRENT_PASSWORD_WRONG · WEAK_PASSWORD · SAME_PASSWORD · WEAK_PASSWORD_STAFF · PASSWORD_REUSED' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'ACCOUNT_LOCKED' })
  myPassword(@Body() dto: StaffPasswordDto) {
    return this.sec.change(dto.currentPassword, dto.newPassword);
  }

  /* ── ② 운영 알림 잠시 끄기 ── */
  @Get('alert-mutes')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '잠시 끈 운영 알림 (v10.370)', description: '지금 꺼진 종류(끝 시각 · 남은 분 · 사유 · 끈 사람 가림) · 최근 20(푼 것 포함) · 끌 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async mutes(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    const rows = await this.db.query<Record<string, unknown> & { by: string | null; active: boolean }>(
      `SELECT m.id::text AS id, m.alert_code AS code, m.until_at AS "untilAt", m.reason, m.created_at AS "createdAt", a.email::text AS by,
              m.lifted_at AS "liftedAt", m.lift_reason AS "liftReason",
              (m.lifted_at IS NULL AND m.until_at > now()) AS active,
              greatest(0, ceil(extract(epoch FROM m.until_at - now()) / 60))::int AS "leftMin"
         FROM alert_mutes m LEFT JOIN accounts a ON a.id = m.created_by ORDER BY m.id DESC LIMIT 20`);
    const out = rows.map((r) => ({ ...r, by: maskMail(r.by), active: !!r.active }));
    return { active: out.filter((r) => r.active), recent: out, canEdit: (p?.roles ?? []).includes('SUPER') };
  }

  @Post('alert-mutes')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ALERT_MUTE', 'SETTING')
  @ApiOperation({ summary: '운영 알림 종류 잠시 끄기 (v10.370 · SUPER)', description: '끝 시각까지 그 종류는 텔레그램 · 슬랙 · 메일 · 당번 보내기만 멈춤(알림 기록 · 운영 화면은 그대로). 끝나면 저절로 켜지고, 아직 열린 알림은 그때 보냄. AUDIT_CHAIN_BROKEN 은 끌 수 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ALERT_MUTE_EXISTS — 이미 꺼짐' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ALERT_MUTE_REASON · ALERT_MUTE_FORBIDDEN(위변조 알림)' })
  async mute(@Body() dto: AlertMuteDto) {
    const reason = reasonOk(dto.reason, 'ALERT_MUTE_REASON');
    if (dto.code === 'AUDIT_CHAIN_BROKEN') throw new PolicyViolation('ALERT_MUTE_FORBIDDEN', '감사 기록 위변조 알림은 끌 수 없습니다.');
    const [on] = await this.db.query(`SELECT 1 FROM alert_mutes WHERE alert_code = $1 AND lifted_at IS NULL AND until_at > now()`, [dto.code]);
    if (on) throw new AppError(409, { code: 'ALERT_MUTE_EXISTS', message: '이미 꺼져 있는 알림 종류입니다.' });
    const [r] = await this.db.query<{ id: string; until: string }>(
      `INSERT INTO alert_mutes (alert_code, until_at, reason, created_by) VALUES ($1, now() + make_interval(hours => $2::int), $3, $4)
       RETURNING id::text AS id, until_at AS until`, [dto.code, dto.hours, reason, RequestCtx.actorId() ?? null]);
    return { ok: true, id: r!.id, code: dto.code, untilAt: r!.until, note: `${dto.hours}시간 동안 이 종류는 보내지 않습니다(알림 기록 · 화면은 그대로).` };
  }

  @Post('alert-mutes/:id/lift')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ALERT_UNMUTE', 'SETTING')
  @ApiParam({ name: 'id', example: 1 })
  @ApiOperation({ summary: '알림 끄기 일찍 풀기 (v10.370 · SUPER)', description: '지우지 않고 푼 때 · 사람 · 사유를 남깁니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 이미 끝남' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ALERT_MUTE_REASON' })
  async unmute(@Param('id', ParseIntPipe) id: number, @Body() dto: OpsReasonDto) {
    const reason = reasonOk(dto.reason, 'ALERT_MUTE_REASON');
    const r = await this.db.query(
      `UPDATE alert_mutes SET lifted_at = now(), lifted_by = $2, lift_reason = $3 WHERE id = $1 AND lifted_at IS NULL AND until_at > now() RETURNING id`,
      [id, RequestCtx.actorId() ?? null, reason]);
    if (!r.length) throw new NotFound('없거나 이미 끝난 알림 끄기입니다.');
    return { ok: true, id: String(id), note: '다시 켰습니다 — 다음 차례부터 보냅니다.' };
  }

  /* ── ③ 사이트 점검 중 화면 ── */
  @Get('maintenance')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '사이트 점검 예약 (v10.371)', description: '시작 · 끝(한국 시각) · 안내 글 · 지금 점검 중 · 안내 띠 중(시작 24시간 전) · 지남 · 바꿀 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async maintenance(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    const [s] = await this.db.query<{ f: string | null; u: string | null; note: string | null; note_en: string | null; on: boolean; soon: boolean; past: boolean }>(
      `WITH v AS (SELECT nullif((SELECT value FROM site_settings WHERE key = 'site.maintenance_from'), '')::timestamptz AS f,
                         nullif((SELECT value FROM site_settings WHERE key = 'site.maintenance_until'), '')::timestamptz AS u)
       SELECT to_char(f AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI') AS f, to_char(u AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI') AS u,
              (SELECT value FROM site_settings WHERE key = 'site.maintenance_note') AS note,
              (SELECT value FROM site_settings WHERE key = 'site.maintenance_note_en') AS note_en,
              coalesce(now() >= f AND now() < u, false) AS on, coalesce(now() < f AND now() >= f - interval '24 hours', false) AS soon,
              coalesce(now() >= u, false) AS past
         FROM v`);
    /* v10.379 (D241 · docs/515) — 이 점검 시작 시각으로 회원 알림을 보냈는가 · 메일 스위치 */
    const [n] = await this.db.query<{ at: string; sent: number; mailed: boolean }>(
      `SELECT to_char(n.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at, n.sent, n.mailed FROM maintenance_notices n
        WHERE n.from_at = nullif((SELECT value FROM site_settings WHERE key = 'site.maintenance_from'), '')::timestamptz`).catch(() => []);
    const [ml] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'site.maintenance_mail'`).catch(() => []);
    return { from: s?.f ?? null, until: s?.u ?? null, note: s?.note || '', noteEn: s?.note_en || '', on: !!s?.on, soon: !!s?.soon, past: !!s?.past, canEdit: (p?.roles ?? []).includes('SUPER'),
             notice: n ? { at: n.at, sent: Number(n.sent), mailed: !!n.mailed } : null, mail: (ml?.v ?? 'off') === 'on' };
  }

  @Post('maintenance')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SITE_MAINTENANCE_SET', 'SETTING')
  @ApiOperation({ summary: '사이트 점검 예약 (v10.371 · SUPER)', description: '시작 ~ 끝(12시간까지 · 끝은 지금 뒤) 동안 사용자 웹 모든 화면이 「점검 중」(운영 화면 · API 그대로). 시작 24시간 전부터 안내 띠. 사용자 웹은 설정을 5분마다 다시 읽어 시작 · 끝이 최대 5분 늦을 수 있음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MAINTENANCE_TIME(끝이 시작 앞 · 12시간 넘음 · 끝이 지남) · MAINTENANCE_REASON · MAINTENANCE_NOTE' })
  async setMaintenance(@Body() dto: MaintenanceDto) {
    const reason = reasonOk(dto.reason, 'MAINTENANCE_REASON');
    const note = (dto.note ?? '').trim(), noteEn = (dto.noteEn ?? '').trim();
    if (note.length > 200 || noteEn.length > 200) throw new PolicyViolation('MAINTENANCE_NOTE', '안내 글은 200자까지입니다.');
    const f = `${dto.from}+09:00`, u = `${dto.until}+09:00`;
    const [ck] = await this.db.query<{ ok: boolean }>(
      `SELECT ($2::timestamptz > $1::timestamptz AND $2::timestamptz <= $1::timestamptz + interval '12 hours' AND $2::timestamptz > now()) AS ok`, [f, u]).catch(() => [{ ok: false }]);
    if (!ck?.ok) throw new PolicyViolation('MAINTENANCE_TIME', '끝은 시작 뒤 12시간 안이고, 지금보다 뒤여야 합니다.');
    await this.writeMaintenance(f, u, note, noteEn, `점검 예약 — ${reason}`);
    return { ok: true, from: dto.from, until: dto.until, note: '점검을 예약했습니다. 시작 24시간 전부터 사용자 웹에 안내 띠가 보입니다.' };
  }

  @Post('maintenance/clear')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SITE_MAINTENANCE_CLEAR', 'SETTING')
  @ApiOperation({ summary: '사이트 점검 지우기 · 끝내기 (v10.371 · SUPER)', description: '예약을 지우거나 점검 중이면 바로 끝냄(사용자 웹은 최대 5분 뒤 돌아옴).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MAINTENANCE_REASON' })
  async clearMaintenance(@Body() dto: OpsReasonDto) {
    const reason = reasonOk(dto.reason, 'MAINTENANCE_REASON');
    await this.writeMaintenance('', '', '', '', `점검 지움 — ${reason}`);
    return { ok: true, note: '점검을 지웠습니다(사용자 웹은 최대 5분 뒤 돌아옴).' };
  }

  private writeMaintenance(f: string, u: string, note: string, noteEn: string, why: string) {
    return this.db.transaction(async () => {
      await this.db.query(`SELECT set_config('app.setting_reason', $1, true)`, [why.slice(0, 200)]);
      const me = RequestCtx.actorId() ?? null;
      for (const [k, v] of [['site.maintenance_from', f], ['site.maintenance_until', u], ['site.maintenance_note', note], ['site.maintenance_note_en', noteEn]] as const) {
        await this.db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
      }
    });
  }
}
