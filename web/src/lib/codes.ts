/**
 * 코드 라벨.
 *
 * 부팅 시 한 번 받고 로컬에서 씁니다. 화면마다 조회하지 않습니다.
 * 라벨을 하드코딩하면 "노출 중"을 "게시 중"으로 바꾸는 데 배포가 필요해집니다.
 */
import { api } from './api';

export interface CodeEntry {
  code: string;
  label: string;
  shortLabel?: string | null;
  tone?: string | null;
}
type Bundle = { audience: string; domains: Record<string, CodeEntry[]> };

let bundle: Bundle | null = null;

export async function loadCodes(audience: 'USER' | 'ADMIN' = 'USER') {
  bundle = await api<Bundle>(`/codes?audience=${audience}`);
  return bundle;
}

export function codeList(domain: string): CodeEntry[] {
  return bundle?.domains[domain] ?? [];
}

/**
 * 미등록 코드는 코드 자체를 돌려주되 콘솔에 남깁니다.
 * 화면에 영문이 나가는 것을 개발 중에 잡기 위해서입니다.
 */
export function label(domain: string, code: string | null | undefined): string {
  if (!code) return '';
  const hit = bundle?.domains[domain]?.find((c) => c.code === code);
  if (!hit) {
    console.warn(`[CODE_LABEL_MISSING] ${domain}.${code}`);
    return code;
  }
  return hit.label;
}

export function tone(domain: string, code: string | null | undefined): string {
  const hit = code ? bundle?.domains[domain]?.find((c) => c.code === code) : null;
  return hit?.tone ?? 'neutral';
}
