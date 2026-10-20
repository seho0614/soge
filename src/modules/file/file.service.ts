import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DatabaseService } from '../../db/database.service';
import { AppError, Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Principal } from '../../core/auth';
import { hasRole } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { LocalStorage, StorageProvider, storageFromEnv } from './storage';
import { SNIFF_BYTES, TYPE_LABEL, contentDisposition, sanitizeName, sniff } from './sniff';

/** 올리기 주소 10분 · 내려받기 주소 5분 */
export const UPLOAD_TTL = Number(process.env.FILE_UPLOAD_TTL ?? 600);
export const DOWNLOAD_TTL = Number(process.env.FILE_DOWNLOAD_TTL ?? 300);

/** 누가 어느 용도로 올릴 수 있는가 */
const UPLOADERS: Record<string, string[]> = {
  OWNERSHIP_DOC: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'],      // 소유 확인을 내는 사람 (POST /me/listings/{id}/ownership 과 같음)
  MARKETING_MATERIAL: ['ADMIN', 'SUPER'],                    // 운영이 올리고 심의합니다
  PARTNER_GUIDE: ['ADMIN', 'SUPER'],
  /* v10.31 — 매물 · 요청의 대표 · 상세 이미지(시안 등록 폼). 올린 사람만 자기 글에 붙일 수 있습니다(attach-images.checkOwnImages) */
  LISTING_IMAGE: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'],
  REQUEST_IMAGE: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'],
  INQUIRY_ATTACHMENT: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'],   /* v10.31 — 고객센터 문의 첨부(이미지 · PDF · 3개) — 올린 사람과 운영만 봅니다 */
  PRODUCT_IMAGE: ['ADMIN', 'SUPER'],                         // v10.26 — 소개몰 상품 사진(운영 화면 「소개몰 상품」). 판매 중 상품의 사진은 누구나 봅니다(GET /health/products/{code}/image)
  /* (w2) LISTING_IMAGE · REQUEST_IMAGE 는 위(w1)와 같은 용도 — 매물 사진 GET /listings/{id}/photos/{n} · 요청 사진 GET /market/requests/{id}/photo 도 같은 파일을 씁니다 */
  BROKER_DOC: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'],          // v10.31 (w2) — 중개사 인증 제출 서류(신청자 · 운영만 열람)
  PARTNER_MEDIA: ['BIZ_OWNER', 'BIZ_STAFF', 'MEMBER'],       // v10.31 (W5 · D072) — 파트너 서비스 대표 이미지 · 회사 로고(올린 사람과 운영만 엶)
};

interface FileRow {
  id: string; owner_account_id: string; purpose: string; original_name: string;
  content_type: string; detected_type: string | null; size_bytes: number; sha256: string | null;
  storage_provider: string; storage_key: string; status: string;
}

/**
 * 파일 올리기 · 내려받기.
 *
 * ── 바이트를 믿지 않습니다 ─────────────────────────────────────
 *   이름 · Content-Type · 크기는 올리는 사람이 정합니다. complete 때 서버가
 *   저장소의 실제 바이트를 끝까지 읽어 **크기 · SHA-256 · 매직바이트 형식**을 봅니다.
 *   하나라도 다르면 REJECTED 로 두고 바이트를 지웁니다.
 *
 * ── 누가 볼 수 있는가는 DB 가 정합니다 (fn_file_can_read) ──────
 *   주인 · 운영(ADMIN/SUPER/REVIEWER) · 승인된 자료 · 활성 가이드는 ACTIVE 파트너.
 *   그 밖은 **없는 파일과 똑같이 404** — 남의 파일이 있는지조차 알려 주지 않습니다.
 */
@Injectable()
export class FileService {
  private readonly log = new Logger(FileService.name);
  readonly storage: StorageProvider = storageFromEnv();

  constructor(private readonly db: DatabaseService) {}

  private async row(id: string): Promise<FileRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [f] = await this.db.query<FileRow>(`SELECT * FROM files WHERE id = $1`, [id]);
    return f ?? null;
  }

  /* ── 1. 올릴 자리 만들기 ───────────────────────────────────── */
  async create(p: Principal, dto: { purpose: string; name: string; contentType: string; size: number; sha256?: string }) {
    const uploaders = UPLOADERS[dto.purpose];
    if (!uploaders || !hasRole(p.roles, ...uploaders)) {   // 2026-10-21 — SUPER 는 모든 용도(hasRole)
      throw new Forbidden('FORBIDDEN', '이 용도의 파일을 올릴 권한이 없습니다.');
    }
    const ct = dto.contentType.toLowerCase().split(';')[0].trim();
    const pol = await this.db.query<{ content_type: string; max_bytes: number; ext: string }>(
      `SELECT content_type, max_bytes, ext FROM file_policies WHERE purpose = $1`, [dto.purpose]);
    const hit = pol.find((x) => x.content_type === ct);
    const allowed = pol.map((x) => TYPE_LABEL[x.content_type] ?? x.content_type).join(' · ');
    if (!hit) throw new PolicyViolation('FILE_TYPE', `이 형식은 받지 않습니다. ${allowed} 파일만 올려 주십시오.`, { allowed: pol });
    if (dto.size > hit.max_bytes) {
      throw new PolicyViolation('FILE_TOO_LARGE',
        `파일이 너무 큽니다 — ${TYPE_LABEL[ct]} 는 최대 ${Math.round(hit.max_bytes / 1048576)}MB 입니다.`,
        { maxBytes: hit.max_bytes });
    }

    const id = randomUUID();
    const d = new Date();
    const key = `${dto.purpose.toLowerCase()}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}.${hit.ext}`;
    const name = sanitizeName(dto.name, hit.ext);
    /* sha256 은 complete 때까지 「올린 사람이 밝힌 값」 입니다. 서버가 계산한 값과 맞아야 READY */
    await this.db.query(
      `INSERT INTO files (id, owner_account_id, purpose, original_name, content_type, size_bytes,
                          sha256, storage_provider, storage_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, p.accountId, dto.purpose, name, ct, dto.size, dto.sha256?.toLowerCase() ?? null,
       this.storage.kind, key]);
    const t = await this.storage.uploadTarget({ id, key, contentType: ct, size: dto.size }, UPLOAD_TTL);
    return {
      fileId: id, name, status: 'UPLOADING', provider: this.storage.kind,
      uploadUrl: t.url, method: t.method, headers: t.headers, expiresAt: t.expiresAt,
      maxBytes: hit.max_bytes,
      note: '이 주소로 파일을 PUT 한 뒤 complete 를 부르십시오. 주소는 10분 동안만 유효합니다.',
    };
  }

  /* ── 2. (LOCAL) 바이트 받기 — 토큰 가드를 통과한 요청만 옵니다 ─ */
  async receive(id: string, req: Readable & { headers: Record<string, any> }) {
    if (!(this.storage instanceof LocalStorage)) throw new NotFound();
    const f = await this.row(id);
    if (!f || f.storage_provider !== 'LOCAL') throw new NotFound();
    if (f.status !== 'UPLOADING') throw new StateConflict('FILE_STATE', `이미 ${f.status} 상태인 파일입니다. 새로 올려 주십시오.`);

    /* S3 presigned PUT 이 서명한 Content-Type 과 같은 규칙 — 밝힌 형식으로만 올립니다 */
    const ct = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
    if (ct !== f.content_type) {
      throw new AppError(415, { code: 'FILE_CONTENT_TYPE', message: `Content-Type 은 ${f.content_type} 이어야 합니다.` });
    }
    const len = req.headers['content-length'];
    if (len !== undefined && Number(len) > f.size_bytes) {
      throw new AppError(413, { code: 'FILE_TOO_LARGE', message: '밝힌 크기보다 큰 파일입니다.' });
    }
    const w = await this.storage.write(f.storage_key, req, f.size_bytes);
    if (w.overflow) {
      throw new AppError(413, { code: 'FILE_TOO_LARGE', message: '밝힌 크기보다 큰 파일입니다.' });
    }
    return { ok: true, size: w.size, sha256: w.sha256, note: '받았습니다. complete 를 부르면 확인합니다.' };
  }

  /* ── 3. 확인 ───────────────────────────────────────────────── */
  async complete(p: Principal, id: string) {
    const f = await this.row(id);
    if (!f || f.owner_account_id !== p.accountId) throw new NotFound();
    if (f.status === 'READY') return this.view(f, '이미 확인된 파일입니다.');
    if (f.status !== 'UPLOADING') throw new StateConflict('FILE_STATE', `${f.status} 상태인 파일입니다. 새로 올려 주십시오.`);

    const src = await this.storage.open(f.storage_key);
    if (!src) throw new StateConflict('FILE_NOT_UPLOADED', '아직 파일이 올라오지 않았습니다. 올린 뒤 다시 부르십시오.');
    const m = await this.measure(src, f.size_bytes);

    const detected = sniff(m.head);
    let reason: string | null = null; let code = '';
    if (m.size !== Number(f.size_bytes)) {
      code = 'FILE_SIZE_MISMATCH'; reason = `크기가 다릅니다 (밝힌 ${f.size_bytes} · 실제 ${m.overflow ? '그 이상' : m.size} 바이트)`;
    } else if (f.sha256 && f.sha256 !== m.sha256) {
      code = 'FILE_HASH_MISMATCH'; reason = '해시(SHA-256)가 다릅니다 — 올리는 중 바뀌었거나 다른 파일입니다';
    } else if (detected !== f.content_type) {
      code = 'FILE_TYPE_MISMATCH';
      reason = `파일 내용이 ${TYPE_LABEL[f.content_type]} 가 아닙니다 (판정: ${detected ? TYPE_LABEL[detected] : '알 수 없음'})`;
    }
    if (reason) {
      await this.db.query(
        `UPDATE files SET status = 'REJECTED', reject_reason = $2, detected_type = $3 WHERE id = $1 AND status = 'UPLOADING'`,
        [id, reason, detected]);
      await this.storage.remove(f.storage_key).catch((e) => this.log.warn(`remove ${f.storage_key}: ${e.message}`));
      throw new PolicyViolation(code, `${reason}. 새로 올려 주십시오.`);
    }
    const [r] = await this.db.query<FileRow>(
      `UPDATE files SET status = 'READY', sha256 = $2, detected_type = $3, completed_at = now()
        WHERE id = $1 AND status = 'UPLOADING' RETURNING *`, [id, m.sha256, detected]);
    if (!r) throw new StateConflict('FILE_STATE', '다른 요청이 먼저 처리했습니다.');
    return this.view(r, '확인했습니다. 이제 제출 · 등록에 쓸 수 있습니다.');
  }

  /** 끝까지 읽으며 크기 · 해시 · 앞부분. 밝힌 크기를 넘으면 더 읽지 않습니다 */
  private measure(src: Readable, limit: number): Promise<{ size: number; sha256: string; head: Buffer; overflow: boolean }> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256'); let size = 0; let head = Buffer.alloc(0); let done = false;
      src.on('data', (c: Buffer) => {
        if (done) return;
        size += c.length;
        if (head.length < SNIFF_BYTES) head = Buffer.concat([head, c.subarray(0, SNIFF_BYTES - head.length)]);
        if (size > limit) { done = true; src.destroy(); resolve({ size, sha256: '', head, overflow: true }); return; }
        h.update(c);
      });
      src.on('end', () => { if (!done) { done = true; resolve({ size, sha256: h.digest('hex'), head, overflow: false }); } });
      src.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
  }

  private view(f: FileRow, note?: string) {
    return {
      ok: true, fileId: f.id, name: f.original_name, purpose: f.purpose, contentType: f.content_type,
      size: Number(f.size_bytes), sha256: f.sha256, status: f.status, ...(note ? { note } : {}),
    };
  }

  /* ── 4. 열기 (짧게 유효한 주소) ────────────────────────────── */
  async open(p: Principal, id: string, disposition: 'inline' | 'attachment' = 'attachment') {
    const f = await this.row(id);
    if (!f) throw new NotFound('파일을 찾을 수 없습니다.');
    const [{ verdict }] = await this.db.query<{ verdict: string }>(
      `SELECT fn_file_can_read($1, $2, $3::text[]) AS verdict`, [id, p.accountId, p.roles]);
    if (verdict === 'PARTNER_ONLY') throw new Forbidden('PARTNER_ONLY', '파트너로 승인된 계정만 내려받을 수 있습니다.');
    if (verdict !== 'OK') throw new NotFound('파일을 찾을 수 없습니다.');

    const t = await this.storage.downloadTarget({
      id, key: f.storage_key, contentType: f.content_type,
      disposition: contentDisposition(disposition, f.original_name),
    }, DOWNLOAD_TTL);

    /* 남의 파일을 연 기록 — 등기부에는 개인정보(소유자 성명 · 주소)가 있습니다. 주소(토큰)는 남기지 않습니다 */
    if (f.owner_account_id !== p.accountId) {
      const c = RequestCtx.get();
      void this.db.query(
        `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
         VALUES ($1,$2,'FILE_OPEN','FILE',$3,$4::jsonb,$5,$6)`,
        [p.accountId, p.roles[0] ?? null, id, JSON.stringify({ purpose: f.purpose, name: f.original_name, disposition }),
         c?.ip ?? null, c?.userAgent ?? null],
      ).catch((e) => this.log.error(`[AUDIT_WRITE_FAILED] FILE_OPEN ${e.message}`));
    }
    return {
      fileId: id, name: f.original_name, contentType: f.content_type, size: Number(f.size_bytes),
      url: t.url, method: 'GET', expiresAt: t.expiresAt,
    };
  }

  /* ── (LOCAL) 바이트 내보내기 — 토큰 가드를 통과한 요청만 ─── */
  async content(id: string, inline: boolean) {
    if (!(this.storage instanceof LocalStorage)) throw new NotFound();
    const f = await this.row(id);
    if (!f || f.status !== 'READY' || f.storage_provider !== 'LOCAL') throw new NotFound('파일을 찾을 수 없습니다.');
    const stream = await this.storage.open(f.storage_key);
    if (!stream) throw new NotFound('파일을 찾을 수 없습니다.');
    return {
      stream,
      headers: {
        'Content-Type': f.content_type,
        'Content-Length': String(f.size_bytes),
        'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', f.original_name),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Cross-Origin-Resource-Policy': 'same-origin',
        /* 판정을 통과한 그림 · 영상만 나가지만, 혹시 모를 스크립트는 막습니다.
         * PDF 는 브라우저 내장 뷰어가 CSP 에 막힐 수 있어 빼고, 대신 attachment 가 기본입니다 */
        ...(f.content_type === 'application/pdf' ? {} : {
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" }),
      } as Record<string, string>,
    };
  }

  /* ── 지우기 (쓰이지 않은 내 파일) ─────────────────────────── */
  async remove(p: Principal, id: string) {
    const f = await this.row(id);
    if (!f || f.owner_account_id !== p.accountId || f.status === 'DELETED') throw new NotFound();
    /* 제출 · 등록에 쓰인 파일이면 DB(fn_files_guard)가 막습니다 */
    await this.db.query(`UPDATE files SET status = 'DELETED' WHERE id = $1`, [id]);
    await this.storage.remove(f.storage_key).catch((e) => this.log.warn(`remove ${f.storage_key}: ${e.message}`));
    return { ok: true, fileId: id, status: 'DELETED', note: '지웠습니다.' };
  }

  /** 다른 모듈용 — 파일 이름 (doc_key · file_key 호환 값) */
  async nameOf(id: string): Promise<string | null> {
    const f = await this.row(id);
    return f?.original_name ?? null;
  }
}
