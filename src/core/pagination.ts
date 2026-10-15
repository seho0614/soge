/**
 * 커서 페이지네이션. offset 은 쓰지 않습니다 —
 * 목록이 계속 갱신되는 화면에서 offset 은 항목을 건너뛰거나 중복시킵니다.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(v: { sortValue: string | number | Date; id: string }): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

export function decodeCursor(c?: string): { sortValue: string; id: string } | null {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  } catch {
    return null;   // 잘못된 커서는 첫 페이지로 — 400 을 던질 만한 일이 아닙니다
  }
}

export function toPage<T extends { id: string }>(
  rows: T[], limit: number, sortKey: keyof T,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ sortValue: last[sortKey] as any, id: last.id })
        : null,
  };
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const clampLimit = (n?: number) => Math.min(Math.max(n ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
