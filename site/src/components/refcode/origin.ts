import { headers } from 'next/headers';

/** 공유 주소의 도메인 — SITE_ORIGIN 이 있으면 그것, 없으면 지금 요청의 호스트(개발 · 스테이징 그대로 맞음).
 *  partners/links 의 소개링크와 같은 규칙입니다. */
export async function siteOrigin(): Promise<string> {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
