import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { staffTodo } from './member-ops';

/* ---------------------------------------------------------------------
 * v10.361 ~ 364 (D237 · docs/495 ~ 498)
 *   ADMIN·SUPER  GET  /admin/accounts/{id}/notes            회원 운영 메모(최근 순 · 쓴 사람 가림)
 *   ADMIN·SUPER  POST /admin/accounts/{id}/notes            메모 더하기(쌓기만 · 감사 MEMBER_NOTE_ADD)
 *   ADMIN·SUPER  GET  /admin/signup-blocks                  가입 차단 목록 · 오늘 · 7일 막힌 수
 *   SUPER        POST /admin/signup-blocks                  차단 더하기(사유 필수 · 기한 · PERSON 은 accountId 로 · 감사 SIGNUP_BLOCK_ADD)
 *   SUPER        POST /admin/signup-blocks/{id}/remove      풀기(사유 · 감사 SIGNUP_BLOCK_REMOVE)
 *   ADMIN·SUPER  GET  /admin/reports/withdrawals?months=    탈퇴 사유 통계
 *   운영 역할    GET  /admin/todo                           내 역할의 「오늘 할 일」
 * ------------------------------------------------------------------- */

export class MemberNoteDto {
  @ApiProperty({ example: '전화로 정산 일정 문의 — 금요일 다시 안내', description: '메모(2 ~ 1,000자)' }) @IsString() @Length(1, 2000) body!: string;
  @ApiPropertyOptional({ description: '중요(문의 · 분쟁 화면에 먼저 보임)' }) @IsOptional() @IsBoolean() important?: boolean;
}
export class SignupBlockDto {
  @ApiProperty({ enum: ['EMAIL_DOMAIN', 'IP_CIDR', 'PERSON'] }) @IsIn(['EMAIL_DOMAIN', 'IP_CIDR', 'PERSON']) kind!: string;
  @ApiPropertyOptional({ example: 'spam.example', description: 'EMAIL_DOMAIN · IP_CIDR 의 값(PERSON 은 비움)' }) @IsOptional() @IsString() @Length(1, 100) value?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'PERSON — 그 회원의 본인인증 고유값으로' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiProperty({ example: '사기 신고 3건', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
  @ApiPropertyOptional({ enum: [7, 30, 90, 365], description: '기한(일 · 비우면 없음)' }) @IsOptional() @IsIn([7, 30, 90, 365]) expiresDays?: number;
}
export class SignupUnblockDto {
  @ApiProperty({ example: '오해로 막음', description: '푸는 사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}

const WD_KO: Record<string, string> = { LOW_USE: '자주 안 씀', NOT_USEFUL: '도움이 안 됨', OTHER_SERVICE: '다른 서비스', PRIVACY: '개인정보 걱정', BAD_EXPERIENCE: '나쁜 경험', OTHER: '기타' };
const maskText = (t: string) => t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(메일)').replace(/\d[\d -]{6,}\d/g, '(번호)').replace(/https?:\/\/\S+/g, '(주소)');

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class MemberOpsController {
  constructor(private readonly db: DatabaseService) {}

  /* ── ① 회원 운영 메모 ── */
  @Get('accounts/:id/notes')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '회원 운영 메모 (v10.361)', description: '최근 순 50개 · 중요 수 · 쓴 사람(가린 메일). 운영진만 — 회원 화면 · 내 정보 내려받기에는 안 나감.' })
  @ApiOkResponse({ type: Object })
  async notes(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db.query<{ id: string; body: string; important: boolean; createdAt: string; by: string | null }>(
      `SELECT n.id::text AS id, n.body, n.important, n.created_at AS "createdAt", a.email::text AS by
         FROM member_notes n LEFT JOIN accounts a ON a.id = n.created_by WHERE n.account_id = $1 ORDER BY n.created_at DESC LIMIT 50`, [id]);
    return { rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })), important: rows.filter((r) => r.important).length, total: rows.length };
  }

  @Post('accounts/:id/notes')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('MEMBER_NOTE_ADD', 'ACCOUNT')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '회원 운영 메모 더하기 (v10.361)', description: '쌓기만(고치기 · 지우기 없음). 잘못 쓴 것은 새 메모로 바로잡습니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 회원 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MEMBER_NOTE_BODY — 2 ~ 1,000자' })
  async addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberNoteDto) {
    const body = dto.body.replace(/\r\n/g, '\n').trim();
    if (body.length < 2 || body.length > 1000) throw new PolicyViolation('MEMBER_NOTE_BODY', '메모는 2 ~ 1,000자입니다.');
    const [a] = await this.db.query(`SELECT 1 FROM accounts WHERE id = $1`, [id]);
    if (!a) throw new NotFound('그 회원이 없습니다.');
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO member_notes (account_id, body, important, created_by) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`, [id, body, !!dto.important, RequestCtx.actorId() ?? null]);
    return { ok: true, id: r!.id, note: '메모를 남겼습니다(회원에게는 보이지 않음).' };
  }

  /* ── ② 가입 차단 목록 ── */
  @Get('signup-blocks')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '가입 차단 목록 (v10.362)', description: '지금 차단(종류 · 값 · 사람은 가린 이메일 · 사유 · 기한 · 더한 사람) · 최근 푼 것 20 · 오늘 · 7일 막힌 수(종류별) · 고칠 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async blocks(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    const active = await this.db.query<Record<string, unknown> & { by: string | null; kind: string; value: string }>(
      `SELECT b.id::text AS id, b.kind, b.value, b.label, b.reason, b.expires_at AS "expiresAt", b.created_at AS "createdAt", a.email::text AS by,
              (b.expires_at IS NOT NULL AND b.expires_at <= now()) AS expired
         FROM signup_blocks b LEFT JOIN accounts a ON a.id = b.created_by WHERE b.removed_at IS NULL ORDER BY b.created_at DESC LIMIT 200`);
    const removed = await this.db.query<Record<string, unknown> & { kind: string; value: string }>(
      `SELECT b.id::text AS id, b.kind, b.value, b.label, b.reason, b.removed_at AS "removedAt", b.removed_reason AS "removedReason"
         FROM signup_blocks b WHERE b.removed_at IS NOT NULL ORDER BY b.removed_at DESC LIMIT 20`);
    const hits = await this.db.query<{ kind: string; today: number; d7: number }>(
      `SELECT kind, coalesce(sum(n) FILTER (WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date), 0)::int AS today, sum(n)::int AS d7
         FROM signup_block_hits WHERE day > (now() AT TIME ZONE 'Asia/Seoul')::date - 7 GROUP BY kind`);
    const show = (r: { kind: string; value: string }) => (r.kind === 'PERSON' ? '(본인인증 고유값)' : r.value);
    return {
      active: active.map((r) => ({ ...r, value: show(r), by: maskMail(r.by) })), removed: removed.map((r) => ({ ...r, value: show(r) })),
      hits, canEdit: (p?.roles ?? []).includes('SUPER'),
    };
  }

  @Post('signup-blocks')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SIGNUP_BLOCK_ADD', 'SETTING')
  @ApiOperation({ summary: '가입 차단 더하기 (v10.362 · SUPER)', description: 'EMAIL_DOMAIN(도메인 · 하위 도메인도) · IP_CIDR(예 203.0.113.0/24 · 하나면 /32) · PERSON(accountId — 그 회원의 본인인증 고유값 해시 · 본인인증한 회원만). 사유 필수 · 기한 7 · 30 · 90 · 365일.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 회원 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SIGNUP_BLOCK_EXISTS — 이미 차단 중' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SIGNUP_BLOCK_VALUE · SIGNUP_BLOCK_REASON · SIGNUP_BLOCK_NO_CI(본인인증 안 한 회원) · SIGNUP_BLOCK_SELF' })
  async addBlock(@Body() dto: SignupBlockDto) {
    const reason = dto.reason.trim();
    if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('SIGNUP_BLOCK_REASON', '사유는 2 ~ 200자입니다.');
    let value = (dto.value ?? '').trim().toLowerCase(); let label: string | null = null;
    if (dto.kind === 'EMAIL_DOMAIN') {
      value = value.replace(/^@/, '');
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value) || value.length > 100) throw new PolicyViolation('SIGNUP_BLOCK_VALUE', '도메인 모양이 아닙니다(예: spam.example).');
    } else if (dto.kind === 'IP_CIDR') {
      const [ok] = await this.db.query<{ v: string | null }>(`SELECT CASE WHEN $1 ~ '^[0-9a-f:./]+$' THEN network($1::cidr)::text END AS v`, [value]).catch(() => [{ v: null }]);
      if (!ok?.v) throw new PolicyViolation('SIGNUP_BLOCK_VALUE', 'IP 대역 모양이 아닙니다(예: 203.0.113.0/24 · 하나면 203.0.113.7/32).');
      value = ok.v;
    } else {
      if (!dto.accountId) throw new PolicyViolation('SIGNUP_BLOCK_VALUE', '막을 회원을 고르십시오.');
      if (dto.accountId === RequestCtx.actorId()) throw new PolicyViolation('SIGNUP_BLOCK_SELF', '자기 자신은 막을 수 없습니다.');
      const [a] = await this.db.query<{ email: string; ci: string | null }>(
        `SELECT a.email::text AS email, (SELECT v.ci_hash FROM identity_verifications v WHERE v.account_id = a.id AND v.result = 'SUCCESS' AND v.ci_hash IS NOT NULL ORDER BY v.completed_at DESC NULLS LAST LIMIT 1) AS ci
           FROM accounts a WHERE a.id = $1`, [dto.accountId]);
      if (!a) throw new NotFound('그 회원이 없습니다.');
      if (!a.ci) throw new PolicyViolation('SIGNUP_BLOCK_NO_CI', '본인인증을 한 회원만 사람 단위로 막을 수 있습니다.');
      value = a.ci; label = maskMail(a.email);
    }
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO signup_blocks (kind, value, label, reason, expires_at, created_by)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, $6)
       ON CONFLICT (kind, value) WHERE removed_at IS NULL DO NOTHING RETURNING id::text AS id`, [dto.kind, value, label, reason, dto.expiresDays ?? null, RequestCtx.actorId() ?? null]);
    if (!r.length) throw new AppError(409, { code: 'SIGNUP_BLOCK_EXISTS', message: '이미 차단 중입니다.' });
    return { ok: true, id: r[0]!.id, kind: dto.kind, value: dto.kind === 'PERSON' ? '(본인인증 고유값)' : value, note: '가입 차단을 더했습니다. 걸리는 가입 · 본인인증은 이유를 알리지 않고 거절됩니다.' };
  }

  @Post('signup-blocks/:id/remove')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SIGNUP_BLOCK_REMOVE', 'SETTING')
  @ApiParam({ name: 'id', example: 1 })
  @ApiOperation({ summary: '가입 차단 풀기 (v10.362 · SUPER)', description: '지우지 않고 푼 때 · 사람 · 사유를 남깁니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 이미 풂' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SIGNUP_BLOCK_REASON' })
  async removeBlock(@Param('id', ParseIntPipe) id: number, @Body() dto: SignupUnblockDto) {
    const reason = dto.reason.trim();
    if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('SIGNUP_BLOCK_REASON', '사유는 2 ~ 200자입니다.');
    const r = await this.db.query(
      `UPDATE signup_blocks SET removed_at = now(), removed_by = $2, removed_reason = $3 WHERE id = $1 AND removed_at IS NULL RETURNING id`, [id, RequestCtx.actorId() ?? null, reason]);
    if (!r.length) throw new NotFound('없거나 이미 푼 차단입니다.');
    return { ok: true, id, note: '가입 차단을 풀었습니다(기록은 남음).' };
  }

  /* ── ③ 탈퇴 사유 통계 ── */
  @Get('reports/withdrawals')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'months', required: false, description: '3 ~ 12 · 처음 6' })
  @ApiOperation({ summary: '탈퇴 사유 통계 (v10.363)', description: '최근 months 달 월별 탈퇴 수 · 사유별 · 가입 뒤 탈퇴까지 가운데 일수 · 거래 있던 회원 수 · 기타 글 최근 10(메일 · 번호 · 주소 모양 가림).' })
  @ApiOkResponse({ type: Object })
  async withdrawals(@Query('months') mIn?: string) {
    const months = Math.max(3, Math.min(12, Math.floor(Number(mIn) || 6)));
    const monthly = await this.db.query<{ month: string; n: number }>(
      `SELECT to_char(date_trunc('month', w.created_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month, count(*)::int AS n
         FROM account_withdrawals w
        WHERE w.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => $1 - 1)) AT TIME ZONE 'Asia/Seoul'
        GROUP BY 1 ORDER BY 1`, [months]);
    const reasons = await this.db.query<{ code: string; n: number }>(
      `SELECT w.reason_code AS code, count(*)::int AS n FROM account_withdrawals w
        WHERE w.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => $1 - 1)) AT TIME ZONE 'Asia/Seoul'
        GROUP BY 1 ORDER BY 2 DESC, 1`, [months]);
    const [st] = await this.db.query<{ total: number; median: number | null; deal: number }>(
      `SELECT count(*)::int AS total, round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM w.created_at - a.created_at)) / 86400)::numeric)::int AS median,
              count(*) FILTER (WHERE w.had_deal)::int AS deal
         FROM account_withdrawals w JOIN accounts a ON a.id = w.account_id
        WHERE w.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => $1 - 1)) AT TIME ZONE 'Asia/Seoul'`, [months]);
    const memos = await this.db.query<{ memo: string; at: string }>(
      `SELECT w.memo, w.created_at AS at FROM account_withdrawals w WHERE w.reason_code = 'OTHER' AND w.memo IS NOT NULL ORDER BY w.created_at DESC LIMIT 10`);
    return {
      months, total: Number(st?.total ?? 0), medianDays: st?.median ?? null, hadDeal: Number(st?.deal ?? 0), monthly,
      reasons: reasons.map((r) => ({ ...r, label: WD_KO[r.code] ?? r.code })), memos: memos.map((m) => ({ at: m.at, memo: maskText(m.memo).slice(0, 200) })),
    };
  }

  /* ── ④ 역할별 「오늘 할 일」 ── */
  @Get('todo')
  @Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')
  @ApiOperation({ summary: '오늘 할 일 (v10.364)', description: '내 역할에 맞는 줄만 — 검수 대기 · 지급 대기 · 출금 확정 대기 · 1:1 문의 · 분쟁 · 신고 · 정산 · 사업자 인증 · 확인 안 한 급한 알림 · 입점 · 자격 심사 · 제휴 신청. 수 · 가장 오래된 때 · 넘김 · 갈 탭. 읽기만.' })
  @ApiOkResponse({ type: Object })
  todo(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    return staffTodo(this.db, (p?.roles ?? []) as string[]);
  }
}
