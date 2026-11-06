/* ---------------------------------------------------------------------
 * v10.201 (docs/318) — 약관 법무 검토 묶음(HTML 한 파일)
 *
 *   오픈 차단 중 약관 · 바닥줄 고지는 법무 확인 뒤 게시해야 풀립니다. 게시 안 된 초안(초안 · 법무 검토)을 한 파일로 묶어
 *   법무에 보냅니다 — 약관마다 지금 게시판과 바뀐 줄(더한 줄 · 뺀 줄) · 남은 〔미확정〕 표시 · 막힌 까닭 · 고친 까닭.
 *   읽기만(DB 를 바꾸지 않음) · 바깥 글꼴 · 그림 · 스크립트 없음(브라우저로 열고 PDF 로 인쇄).
 *   ★ 묶음은 검토를 돕는 자료일 뿐 — 약관 내용의 법적 적정성은 법무가 판단합니다.
 * ------------------------------------------------------------------- */

export interface PackTerm {
  code: string; title: string; version: string; status: string; body: string;
  blockedBy: string | null; changeNote: string | null;
  base: { version: string; body: string } | null;
}
export interface PackItem {
  code: string; title: string; version: string; status: string; baseVersion: string | null;
  holes: string[]; added: number; removed: number; blockedBy: string | null;
}
type Line = { op: ' ' | '+' | '-'; text: string };

const MAX_LINES = 1500;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STATUS: Record<string, string> = { DRAFT: '초안', LEGAL_REVIEW: '법무 검토' };

/** 본문의 미확정 표시(〔…〕 · 〔시행일〕 은 게시가 채우므로 뺌) — TermsService.holes 와 같은 규칙 */
export const packHoles = (body: string) => (body.match(/〔[^〕]*〕/g) ?? []).filter((m) => m !== '〔시행일〕');

/** 줄 단위 비교(가장 긴 공통 줄) — 약관은 수백 줄이라 그대로 계산. 너무 길면 비교 없이 새 글 전체를 「더한 줄」로 */
export function lineDiff(before: string, after: string): Line[] {
  const a = before.split('\n'), b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) return b.map((text) => ({ op: '+', text }));
  const n = a.length, m = b.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < n) out.push({ op: '-', text: a[i++] });
  while (j < m) out.push({ op: '+', text: b[j++] });
  return out;
}

export function buildReviewPack(terms: PackTerm[], day: string): { items: PackItem[]; html: string } {
  const items: PackItem[] = [];
  const parts: string[] = [];
  for (const t of terms) {
    const holes = packHoles(t.body);
    const diff = t.base ? lineDiff(t.base.body, t.body) : t.body.split('\n').map((text) => ({ op: '+' as const, text }));
    const added = t.base ? diff.filter((x) => x.op === '+').length : 0;
    const removed = diff.filter((x) => x.op === '-').length;
    items.push({ code: t.code, title: t.title, version: t.version, status: t.status, baseVersion: t.base?.version ?? null, holes, added, removed, blockedBy: t.blockedBy });
    const mark = (s: string) => esc(s).replace(/〔[^〕]*〕/g, (h) => `<mark>${h}</mark>`);
    parts.push(`
<section class="term" id="t-${esc(t.code)}">
  <h2>${esc(t.title)} <small>${esc(t.code)} · 판 ${esc(t.version)} · ${esc(STATUS[t.status] ?? t.status)}</small></h2>
  <table class="meta">
    <tr><th>비교 기준</th><td>${t.base ? `지금 게시판 ${esc(t.base.version)} — 더한 줄 ${added} · 뺀 줄 ${removed}` : '게시판 없음 — 처음 게시(글 전체)'}</td></tr>
    <tr><th>남은 〔미확정〕</th><td>${holes.length ? `${holes.length}곳 — ${holes.map((h) => `<mark>${esc(h)}</mark>`).join(' ')}` : '없음'}</td></tr>
    ${t.blockedBy ? `<tr><th>막힌 까닭</th><td>${esc(t.blockedBy)}</td></tr>` : ''}
    ${t.changeNote ? `<tr><th>고친 까닭</th><td>${esc(t.changeNote)}</td></tr>` : ''}
    <tr><th>법무 확인</th><td>□ 확인함 &nbsp; 확인한 사람 ______ &nbsp; 날짜 ______ &nbsp; 의견 ________________</td></tr>
  </table>
  <pre class="body">${diff.map((x) => `<span class="l${x.op === '+' ? ' add' : x.op === '-' ? ' del' : ''}">${t.base ? (x.op === ' ' ? '  ' : `${x.op} `) : ''}${mark(x.text)}</span>`).join('\n')}</pre>
</section>`);
  }
  const rows = items.map((x) => `<tr><td><a href="#t-${esc(x.code)}">${esc(x.title)}</a></td><td>${esc(x.version)}</td><td>${esc(STATUS[x.status] ?? x.status)}</td><td>${x.baseVersion ? esc(x.baseVersion) : '처음'}</td><td>${x.baseVersion ? `+${x.added} · −${x.removed}` : '전체'}</td><td>${x.holes.length}</td></tr>`).join('');
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>소개뱅크 약관 법무 검토 묶음 ${esc(day)}</title>
<style>
body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1d2433;margin:24px auto;max-width:960px;padding:0 16px;line-height:1.6}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;border-bottom:2px solid #1d2433;padding-bottom:4px}h2 small{font-weight:normal;color:#5b6475;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c9ced8;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f2f4f7;width:120px}
.sum th{width:auto}.note{color:#5b6475;font-size:13px}
pre.body{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;border:1px solid #c9ced8;padding:12px;background:#fff}
.l{display:block}.add{background:#e6f4ea}.del{background:#fde8e8;text-decoration:line-through;color:#8a1f1f}mark{background:#fff3b0}
@media print{.term{page-break-before:always}a{color:inherit;text-decoration:none}}
</style></head><body>
<h1>소개뱅크 약관 법무 검토 묶음</h1>
<p class="note">(주)한국바이오헬스케어 소개뱅크 사업부 · 만든 날 ${esc(day)}(한국 날짜) · 게시 안 된 초안 ${items.length}건<br>
초록 줄 = 지금 게시판에 더한 줄 · 빨간 줄 = 뺀 줄 · 노란 표시 = 아직 채우지 않은 〔미확정〕 칸(게시 전에 채워야 함 · 〔시행일〕은 게시할 때 시행일로 채워짐).
이 묶음은 검토를 돕는 자료이며, 확인을 마친 글만 운영 화면 › 약관에서 게시합니다.</p>
<table class="sum"><thead><tr><th>약관</th><th>판</th><th>상태</th><th>비교 기준</th><th>바뀐 줄</th><th>〔미확정〕</th></tr></thead><tbody>${rows || '<tr><td colspan="6">게시 안 된 초안이 없습니다.</td></tr>'}</tbody></table>
${parts.join('\n')}
</body></html>
`;
  return { items, html };
}
