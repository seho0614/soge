import type { ReactNode } from 'react';

/**
 * v10.203 (D180 · docs/324) — 사용자 설명서 본문(마크다운 일부)을 화면 요소로.
 *   HTML 을 그대로 넣지 않고(innerHTML 로 넣는 길 없음) 줄을 나눠 React 요소로만 그립니다 — 운영이 쓴 글이라도 스크립트가 들어가지 않게.
 *   쓰는 모양: ## 장(id = c1, c2 … 목차) · ### 절(id = m1, m2 … — 서버 HelpService.sections 와 같은 순서) · - 목록 · 1. 순서 · | 표 | · --- · **굵게** · `주소`
 */
function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b> : <code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function ManualBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let sec = 0;
  let ch = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const k = `l${i}`;
    if (!line.trim()) { i++; continue; }
    if (/^###\s+/.test(line)) { sec++; out.push(<h3 key={k} id={`m${sec}`} className="w1-s3" style={{ scrollMarginTop: 80 }}>{inline(line.replace(/^###\s+/, ''), k)}</h3>); i++; continue; }
    if (/^##\s+/.test(line)) { ch++; out.push(<h2 key={k} id={`c${ch}`} className="w1-s2" style={{ scrollMarginTop: 80 }}>{inline(line.replace(/^##\s+/, ''), k)}</h2>); i++; continue; }
    if (/^#\s+/.test(line)) { i++; continue; }   // 문서 제목은 화면 제목이 대신함
    if (/^-{3,}\s*$/.test(line)) { out.push(<hr key={k} />); i++; continue; }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        if (!/^\|[\s:|-]+\|?\s*$/.test(lines[i]!)) rows.push(cells(lines[i]!));
        i++;
      }
      const [head, ...rest] = rows;
      out.push(
        <div key={k} style={{ overflowX: 'auto' }}>
          <table className="w1-tb">
            {head && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>}
            <tbody>{rest.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*-\s+/, '')); i++; }
      out.push(<ul key={k} className="w1-ls">{items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push(<ol key={k} className="w1-ls">{items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) { out.push(<div key={k} className="w1-nt">{inline(line.replace(/^>\s?/, ''), k)}</div>); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|\||\s*-\s|\s*\d+\.\s|>|-{3,}\s*$)/.test(lines[i]!)) { para.push(lines[i]!); i++; }
    if (!para.length) { para.push(line); i++; }   // 어느 모양에도 안 맞는 줄 — 글로 두고 넘어감(멈추지 않게)
    out.push(<p key={k}>{inline(para.join(' '), k)}</p>);
  }
  return <div className="w1-manual" data-manual-body="">{out}</div>;
}

/** ## 장 목록(목차) — ManualBody 의 c번호와 같은 순서 */
export const manualChapters = (body: string) =>
  body.split('\n').filter((l) => /^##\s+/.test(l)).map((l, i) => ({ id: `c${i + 1}`, title: l.replace(/^##\s+/, '').replace(/[`*]/g, '') }));
