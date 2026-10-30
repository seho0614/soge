import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/* ---------------------------------------------------------------------
 * v10.141 (D137 · docs/214 · 설계 docs/213) — NICE 본인확인 표준창 연결
 *
 * ⚠ 공개 자료(NICE API 본인확인 표준창 안내) 기준입니다. 계약 뒤 받는 개발 안내서와 주소 · 칸 이름 · 암호화 방식이 다르면
 *   **이 파일만** 고칩니다(서비스 · 화면은 이 파일이 돌려주는 모양만 씀).
 *
 *   ① 기관 토큰    POST {base}/digital/niceid/oauth/oauth/token  (Basic client_id:client_secret · grant_type=client_credentials)
 *   ② 암호화 토큰  POST {base}/digital/niceid/api/v1.0/common/crypto/token  (bearer base64(access_token:현재초:client_id) · ProductID)
 *                  → token_version_id · token_val · site_code
 *   ③ 열쇠 만들기  base64(sha256(req_dtim + req_no + token_val)) → 앞 16 = 대칭키 · 뒤 16 = IV · 앞 32 = 무결성 키
 *   ④ 요청 자료    JSON → AES-128-CBC(PKCS7) → base64 = enc_data · HMAC-SHA256(무결성 키, enc_data) → base64 = integrity_value
 *   ⑤ 표준창       {window} 로 m=service · token_version_id · enc_data · integrity_value 를 보냄(같은 창 · GET 으로 돌아옴)
 *   ⑥ 돌아온 자료  무결성 확인 → 복호화 → resultcode 0000 · requestno 대조 → ci · name · birthdate …
 *
 * MOCK(점검판)은 ②만 우리가 흉내(token_val 을 임의로)내고 ③ ~ ⑥은 같은 코드를 씁니다 — 가짜 표준창도 같은 암호로 돌려보냄.
 * ------------------------------------------------------------------- */

export const NICE_API_BASE = () => (process.env.NICE_API_BASE?.trim() || 'https://svc.niceapi.co.kr:22001').replace(/\/+$/, '');
export const NICE_WINDOW_URL = () => process.env.NICE_WINDOW_URL?.trim() || 'https://nice.checkplus.co.kr/CheckPlusSafeModel/service.cb';
const TIMEOUT_MS = () => Math.min(Math.max(Number(process.env.NICE_TIMEOUT_MS) || 8000, 1000), 30000);

export interface NiceSession { tokenVersionId: string; key: string; iv: string; hmacKey: string; siteCode: string }
export interface NiceWindow { url: string; method: 'POST' | 'GET'; fields: Record<string, string> }
export interface NiceResult {
  resultCode: string; requestNo: string; ci: string | null; name: string | null; birthdate: string | null;
  gender: string | null; nationalInfo: string | null;
}

/** ③ 열쇠 만들기 */
export function deriveKeys(reqDtim: string, reqNo: string, tokenVal: string) {
  const r = createHash('sha256').update(reqDtim.trim() + reqNo.trim() + tokenVal.trim()).digest('base64');
  return { key: r.slice(0, 16), iv: r.slice(-16), hmacKey: r.slice(0, 32) };
}

export function encrypt(s: NiceSession, plain: string): { encData: string; integrity: string } {
  const c = createCipheriv('aes-128-cbc', Buffer.from(s.key, 'utf8'), Buffer.from(s.iv, 'utf8'));
  const encData = Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
  return { encData, integrity: hmac(s, encData) };
}

function hmac(s: NiceSession, encData: string) {
  return createHmac('sha256', Buffer.from(s.hmacKey, 'utf8')).update(encData, 'utf8').digest('base64');
}

/** ⑥ 무결성 확인 · 복호화 — 틀리면 null(까닭은 부르는 쪽이 INTEGRITY 로 기록) */
export function decrypt(s: NiceSession, encData: string, integrity: string): string | null {
  const want = Buffer.from(hmac(s, encData)); const got = Buffer.from(String(integrity ?? ''));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const d = createDecipheriv('aes-128-cbc', Buffer.from(s.key, 'utf8'), Buffer.from(s.iv, 'utf8'));
    return Buffer.concat([d.update(Buffer.from(encData, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

/** 돌아온 JSON → 우리가 쓰는 칸. 이름은 utf8_name(URL 인코딩) 먼저 */
export function parseResult(json: string): NiceResult | null {
  let d: any;
  try { d = JSON.parse(json); } catch { return null; }
  const dec = (v: unknown) => { if (typeof v !== 'string' || !v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  return {
    resultCode: String(d.resultcode ?? ''), requestNo: String(d.requestno ?? ''),
    ci: typeof d.ci === 'string' && d.ci ? d.ci : null, name: dec(d.utf8_name) ?? dec(d.name),
    birthdate: typeof d.birthdate === 'string' && /^\d{8}$/.test(d.birthdate) ? d.birthdate : null,
    gender: d.gender != null ? String(d.gender) : null, nationalInfo: d.nationalinfo != null ? String(d.nationalinfo) : null,
  };
}

/** 요청 시각 YYYYMMDDHHmmss(서울) */
export function reqDtim(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14);
}

/** 요청 번호 — 영문 · 숫자 30자(표준창 칸 길이 안) */
export function newReqNo() { return 'SGB' + randomBytes(14).toString('hex').slice(0, 27).toUpperCase(); }

async function post(url: string, headers: Record<string, string>, body: string) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT_MS());
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ac.signal });
    const text = await r.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* 아래에서 */ }
    if (!r.ok || !j) throw new Error(`NICE ${r.status}`);
    return j;
  } finally { clearTimeout(t); }
}

/** 기관 토큰 — 유효 기간이 길어 띄운 동안 보관(실패하면 다음에 다시) */
let accessToken: { v: string; id: string } | null = null;
async function orgToken(clientId: string, secret: string) {
  if (accessToken && accessToken.id === clientId) return accessToken.v;
  const j = await post(`${NICE_API_BASE()}/digital/niceid/oauth/oauth/token`, {
    'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
  }, 'grant_type=client_credentials&scope=default');
  const v = j?.dataBody?.access_token;
  if (typeof v !== 'string' || !v) throw new Error('NICE 기관 토큰 없음');
  accessToken = { v, id: clientId };
  return v;
}

/** v10.153 — 키 확인 전에 보관한 기관 토큰을 버림 */
export function resetNiceToken() { accessToken = null; }

/** ② 암호화 토큰 (NICE) */
export async function niceCryptoToken(reqNo: string, dtim: string) {
  const clientId = process.env.NICE_CLIENT_ID?.trim() ?? ''; const secret = process.env.NICE_CLIENT_SECRET?.trim() ?? '';
  const productId = process.env.NICE_PRODUCT_ID?.trim() ?? '';
  if (!clientId || !secret || !productId) throw new Error('NICE 키 없음');
  const tok = await orgToken(clientId, secret);
  const now = Math.floor(Date.now() / 1000);
  const j = await post(`${NICE_API_BASE()}/digital/niceid/api/v1.0/common/crypto/token`, {
    'Content-Type': 'application/json', ProductID: productId,
    Authorization: 'bearer ' + Buffer.from(`${tok}:${now}:${clientId}`).toString('base64'),
  }, JSON.stringify({ dataHeader: { CNTY_CD: 'ko' }, dataBody: { req_dtim: dtim, req_no: reqNo, enc_mode: '1' } }));
  const b = j?.dataBody ?? {};
  if ((b.rsp_cd && b.rsp_cd !== 'P000') || (b.result_cd && b.result_cd !== '0000')) throw new Error('NICE 암호화 토큰 실패');
  if (!b.token_version_id || !b.token_val || !b.site_code) throw new Error('NICE 암호화 토큰 칸 없음');
  return { tokenVersionId: String(b.token_version_id), tokenVal: String(b.token_val), siteCode: String(b.site_code) };
}

/** ② 흉내 (MOCK — 밖으로 나가지 않음) */
export function mockCryptoToken() {
  return { tokenVersionId: 'MOCK' + randomBytes(8).toString('hex').toUpperCase(), tokenVal: randomBytes(24).toString('base64'), siteCode: 'MOCKSITE' };
}

/** ④ 표준창에 넘길 요청 자료 */
export function requestData(s: NiceSession, reqNo: string, returnUrl: string) {
  return JSON.stringify({ requestno: reqNo, returnurl: returnUrl, sitecode: s.siteCode, authtype: 'M', methodtype: 'get', popupyn: 'N', receivedata: '' });
}
