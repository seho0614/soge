/* ===== v10.468 (D264 · docs/606) 문서 PDF(인쇄) — web/src/lib/printDoc.ts 새 파일 =====
 * 대표 11/20 「㉝ ③ 문서 PDF 내려받기 — 서버 PDF 라이브러리 설치 없이 인쇄용 화면 + @media print」.
 *   openPrint({ title, body, kind, sign }) — 새 창에 A4 인쇄용 문서를 그리고 위에 「PDF 로 저장」 · 「인쇄」 단추 · 짧은 안내를 둠(인쇄할 때는 숨김).
 *   「PDF 로 저장」 = 브라우저 인쇄 창(window.print)에서 대상(프린터)을 「PDF로 저장」으로 고르는 것 — 크롬 · 엣지 · 사파리 모두 같은 길.
 *   창 제목(document.title)이 저장할 파일 이름으로 들어감(예: Q-2611-0001 · 급여명세서_2026-11_홍길동).
 *   쓰는 곳: Erp.tsx printHtml(견적서 · 주문서 · 거래명세서 · 발주서) · Hr.tsx printSlip(급여명세서 — 관리 쪽 · 내 인사).
 *   팝업이 막히면 false — 부른 쪽이 안내.
 * 색은 인쇄용 새 창이라 운영 화면 토큰을 쓰지 않고 이름 색(black · dimgray …)만 · 글자 12 · 13 · 14 · 18 · 24px.
 */

export type PrintKind = 'SALES' | 'PO' | 'PAYSLIP' | 'OTHER';
export interface PrintOpts { title: string; body: string; kind?: PrintKind; sign?: string }

const escT = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const PRINT_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif; margin: 0; color: black; background: white; font-size: 13px; }
  .sheet { max-width: 186mm; margin: 0 auto; padding: 16px 0 24px; }
  h1 { font-size: 24px; text-align: center; letter-spacing: 8px; margin: 4px 0 14px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid dimgray; padding: 4px 6px; font-size: 12px; vertical-align: top; }
  th { background: whitesmoke; }
  .r { text-align: right; }
  .meta td { border: none; padding: 2px 4px; font-size: 13px; }
  .sum { font-weight: bold; }
  .total td { font-size: 14px; }
  .cols { display: flex; gap: 8px; } .cols > table { flex: 1; }
  .small { font-size: 12px; color: dimgray; }
  .sign { margin-top: 18px; display: flex; justify-content: flex-end; gap: 8px; font-size: 13px; }
  .sign .box { width: 72px; height: 72px; border: 1px solid dimgray; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: gray; }
  .foot { margin-top: 18px; font-size: 12px; color: gray; text-align: center; }
  .bar { position: sticky; top: 0; background: white; border-bottom: 1px solid lightgray; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .bar button { font-size: 14px; padding: 8px 14px; border: 1px solid dimgray; background: white; border-radius: 7px; cursor: pointer; }
  .bar button.main { background: black; color: white; border-color: black; }
  .bar .guide { font-size: 12px; color: dimgray; flex-basis: 100%; }
  @media (max-width: 640px) { .cols { display: block; } }
  @media print { .bar { display: none !important; } .sheet { padding: 0; max-width: none; } a { color: black; text-decoration: none; } }
`;

const GUIDE: Record<PrintKind, string> = {
  SALES: '견적서 · 거래명세서',
  PO: '발주서',
  PAYSLIP: '급여명세서(개인 정보 — 저장한 파일은 본인에게만 전달)',
  OTHER: '문서',
};

/** 인쇄용 새 창 — 팝업이 막히면 false */
export function openPrint(o: PrintOpts): boolean {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  const kind = o.kind ?? 'OTHER';
  const sign = o.sign ? `<div class="sign"><span>${escT(o.sign)}</span><span class="box">(인)</span></div>` : '';
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escT(o.title)}</title><style>${PRINT_CSS}</style></head><body>
    <div class="bar" data-print-bar="${kind}">
      <button class="main" type="button" data-print-pdf="" onclick="window.print()">PDF 로 저장</button>
      <button type="button" data-print-paper="" onclick="window.print()">인쇄</button>
      <button type="button" onclick="window.close()">닫기</button>
      <span class="guide" data-print-guide="">${escT(GUIDE[kind])} — 「PDF 로 저장」을 누르고 인쇄 창의 <b>대상(프린터)</b>을 <b>「PDF로 저장」</b>으로 고른 뒤 저장하십시오. 용지 A4 · 여백 기본 · 「배경 그래픽」을 켜면 머리 칸 바탕이 함께 나옵니다. 파일 이름은 「${escT(o.title)}」.</span>
    </div>
    <div class="sheet" data-print-sheet="${kind}">${o.body}${sign}<p class="foot">출력 ${escT(stamp)} · 소개뱅크 운영 화면</p></div>
  </body></html>`);
  w.document.close();
  w.focus();
  return true;
}
