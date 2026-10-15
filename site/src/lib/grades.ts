import { apiGet } from '@/lib/api';

/** v10.31 — 등급 이름(골든 · 실버 · 브론즈 — 가칭)은 코드 라벨 정본(GET /codes 의 listing.grade)에서 */
export async function gradeLabels(): Promise<Record<string, string>> {
  const c = await apiGet<{ domains: Record<string, Array<{ code: string; label: string }>> }>('/codes', 300).catch(() => null);
  return Object.fromEntries((c?.domains?.['listing.grade'] ?? []).map((x) => [x.code, x.label]));
}
