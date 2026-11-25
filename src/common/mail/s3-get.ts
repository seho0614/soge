import * as crypto from 'crypto';

/* ---------------------------------------------------------------------
 * v10.789 (D330 · docs/904) 공용 메일함 — S3 에 있는 받은 원본 가져오기(서명 v4 · 새 패키지 없음)
 *
 *   SES 받기 규칙은 S3 작업 하나(SNS 작업은 150KB 넘는 메일을 반송하므로 쓰지 않음 — AWS 「Publish to Amazon SNS topic action」).
 *   자격 증명 차례: ① 환경 변수 MAIL_S3_ACCESS_KEY_ID · MAIL_S3_SECRET_ACCESS_KEY(· MAIL_S3_SESSION_TOKEN) — 사람이 운영 .env 에
 *                   ② 없으면 EC2 인스턴스 역할(IMDSv2 · 169.254.169.254) — 운영 서버에 역할을 붙였을 때
 *   권한은 그 버킷 inbound/ 아래 s3:GetObject 하나만(docs/902 W0 블록 6). 값은 화면 · 응답 · 로그 · DB 에 싣지 않음.
 *   지역 MAIL_S3_REGION(기본 ap-northeast-2) · 크기 상한 maxBytes(넘으면 받지 않음).
 * ------------------------------------------------------------------- */

export interface S3Creds { id: string; secret: string; token?: string; exp?: number }
export type S3Get = (bucket: string, key: string, maxBytes: number) => Promise<Buffer | null>;

const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k: crypto.BinaryLike, s: string) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** 서명 v4 머리(GET · 본문 없음) — 시험이 같은 값을 다시 계산할 수 있게 내보냄 */
export function s3SignedHeaders(bucket: string, key: string, region: string, c: S3Creds, now = new Date()) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const path = '/' + key.split('/').map(enc).join('/');
  const payload = sha('');
  const h: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  if (c.token) h['x-amz-security-token'] = c.token;
  const names = Object.keys(h).sort();
  const canonical = ['GET', path, '', names.map((n) => `${n}:${h[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + c.secret, day), region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(toSign, 'utf8').digest('hex');
  return { url: `https://${host}${path}`, headers: { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` } };
}

let cached: S3Creds | null = null;

async function imdsCreds(): Promise<S3Creds | null> {
  try {
    const t = await fetch('http://169.254.169.254/latest/api/token', { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }, signal: AbortSignal.timeout(1500) });
    if (!t.ok) return null;
    const token = await t.text();
    const h = { 'X-aws-ec2-metadata-token': token };
    const r = await fetch('http://169.254.169.254/latest/meta-data/iam/security-credentials/', { headers: h, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const role = (await r.text()).split('\n')[0]?.trim();
    if (!role || !/^[\w+=,.@-]{1,128}$/.test(role)) return null;
    const j = await (await fetch(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${role}`, { headers: h, signal: AbortSignal.timeout(1500) })).json() as any;
    if (!j?.AccessKeyId || !j?.SecretAccessKey) return null;
    return { id: j.AccessKeyId, secret: j.SecretAccessKey, token: j.Token, exp: Date.parse(j.Expiration) || Date.now() + 10 * 60_000 };
  } catch { return null; }
}

export async function s3Creds(env: NodeJS.ProcessEnv = process.env): Promise<S3Creds | null> {
  const id = env.MAIL_S3_ACCESS_KEY_ID?.trim(), secret = env.MAIL_S3_SECRET_ACCESS_KEY?.trim();
  if (id && secret) return { id, secret, token: env.MAIL_S3_SESSION_TOKEN?.trim() || undefined };
  if (cached && (cached.exp ?? 0) - Date.now() > 5 * 60_000) return cached;
  cached = await imdsCreds();
  return cached;
}

/** 받은 원본 가져오기 — 자격 증명이 없거나 실패하면 null(메일은 위치만 남고 「S3 에서 가져오기」로 다시) */
export const s3Get: S3Get = async (bucket, key, maxBytes) => {
  const c = await s3Creds();
  if (!c) return null;
  const region = process.env.MAIL_S3_REGION?.trim() || 'ap-northeast-2';
  if (!/^[a-z0-9-]{4,30}$/.test(region)) return null;
  const { url, headers } = s3SignedHeaders(bucket, key, region, c);
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  } catch { return null; }
};
