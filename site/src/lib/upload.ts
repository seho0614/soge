/**
 * 파일 올리기 (브라우저 전용) — D007.
 *
 *   1. POST /api/v1/files            올릴 자리 · 주소 받기
 *   2. PUT  uploadUrl                바이트 (S3 면 S3 로 직접, 개발이면 API 토큰 주소)
 *   3. POST /api/v1/files/{id}/complete  서버가 크기 · 해시 · 형식을 확인 → READY
 *
 * ★ 해시(SHA-256)를 미리 계산해 보냅니다. 올리는 중 바뀌면 서버가 거절합니다.
 * ★ 형식은 서버가 파일 앞부분(매직바이트)으로 다시 판정합니다 — 확장자만 바꾼 파일은 거절됩니다.
 */
export type UploadPurpose = 'OWNERSHIP_DOC' | 'MARKETING_MATERIAL' | 'PARTNER_GUIDE' | 'LISTING_IMAGE' | 'REQUEST_IMAGE' | 'BROKER_DOC'   // v10.31 (w2) — 매물 · 요청 사진 · 중개 서류
  | 'INQUIRY_ATTACHMENT'   // v10.31 (w1) — 고객센터 문의 첨부
  | 'PARTNER_MEDIA';       /* v10.31 (W5) — 파트너 사진 · 로고 */
export interface Uploaded { fileId: string; name: string; contentType: string; size: number }

export class UploadError extends Error {
  constructor(message: string, readonly status = 0, readonly code?: string) { super(message); }
}

/** 브라우저가 비워 두거나 엉뚱하게 주는 형식을 확장자로 보완합니다 (최종 판정은 서버) */
export function guessType(f: File): string {
  if (f.type && f.type !== 'application/octet-stream') return f.type === 'image/jpg' ? 'image/jpeg' : f.type;
  const ext = f.name.toLowerCase().split('.').pop();
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }   // 보안 컨텍스트가 아니면 생략 — 서버가 계산합니다
}

async function json(r: Response) { return (await r.json().catch(() => null)) as { code?: string; message?: string } | null; }

export async function uploadFile(file: File, purpose: UploadPurpose, onStep?: (s: string) => void,
                                 base = '/api/v1'): Promise<Uploaded> {
  const contentType = guessType(file);
  onStep?.('파일을 확인하는 중…');
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);

  const r1 = await fetch(`${base}/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose, name: file.name, contentType, size: file.size, sha256 }),
  });
  const d1 = (await json(r1)) as (null | { fileId: string; uploadUrl: string; method: string; headers: Record<string, string>;
    code?: string; message?: string });
  if (!r1.ok || !d1?.fileId) throw new UploadError(d1?.message ?? '올릴 준비를 하지 못했습니다.', r1.status, d1?.code);

  onStep?.('올리는 중…');
  const r2 = await fetch(d1.uploadUrl, { method: d1.method || 'PUT', headers: d1.headers, body: buf });
  if (!r2.ok) {
    const e = await json(r2);
    throw new UploadError(e?.message ?? `파일을 올리지 못했습니다 (${r2.status}).`, r2.status, e?.code);
  }

  onStep?.('서버가 파일을 확인하는 중…');
  const r3 = await fetch(`${base}/files/${d1.fileId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const d3 = (await json(r3)) as (null | { fileId: string; name: string; contentType: string; size: number; code?: string; message?: string });
  if (!r3.ok || !d3?.fileId) throw new UploadError(d3?.message ?? '파일 확인에 실패했습니다.', r3.status, d3?.code);
  return { fileId: d3.fileId, name: d3.name, contentType: d3.contentType, size: d3.size };
}

/**
 * 파일 열기 — 5분짜리 주소를 받아 엽니다.
 * 팝업 차단을 피하려고 **누른 순간** 빈 창을 먼저 열고, 주소가 오면 그 창을 옮깁니다.
 */
export async function openFile(fileId: string, inline = false, base = '/api/v1'): Promise<void> {
  const w = inline ? window.open('', '_blank') : null;
  const r = await fetch(`${base}/files/${fileId}${inline ? '?disposition=inline' : ''}`);
  const d = (await r.json().catch(() => null)) as { url?: string; code?: string; message?: string } | null;
  if (!r.ok || !d?.url) { w?.close(); throw new UploadError(d?.message ?? '파일을 열지 못했습니다.', r.status, d?.code); }
  if (w) w.location.href = d.url; else window.location.assign(d.url);
}

export const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;
