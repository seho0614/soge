'use client';

/**
 * v10.532 (D281 · docs/670) 판매자센터 월 정산서 「인쇄 · PDF 저장」 단추 — 브라우저 인쇄 창(대상 「PDF로 저장」)
 *   글자는 서버 화면이 넘김(사전 묶음을 브라우저로 따로 보내지 않음)
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="hlt-btn slx-noprint" data-slx-print="" onClick={() => window.print()}>{label}</button>
  );
}
