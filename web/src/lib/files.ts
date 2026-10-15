import { api, ApiFailure } from './api';

/**
 * 파일 올리기 · 열기 (운영 BO) — D007.
 *
 *   POST /files → PUT uploadUrl (S3 직접 또는 개발용 API 토큰 주소) → POST /files/{id}/complete
 *
 * 형식 · 크기 · 해시는 서버가 실제 바이트로 다시 봅니다. 여기 검사는 안내용입니다.
 */
export type Purpose = 'OWNERSHIP_DOC' | 'MARKETING_MATERIAL' | 'PARTNER_GUIDE' | 'PRODUCT_IMAGE';
export interface Uploaded { fileId: string; name: string; contentType: string; size: number }

export function guessType(f: File): string {
  if (f.type && f.type !== 'application/octet-stream') return f.type === 'image/jpg' ? 'image/jpeg' : f.type;
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' } as Record<string, string>)[ext]
    ?? 'application/octet-stream';
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

export async function uploadFile(file: File, purpose: Purpose): Promise<Uploaded> {
  const contentType = guessType(file);
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  const t = await api<{ fileId: string; uploadUrl: string; method: string; headers: Record<string, string> }>('/files', {
    method: 'POST', body: JSON.stringify({ purpose, name: file.name, contentType, size: file.size, sha256 }),
  });
  /* 올리기 주소는 그 자체가 권한입니다(서명 · 10분). 로그인 토큰을 붙이지 않습니다 — S3 로 새지 않게 */
  const r = await fetch(t.uploadUrl, { method: t.method || 'PUT', headers: t.headers, body: buf });
  if (!r.ok) {
    const b = await r.json().catch(() => ({ code: 'UPLOAD_FAILED', message: `파일을 올리지 못했습니다 (${r.status}).` }));
    throw new ApiFailure(r.status, b);
  }
  return api<Uploaded>(`/files/${t.fileId}/complete`, { method: 'POST', body: '{}' });
}

/** 5분짜리 주소를 받아 새 창으로 엽니다. 팝업 차단을 피하려고 빈 창을 먼저 엽니다 */
export async function openFile(fileId: string, inline = true): Promise<void> {
  const w = window.open('', '_blank');
  try {
    const d = await api<{ url: string }>(`/files/${fileId}${inline ? '?disposition=inline' : ''}`);
    if (w) w.location.href = d.url; else window.location.assign(d.url);
  } catch (e) { w?.close(); throw e; }
}

export const fmtSize = (n?: number | string | null) => {
  const v = Number(n ?? 0);
  return v >= 1048576 ? `${(v / 1048576).toFixed(1)}MB` : v >= 1024 ? `${Math.round(v / 1024)}KB` : `${v}B`;
};
export const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'video/mp4': 'MP4',
};

/**
 * 파일을 올리고 그 id 로 등록합니다. 등록이 실패하면 올린 파일을 치웁니다(DELETE /files/{id}) —
 * 쓰이지 않은 파일이 쌓이지 않게. 파일이 없으면 그냥 등록합니다.
 */
export async function withUpload<T>(file: File | null, purpose: Purpose, register: (fileId?: string) => Promise<T>): Promise<T> {
  const up = file ? await uploadFile(file, purpose) : null;
  try {
    return await register(up?.fileId);
  } catch (e) {
    if (up) await api(`/files/${up.fileId}`, { method: 'DELETE' }).catch(() => undefined);
    throw e;
  }
}
