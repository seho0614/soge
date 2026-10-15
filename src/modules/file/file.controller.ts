import {
  Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, Post, Put, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { FileService } from './file.service';
import { CreateFileDto, FILE_PURPOSES, FileOpenQueryDto } from './file.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { Forbidden } from '../../core/errors';
import { verifyToken } from './storage';

const ALL = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER'] as const;

/**
 * 파일 (D007) — 등기사항증명서 · 마케팅자료 · 파트너가이드.
 *
 *   1. POST /files                 → 올릴 주소 (S3 presigned PUT · 개발은 API 토큰 주소)
 *   2. PUT  {uploadUrl}            → 바이트 (브라우저가 직접)
 *   3. POST /files/{id}/complete   → 서버가 크기 · 해시 · 형식(매직바이트)을 보고 READY
 *   4. 소유 확인 · 자료 등록 · 가이드 등록에 fileId 를 넘김
 *   5. GET  /files/{id}            → 5분짜리 내려받기 주소
 */
@ApiTags('FILE')
@ApiBearerAuth()
@Controller('api/v1')
export class FileController {
  constructor(private readonly svc: FileService) {}

  @Post('files')
  @Roles(...ALL)
  @ApiOperation({
    summary: '파일 올릴 자리 만들기',
    description:
      '용도별로 **올릴 수 있는 사람**이 다릅니다 — 등기사항증명서(OWNERSHIP_DOC)는 회원, ' +
      '마케팅자료 · 가이드는 운영(ADMIN · SUPER).\n\n' +
      '돌려받은 `uploadUrl` 에 `method`(PUT) · `headers`(Content-Type) 그대로 바이트를 보내십시오. ' +
      'S3 면 presigned URL(10분), 개발(로컬)이면 `/api/v1/files/{id}/content?t=…` 입니다.\n\n' +
      '형식: PDF · JPG · PNG (마케팅자료는 MP4 도). 크기: 문서 10MB · 자료 PDF 20MB · 영상 50MB.',
  })
  @ApiResponse({ status: 422, description: 'FILE_TYPE · FILE_TOO_LARGE · FILE(올리는 중 20개 초과)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — 이 용도를 올릴 수 없는 역할' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    fileId: { type: 'string', format: 'uuid' }, uploadUrl: { type: 'string' }, method: { type: 'string', example: 'PUT' },
    headers: { type: 'object' }, expiresAt: { type: 'string', format: 'date-time' }, provider: { type: 'string', enum: ['S3', 'LOCAL'] },
    name: { type: 'string', description: '정리된 이름' } } } })
  /* 감사 기록을 붙이지 않습니다 — 응답에 올리기 토큰이 있습니다. 생성 자체는 files 행이 기록입니다 */
  create(@Req() req: Request, @Body() dto: CreateFileDto) {
    return this.svc.create((req as any).principal, dto);
  }

  @Post('files/:id/complete')
  @Roles(...ALL)
  @HttpCode(200)
  @ApiOperation({
    summary: '올리기 확인',
    description:
      '서버가 저장소의 **실제 바이트**를 읽어 크기 · SHA-256 · 형식(매직바이트)을 봅니다. ' +
      '다르면 REJECTED 로 두고 바이트를 지웁니다 — 새로 올리십시오. 올린 사람만 부를 수 있습니다.',
  })
  @ApiResponse({ status: 409, description: 'FILE_NOT_UPLOADED · FILE_STATE' })
  @ApiResponse({ status: 422, description: 'FILE_SIZE_MISMATCH · FILE_HASH_MISMATCH · FILE_TYPE_MISMATCH' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, fileId: { type: 'string', format: 'uuid' }, name: { type: 'string' },
    purpose: { type: 'string', enum: [...FILE_PURPOSES] },
    contentType: { type: 'string' }, size: { type: 'integer' }, sha256: { type: 'string' },
    status: { type: 'string', enum: ['UPLOADING', 'READY', 'REJECTED', 'DELETED'] }, note: { type: 'string' } } } })
  @Audit('FILE_COMPLETE', 'FILE')
  complete(@Req() req: Request, @Param('id') id: string) {
    return this.svc.complete((req as any).principal, id);
  }

  @Get('files/:id')
  @Roles(...ALL)
  @ApiOperation({
    summary: '파일 열기 (짧게 유효한 주소)',
    description:
      '**주인 · 운영(ADMIN/SUPER/REVIEWER) · 승인된 마케팅자료와 활성 가이드는 ACTIVE 파트너**만 받습니다. ' +
      '그 밖은 없는 파일과 같이 404 입니다. 주소는 5분 유효. 운영이 남의 파일을 열면 감사 기록(FILE_OPEN)이 남습니다.',
  })
  @ApiQuery({ name: 'disposition', required: false, enum: ['attachment', 'inline'] })
  @ApiResponse({ status: 403, description: 'PARTNER_ONLY — 파트너 승인 계정만' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — 없거나 볼 수 없는 파일' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    fileId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, contentType: { type: 'string' },
    size: { type: 'integer' }, url: { type: 'string', description: 'S3 presigned GET 또는 /api/v1/files/{id}/content?t=…' },
    method: { type: 'string', example: 'GET' }, expiresAt: { type: 'string', format: 'date-time' } } } })
  open(@Req() req: Request, @Param('id') id: string, @Query() q: FileOpenQueryDto) {
    return this.svc.open((req as any).principal, id, (q.disposition as any) ?? 'attachment');
  }

  @Delete('files/:id')
  @Roles(...ALL)
  @ApiOperation({
    summary: '내 파일 지우기',
    description: '제출 · 등록에 쓰인 파일은 지울 수 없습니다(DB 가 막음). 화면은 올린 뒤 제출 · 등록이 실패하면 이것으로 치웁니다.',
  })
  @ApiResponse({ status: 422, description: 'FILE — 제출 · 등록에 쓰인 파일' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, fileId: { type: 'string', format: 'uuid' }, status: { type: 'string', example: 'DELETED' }, note: { type: 'string' } } } })
  @Audit('FILE_DELETE', 'FILE')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.svc.remove((req as any).principal, id);
  }
}

/**
 * 토큰 주소 가드 (로컬 저장소).
 * 사람 토큰 대신 **파일 · 동작 · 만료에 묶인 서명**을 봅니다 — S3 presigned URL 과 같은 성격입니다.
 */
@Injectable()
export class FileTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const op = req.method === 'PUT' ? 'put' : 'get';
    const v = verifyToken(op, String(req.params?.id ?? ''), String(req.query?.t ?? ''));
    if (v === 'EXPIRED') throw new Forbidden('FILE_TOKEN_EXPIRED', '주소가 만료되었습니다. 다시 받아 주십시오.');
    if (v !== 'OK') throw new Forbidden('FILE_TOKEN_INVALID', '주소가 올바르지 않습니다.');
    return true;
  }
}

@ApiTags('FILE')
@Controller('api/v1')
@UseGuards(FileTokenGuard)
export class FileContentController {
  constructor(private readonly svc: FileService) {}

  @Put('files/:id/content')
  @ApiOperation({
    summary: '(개발 · 로컬 저장소) 바이트 올리기',
    description:
      'POST /files 가 준 주소입니다(토큰 10분). Content-Type 은 밝힌 형식과 같아야 하고, ' +
      '밝힌 크기를 넘으면 그 자리에서 끊습니다(413). S3 를 쓰면 이 주소는 쓰지 않습니다.',
  })
  @ApiParam({ name: 'id' }) @ApiQuery({ name: 't', description: '서명 토큰' })
  @ApiConsumes('application/pdf', 'image/jpeg', 'image/png', 'video/mp4')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 403, description: 'FILE_TOKEN_INVALID · FILE_TOKEN_EXPIRED' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'FILE_CONTENT_TYPE' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, size: { type: 'integer' }, sha256: { type: 'string' }, note: { type: 'string' } } } })
  async upload(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return await this.svc.receive(id, req as any);
    } catch (e: any) {
      /* 본문을 다 읽지 않고 거절하면 연결을 닫습니다 — 남은 바이트를 받지 않습니다 */
      if (e?.getStatus?.() === 413) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      throw e;
    }
  }

  @Get('files/:id/content')
  @ApiOperation({ summary: '(개발 · 로컬 저장소) 바이트 내려받기', description: 'GET /files/{id} 가 준 주소입니다(토큰 5분).' })
  @ApiParam({ name: 'id' }) @ApiQuery({ name: 't' }) @ApiQuery({ name: 'inline', required: false })
  @ApiOkResponse({ description: '파일 바이트 (Content-Disposition · nosniff)', content: Object.fromEntries(
    ['application/pdf', 'image/jpeg', 'image/png', 'video/mp4'].map((t) => [t, { schema: { type: 'string', format: 'binary' } }])) })
  @ApiResponse({ status: 403, description: 'FILE_TOKEN_INVALID · FILE_TOKEN_EXPIRED' })
  async download(@Param('id') id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const { stream, headers } = await this.svc.content(id, inline === '1');
    res.status(200);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
