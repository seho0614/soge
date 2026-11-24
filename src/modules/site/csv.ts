/* v10.738 · 743 (docs/846 · 851) CSV — 엑셀이 한글을 읽게 BOM · 칸에 쉼표 · 따옴표 · 줄바꿈이면 따옴표로 감쌈 · =,+,-,@ 로 시작하면 앞에 ' (수식 막음) */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
