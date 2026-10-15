/**
 * 형식 판정 — 실제 바이트(매직 넘버)로 봅니다.
 *
 * ★ 브라우저가 보내는 Content-Type 과 파일 이름의 확장자는 **올리는 사람이 정합니다.**
 *   `등기부.pdf` 라는 이름의 HTML 을 올리고 운영 화면에서 열면 우리 도메인에서 스크립트가 돕니다.
 *   그래서 complete 때 서버가 앞부분을 직접 읽어 정합니다.
 */
export function sniff(head: Buffer): string | null {
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  /* MP4 (ISO BMFF): [크기 4바이트]['ftyp'][브랜드 4바이트]. QuickTime('qt  ')은 받지 않습니다 */
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1');
    if (/^(isom|iso[2-9]|mp41|mp42|avc1|dash|M4V |MSNV|f4v )$/.test(brand)) return 'video/mp4';
  }
  return null;
}

/** 판정에 필요한 앞부분 길이 */
export const SNIFF_BYTES = 16;

export const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'video/mp4': 'MP4',
};

/**
 * 보여 줄 파일 이름을 정리합니다. 저장 위치에는 **쓰지 않습니다**(키는 서버가 만든 uuid).
 *   - 경로 부분(… / \)을 버리고 마지막 이름만
 *   - 제어문자 · 방향 바꿈 문자(파일명 위장: "fdp.exe" 처럼 보이게) 제거
 *   - 윈도우 금지 문자 <>:"|?* → _
 *   - 확장자는 **판정한 형식의 것**으로 맞춤 (`a.pdf.html` 같은 이중 확장자 무력화)
 */
export function sanitizeName(raw: string, ext: string): string {
  let s = String(raw ?? '').normalize('NFC');
  s = s.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  s = s.replace(/[<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  /* 확장자를 떼고 정해진 것으로 붙입니다 */
  const dot = s.lastIndexOf('.');
  let base = dot > 0 ? s.slice(0, dot) : s;
  base = base.replace(/[.\s]+$/g, '');
  const cps = Array.from(base);
  if (cps.length > 120) base = cps.slice(0, 120).join('').trim();
  if (!base) base = 'file';
  return `${base}.${ext}`;
}

/** Content-Disposition — 한글 이름은 RFC 5987(filename*) 로, 옛 브라우저용 ASCII 대체 이름도 함께 */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}
