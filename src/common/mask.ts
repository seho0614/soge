/**
 * 개인정보 가림 (v10.31 · 운영 화면).
 * 시안 표기 그대로: 이메일 kim****@example.com · 연락처 010-****-2280 · 사업자번호 215-81-33*** · 이름 김**.
 * 운영 화면에는 가린 값만 내보냅니다 — 찾기(검색)는 서버가 원래 값으로 합니다.
 */
export function maskEmail(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const at = v.indexOf('@');
  if (at < 0) return `${v.slice(0, 2)}****`;
  const id = v.slice(0, at);
  const keep = id.length <= 2 ? 1 : id.length <= 4 ? 2 : 3;
  return `${id.slice(0, keep)}****${v.slice(at)}`;
}

export function maskPhone(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const d = v.replace(/\D/g, '');
  if (d.length < 8) return '****';
  const head = d.startsWith('02') ? '02' : d.slice(0, 3);
  return `${head}-****-${d.slice(-4)}`;
}

/** 사업자등록번호 — 'tail' 215-81-33*** (회원 상세) · 'mid' 128-86-***12 (사업자 신청 줄) — 시안 두 화면의 표기 */
export function maskBizNo(v: string | null | undefined, style: 'tail' | 'mid' = 'tail'): string | null {
  if (!v) return v ?? null;
  const d = v.replace(/\D/g, '');
  if (d.length !== 10) return `${d.slice(0, 3)}****`;
  return style === 'mid'
    ? `${d.slice(0, 3)}-${d.slice(3, 5)}-***${d.slice(8)}`
    : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 7)}***`;
}

/** 사람 이름 — 첫 글자만(김**) */
export function maskName(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const t = v.trim();
  return t.length <= 1 ? '*' : `${t[0]}${'*'.repeat(Math.min(t.length - 1, 3))}`;
}
