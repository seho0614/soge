/* ---------------------------------------------------------------------
 * v10.374 (D240 · docs/509) — 운영 적용 확인표 항목 읽기
 *   절차서 4-1 표(| # | 곳 (정확한 위치) | 맞으면 |)를 붙여 넣으면 줄마다 「곳 — 맞으면」 한 항목.
 *   머리 줄 · 구분 줄(|---|) · 빈 줄은 뺌 · 표가 아니면 한 줄 = 한 항목 · 굵게(**) · 꺾쇠 따옴표 그대로 · 400자까지.
 * ------------------------------------------------------------------- */
export function parseApplyItems(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (!cells.length || cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (cells[0] === '#' || cells.some((c) => c === '맞으면')) continue;   // 머리 줄
      const body = /^\d+$/.test(cells[0] ?? '') ? cells.slice(1) : cells;
      const t = body.filter(Boolean).join(' — ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2) out.push(t.slice(0, 400));
    } else {
      const t = line.replace(/^[-*·\d.)\s]+/, '').replace(/\*\*/g, '').trim();
      if (t.length >= 2) out.push(t.slice(0, 400));
    }
  }
  return out;
}
