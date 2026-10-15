import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet, ApiFailure } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyFrame } from '@/components/my/MyFrame';
import { MyHead, Note, Empty } from '@/components/my/ui';

export const metadata: Metadata = { title: '계약서 양식 전문' };
export const dynamic = 'force-dynamic';

interface Tpl { code: string; name: string; version: string; scope: string; body: string; effectiveFrom: string | null }
type Props = { params: Promise<{ code: string }>; searchParams?: Promise<{ deal?: string }> };

/** **굵게** 만 그립니다 — 양식 글에 쓰는 꾸밈은 이것뿐입니다(HTML 을 그대로 넣지 않음) */
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (x.startsWith('**') && x.endsWith('**') ? <b key={i}>{x.slice(2, -2)}</b> : x));
}
/** 양식 글(DB · 마크다운 일부) → 화면. 제목(##) · 표 · 인용(>) · 문단만 씁니다 */
function render(body: string): ReactNode[] {
  const out: ReactNode[] = []; let para: string[] = []; let quote: string[] = []; let tbl: string[] = []; let k = 0;
  const flushP = () => { if (para.length) { out.push(<p key={k++} className="ctf-p">{para.map((x, i) => <span key={i}>{i > 0 && <br />}{inline(x)}</span>)}</p>); para = []; } };
  const flushQ = () => { if (quote.length) { out.push(<div key={k++} className="note info">{inline(quote.join(' '))}</div>); quote = []; } };
  const flushT = () => {
    if (!tbl.length) return;
    const rows = tbl.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const head = rows[0] ?? [];
    out.push(<div key={k++} className="tw"><table className="tbl"><thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
      <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
    tbl = [];
  };
  for (const line of body.split('\n')) {
    if (line.startsWith('|')) { flushP(); flushQ(); tbl.push(line); continue; }
    flushT();
    if (line.startsWith('> ')) { flushP(); quote.push(line.slice(2)); continue; }
    flushQ();
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) { flushP(); out.push(<h2 key={k++} className="ctf-h">{inline(line.slice(3))}</h2>); continue; }
    if (!line.trim()) { flushP(); continue; }
    para.push(line.trim());
  }
  flushT(); flushP(); flushQ();
  return out;
}

/** SB-MYP-CTR-030 계약서 양식 전문 · v10.27 (G-130) — GET /contract-templates/{code} 의 글을 그대로 */
export default async function ContractTemplatePage({ params, searchParams }: Props) {
  const code = decodeURIComponent((await params).code);
  /* v10.31 (시안 「← 계약서 · 체결」) — 계약서 화면에서 열면 ?deal={거래} 를 받아 그 계약서로 돌아갑니다(형식이 맞을 때만) */
  const deal = (await searchParams)?.deal ?? '';
  const back = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deal)
    ? { href: `/my/contracts/${deal}`, label: '← 계약서 · 체결' } : { href: '/my/contracts', label: '← 계약 진행' };
  let t: Tpl | null = null; let err: string | null = null;
  try { t = await apiGet<Tpl>(`/contract-templates/${encodeURIComponent(code)}`, 300); }
  catch (e) { err = e instanceof ApiFailure && e.status < 500 ? '없는 양식입니다.' : '양식을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.'; }
  /* v10.29 — 시안(scCtrForm)은 나의공간 「계약 진행」 안의 화면입니다. 로그인한 사람에게는 같은 틀(왼쪽 메뉴)로 보입니다.
   *   글은 그대로 DB(contract_templates) 판을 그립니다 — 시안에 박힌 글이 아닙니다. */
  if (!t) {
    return (<MyFrame><div className="my-ctf-wrap" data-ctform-none="">
      <MyHead title="계약서 양식 전문" sub="조항은 고칠 수 없고 빈칸만 채웁니다." />
      <Empty>{err}</Empty>
      <div className="my-btns"><Link className="my-bo" href="/contracts/templates/INTRO_STD">소개 표준계약서 보기</Link><Link className="my-bo" href="/my/contracts">← 계약 목록</Link></div>
    </div><i hidden data-root-end="" /></MyFrame>);
  }
  return (
    <MyFrame><div className="my-ctf-wrap" data-ctform={t.code}>
      <MyHead title="계약서 양식 전문"
        sub={`${t.name} ${t.version} — 조항은 고칠 수 없고 빈칸만 채웁니다.${t.effectiveFrom ? ` 시행일 ${ymdKst(t.effectiveFrom)}.` : ''}`} />
      <div className="my-card my-ctf ctf">
        <div className="note info"><b>이 양식은 조항을 고칠 수 없습니다.</b> 빈칸만 채우십시오. 조항을 개별 수정하면 저희가 법률사무를 취급한 것이 되어 변호사법 109조에 걸립니다.</div>
        {render(t.body)}
      </div>
      <Note kind="info"><b>실제 계약서와 같은 글입니다.</b> 서명하실 계약서는 이 판({t.code} {t.version})으로 만들어지며, 화면은 그 글을 그대로 보여 드립니다.</Note>
      {t.scope === 'INTRO' && t.code !== 'INTRO_STD' && (
        <Note kind="info">지금 쓰는 양식은 <Link href="/contracts/templates/INTRO_STD">소개 표준계약서(INTRO_STD)</Link>입니다.</Note>
      )}
      <div className="my-btns"><Link className="my-bo" href={back.href} data-ctform-back="">{back.label}</Link></div>
    </div><i hidden data-root-end="" /></MyFrame>
  );
}
