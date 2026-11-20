/* ===== v10.433 ~ 436 (D256 · docs/570 ~ 573) 내부 ERP 완성 — web/src/app/admin/Erp.tsx 새 파일 =====
 * 대표 11/19 「이카운트 연동은 보류 → 그냥 내부 시스템으로」.
 *   ErpDocs        회계 › 견적 · 명세서  — 견적서 · 주문서 · 거래명세서 만들기 · 새 판 · 이어 만들기 · 확정 · 세금계산서 요청 · 인쇄 · 발주서 인쇄
 *   ErpDepts       회계 › 부서 손익      — 부서 · 프로젝트 · 돈 흐름 기본 부서 · 전표 꼬리표 · 부서 · 프로젝트별 손익
 *   ErpWarehouses  회계 › 창고 · 바코드  — 창고 · 창고별 재고 · 이동 · 입고 · 실사 · 바코드 정하기 · Code128 인쇄 · 카메라 읽기(BarcodeDetector)
 *   ErpDunning     회계 › 미수금 독촉    — 거래처별 받을 돈 · 단계 · 미리 보기 · 보내기 · 문안 · 입금 예정
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useEffect, useRef, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openPrint } from '../../lib/printDoc';   // v10.468 (D264) 문서 PDF(인쇄)

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const isSuper = () => tokenRoles().includes('SUPER');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 인쇄 — 새 창에 문서만 그려 브라우저 인쇄(종이 · PDF 저장) */
function printHtml(title: string, body: string) {
  /* v10.468 (D264 · docs/606) — 공용 인쇄 창: A4 · 머리 · 공급자 도장 칸 · 「PDF 로 저장」(브라우저 인쇄 → PDF) 안내 · 서버 PDF 라이브러리 없음 */
  if (!openPrint({ title, body, kind: title.startsWith('발주서') ? 'PO' : 'SALES', sign: '공급자' })) alert('팝업이 막혀 인쇄 창을 열지 못했습니다 — 주소창 오른쪽 팝업 차단을 풀고 다시 누르십시오.');
}

interface Company { name: string | null; bizNo: string | null; ceo: string | null; address: string | null; phone: string | null }
const companyBox = (c: Company) => `<table class="meta"><tr><td><b>공급자</b> ${esc(c.name)} · 사업자번호 ${esc(c.bizNo)} · 대표 ${esc(c.ceo)}</td></tr><tr><td>${esc(c.address)} · ${esc(c.phone)}</td></tr></table>`;

/* ── v10.433 견적서 · 주문서 · 거래명세서 ── */
interface DocRow { id: string; kind: string; docNo: string; rev: number; partyName: string; title: string; issuedOn: string; dueOn: string | null; supply: number; vat: number; total: number; state: string; taxInvoiceNo: string | null; parentNo: string | null }
interface DocList { items: DocRow[]; parties: Array<{ id: string; name: string; bizNo: string | null }>; revenues: Array<{ role: string; name: string }>; kinds: Record<string, string>; states: Record<string, string> }
interface DLine { item: string; spec?: string | null; qty: number; unit?: string | null; unitPrice: number; supply?: number; vat?: number; taxType: string }
interface DocDetail { doc: DocRow & { partyBizNo: string | null; contactName: string | null; validUntil: string | null; memo: string | null; supersededBy: string | null; taxInvoiceId: string | null; revenueRole: string };
  lines: DLine[]; revisions: Array<{ id: string; rev: number; state: string }>; children: Array<{ id: string; kind: string; docNo: string; state: string }>; next: string[]; company: Company }
const EMPTY_LINE: DLine = { item: '', qty: 1, unitPrice: 0, taxType: 'TAXABLE' };
const lineCalc = (l: DLine) => { const s = Math.floor(Number(l.qty || 0) * Number(l.unitPrice || 0)); return { s, v: l.taxType === 'TAXABLE' ? Math.floor(s / 10) : 0 }; };

function DocForm({ list, onDone }: { list: DocList; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ kind: 'QUOTE', partyId: '', title: '', issuedOn: kstDay(), dueOn: '', validUntil: '', revenueRole: 'REV_SALES', memo: '' });
  const [lines, setLines] = useState<DLine[]>([{ ...EMPTY_LINE }]);
  const tot = lines.reduce((t, l) => { const c = lineCalc(l); return { s: t.s + c.s, v: t.v + c.v }; }, { s: 0, v: 0 });
  const save = () => void a.run('add', () => api('/admin/acct/sales-docs', { method: 'POST', body: JSON.stringify({ ...f, dueOn: f.dueOn || undefined, validUntil: f.validUntil || undefined, memo: f.memo || undefined,
    lines: lines.map((l) => ({ item: l.item, spec: l.spec || undefined, qty: Number(l.qty), unit: l.unit || undefined, unitPrice: Number(l.unitPrice), taxType: l.taxType })) }) }),
    () => { setLines([{ ...EMPTY_LINE }]); setF({ ...f, title: '', memo: '' }); onDone(); });
  return (
    <div className="card pad" data-erp-doc-form="">
      <Flash msg={a.msg} err={a.err} />
      <b>새 문서</b>{' '}
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(list.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
      <select value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} aria-label="거래처"><option value="">거래처 고르기</option>{list.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{' '}
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" size={20} />{' '}
      <label>날짜 <input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></label>{' '}
      <label>결제 기한 <input type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></label>{' '}
      <select value={f.revenueRole} onChange={(e) => setF({ ...f, revenueRole: e.target.value })} aria-label="매출 계정">{list.revenues.map((r) => <option key={r.role} value={r.role}>{r.name}</option>)}</select>
      <table className="tbl"><thead><tr><th>품목</th><th>규격</th><th>수량</th><th>단위</th><th>단가</th><th>과세</th><th className="num">공급가</th><th className="num">부가세</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => { const c = lineCalc(l); const set = (p: Partial<DLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (<tr key={i} data-erp-doc-line={i}>
            <td><input value={l.item} onChange={(e) => set({ item: e.target.value })} size={18} /></td><td><input value={l.spec ?? ''} onChange={(e) => set({ spec: e.target.value })} size={8} /></td>
            <td><input type="number" value={l.qty} onChange={(e) => set({ qty: Number(e.target.value) })} style={{ width: 70 }} /></td><td><input value={l.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} size={4} /></td>
            <td><input type="number" value={l.unitPrice} onChange={(e) => set({ unitPrice: Number(e.target.value) })} style={{ width: 110 }} /></td>
            <td><select value={l.taxType} onChange={(e) => set({ taxType: e.target.value })}><option value="TAXABLE">과세</option><option value="EXEMPT">면세</option><option value="ZERO">영세</option></select></td>
            <td className="num">{won(c.s)}</td><td className="num">{won(c.v)}</td>
            <td>{lines.length > 1 && <button className="btn-sm btn-plain" onClick={() => setLines(lines.filter((_, j) => j !== i))}>빼기</button>}</td></tr>); })}</tbody></table>
      <button className="btn-sm btn-plain" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>줄 더하기</button>{' '}
      공급가 <b>{won(tot.s)}</b> · 부가세 <b>{won(tot.v)}</b> · 합계 <b>{won(tot.s + tot.v)}</b>{' '}
      <button className="btn-sm" disabled={a.busy === 'add' || !f.partyId || !f.title.trim() || lines.some((l) => !l.item.trim())} onClick={save} data-erp-doc-save="">만들기(초안)</button>
    </div>
  );
}

function docPrint(d: DocDetail) {
  const ko: Record<string, string> = { QUOTE: '견 적 서', ORDER: '주 문 서', STATEMENT: '거 래 명 세 서' };
  const rows = d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item)}</td><td>${esc(l.spec)}</td><td class="r">${l.qty}</td><td>${esc(l.unit)}</td><td class="r">${won(l.unitPrice)}</td><td class="r">${won(l.supply)}</td><td class="r">${won(l.vat)}</td></tr>`).join('');
  printHtml(`${d.doc.docNo}`, `<h1>${ko[d.doc.kind] ?? d.doc.kind}</h1>
    <table class="meta"><tr><td>번호 ${esc(d.doc.docNo)}${d.doc.rev > 1 ? ` (${d.doc.rev}판)` : ''} · 날짜 ${esc(d.doc.issuedOn)}${d.doc.validUntil ? ` · 유효 ${esc(d.doc.validUntil)}` : ''}${d.doc.dueOn ? ` · 결제 기한 ${esc(d.doc.dueOn)}` : ''}</td></tr>
    <tr><td><b>받는 곳</b> ${esc(d.doc.partyName)} ${d.doc.partyBizNo ? `(${esc(d.doc.partyBizNo)})` : ''} ${esc(d.doc.contactName)} 귀하</td></tr></table>${companyBox(d.company)}
    <table><tr><th>#</th><th>품목</th><th>규격</th><th>수량</th><th>단위</th><th>단가</th><th>공급가</th><th>부가세</th></tr>${rows}
    <tr class="sum"><td colspan="6">합계 ${won(d.doc.total)}원</td><td class="r">${won(d.doc.supply)}</td><td class="r">${won(d.doc.vat)}</td></tr></table><p>${esc(d.doc.memo)}</p>`);
}

function DocView({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useApi<DocDetail>(`/admin/acct/sales-docs/${id}`, [id]);
  const a = useAct();
  const d = q.data;
  if (!d) return null;
  const act = (k: string, path: string, body: unknown) => void a.run(k, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => { q.reload(); onDone(); });
  const ko: Record<string, string> = { ORDER: '주문서로', STATEMENT: '거래명세서로' };
  return (
    <div className="card pad" data-erp-doc-view={d.doc.docNo}>
      <Flash msg={a.msg} err={a.err} />
      <b>{d.doc.docNo}</b> {d.doc.rev > 1 && <small className="dim">{d.doc.rev}판</small>} · {d.doc.partyName} · {d.doc.title} · 합계 <b>{won(d.doc.total)}</b> · {d.doc.state}
      {d.doc.taxInvoiceNo && <small> · 세금계산서 {d.doc.taxInvoiceNo}</small>}{' '}
      <button className="btn-sm btn-plain" onClick={() => docPrint(d)} data-erp-doc-print="">인쇄</button>{' '}
      {d.doc.state === 'DRAFT' && <button className="btn-sm btn-plain" onClick={() => act('sent', `/admin/acct/sales-docs/${id}/state`, { state: 'SENT' })}>보냄 표시</button>}{' '}
      {!d.doc.supersededBy && ['DRAFT', 'SENT'].includes(d.doc.state) && <button className="btn-sm" onClick={() => act('acc', `/admin/acct/sales-docs/${id}/state`, { state: 'ACCEPTED' })} data-erp-doc-accept="">확정</button>}{' '}
      {d.next.map((k) => <button key={k} className="btn-sm btn-plain" onClick={() => act(`cv${k}`, `/admin/acct/sales-docs/${id}/convert`, { to: k })} data-erp-doc-convert={k}>{ko[k] ?? k} 이어 만들기</button>)}{' '}
      {d.doc.kind === 'STATEMENT' && d.doc.state === 'ACCEPTED' && !d.doc.taxInvoiceId && <button className="btn-sm btn-plain" onClick={() => act('ti', `/admin/acct/sales-docs/${id}/tax-invoice`, {})} data-erp-doc-taxinv="">세금계산서 요청</button>}{' '}
      {d.doc.state !== 'CANCELED' && <button className="btn-sm btn-plain" onClick={() => { const r = prompt('취소 사유(2자 이상)'); if (r) act('cx', `/admin/acct/sales-docs/${id}/state`, { state: 'CANCELED', reason: r }); }}>취소</button>}
      <table className="tbl"><thead><tr><th>품목</th><th>수량</th><th>단가</th><th className="num">공급가</th><th className="num">부가세</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.item} <small className="dim">{l.spec}</small></td><td>{l.qty} {l.unit}</td><td className="num">{won(l.unitPrice)}</td><td className="num">{won(l.supply)}</td><td className="num">{won(l.vat)}{l.taxType !== 'TAXABLE' && <small> {l.taxType === 'EXEMPT' ? '면세' : '영세'}</small>}</td></tr>)}</tbody></table>
      {!!d.children.length && <p className="muted">이어 만든 문서: {d.children.map((c) => `${c.docNo}(${c.state})`).join(' · ')}</p>}
      {d.revisions.length > 1 && <p className="muted">판: {d.revisions.map((r) => `${r.rev}판 ${r.state}`).join(' · ')}</p>}
    </div>
  );
}

export function ErpDocs() {
  const [kind, setKind] = useState('');
  const q = useApi<DocList>(`/admin/acct/sales-docs${kind ? `?kind=${kind}` : ''}`, [kind]);
  const [open, setOpen] = useState<string | null>(null);
  const [po, setPo] = useState('');
  const pa = useAct();
  const printPo = () => void pa.run('po', () => api<{ po: Record<string, string>; lines: Array<{ item: string; qty: number; unitPrice: number; supply: number }>; supply: number; vat: number; total: number; company: Company }>(`/admin/acct/sales-docs/po/${encodeURIComponent(po)}/print`),
    undefined, () => '발주서를 열었습니다.').then((r) => { if (r?.po) printHtml(`발주서 ${r.po.no}`, `<h1>발 주 서</h1><table class="meta"><tr><td>번호 ${esc(r.po.no)} · 날짜 ${esc(r.po.orderedOn)}</td></tr><tr><td><b>받는 곳</b> ${esc(r.po.partyName)} ${esc(r.po.contactName)} 귀하</td></tr></table>${companyBox(r.company)}
      <table><tr><th>#</th><th>품목</th><th>수량</th><th>단가</th><th>공급가</th></tr>${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item)}</td><td class="r">${l.qty}</td><td class="r">${won(l.unitPrice)}</td><td class="r">${won(l.supply)}</td></tr>`).join('')}
      <tr class="sum"><td colspan="4">공급가 ${won(r.supply)} · 부가세 ${won(r.vat)} · 합계 ${won(r.total)}원</td><td></td></tr></table><p>${esc(r.po.memo)}</p>`); });
  const d = q.data;
  return (
    <section data-erp-docs={d?.items.length ?? ''}>
      {d && <DocForm list={d} onDone={q.reload} />}
      <p>
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">모든 종류</option>{d && Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
        <Flash msg={pa.msg} err={pa.err} /> 발주서 인쇄 <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="발주 번호" size={6} /> <button className="btn-sm btn-plain" disabled={!po} onClick={printPo} data-erp-po-print="">열기</button>
      </p>
      {d && (
        <table className="tbl"><thead><tr><th>번호</th><th>종류</th><th>거래처</th><th>제목</th><th>날짜</th><th className="num">합계</th><th>상태</th><th /></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.id} data-erp-doc-row={x.kind}><td>{x.docNo}{x.rev > 1 && <small className="dim"> {x.rev}판</small>}{x.parentNo && <small className="dim"> ← {x.parentNo}</small>}</td><td>{d.kinds[x.kind]}</td><td>{x.partyName}</td><td>{x.title}</td><td>{x.issuedOn}</td>
              <td className="num">{won(x.total)}</td><td>{d.states[x.state]}{x.taxInvoiceNo && <small> · 계산서</small>}</td>
              <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '열기'}</button></td></tr>))}</tbody></table>
      )}
      {open && <DocView key={open} id={open} onDone={q.reload} />}
    </section>
  );
}

/* ── v10.434 부서 · 프로젝트별 손익 ── */
interface Depts { depts: Array<{ id: string; code: string; name: string; active: boolean }>; projects: Array<{ id: string; code: string; name: string; deptName: string | null; closed: boolean }>; rules: Array<{ source: string; label: string; deptId: string | null }> }
interface Pnl { items: Array<{ key: string | null; label: string; revenue: number; expense: number; profit: number }>; total: { revenue: number; expense: number; profit: number }; note: string }
interface TagRow { id: string; date: string; source: string; sourceKey: string; memo: string | null; party: string | null; amount: number; entryDept: string | null; entryProject: string | null; sourceDept: string | null; ruleDept: string | null }

export function ErpDepts() {
  const q = useApi<Depts>('/admin/acct/depts');
  const [from, setFrom] = useState(kstDay().slice(0, 8) + '01');
  const [to, setTo] = useState(kstDay());
  const [by, setBy] = useState('dept');
  const p = useApi<Pnl>(`/admin/acct/dept-pnl?from=${from}&to=${to}&by=${by}`, [from, to, by]);
  const [ym, setYm] = useState(kstDay().slice(0, 7));
  const t = useApi<{ items: TagRow[] }>(`/admin/acct/tags/entries?ym=${ym}`, [ym]);
  const a = useAct();
  const [nd, setNd] = useState({ code: '', name: '' });
  const [np, setNp] = useState({ code: '', name: '' });
  const d = q.data;
  const dn = (id: string | null) => (id ? d?.depts.find((x) => x.id === id)?.name ?? id : '');
  const tag = (row: TagRow, deptId: string) => { const reason = prompt('꼬리표 사유(2자 이상)'); if (reason) void a.run(`t${row.id}`, () => api(`/admin/acct/tags/entry/${row.id}`, { method: 'POST', body: JSON.stringify({ deptId, reason }) }), t.reload); };
  const rule = (source: string, deptId: string) => { const reason = prompt('기본 부서 바꾸는 사유(2자 이상)'); if (reason) void a.run(`r${source}`, () => api('/admin/acct/depts/rules', { method: 'PUT', body: JSON.stringify({ items: [{ source, deptId }], reason }) }), () => { q.reload(); p.reload(); }); };
  return (
    <section data-erp-depts={d?.depts.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-erp-pnl="">
        <b>부서 · 프로젝트별 손익</b>{' '}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> ~ <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />{' '}
        <select value={by} onChange={(e) => setBy(e.target.value)}><option value="dept">부서별</option><option value="project">프로젝트별</option></select>
        {p.data && (
          <table className="tbl"><thead><tr><th>{by === 'project' ? '프로젝트' : '부서'}</th><th className="num">매출</th><th className="num">비용</th><th className="num">이익</th></tr></thead>
            <tbody>{p.data.items.map((x) => <tr key={x.key ?? 'none'} data-erp-pnl-row={x.key ?? 'none'}><td>{x.label}</td><td className="num">{won(x.revenue)}</td><td className="num">{won(x.expense)}</td><td className="num">{won(x.profit)}</td></tr>)}
              <tr><td><b>합계</b></td><td className="num"><b>{won(p.data.total.revenue)}</b></td><td className="num"><b>{won(p.data.total.expense)}</b></td><td className="num"><b>{won(p.data.total.profit)}</b></td></tr></tbody></table>
        )}
        {p.data && <p className="muted">{p.data.note}</p>}
      </div>
      {d && (
        <div className="card pad">
          <b>부서</b> {d.depts.map((x) => <span key={x.id} className={x.active ? '' : 'dim'}>{x.code} {x.name} · </span>)}
          {isSuper() && <span><input value={nd.code} onChange={(e) => setNd({ ...nd, code: e.target.value.toUpperCase() })} placeholder="코드" size={8} /> <input value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} placeholder="이름" size={10} />{' '}
            <button className="btn-sm" disabled={!nd.code || !nd.name} onClick={() => void a.run('nd', () => api('/admin/acct/depts', { method: 'POST', body: JSON.stringify(nd) }), () => { setNd({ code: '', name: '' }); q.reload(); })} data-erp-dept-add="">부서 더하기</button></span>}
          <br /><b>프로젝트</b> {d.projects.map((x) => <span key={x.id} className={x.closed ? 'dim' : ''}>{x.code} {x.name}{x.deptName ? `(${x.deptName})` : ''} · </span>)}
          {isSuper() && <span><input value={np.code} onChange={(e) => setNp({ ...np, code: e.target.value.toUpperCase() })} placeholder="코드" size={10} /> <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="이름" size={12} />{' '}
            <button className="btn-sm" disabled={!np.code || !np.name} onClick={() => void a.run('np', () => api('/admin/acct/projects', { method: 'POST', body: JSON.stringify(np) }), () => { setNp({ code: '', name: '' }); q.reload(); })}>프로젝트 더하기</button></span>}
          <details><summary>돈 흐름 기본 부서 (꼬리표가 없을 때)</summary>
            <table className="tbl"><tbody>{d.rules.map((r) => <tr key={r.source}><td>{r.label} <small className="dim">{r.source}</small></td><td>
              {isSuper() ? <select value={r.deptId ?? ''} onChange={(e) => rule(r.source, e.target.value)}><option value="">정하지 않음</option>{d.depts.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : dn(r.deptId)}
            </td></tr>)}</tbody></table></details>
        </div>
      )}
      <div className="card pad" data-erp-tags={t.data?.items.length ?? ''}>
        <b>전표 꼬리표</b> <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        {t.data && d && (
          <table className="tbl"><thead><tr><th>날짜</th><th>돈 흐름</th><th>적요</th><th className="num">금액</th><th>지금 부서</th><th>정하기</th></tr></thead>
            <tbody>{t.data.items.slice(0, 300).map((r) => (
              <tr key={r.id}><td>{r.date}</td><td><small>{r.source}</small></td><td>{r.memo} <small className="dim">{r.party}</small></td><td className="num">{won(r.amount)}</td>
                <td>{dn(r.entryDept ?? r.sourceDept ?? r.ruleDept)}{!r.entryDept && (r.sourceDept || r.ruleDept) && <small className="dim"> (기본)</small>}</td>
                <td><select value={r.entryDept ?? ''} onChange={(e) => tag(r, e.target.value)} aria-label="부서"><option value="">—</option>{d.depts.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td></tr>))}</tbody></table>
        )}
      </div>
    </section>
  );
}

/* ── v10.435 창고 · 바코드 ── */
/** Code128-B 패턴(값 0 ~ 106 · 막대 · 빈칸 너비) */
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
export function code128Svg(text: string, h = 50) {
  const vals = [104, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const sum = vals.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  const pats = [...vals, sum % 103, 106].map((v) => C128[v] ?? '');
  let x = 10; const bars: string[] = [];
  for (const p of pats) [...p].forEach((w, i) => { const n = Number(w); if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="${h}"/>`); x += n; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(x + 10) * 2}" height="${h * 2 + 28}" viewBox="0 0 ${x + 10} ${h + 14}"><g fill="#000">${bars.join('')}</g><text x="${(x + 10) / 2}" y="${h + 11}" font-size="9" text-anchor="middle" font-family="monospace">${esc(text)}</text></svg>`;
}

interface Wh { id: string; code: string; name: string; isMain: boolean; active: boolean; qty: number }
interface WhStock { warehouses: Array<{ id: string; code: string; name: string }>; items: Array<{ optionId: string; code: string; name: string; label: string; avgCost: number; barcode: string | null; byWh: Record<string, number>; total: number }> }
interface Bc { optionId: string; code: string; name: string; label: string; active: boolean; barcode: string | null }

/** 카메라로 바코드 읽기 — 브라우저 BarcodeDetector 가 있을 때만(없으면 직접 넣기) */
function Scanner({ onCode }: { onCode: (c: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const has = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  useEffect(() => {
    if (!on || !video.current) return;
    let stop = false; let stream: MediaStream | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Det = (window as any).BarcodeDetector;
    const det = new Det({ formats: ['code_128'] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s; video.current!.srcObject = s; await video.current!.play();
      while (!stop) {
        const r = await det.detect(video.current!).catch(() => []);
        if (r?.[0]?.rawValue) { onCode(String(r[0].rawValue)); setOn(false); break; }
        await new Promise((ok) => setTimeout(ok, 300));
      }
    }).catch(() => setOn(false));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on, onCode]);
  if (!has) return <small className="dim">이 브라우저는 카메라 읽기를 지원하지 않습니다 — 글자를 넣으십시오.</small>;
  return <span>{on ? <><video ref={video} style={{ width: 240 }} muted playsInline /> <button className="btn-sm btn-plain" onClick={() => setOn(false)}>닫기</button></> : <button className="btn-sm btn-plain" onClick={() => setOn(true)} data-erp-scan="">카메라로 읽기</button>}</span>;
}

export function ErpWarehouses() {
  const w = useApi<{ items: Wh[]; note: string }>('/admin/acct/warehouses');
  const s = useApi<WhStock>('/admin/acct/warehouses/stock');
  const b = useApi<{ items: Bc[] }>('/admin/acct/barcodes');
  const a = useAct();
  const [nw, setNw] = useState({ code: '', name: '' });
  const [mv, setMv] = useState({ optionId: '', fromWh: '', toWh: '', qty: '' });
  const [code, setCode] = useState('');
  const [found, setFound] = useState<{ code: string; option: { name: string; label: string }; byWh: Array<{ id: string; name: string; qty: number }> } | null>(null);
  const reload = () => { w.reload(); s.reload(); b.reload(); };
  const find = (c: string) => { setCode(c); void a.run('find', () => api<NonNullable<typeof found>>(`/admin/acct/barcodes/find?code=${encodeURIComponent(c)}`), undefined, () => '찾았습니다.').then((r) => setFound(r ?? null)); };
  const adjust = (optionId: string, whId: string) => {
    const counted = prompt('센 수량'); if (counted == null) return;
    const reason = prompt('실사 사유(2자 이상)'); if (!reason) return;
    void a.run(`adj${optionId}${whId}`, () => api('/admin/acct/warehouses/adjust', { method: 'POST', body: JSON.stringify({ optionId, whId, counted: Number(counted), reason }) }), reload);
  };
  const printBc = () => { const xs = (b.data?.items ?? []).filter((x) => x.barcode);
    printHtml('바코드', `<div style="display:flex;flex-wrap:wrap;gap:12px">${xs.map((x) => `<div style="border:1px dashed #999;padding:6px;text-align:center;font-size:11px">${esc(x.name)} ${esc(x.label)}<br/>${code128Svg(x.barcode!)}</div>`).join('')}</div>`); };
  return (
    <section data-erp-wh={w.data?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {w.data && (
        <div className="card pad">
          <b>창고</b> {w.data.items.map((x) => <span key={x.id} className={x.active ? '' : 'dim'}>{x.name}{x.isMain ? '(본)' : ''} {won(x.qty)}개 · </span>)}
          {isSuper() && <span><input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value.toUpperCase() })} placeholder="코드" size={8} /> <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="이름" size={10} />{' '}
            <button className="btn-sm" disabled={!nw.code || !nw.name} onClick={() => void a.run('nw', () => api('/admin/acct/warehouses', { method: 'POST', body: JSON.stringify(nw) }), () => { setNw({ code: '', name: '' }); reload(); })} data-erp-wh-add="">창고 더하기</button></span>}
          <p className="muted">{w.data.note}</p>
        </div>
      )}
      <div className="card pad" data-erp-scanbox="">
        <b>바코드 찾기</b> <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="바코드 글자" size={16} onKeyDown={(e) => { if (e.key === 'Enter' && code) find(code); }} />{' '}
        <button className="btn-sm btn-plain" disabled={!code} onClick={() => find(code)}>찾기</button> <Scanner onCode={find} />
        {found && <p>{found.option.name} {found.option.label} — {found.byWh.map((x) => `${x.name} ${x.qty}개`).join(' · ')}</p>}
      </div>
      {s.data && (
        <div className="card pad" data-erp-wh-stock={s.data.items.length}>
          <b>창고별 재고</b>
          <table className="tbl"><thead><tr><th>상품</th>{s.data.warehouses.map((x) => <th key={x.id} className="num">{x.name}</th>)}<th className="num">합</th><th className="num">평균 단가</th><th>바코드</th></tr></thead>
            <tbody>{s.data.items.map((x) => (
              <tr key={x.optionId}><td>{x.name} <small className="dim">{x.label}</small></td>
                {s.data!.warehouses.map((h) => <td key={h.id} className="num">{won(x.byWh[h.id] ?? 0)}{isSuper() && <button className="btn-sm btn-plain" onClick={() => adjust(x.optionId, h.id)} title="실사">✎</button>}</td>)}
                <td className="num">{won(x.total)}</td><td className="num">{won(Math.round(x.avgCost))}</td><td>{x.barcode ?? '—'}</td></tr>))}</tbody></table>
          <p>
            <b>창고 간 이동</b>{' '}
            <select value={mv.optionId} onChange={(e) => setMv({ ...mv, optionId: e.target.value })}><option value="">상품</option>{s.data.items.map((x) => <option key={x.optionId} value={x.optionId}>{x.name} {x.label}</option>)}</select>{' '}
            <select value={mv.fromWh} onChange={(e) => setMv({ ...mv, fromWh: e.target.value })}><option value="">보내는 창고</option>{s.data.warehouses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> →{' '}
            <select value={mv.toWh} onChange={(e) => setMv({ ...mv, toWh: e.target.value })}><option value="">받는 창고</option>{s.data.warehouses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>{' '}
            <input type="number" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} placeholder="수량" style={{ width: 70 }} />{' '}
            <button className="btn-sm" disabled={!mv.optionId || !mv.fromWh || !mv.toWh || !Number(mv.qty)} data-erp-wh-move=""
              onClick={() => void a.run('mv', () => api('/admin/acct/warehouses/transfer', { method: 'POST', body: JSON.stringify({ ...mv, qty: Number(mv.qty) }) }), () => { setMv({ optionId: '', fromWh: '', toWh: '', qty: '' }); reload(); })}>옮기기</button>
          </p>
        </div>
      )}
      {b.data && (
        <div className="card pad" data-erp-barcodes={b.data.items.length}>
          <b>바코드</b> <button className="btn-sm btn-plain" onClick={printBc} data-erp-barcode-print="">정한 것 인쇄(Code128)</button>
          <table className="tbl"><tbody>{b.data.items.map((x) => (
            <tr key={x.optionId}><td>{x.name} <small className="dim">{x.label}</small></td><td>{x.barcode ?? <button className="btn-sm btn-plain" onClick={() => void a.run(`bc${x.optionId}`, () => api(`/admin/acct/barcodes/${x.optionId}`, { method: 'POST', body: '{}' }), reload)} data-erp-barcode-set={x.optionId}>정하기</button>}</td></tr>))}</tbody></table>
        </div>
      )}
    </section>
  );
}

/* ── v10.436 미수금 독촉 · 입금 예정 ── */
interface DunRow { party: string; partyId: string | null; email: string | null; open: number; oldest: string | null; oldestDays: number; stage: number; sentStage: number; due: boolean; lastSentAt: string | null }
interface Dun { today: string; on: boolean; templates: Array<{ stage: number; days: number; subject: string; body: string }>; rows: DunRow[]; total: number;
  promises: Array<{ id: string; partyName: string; amount: number; dueOn: string; note: string | null; state: string }>; note: string }

export function ErpDunning() {
  const q = useApi<Dun>('/admin/acct/dunning');
  const a = useAct();
  const [pv, setPv] = useState<{ party: string; subject: string; text: string; to: string | null } | null>(null);
  const [pm, setPm] = useState({ party: '', amount: '', dueOn: kstDay(7) });
  const [tpl, setTpl] = useState<{ stage: number; days: number; subject: string; body: string } | null>(null);
  const d = q.data;
  const stageKo = ['—', '1 안내', '2 독촉', '3 최종'];
  const preview = (party: string) => void a.run('pv', () => api<{ party: string; subject: string; text: string; to: string | null }>('/admin/acct/dunning/preview', { method: 'POST', body: JSON.stringify({ party }) }), undefined, () => '미리 보기').then((r) => setPv(r ?? null));
  return (
    <section data-erp-dunning={d?.rows.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'} data-erp-dunning-on={d.on ? 'on' : 'off'}>자동 독촉 메일 {d.on ? '켜짐(매일 09:35)' : '꺼짐 — 정책 › 전체 설정 acct.dunning'} · 받을 돈 합계 <b>{won(d.total)}</b></p>
          <table className="tbl"><thead><tr><th>거래처</th><th className="num">받을 돈</th><th>가장 오래된</th><th>단계</th><th>보낸 단계</th><th>메일</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.party} data-erp-dun-row={r.stage}><td>{r.party}</td><td className="num">{won(r.open)}</td><td>{r.oldest} <small className="dim">{r.oldestDays}일</small></td>
                <td>{r.due ? <b className="warn-text">{stageKo[r.stage]}</b> : stageKo[r.stage]}</td><td>{stageKo[r.sentStage]}{r.lastSentAt && <small className="dim"> {ymdhm(r.lastSentAt)}</small>}</td><td>{r.email ?? <small className="dim">없음</small>}</td>
                <td>{r.stage > 0 && <button className="btn-sm btn-plain" onClick={() => preview(r.party)}>미리 보기</button>}{' '}
                  {r.stage > 0 && isSuper() && <button className="btn-sm" disabled={!r.email} onClick={() => { if (confirm(`${r.party} 에 ${stageKo[r.stage]} 메일을 보낼까요?`)) void a.run(`s${r.party}`, () => api('/admin/acct/dunning/send', { method: 'POST', body: JSON.stringify({ party: r.party }) }), q.reload); }} data-erp-dun-send="">보내기</button>}{' '}
                  <button className="btn-sm btn-plain" onClick={() => setPm({ ...pm, party: r.party, amount: String(r.open) })}>입금 예정</button></td></tr>))}</tbody></table>
          {pv && <div className="card pad" data-erp-dun-preview=""><b>{pv.subject}</b> <small className="dim">→ {pv.to ?? '메일 없음'}</small><pre style={{ whiteSpace: 'pre-wrap' }}>{pv.text}</pre><button className="btn-sm btn-plain" onClick={() => setPv(null)}>닫기</button></div>}
          <div className="card pad" data-erp-promise="">
            <b>입금 예정</b> <input value={pm.party} onChange={(e) => setPm({ ...pm, party: e.target.value })} placeholder="거래처" size={14} />{' '}
            <input type="number" value={pm.amount} onChange={(e) => setPm({ ...pm, amount: e.target.value })} placeholder="금액" style={{ width: 110 }} /> <input type="date" value={pm.dueOn} onChange={(e) => setPm({ ...pm, dueOn: e.target.value })} />{' '}
            <button className="btn-sm" disabled={!pm.party || !Number(pm.amount)} onClick={() => void a.run('pm', () => api('/admin/acct/receipt-promises', { method: 'POST', body: JSON.stringify({ ...pm, amount: Number(pm.amount) }) }), () => { setPm({ party: '', amount: '', dueOn: kstDay(7) }); q.reload(); })} data-erp-promise-add="">넣기(자금 흐름 예정에도)</button>
            <table className="tbl"><tbody>{d.promises.map((p) => (
              <tr key={p.id}><td>{p.partyName}</td><td className="num">{won(p.amount)}</td><td>{p.dueOn}</td><td>{({ OPEN: '기다림', KEPT: '지킴', BROKEN: '어김', CANCELED: '취소' } as Record<string, string>)[p.state]}</td>
                <td>{p.state === 'OPEN' && ['KEPT', 'BROKEN', 'CANCELED'].map((s) => <button key={s} className="btn-sm btn-plain" onClick={() => { const note = prompt('사유(2자 이상)'); if (note) void a.run(`c${p.id}`, () => api(`/admin/acct/receipt-promises/${p.id}/close`, { method: 'POST', body: JSON.stringify({ state: s, note }) }), q.reload); }}>{({ KEPT: '지킴', BROKEN: '어김', CANCELED: '취소' } as Record<string, string>)[s]}</button>)}</td></tr>))}</tbody></table>
          </div>
          <details><summary>독촉 문안 (단계 날수 · 제목 · 본문)</summary>
            {d.templates.map((t) => <p key={t.stage}><b>{stageKo[t.stage]}</b> {t.days}일 넘음 · {t.subject} {isSuper() && <button className="btn-sm btn-plain" onClick={() => setTpl({ ...t })}>고치기</button>}</p>)}
            {tpl && <div className="card pad"><input type="number" value={tpl.days} onChange={(e) => setTpl({ ...tpl, days: Number(e.target.value) })} style={{ width: 70 }} />일 · <input value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} size={40} />
              <textarea value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} rows={6} style={{ width: '100%' }} />
              <small className="dim">글자: {'{party} {amount} {oldest} {days} {company} {phone}'}</small>{' '}
              <button className="btn-sm" onClick={() => void a.run('tpl', () => api(`/admin/acct/dunning/templates/${tpl.stage}`, { method: 'PUT', body: JSON.stringify({ days: tpl.days, subject: tpl.subject, body: tpl.body }) }), () => { setTpl(null); q.reload(); })}>저장</button></div>}
          </details>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
