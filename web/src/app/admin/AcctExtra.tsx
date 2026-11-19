/* ===== v10.437 ~ 440 (D257 · docs/574 ~ 577) 회계 덧붙임 — web/src/app/admin/AcctExtra.tsx 새 파일 =====
 * 대표 11/19 「다음개발」 4개 모두.
 *   AccountantDesk  회계 › 세무사          — 세무사: 내 기한 · 질문 남기기 / SUPER · 지급 담당: 세무사 계정 · 기한 · 접속 기록 · 답
 *   ReceiptReader   회계 › 영수증 읽기     — 증빙 사진 올리기 → 칸 채움 제안 → 고쳐서 매입 넣기(POST /admin/acct/purchases)
 *   AccrualBox      회계 › 고정비          — 계약별 규칙 · 그 달 줄 · 매입 맞춤 · 맞추지 못한 줄
 *   ArchiveBox      회계 › 장부 보관 · 통제 — 해마다 보관 판 · 만들기 · 내려받기(승인) · 내부통제 보고
 * (adminMenu · App.tsx 연결은 patches/3_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { uploadFile } from '../../lib/files';
import { exportTicket } from './OpsSafetyBoxes';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstYm = (addMonths = 0) => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + addMonths); return d.toISOString().slice(0, 7); };
const isSuper = () => tokenRoles().includes('SUPER');
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};

/* ── v10.437 세무사 ── */
interface Note { id: string; ym: string; entryId: string | null; body: string; createdAt: string; author: string; replies: Array<{ id: string; body: string; by: string; at: string }> }
interface Desk { isAccountant: boolean; ym: string | null; myExpiresAt: string | null; note: string; notes: Note[];
  accountants: Array<{ id: string; email: string; name: string | null; expiresAt: string | null; active: boolean; lastAt: string | null; calls30: number }>;
  access: Array<{ id: string; email: string; method: string; path: string; at: string }> }
export function AccountantDesk() {
  const [ym, setYm] = useState('');
  const q = useApi<Desk>(`/admin/acct/accountant${ym ? `?ym=${ym}` : ''}`, [ym]);
  const a = useAct();
  const [f, setF] = useState({ ym: kstYm(-1), entryId: '', body: '' });
  const [rep, setRep] = useState<Record<string, string>>({});
  const d = q.data;
  const add = () => void a.run('add', () => api('/admin/acct/accountant/notes', { method: 'POST', body: JSON.stringify({ ym: f.ym, body: f.body, ...(f.entryId ? { entryId: f.entryId } : {}) }) }),
    () => { setF({ ...f, body: '', entryId: '' }); q.reload(); });
  const reply = (id: string) => void a.run(`r${id}`, () => api(`/admin/acct/accountant/notes/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: rep[id] ?? '' }) }),
    () => { setRep({ ...rep, [id]: '' }); q.reload(); });
  return (
    <section data-acct-accountant={d ? (d.isAccountant ? 'me' : 'staff') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">{d.note}</p>}
      {d?.isAccountant && <p className="warn-text" data-acct-accountant-expiry="">세무사 계정 · 읽기 전용 · 기한 {d.myExpiresAt ? ymdhm(d.myExpiresAt) : '—'}</p>}
      {d && !d.isAccountant && (
        <div className="card pad" data-acct-accountant-list={d.accountants.length}>
          <b>세무사 계정</b> <small className="dim">권한 주기는 권한 계층 › 권한 관리(기한 7 · 30 · 90일 꼭)</small>
          <table className="tbl"><thead><tr><th>계정</th><th>기한</th><th>상태</th><th>최근 접속</th><th>30일 호출</th></tr></thead>
            <tbody>{d.accountants.map((x) => <tr key={x.id}><td>{x.name ? `${x.name} · ` : ''}{x.email}</td><td>{x.expiresAt ? ymdhm(x.expiresAt) : '—'}</td>
              <td>{x.active ? '쓰는 중' : <span className="warn-text">지남</span>}</td><td>{x.lastAt ? ymdhm(x.lastAt) : '—'}</td><td>{x.calls30}</td></tr>)}</tbody></table>
          {!!d.access.length && (
            <details data-acct-accountant-access={d.access.length}><summary>최근 접속 기록 {d.access.length}</summary>
              <table className="tbl"><tbody>{d.access.map((x) => <tr key={x.id}><td>{ymdhm(x.at)}</td><td>{x.email}</td><td>{x.method}</td><td className="dim"><small>{x.path}</small></td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      )}
      {d?.isAccountant && (
        <div className="card pad" data-acct-accountant-form="">
          <b>질문 남기기</b>{' '}
          <input type="month" value={f.ym} onChange={(e) => setF({ ...f, ym: e.target.value })} aria-label="달" />{' '}
          <input value={f.entryId} onChange={(e) => setF({ ...f, entryId: e.target.value.replace(/\D/g, '') })} placeholder="전표 번호(선택)" size={12} />{' '}
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} cols={60} placeholder="질문(2 ~ 1000자)" />{' '}
          <button className="btn-sm" disabled={a.busy === 'add' || f.body.trim().length < 2} onClick={add} data-acct-accountant-add="">남기기</button>
        </div>
      )}
      <p><label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label> <small className="dim">비우면 모두</small></p>
      {d && (
        <table className="tbl" data-acct-accountant-notes={d.notes.length}><thead><tr><th>때</th><th>달 · 전표</th><th>질문</th><th>답</th></tr></thead>
          <tbody>{d.notes.map((n) => (
            <tr key={n.id}><td>{ymdhm(n.createdAt)}<br /><small className="dim">{n.author}</small></td><td>{n.ym}{n.entryId ? ` · #${n.entryId}` : ''}</td><td>{n.body}</td>
              <td>{n.replies.map((r) => <p key={r.id}>{r.body} <small className="dim">{r.by} · {ymdhm(r.at)}</small></p>)}
                {isSuper() && <span><input value={rep[n.id] ?? ''} onChange={(e) => setRep({ ...rep, [n.id]: e.target.value })} placeholder="답" size={24} />{' '}
                  <button className="btn-sm" disabled={a.busy === `r${n.id}` || !(rep[n.id] ?? '').trim()} onClick={() => reply(n.id)}>답</button></span>}</td></tr>))}</tbody></table>
      )}
    </section>
  );
}

/* ── v10.438 영수증 읽기 ── */
interface Guess { issuedOn: string | null; supplierName: string | null; supplierBizNo: string | null; supply: number | null; vat: number | null; total: number | null; kind: string | null; item: string | null; confidence: number }
interface Reads { on: boolean; mode: string; items: Array<{ id: string; fileId: string; name: string; mode: string; model: string | null; ok: boolean; error: string | null; createdAt: string }> }
const KIND_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD: '카드', CASH: '현금영수증', SIMPLE: '간이영수증' };
export function ReceiptReader() {
  const q = useApi<Reads>('/admin/acct/receipt-ai/reads');
  const a = useAct();
  const [file, setFile] = useState<{ fileId: string; name: string } | null>(null);
  const [g, setG] = useState<(Guess & { assumed?: boolean }) | null>(null);
  const [f, setF] = useState({ issuedOn: '', supplierName: '', supplierBizNo: '', item: '', supply: '', vat: '', kind: 'CARD', accountRole: 'EXP_SUPPLIES', payRole: 'AP' });
  const pick = async (fl: File | undefined) => {
    if (!fl) return;
    await a.run('up', async () => {
      const up = await uploadFile(fl, 'ACCT_EVIDENCE');
      setFile({ fileId: up.fileId, name: up.name });
      const r = await api<{ guess: Guess; assumed: boolean; note: string }>('/admin/acct/receipt-ai/read', { method: 'POST', body: JSON.stringify({ fileId: up.fileId }) });
      setG({ ...r.guess, assumed: r.assumed });
      setF((x) => ({ ...x, issuedOn: r.guess.issuedOn ?? '', supplierName: r.guess.supplierName ?? '', supplierBizNo: r.guess.supplierBizNo ?? '', item: r.guess.item ?? '',
        supply: r.guess.supply != null ? String(r.guess.supply) : '', vat: r.guess.vat != null ? String(r.guess.vat) : '', kind: r.guess.kind ?? x.kind }));
      q.reload();
      return r;
    }, undefined, (r) => r?.note ?? '읽었습니다.');
  };
  const book = () => void a.run('book', () => api('/admin/acct/purchases', { method: 'POST', body: JSON.stringify({
    kind: f.kind, issuedOn: f.issuedOn, supplierName: f.supplierName, ...(f.supplierBizNo ? { supplierBizNo: f.supplierBizNo } : {}), item: f.item || '영수증',
    supply: Number(f.supply), vat: f.kind === 'SIMPLE' ? 0 : Number(f.vat || 0), accountRole: f.accountRole, payRole: f.payRole, attachments: file ? [file.fileId] : [] }) }),
    () => { setG(null); setFile(null); });
  return (
    <section data-acct-receipt={q.data ? (q.data.on ? q.data.mode : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {q.data && !q.data.on && <p className="warn-text">영수증 읽기가 꺼져 있습니다 — 정책 › 전체 설정 acct.receipt_ai(SUPER).</p>}
      {q.data?.on && q.data.mode === 'ASSUME' && <p className="warn-text">간주 방식입니다 — 읽은 값은 가짜입니다(점검용). 실제로 읽으려면 acct.receipt_ai_mode = AI.</p>}
      <p><label>증빙 사진(JPG · PNG) <input type="file" accept="image/jpeg,image/png" disabled={a.busy === 'up'} onChange={(e) => void pick(e.target.files?.[0])} data-acct-receipt-file="" /></label></p>
      {g && (
        <div className="card pad" data-acct-receipt-guess={g.assumed ? 'assumed' : 'ai'}>
          <b>읽은 값 — 확인하고 고치십시오</b> <small className="dim">믿음 {Math.round(g.confidence * 100)}%{g.assumed ? ' · 간주' : ''}</small><br />
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
          <input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} />{' '}
          <input value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} placeholder="공급자" size={16} />{' '}
          <input value={f.supplierBizNo} onChange={(e) => setF({ ...f, supplierBizNo: e.target.value.replace(/\D/g, '') })} placeholder="사업자번호" size={11} />{' '}
          <input value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="품목" size={12} />{' '}
          <input value={f.supply} onChange={(e) => setF({ ...f, supply: e.target.value.replace(/\D/g, '') })} placeholder="공급가" size={9} />{' '}
          <input value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value.replace(/\D/g, '') })} placeholder="부가세" size={8} />{' '}
          <input value={f.accountRole} onChange={(e) => setF({ ...f, accountRole: e.target.value.toUpperCase() })} placeholder="비용 계정" size={12} />{' '}
          <select value={f.payRole} onChange={(e) => setF({ ...f, payRole: e.target.value })}><option value="AP">미지급금</option><option value="CASH">보통예금</option><option value="CARD_AP">법인카드</option></select>{' '}
          <button className="btn-sm" disabled={a.busy === 'book' || !f.issuedOn || !f.supplierName || !Number(f.supply)} onClick={book} data-acct-receipt-book="">매입으로 넣기</button>
          <small className="dim"> 합계 {won(Number(f.supply || 0) + (f.kind === 'SIMPLE' ? 0 : Number(f.vat || 0)))}</small>
        </div>
      )}
      {q.data && !!q.data.items.length && (
        <details data-acct-receipt-reads={q.data.items.length}><summary>최근 읽은 기록 {q.data.items.length}</summary>
          <table className="tbl"><tbody>{q.data.items.map((r) => <tr key={r.id}><td>{ymdhm(r.createdAt)}</td><td>{r.name}</td><td>{r.mode}{r.model ? ` · ${r.model}` : ''}</td><td>{r.ok ? '읽음' : <span className="warn-text">{r.error ?? '실패'}</span>}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}

/* ── v10.439 고정비 ── */
interface Accr { ym: string; on: boolean; note: string; kindRole: Record<string, string>;
  contracts: Array<{ id: string; title: string; kind: string; monthlyAmount: number; state: string; party: string | null; bizNo: string | null; accountRole: string | null; vatIncluded: boolean; enabled: boolean; hasRule: boolean;
    accrualId: string | null; amount: number | null; accrualState: string | null; purchaseId: string | null; matchedBy: string | null }>;
  unmatched: Array<{ id: string; ym: string; amount: number; title: string }> }
export function AccrualBox() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<Accr>(`/admin/acct/accruals?ym=${ym}`, [ym]);
  const a = useAct();
  const d = q.data;
  const rule = (id: string, body: Record<string, unknown>) => void a.run(`u${id}`, () => api(`/admin/acct/accruals/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }), q.reload);
  const match = (id: string) => { const p = prompt('맞출 매입 번호'); if (p) void a.run(`m${id}`, () => api(`/admin/acct/accruals/${id}/match`, { method: 'POST', body: JSON.stringify({ purchaseId: p.trim() }) }), q.reload); };
  return (
    <section data-acct-accrual={d?.contracts.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        {d && (d.on ? <span>고정비 전표 켜짐</span> : <span className="warn-text">꺼짐(acct.contract_accrue) — 맞춤 · 알림만</span>)}</p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>계약</th><th>달 금액</th><th>비용 계정</th><th>부가세 포함</th><th>켜기</th><th>{d.ym} 줄</th><th /></tr></thead>
          <tbody>{d.contracts.map((c) => (
            <tr key={c.id} data-acct-accrual-row={c.accrualState ?? 'none'}>
              <td>{c.title}<br /><small className="dim">{c.party ?? '—'} · {c.state}</small></td><td>{won(c.monthlyAmount)}</td>
              <td>{isSuper() ? <input defaultValue={c.accountRole ?? d.kindRole[c.kind] ?? 'EXP_ETC'} size={12} onBlur={(e) => e.target.value !== (c.accountRole ?? '') && rule(c.id, { accountRole: e.target.value.toUpperCase(), vatIncluded: c.vatIncluded, enabled: c.enabled })} /> : (c.accountRole ?? d.kindRole[c.kind])}</td>
              <td><input type="checkbox" checked={c.vatIncluded} disabled={!isSuper()} onChange={(e) => rule(c.id, { accountRole: c.accountRole ?? undefined, vatIncluded: e.target.checked, enabled: c.enabled })} /></td>
              <td><input type="checkbox" checked={c.enabled} disabled={!isSuper()} onChange={(e) => rule(c.id, { accountRole: c.accountRole ?? undefined, vatIncluded: c.vatIncluded, enabled: e.target.checked })} /></td>
              <td>{c.accrualId ? `${won(c.amount)} · ${c.accrualState === 'MATCHED' ? `맞춤(${c.matchedBy === 'AUTO' ? '자동' : '직접'} · 매입 ${c.purchaseId})` : '미지급'}` : '—'}</td>
              <td>{isSuper() && c.accrualId && c.accrualState === 'ACCRUED' && <button className="btn-sm btn-plain" onClick={() => match(c.accrualId!)}>매입 맞춤</button>}</td></tr>))}</tbody></table>
      )}
      {d && !!d.unmatched.length && (
        <div className="card pad" data-acct-accrual-unmatched={d.unmatched.length}>
          <b className="warn-text">매입이 아직 없는 지난 줄 {d.unmatched.length}</b>
          <ul>{d.unmatched.map((u) => <li key={u.id}>{u.ym} · {u.title} · {won(u.amount)} {isSuper() && <button className="btn-sm btn-plain" onClick={() => match(u.id)}>매입 맞춤</button>}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

/* ── v10.440 장부 보관 · 내부통제 ── */
interface Arch { closedYears: number[]; note: string;
  items: Array<{ id: string; year: number; entries: number; lines: number; debitSum: number; files: number; csvSha256: string; keepUntil: string; note: string | null; createdAt: string; actor: string | null; changed: boolean }> }
interface Ctrl { ym: string; exceptions: number; text: string; note: string; items: Array<{ key: string; label: string; n: number; where: string }> }
export function ArchiveBox() {
  const q = useApi<Arch>('/admin/acct/archives');
  const [ym, setYm] = useState(kstYm(-1));
  const c = useApi<Ctrl>(`/admin/acct/control?ym=${ym}`, [ym]);
  const a = useAct();
  const [year, setYear] = useState('');
  const make = () => void a.run('make', () => api('/admin/acct/archives', { method: 'POST', body: JSON.stringify({ year: Number(year) }) }), q.reload);
  const down = (id: string) => void a.run(`d${id}`, async () => {
    const t = await exportTicket('ACCT_ARCHIVE');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ csv: string; filesCsv: string; filename: string; filesFilename: string; note: string }>(`/admin/acct/archives/${id}/export?ticket=${t}`);
    save(r.filename, r.csv); save(r.filesFilename, r.filesCsv); return r;
  }, undefined, (r) => r?.note ?? '');
  const d = q.data;
  return (
    <section data-acct-archive={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">{d.note}</p>}
      {isSuper() && d && (
        <p><select value={year} onChange={(e) => setYear(e.target.value)} aria-label="해"><option value="">마감한 해</option>{d.closedYears.map((y) => <option key={y} value={y}>{y}</option>)}</select>{' '}
          <button className="btn-sm" disabled={!year || a.busy === 'make'} onClick={make} data-acct-archive-make="">보관 만들기</button></p>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>해</th><th>전표 · 줄</th><th>차변 합</th><th>증빙</th><th>CSV 지문</th><th>보관 기한</th><th>만든 때</th><th /></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.id} data-acct-archive-row={x.year}><td>{x.year}{x.changed && <small className="warn-text"> 바뀜</small>}</td><td>{x.entries} · {x.lines}</td><td>{won(x.debitSum)}</td><td>{x.files}</td>
              <td className="dim"><small>{x.csvSha256.slice(0, 16)}…</small></td><td>{x.keepUntil}</td><td>{ymdhm(x.createdAt)}<br /><small className="dim">{x.actor ?? ''}</small></td>
              <td><button className="btn-sm btn-plain" disabled={a.busy === `d${x.id}`} onClick={() => down(x.id)}>내려받기</button></td></tr>))}</tbody></table>
      )}
      <h3>내부통제 보고 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} aria-label="달" /></h3>
      {c.data && (
        <div className="card pad" data-acct-control={c.data.exceptions}>
          <p className={c.data.exceptions ? 'warn-text' : ''}>{c.data.text}</p>
          <table className="tbl"><tbody>{c.data.items.map((i) => <tr key={i.key}><td>{i.label}</td><td>{i.n}</td><td className="dim"><small>{i.where}</small></td></tr>)}</tbody></table>
          <p className="muted">{c.data.note}</p>
        </div>
      )}
    </section>
  );
}
