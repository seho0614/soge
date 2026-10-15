/**
 * 파일 저장소 시험 (오프라인) — D007.
 *
 *   1) SigV4 presign 이 AWS 공식 문서의 예시 값과 **글자 하나까지** 같은가
 *      - 쿼리 서명 예시: examplebucket/test.txt · 20130524T000000Z · 86400초 → aeeed9bb…
 *        https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 *      - 서명 키 파생 예시: 20120215 · us-east-1 · iam → f4780e2d…
 *        https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html (Derive a signing key)
 *   2) 자격 증명 순서 (환경변수 → ECS 태스크 역할 → IMDSv2) · 만료 전 갱신
 *   3) 저장 키 · 로컬 경로가 저장소 밖으로 못 나가는가 (경로 조작)
 *   4) 매직바이트 판정 · 파일 이름 정리 · 토큰(동작 · 파일 · 만료 묶임)
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-s3-presign-offline.ts
 */
import { presign, signingKey, canonicalQuery } from '../src/modules/file/sigv4';
import { AwsCredentialChain, LocalStorage, S3Storage, signToken, verifyToken } from '../src/modules/file/storage';
import { sanitizeName, sniff, contentDisposition } from '../src/modules/file/sniff';

process.env.JWT_SECRET ??= 'offline-test-secret-0123456789abcdef';
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${label}${ok ? '' : '  — ' + JSON.stringify(detail)}`);
};
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

(async () => {
  console.log('── 1. SigV4 공식 예시 ──');
  const doc = presign({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    expiresIn: 86400, now: new Date('2013-05-24T00:00:00Z'),
  });
  check('presigned GET 서명 = 문서 값 aeeed9bb…', doc.signature === 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404', doc.signature);
  check('정규 요청 = 문서 값', doc.canonicalRequest === [
    'GET', '/test.txt',
    'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
    'host:examplebucket.s3.amazonaws.com', '', 'host', 'UNSIGNED-PAYLOAD'].join('\n'), doc.canonicalRequest);
  check('URL 끝에 서명', doc.url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&')
    && doc.url.endsWith('&X-Amz-Signature=' + doc.signature), doc.url);
  check('서명 키 파생 = 문서 값 f4780e2d…',
    signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex')
      === 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  check('쿼리 인코딩 RFC3986 (공백 %20 · * %2A · 한글 UTF-8)',
    canonicalQuery({ b: 'a b*', a: '등' }) === 'a=%EB%93%B1&b=a%20b%2A', canonicalQuery({ b: 'a b*', a: '등' }));
  const tok = presign({ method: 'PUT', url: 'https://b.s3.ap-northeast-2.amazonaws.com/k.pdf', region: 'ap-northeast-2',
    credentials: { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 'tok/+=' }, expiresIn: 600,
    signedHeaders: { 'Content-Type': 'application/pdf', 'Content-Length': '1234' } });
  check('세션 토큰이 서명 안에 · 헤더 서명 목록 정렬',
    tok.canonicalRequest.includes('X-Amz-Security-Token=tok%2F%2B%3D') &&
    tok.canonicalRequest.includes('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost') &&
    tok.canonicalRequest.includes('content-length:1234\ncontent-type:application/pdf\nhost:b.s3.ap-northeast-2.amazonaws.com\n'),
    tok.canonicalRequest);
  check('유효시간 범위 밖 거절 (0초 · 8일)', throws(() => presign({ ...({} as any), method: 'GET', url: 'https://a/b', region: 'r',
    credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, expiresIn: 0 })) &&
    throws(() => presign({ method: 'GET', url: 'https://a/b', region: 'r', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, expiresIn: 604801 })));

  console.log('── 2. 자격 증명 순서 ──');
  const calls: string[] = [];
  const fake = (routes: Record<string, any>) => async (url: string, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    const v = routes[`${init.method ?? 'GET'} ${url}`];
    if (v === undefined) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return { ok: true, status: 200, text: async () => (typeof v === 'string' ? v : JSON.stringify(v)), json: async () => v };
  };
  const envC = await new AwsCredentialChain({ AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK', AWS_SESSION_TOKEN: 'ST' } as any, fake({})).get();
  check('① 환경변수', envC.accessKeyId === 'AK' && envC.sessionToken === 'ST' && calls.length === 0);
  const later = new Date(Date.now() + 3600_000).toISOString();
  const ecs = await new AwsCredentialChain({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc' } as any,
    fake({ 'GET http://169.254.170.2/v2/credentials/abc': { AccessKeyId: 'EK', SecretAccessKey: 'ES', Token: 'ET', Expiration: later } })).get();
  check('② ECS 태스크 역할 (169.254.170.2 + 상대 URI)', ecs.accessKeyId === 'EK' && ecs.sessionToken === 'ET', ecs);
  calls.length = 0;
  const base = 'http://imds.test';
  const soon = new Date(Date.now() + 60_000).toISOString();   // 5분 안에 만료 → 다음 호출에서 다시 받음
  const imdsRoutes = {
    [`PUT ${base}/latest/api/token`]: 'TKN',
    [`GET ${base}/latest/meta-data/iam/security-credentials/`]: 'sgb-api-role\n',
    [`GET ${base}/latest/meta-data/iam/security-credentials/sgb-api-role`]: { AccessKeyId: 'IK', SecretAccessKey: 'IS', Token: 'IT', Expiration: soon },
  };
  const chain = new AwsCredentialChain({ AWS_EC2_METADATA_SERVICE_ENDPOINT: base } as any, fake(imdsRoutes));
  const im = await chain.get();
  check('③ IMDSv2 (토큰 PUT → 역할 이름 → 자격)', im.accessKeyId === 'IK' && calls[0] === `PUT ${base}/latest/api/token` && calls.length === 3, calls);
  await chain.get();
  check('   만료 5분 전이면 다시 받음', calls.length === 6, calls.length);
  const noCred = await new AwsCredentialChain({ AWS_EC2_METADATA_DISABLED: 'true' } as any, fake({})).get().then(() => false, () => true);
  check('   자격이 없으면 실패 (조용히 통과하지 않음)', noCred);

  console.log('── 3. 저장 키 · 경로 ──');
  const s3 = new S3Storage({ S3_BUCKET: 'sgb-files', AWS_REGION: 'ap-northeast-2', AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK' } as any);
  const key = 'ownership_doc/2026/10/0b0e7a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b.pdf';
  check('가상 호스트 주소', s3.objectUrl(key) === `https://sgb-files.s3.ap-northeast-2.amazonaws.com/${key}`, s3.objectUrl(key));
  const s3p = new S3Storage({ S3_BUCKET: 'b', S3_ENDPOINT: 'http://127.0.0.1:9', S3_FORCE_PATH_STYLE: '1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } as any);
  check('경로 방식 (S3_ENDPOINT · S3_FORCE_PATH_STYLE)', s3p.objectUrl(key) === `http://127.0.0.1:9/b/${key}`);
  for (const bad of ['../etc/passwd', 'ownership_doc/2026/10/../../x.pdf', '/abs/x.pdf', 'ownership_doc/2026/10/a b.pdf',
                     'ownership_doc\\2026\\10\\0b0e7a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b.pdf']) {
    check(`S3 키 거절 ${JSON.stringify(bad)}`, throws(() => s3.objectUrl(bad)));
  }
  const up = await s3.uploadTarget({ key, contentType: 'application/pdf', size: 1234 }, 600);
  const q = new URL(up.url).searchParams;
  check('PUT 주소: Content-Type · Content-Length 서명, 10분', q.get('X-Amz-SignedHeaders') === 'content-length;content-type;host'
    && q.get('X-Amz-Expires') === '600' && up.headers['Content-Type'] === 'application/pdf', up.url);
  const dn = await s3.downloadTarget({ key, contentType: 'application/pdf', disposition: contentDisposition('attachment', '등기부 (1).pdf') }, 300);
  const dq = new URL(dn.url).searchParams;
  check('GET 주소: response-content-disposition 에 한글 이름(RFC5987) · 5분',
    dq.get('response-content-disposition') === `attachment; filename="___ (1).pdf"; filename*=UTF-8''%EB%93%B1%EA%B8%B0%EB%B6%80%20%281%29.pdf`
    && dq.get('X-Amz-Expires') === '300', dq.get('response-content-disposition'));

  const local = new LocalStorage('/tmp/sgb-upload-test');
  check('로컬 경로는 루트 안', local.pathOf(key) === `/tmp/sgb-upload-test/${key}`);
  for (const bad of ['../x', 'ownership_doc/2026/10/../../../etc/passwd.pdf', '/etc/passwd']) {
    check(`로컬 키 거절 ${JSON.stringify(bad)}`, throws(() => local.pathOf(bad)));
  }

  console.log('── 4. 판정 · 이름 · 토큰 ──');
  check('PDF', sniff(Buffer.from('%PDF-1.7\n')) === 'application/pdf');
  check('JPG', sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])) === 'image/jpeg');
  check('PNG', sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])) === 'image/png');
  check('MP4 (isom)', sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom\0\0\0\0')])) === 'video/mp4');
  check('QuickTime 은 MP4 아님', sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  \0\0\0\0')])) === null);
  check('HTML 은 판정 불가', sniff(Buffer.from('<html><script>alert(1)</script>')) === null);
  check('SVG 는 판정 불가', sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')) === null);
  check('경로 버림', sanitizeName('../../etc/passwd', 'pdf') === 'passwd.pdf', sanitizeName('../../etc/passwd', 'pdf'));
  check('역슬래시 경로 버림', sanitizeName('C:\\Users\\a\\등기부.pdf', 'pdf') === '등기부.pdf');
  check('이중 확장자 → 판정 형식', sanitizeName('invoice.pdf.html', 'pdf') === 'invoice.pdf.pdf' && sanitizeName('a.exe', 'png') === 'a.png');
  check('방향 바꿈 문자 제거', sanitizeName('abc\u202Egpj.exe', 'jpg') === 'abcgpj.jpg', sanitizeName('abc\u202Egpj.exe', 'jpg'));
  check('제어문자 · 금지문자', sanitizeName('a\u0000b<c>:"|?*.pdf', 'pdf') === 'ab_c______.pdf', sanitizeName('a\u0000b<c>:"|?*.pdf', 'pdf'));
  check('빈 이름 · 점만', sanitizeName('...', 'pdf') === 'file.pdf' && sanitizeName('', 'png') === 'file.png');
  check('긴 이름 120자', Array.from(sanitizeName('가'.repeat(300) + '.pdf', 'pdf')).length === 124);
  const id = '0b0e7a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
  const t = signToken('put', id, 600);
  check('토큰 정상', verifyToken('put', id, t) === 'OK');
  check('다른 동작(get)에 못 씀', verifyToken('get', id, t) === 'INVALID');
  check('다른 파일에 못 씀', verifyToken('put', id.replace('0b', '0c'), t) === 'INVALID');
  check('만료', verifyToken('put', id, signToken('put', id, 1, Date.now() - 10_000)) === 'EXPIRED');
  check('만료 시각만 고치면 무효', verifyToken('put', id, t.replace(/^\d+/, (m) => String(Number(m) + 9999))) === 'INVALID');
  check('형식 틀림 · 비어 있음', verifyToken('put', id, 'x') === 'INVALID' && verifyToken('put', id, undefined) === 'INVALID');

  console.log(`\n통과 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
