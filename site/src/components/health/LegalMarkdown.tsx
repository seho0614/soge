/**
 * v10.31 (결함-중 · 시안도 같음 — 「건강상품 판매 약관(직판)」 전문이 ## · ``` · |표| · ** 기호를 그대로 보임) — 약관 글(마크다운 일부)을 그립니다.
 * 쓰는 꾸밈만: 제목(# ## ###) · 코드 상자(```) · 표(|) · 인용(>) · 목록(- ·) · 굵게(**). HTML 을 그대로 넣지 않습니다(글자로만 그림).
 * 서버 · 클라이언트 어디서나 씁니다(상태 없음).
 */
import type { ReactNode } from 'react';

function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (x.startsWith('**') && x.endsWith('**') && x.length > 4 ? <b key={i}>{x.slice(2, -2)}</b> : x));
}

export function LegalMarkdown({ body, className = 'hlt-legal-md' }: { body: string; className?: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [], quote: string[] = [], tbl: string[] = [], list: string[] = [], code: string[] | null = null, k = 0;
  const flushP = () => { if (para.length) { out.push(<p key={k++}>{para.map((x, i) => <span key={i}>{i > 0 && <br />}{inline(x)}</span>)}</p>); para = []; } };
  const flushQ = () => { if (quote.length) { out.push(<blockquote key={k++}>{inline(quote.join(' '))}</blockquote>); quote = []; } };
  const flushL = () => { if (list.length) { out.push(<ul key={k++}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  const flushT = () => {
    if (!tbl.length) return;
    const rows = tbl.filter((r) => !/^\|\s*:?-/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const head = rows[0] ?? [];
    out.push(<div key={k++} style={{ overflowX: 'auto' }}><table><thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
      <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
    tbl = [];
  };
  const flushAll = () => { flushT(); flushP(); flushQ(); flushL(); };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (code) {
      if (/^```/.test(line)) { out.push(<pre key={k++}>{code.join('\n')}</pre>); code = null; } else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushAll(); code = []; continue; }
    if (line.startsWith('|')) { flushP(); flushQ(); flushL(); tbl.push(line); continue; }
    flushT();
    if (line.startsWith('> ')) { flushP(); flushL(); quote.push(line.slice(2)); continue; }
    flushQ();
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) { flushP(); flushL(); const lv = m[1]!.length; const t = inline(m[2]!); out.push(lv === 1 ? <h2 key={k++}>{t}</h2> : lv === 2 ? <h3 key={k++}>{t}</h3> : <h4 key={k++}>{t}</h4>); continue; }
    const li = /^\s*[-·*]\s+(.*)$/.exec(line);
    if (li) { flushP(); list.push(li[1]!); continue; }
    flushL();
    if (/^-{3,}$/.test(line.trim())) { flushP(); out.push(<hr key={k++} />); continue; }
    if (!line.trim()) { flushP(); continue; }
    para.push(line.trim());
  }
  if (code) out.push(<pre key={k++}>{code.join('\n')}</pre>);
  flushAll();
  return <div className={className}>{out}</div>;
}
