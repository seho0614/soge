import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 — 쿼리 문자열 서명(presigned URL).
 *
 * AWS SDK 를 들이지 않고 직접 씁니다(오프라인 설치 불가 · 의존성 최소화).
 * 규칙은 공식 문서 그대로입니다.
 *   - Authenticating Requests: Using Query Parameters (AWS Signature Version 4)
 *     https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 *   - Create a canonical request / string to sign / derive signing key
 *     https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 *
 * 검증: scripts/test-s3-presign-offline.ts 가 문서의 예시 값(examplebucket/test.txt,
 *       서명 aeeed9bb…)과 서명 키 파생 예시(f4780e2d…)를 그대로 맞춰 봅니다.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** 예: https://bucket.s3.ap-northeast-2.amazonaws.com/a/b.pdf */
  url: string;
  region: string;
  service?: string;            // 기본 s3
  credentials: AwsCredentials;
  expiresIn: number;           // 초 (1 ~ 604800)
  /** 서명에 넣을 헤더. host 는 자동. 요청 때 똑같이 보내야 합니다 */
  signedHeaders?: Record<string, string>;
  /** 추가 쿼리 (response-content-disposition 등). 서명에 포함됩니다 */
  query?: Record<string, string>;
  now?: Date;
}

const sha256hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest();

/** RFC 3986 — 비예약 문자(A-Z a-z 0-9 - _ . ~)만 그대로 둡니다 */
export function uriEncode(s: string, keepSlash = false): string {
  let out = '';
  for (const ch of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** 서명 키: kDate → kRegion → kService → kSigning */
export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export function amzDate(d: Date): { amz: string; day: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20130524T000000Z
  return { amz: iso, day: iso.slice(0, 8) };
}

export function canonicalQuery(q: Record<string, string>): string {
  return Object.keys(q)
    .map((k) => [uriEncode(k), uriEncode(q[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
}

/** 서명된 URL 과 서명 과정의 중간값(시험용)을 돌려줍니다 */
export function presign(input: PresignInput): {
  url: string; canonicalRequest: string; stringToSign: string; signature: string;
} {
  const service = input.service ?? 's3';
  if (!(input.expiresIn >= 1 && input.expiresIn <= 604800)) {
    throw new Error('expiresIn 은 1 ~ 604800 초입니다');
  }
  const u = new URL(input.url);
  const { amz, day } = amzDate(input.now ?? new Date());
  const scope = `${day}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: u.host };
  for (const [k, v] of Object.entries(input.signedHeaders ?? {})) {
    headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');

  const q: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(Math.floor(input.expiresIn)),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  /* S3 는 세션 토큰을 서명 **안에** 넣습니다 (임시 자격 · 인스턴스 역할) */
  if (input.credentials.sessionToken) q['X-Amz-Security-Token'] = input.credentials.sessionToken;

  /* S3 경로는 한 번만 인코딩합니다(다른 서비스와 다름). 이미 인코딩된 pathname 을 풀어 다시 씁니다 */
  const path = uriEncode(decodeURIComponent(u.pathname || '/'), true);
  const cq = canonicalQuery(q);
  const canonicalRequest = [
    input.method, path, cq,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.credentials.secretAccessKey, day, input.region, service))
    .update(stringToSign, 'utf8').digest('hex');

  const url = `${u.protocol}//${u.host}${path}?${cq}&X-Amz-Signature=${signature}`;
  return { url, canonicalRequest, stringToSign, signature };
}
