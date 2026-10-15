import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { AwsCredentials, presign } from './sigv4';

/**
 * 파일 저장소.
 *
 *   S3     환경변수 S3_BUCKET 이 있으면. 브라우저가 S3 로 **직접** 올리고 내려받습니다
 *          (presigned PUT/GET). API 서버는 바이트를 중계하지 않습니다.
 *   LOCAL  S3_BUCKET 이 없으면(개발). UPLOAD_DIR(기본 ./uploads) 아래에 두고
 *          API 의 토큰 주소(PUT/GET /files/{id}/content?t=…)로 주고받습니다.
 *
 * 어느 쪽이든 complete 때 서버가 **실제 바이트를 다시 읽어** 크기 · 해시 · 형식을 봅니다.
 */

/** 저장 키 형식 — DB(ck_files_storage_key)와 같습니다. 이 형식이 아니면 디스크에 닿지 않습니다 */
export const STORAGE_KEY_RE =
  /^[a-z_]{3,30}\/[0-9]{4}\/[0-9]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/;

export interface Target { url: string; method: 'PUT' | 'GET'; headers: Record<string, string>; expiresAt: string }

export interface StorageProvider {
  readonly kind: 'S3' | 'LOCAL';
  /** 브라우저가 파일을 올릴 곳 */
  uploadTarget(f: { id: string; key: string; contentType: string; size: number }, ttlSec: number): Promise<Target>;
  /** 내려받을 곳 (짧게 유효) */
  downloadTarget(f: { id: string; key: string; contentType: string; disposition: string }, ttlSec: number): Promise<Target>;
  /** 서버가 검증용으로 읽음. 없으면 null */
  open(key: string): Promise<Readable | null>;
  remove(key: string): Promise<void>;
}

/* ── 토큰 (LOCAL 의 업로드 · 다운로드 주소) ─────────────────────────
 *   `${만료(초)}.${HMAC(op:fileId:만료)}` — 파일 · 동작 · 만료에 묶입니다.
 *   다른 파일 · 다른 동작(get 토큰으로 put)에는 쓸 수 없습니다. */
function tokenKey(): Buffer {
  const secret = process.env.FILE_TOKEN_SECRET || process.env.JWT_SECRET || '';
  if (!secret) throw new Error('FILE_TOKEN_SECRET 또는 JWT_SECRET 이 필요합니다');
  return createHash('sha256').update('sgb-file-token|' + secret).digest();
}
export function signToken(op: 'put' | 'get', fileId: string, ttlSec: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  const mac = createHmac('sha256', tokenKey()).update(`${op}:${fileId}:${exp}`).digest('base64url');
  return `${exp}.${mac}`;
}
export type TokenCheck = 'OK' | 'INVALID' | 'EXPIRED';
export function verifyToken(op: 'put' | 'get', fileId: string, token: string | undefined, now = Date.now()): TokenCheck {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!m) return 'INVALID';
  const want = createHmac('sha256', tokenKey()).update(`${op}:${fileId}:${m[1]}`).digest();
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return 'INVALID';
  if (Number(m[1]) * 1000 < now) return 'EXPIRED';
  return 'OK';
}

const API_PREFIX = () => (process.env.FILE_PUBLIC_BASE ?? '/api/v1').replace(/\/$/, '');
const iso = (ttl: number) => new Date(Date.now() + ttl * 1000).toISOString();

/* ── LOCAL ──────────────────────────────────────────────────────── */
export class LocalStorage implements StorageProvider {
  readonly kind = 'LOCAL' as const;
  readonly root: string;
  constructor(dir = process.env.UPLOAD_DIR || './uploads') {
    this.root = path.resolve(dir);
  }

  /** 키 → 실제 경로. 형식 검사 + 루트 밖으로 못 나가게 두 번 막습니다 */
  pathOf(key: string): string {
    if (!STORAGE_KEY_RE.test(key)) throw new Error('잘못된 저장 키');
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('저장소 밖 경로');
    return p;
  }

  async uploadTarget(f: { id: string; contentType: string }, ttl: number): Promise<Target> {
    return {
      method: 'PUT', url: `${API_PREFIX()}/files/${f.id}/content?t=${signToken('put', f.id, ttl)}`,
      headers: { 'Content-Type': f.contentType }, expiresAt: iso(ttl),
    };
  }
  async downloadTarget(f: { id: string; disposition: string }, ttl: number): Promise<Target> {
    const d = f.disposition.startsWith('inline') ? '&inline=1' : '';
    return {
      method: 'GET', url: `${API_PREFIX()}/files/${f.id}/content?t=${signToken('get', f.id, ttl)}${d}`,
      headers: {}, expiresAt: iso(ttl),
    };
  }

  /**
   * 들어오는 바이트를 임시 파일에 쓰고, 끝까지 받은 뒤에 제자리로 옮깁니다.
   * limit 을 넘으면 그 자리에서 끊습니다 — 디스크를 채우지 못하게.
   */
  async write(key: string, src: Readable, limit: number): Promise<{ size: number; sha256: string; overflow: boolean }> {
    const dest = this.pathOf(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part-${randomBytes(6).toString('hex')}`;
    const out = createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
    const h = createHash('sha256');
    let size = 0; let overflow = false;
    try {
      await new Promise<void>((resolve, reject) => {
        src.on('data', (chunk: Buffer) => {
          size += chunk.length;
          /* 넘치면 더 읽지 않습니다. 소켓은 응답(413 · Connection: close)을 보낸 뒤 호출자가 닫습니다 */
          if (size > limit) {
            overflow = true; src.removeAllListeners('data'); src.pause(); out.destroy(); resolve(); return;
          }
          h.update(chunk);
          if (!out.write(chunk)) { src.pause(); out.once('drain', () => src.resume()); }
        });
        src.on('end', () => out.end(() => resolve()));
        src.on('error', reject);
        out.on('error', reject);
        src.on('aborted', () => reject(new Error('aborted')));
      });
      if (overflow) { await fsp.rm(tmp, { force: true }); return { size, sha256: '', overflow }; }
      await fsp.rename(tmp, dest);
      return { size, sha256: h.digest('hex'), overflow };
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async open(key: string): Promise<Readable | null> {
    const p = this.pathOf(key);
    try { await fsp.access(p); } catch { return null; }
    return createReadStream(p);
  }
  async stat(key: string): Promise<number | null> {
    try { return (await fsp.stat(this.pathOf(key))).size; } catch { return null; }
  }
  async remove(key: string): Promise<void> {
    await fsp.rm(this.pathOf(key), { force: true });
  }
}

/* ── S3 ─────────────────────────────────────────────────────────── */

/**
 * 자격 증명 — AWS 표준 순서를 따릅니다.
 *   ① 환경변수 AWS_ACCESS_KEY_ID · AWS_SECRET_ACCESS_KEY (· AWS_SESSION_TOKEN)
 *   ② ECS 태스크 역할   AWS_CONTAINER_CREDENTIALS_RELATIVE_URI (169.254.170.2)
 *                       또는 AWS_CONTAINER_CREDENTIALS_FULL_URI (+ AWS_CONTAINER_AUTHORIZATION_TOKEN)
 *   ③ EC2 인스턴스 역할 IMDSv2 (AWS_EC2_METADATA_SERVICE_ENDPOINT, 기본 http://169.254.169.254)
 * 임시 자격은 만료 5분 전에 다시 받습니다.
 */
type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;

export class AwsCredentialChain {
  private cached: (AwsCredentials & { expiresAt?: number }) | null = null;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env,
              private readonly fetchFn: FetchFn = (globalThis as any).fetch) {}

  async get(): Promise<AwsCredentials> {
    const e = this.env;
    if (e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY) {
      return { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
               sessionToken: e.AWS_SESSION_TOKEN || undefined };
    }
    if (this.cached && (!this.cached.expiresAt || this.cached.expiresAt - Date.now() > 300_000)) return this.cached;
    const c = await this.fromContainer() ?? await this.fromImds();
    if (!c) throw new Error('AWS 자격 증명을 찾지 못했습니다 (환경변수 · ECS 태스크 역할 · 인스턴스 역할)');
    this.cached = c;
    return c;
  }

  private parse(j: any) {
    if (!j?.AccessKeyId || !j?.SecretAccessKey) return null;
    return { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, sessionToken: j.Token,
             expiresAt: j.Expiration ? Date.parse(j.Expiration) : undefined };
  }

  private async fromContainer() {
    const rel = this.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    const full = this.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    if (!rel && !full) return null;
    const url = rel ? `http://169.254.170.2${rel}` : full!;
    const headers: Record<string, string> = {};
    if (this.env.AWS_CONTAINER_AUTHORIZATION_TOKEN) headers.Authorization = this.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    const r = await this.fetchFn(url, { headers, signal: AbortSignal.timeout(2000) });
    return r.ok ? this.parse(await r.json()) : null;
  }

  private async fromImds() {
    if (this.env.AWS_EC2_METADATA_DISABLED === 'true') return null;
    const base = (this.env.AWS_EC2_METADATA_SERVICE_ENDPOINT || 'http://169.254.169.254').replace(/\/$/, '');
    try {
      const t = await this.fetchFn(`${base}/latest/api/token`, {
        method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }, signal: AbortSignal.timeout(1000) });
      if (!t.ok) return null;
      const token = await t.text();
      const h = { 'X-aws-ec2-metadata-token': token };
      const rl = await this.fetchFn(`${base}/latest/meta-data/iam/security-credentials/`, { headers: h, signal: AbortSignal.timeout(1000) });
      if (!rl.ok) return null;
      const role = (await rl.text()).split('\n')[0].trim();
      if (!role) return null;
      const rc = await this.fetchFn(`${base}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`,
        { headers: h, signal: AbortSignal.timeout(1000) });
      return rc.ok ? this.parse(await rc.json()) : null;
    } catch { return null; }
  }
}

export class S3Storage implements StorageProvider {
  readonly kind = 'S3' as const;
  readonly bucket: string;
  readonly region: string;
  private readonly endpoint?: string;
  private readonly pathStyle: boolean;
  private readonly signLength: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env,
              private readonly creds = new AwsCredentialChain(env),
              private readonly fetchFn: FetchFn = (globalThis as any).fetch) {
    this.bucket = env.S3_BUCKET!;
    this.region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'ap-northeast-2';
    /* S3 호환 저장소 · 시험용 가짜 서버 주소. 비우면 AWS 표준 주소 */
    this.endpoint = env.S3_ENDPOINT?.replace(/\/$/, '') || undefined;
    this.pathStyle = env.S3_FORCE_PATH_STYLE === '1' || env.S3_FORCE_PATH_STYLE === 'true';
    /* 크기를 서명에 넣어 S3 가 다른 크기를 거절하게 합니다 (끄려면 0) */
    this.signLength = env.S3_SIGN_CONTENT_LENGTH !== '0';
  }

  objectUrl(key: string): string {
    if (!STORAGE_KEY_RE.test(key)) throw new Error('잘못된 저장 키');
    if (this.endpoint) {
      if (this.pathStyle) return `${this.endpoint}/${this.bucket}/${key}`;
      const u = new URL(this.endpoint);
      return `${u.protocol}//${this.bucket}.${u.host}/${key}`;
    }
    return this.pathStyle
      ? `https://s3.${this.region}.amazonaws.com/${this.bucket}/${key}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async sign(method: 'GET' | 'PUT' | 'DELETE', key: string, ttl: number,
             headers?: Record<string, string>, query?: Record<string, string>) {
    return presign({ method, url: this.objectUrl(key), region: this.region, credentials: await this.creds.get(),
                     expiresIn: ttl, signedHeaders: headers, query }).url;
  }

  async uploadTarget(f: { key: string; contentType: string; size: number }, ttl: number): Promise<Target> {
    const signed: Record<string, string> = { 'content-type': f.contentType };
    if (this.signLength) signed['content-length'] = String(f.size);
    return {
      method: 'PUT', url: await this.sign('PUT', f.key, ttl, signed),
      /* Content-Length 는 브라우저가 스스로 붙입니다 — 보여 주기만 합니다 */
      headers: { 'Content-Type': f.contentType }, expiresAt: iso(ttl),
    };
  }
  async downloadTarget(f: { key: string; contentType: string; disposition: string }, ttl: number): Promise<Target> {
    return {
      method: 'GET', headers: {}, expiresAt: iso(ttl),
      url: await this.sign('GET', f.key, ttl, undefined, {
        'response-content-disposition': f.disposition,
        'response-content-type': f.contentType,
        'response-cache-control': 'private, no-store',
      }),
    };
  }
  async open(key: string): Promise<Readable | null> {
    const r: any = await this.fetchFn(await this.sign('GET', key, 60), { signal: AbortSignal.timeout(60_000) });
    if (r.status === 404 || r.status === 403) return null;      // 없는 객체는 권한에 따라 403 으로 옵니다
    if (!r.ok) throw new Error(`S3 GET ${r.status}`);
    return Readable.fromWeb(r.body);
  }
  async remove(key: string): Promise<void> {
    const r = await this.fetchFn(await this.sign('DELETE', key, 60), { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
    if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${r.status}`);
  }
}

/** 환경에 맞는 저장소 하나. S3_BUCKET 이 있으면 S3 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  return env.S3_BUCKET ? new S3Storage(env) : new LocalStorage(env.UPLOAD_DIR || './uploads');
}
