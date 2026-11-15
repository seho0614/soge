/* ---------------------------------------------------------------------
 * v10.310 (docs/433) — 입점 약관(HLT_SELLER) 제17조 2항 요율 표 ↔ 운영 「입점 유형 요율」(hlt_seller_type_rates) 대조
 *
 *   약관 본문 「제17조」 ~ 「제18조」 사이의 표 줄 `| 브랜드 직영관 | 12% |` · `| 일반 입점 | 〔 〕% |` 를 읽어
 *   유형마다 약관 값과 지금 요율(예정 예약이 있으면 그 값도)을 견줍니다. 읽기만 — 글 · 요율을 바꾸지 않음.
 * ------------------------------------------------------------------- */

export type RateSlotState = 'blank' | 'missing' | 'unset' | 'match' | 'scheduled' | 'mismatch';
export const RATE_TYPES = [
  { type: 'BRAND' as const, label: '브랜드 직영관' },
  { type: 'TENANT' as const, label: '일반 입점' },
];

/** 제17조 구간(제목 줄 「제17조」부터 다음 「제18조」 앞까지) — 없으면 '' */
export function article17(body: string): string {
  const s = String(body ?? '');
  const a = s.search(/(^|\n)[#\s]*제\s*17\s*조/);
  if (a < 0) return '';
  const rest = s.slice(a + 1);
  const b = rest.search(/\n[#\s]*제\s*18\s*조/);
  return b < 0 ? rest : rest.slice(0, b);
}

/** 표 줄의 요율 칸 — { text: 칸 글 · value: 숫자(빈칸 · 못 읽으면 null) · blank: 〔 〕 } · 줄이 없으면 null */
export function termRateCell(body: string, label: string): { text: string; value: number | null; blank: boolean } | null {
  const sec = article17(body);
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || cells[1] !== label) continue;
    const text = cells[2];
    const blank = /〔[^〕]*〕/.test(text);
    const m = blank ? null : text.match(/(\d+(?:\.\d+)?)\s*%/);
    return { text, value: m ? Number(m[1]) : null, blank };
  }
  return null;
}

export function slotState(cell: ReturnType<typeof termRateCell>, rate: number | null, scheduled: number | null): RateSlotState {
  if (!cell) return 'missing';
  if (cell.blank || cell.value === null) return 'blank';
  if (scheduled !== null && Math.abs(scheduled - cell.value) < 0.005) return 'scheduled';
  if (rate === null) return 'unset';
  return Math.abs(rate - cell.value) < 0.005 ? 'match' : 'mismatch';
}

export const SLOT_TEXT: Record<RateSlotState, string> = {
  blank: '약관 칸이 비어 있음(〔 〕)',
  missing: '약관 제17조 표에 이 줄이 없음',
  unset: '운영 요율이 비어 있음 — 갈래 요율을 씀',
  match: '같음',
  scheduled: '예정 예약 값과 같음 — 시행일부터 같아짐',
  mismatch: '다름',
};
