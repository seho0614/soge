/**
 * v10.31 — 약관 본문(마크다운)을 화면 요소로 그립니다. 전: 「## 제목 · **굵게** · 표 |---|」가 글자 그대로 찍혔습니다(결함 중).
 *   HTML 을 그대로 넣지 않습니다(dangerouslySetInnerHTML 없음) — 지원하는 것만 React 요소로:
 *   # ~ ### 제목 · **굵게** · `코드` · 줄머리 - / * / 1. 목록 · | 표 | · ``` 코드 묶음 · > 인용 · 빈 줄 = 문단. 나머지는 글자 그대로.
 *   제목(##)에는 id(조-1, 조-2 …)를 달아 「조항 목록」이 그 자리로 이어지게 합니다.
 */
import { Fragment } from 'react';

function inline(s: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b> : <code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export interface TocItem { id: string; text: string }

/** 본문의 ## 제목 목록(조항 목록) */
export function toc(md: string): TocItem[] {
  const out: TocItem[] = [];
  md.split('\n').forEach((l) => { const m = l.match(/^##\s+(.+)$/); if (m) out.push({ id: `jo-${out.length + 1}`, text: m[1]!.replace(/\*\*/g, '').trim() }); });
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0, h2 = 0, k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) buf.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key()} className="w1-md-pre">{buf.join('\n')}</pre>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lv = h[1]!.length, kk = key();
      if (lv === 1) blocks.push(<h2 key={kk} className="w1-md-h1">{inline(h[2]!, kk)}</h2>);
      else if (lv === 2) { h2++; blocks.push(<h3 key={kk} id={`jo-${h2}`} className="w1-md-h2">{inline(h[2]!, kk)}</h3>); }
      else blocks.push(<h4 key={kk} className="w1-md-h3">{inline(h[2]!, kk)}</h4>);
      i++; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      const kk = key();
      blocks.push(
        <div key={kk} className="w1-md-tw"><table className="w1-tb">
          {head && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${kk}h${j}`)}</th>)}</tr></thead>}
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${kk}${ri}-${j}`)}</td>)}</tr>)}</tbody>
        </table></div>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const kk = key();
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${kk}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={kk} className="w1-md-list">{lis}</ol> : <ul key={kk} className="w1-md-list">{lis}</ul>);
      continue;
    }
    if (l.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      const kk = key();
      blocks.push(<blockquote key={kk} className="w1-md-q">{buf.map((t, j) => <Fragment key={j}>{j > 0 && <br />}{inline(t, `${kk}-${j}`)}</Fragment>)}</blockquote>);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s+|>)/.test(lines[i]!)) buf.push(lines[i++]!);
    const kk = key();
    blocks.push(<p key={kk} className="w1-md-p">{buf.map((t, j) => <Fragment key={j}>{j > 0 && <br />}{inline(t, `${kk}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="w1-md">{blocks}</div>;
}
