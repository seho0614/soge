'use client';

import { useEffect, useState } from 'react';
import { ymdKst } from '@/lib/format';

/**
 * SB-PTC-LST-010 내 매물 · 입점 상태 — 법률 · 세무 월 정액 노출 신청 (서버 D019 · /api/v1/partner/directory)
 * 리드를 받지 않습니다. 입금 확인 뒤 본사가 노출 기간을 켭니다.
 * 자격(변호사 · 법무사 / 세무사 · 공인회계사 등록) 심사와 상담 축 입점 승인이 먼저입니다.
 *
 * v10.33 (D092 · 2026-10-11 대표 결정)
 *   ① 부가세 별도 — 「월 300,000원 (부가세 별도)」 · 입금하실 금액 = 월 노출료 × 개월수 + 부가세 10%(1원 미만 절사)
 *   ② 기간 연장 A안 — 노출 중인 줄의 「연장 신청」(개월수) → 노출은 계속 · 본사가 입금을 확인하면 기존 종료일 다음 날부터 이어짐
 *   ③ 세금계산서 — 입금 확인마다 1건(공급자 = 소개뱅크 운영 법인). 아래 표에서 발행 번호 · 일자 · 금액을 봅니다.
 */
interface Renewal { months: number; monthlyFee: number; supplyAmount: number; vatAmount: number; totalAmount: number; from: string; to: string }
interface Mine {
  id: string; categoryCode: string; categoryName: string; displayName: string; contactPhone: string;
  state: string; monthlyFee?: number | null; paidFrom?: string | null; paidTo?: string | null; reason?: string | null;
  months?: number | null; supplyAmount?: number | null; vatAmount?: number | null; totalAmount?: number | null; rounds?: number;
  renewal?: Renewal | null; lastRenewal?: { state: string; reason: string | null; decidedAt: string } | null;
}
interface Invoice {
  id: string; state: string; supply: number; vat: number; total: number; invoiceNo: string | null; issuedOn: string | null;
  supplierName: string; seq: number; kind: string; from: string; to: string; months: number | null; displayName: string;
  /* v10.34 (D093) 국세청 전송 — 업체 화면에는 발행됨 · 승인번호만(간주면 「전송 대기 — 연동 전」 · 내부 번호 없음) */
  etaxMode?: string | null; etaxStatus?: string | null; assumed?: boolean; approvalNo?: string | null;
}
/** v10.34 — 세금계산서 상태 문구(사실 그대로) */
const invState = (i: Invoice) => i.etaxStatus === 'SENT' ? '발행됨 · 국세청 전송'
  : i.etaxStatus === 'ASSUMED' ? '전송 대기 — 연동 전'
  : i.etaxStatus === 'CANCELED' ? '취소 · 수정 발행'
  : i.etaxStatus === 'SENDING' || i.etaxStatus === 'FAILED' ? '발행 처리 중'
  : i.state === 'ISSUED' ? '발행됨' : '발행 요청';
const STATE: Record<string, string> = { PENDING: '심사 · 입금 확인 대기', ACTIVE: '노출 중', RENEW_REQUESTED: '노출 중 · 연장 입금 확인 대기', ENDED: '종료', REJECTED: '반려' };
const won = (v: number | null | undefined) => `${Number(v ?? 0).toLocaleString('ko-KR')}원`;
/** 부가세 = 공급가액 × 10% · 1원 미만 절사 (서버 fn_directory_vat 와 같은 규칙 — 기록은 서버가 계산합니다) */
const vatOf = (supply: number) => Math.floor(supply / 10);
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function DirectoryApply() {
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [inv, setInv] = useState<Invoice[]>([]);
  const [f, setF] = useState({ categoryCode: 'CSL_LEGAL', displayName: '', intro: '', contactPhone: '', websiteUrl: '', sido: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [renewM, setRenewM] = useState<Record<string, number>>({});
  /* D020 — 월 노출료 기준 금액(운영이 등록 · 설정 directory.monthly_fee). 신청 전에 금액을 알 수 있게 보여 줍니다 */
  const [baseFee, setBaseFee] = useState<number | null>(null);

  async function load() {
    const r = await fetch('/api/v1/partner/directory');
    const j = await r.json().catch(() => null);
    setMine(r.ok ? (j as Mine[]) : []);
    const s = await fetch('/api/v1/site-settings/public').then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const v = s?.['directory.monthly_fee'];
    setBaseFee(typeof v === 'string' && /^[1-9][0-9]{3,8}$/.test(v) ? Number(v) : null);
    const iv = await fetch('/api/v1/partner/directory/invoices').then((x) => (x.ok ? x.json() : [])).catch(() => []);
    setInv(Array.isArray(iv) ? iv : []);
  }
  useEffect(() => { void load(); }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr(null); setMsg(null);
    if (f.displayName.trim().length < 2) return setErr('사무소 이름을 적어 주십시오.');
    if (!/^[0-9-]{8,14}$/.test(f.contactPhone.trim())) return setErr('대표번호를 02-1234-5678 형식으로 적어 주십시오.');
    if (f.websiteUrl && !/^https:\/\//.test(f.websiteUrl.trim())) return setErr('홈페이지는 https:// 로 시작해야 합니다.');
    if (!f.sido.trim()) return setErr('지역을 적어 주십시오.');
    setBusy(true);
    try {
      const r = await fetch('/api/v1/partner/directory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, intro: f.intro.trim() || undefined, websiteUrl: f.websiteUrl.trim() || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? '신청하지 못했습니다.');
      setMine(j as Mine[]); setMsg('신청했습니다. 자격 확인과 입금 확인 뒤 노출됩니다.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  /* v10.33 — 연장 신청(A안). 노출은 계속되고, 입금이 확인되면 기존 종료일 다음 날부터 이어집니다 */
  async function renew(m: Mine) {
    setErr(null); setMsg(null);
    const months = renewM[m.id] ?? 1;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/partner/directory/${m.id}/renew`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? '연장 신청을 하지 못했습니다.');
      setMine(j as Mine[]);
      const rn = (j as Mine[]).find((x) => x.id === m.id)?.renewal;
      setMsg(`연장 신청을 냈습니다 — ${months}개월 · 입금하실 금액 ${won(rn?.totalAmount)}(부가세 포함). 입금이 확인되면 ${rn ? ymdKst(rn.from) : ''}부터 이어집니다.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const fee = baseFee ?? 0;
  return (
    <section className="card ptc-box" data-directory-apply="1">
      <h2>법률 · 세무 사무소 노출 (월 정액)</h2>
      <p className="hint">상담 신청을 받지 않고 업체 정보만 노출합니다. 노출료는 기간 정액이며 연락 · 수임 건수와 무관합니다.
        화면에는 「광고」로 표시되고 순서는 날마다 바뀝니다.</p>
      <p className="hint" data-base-fee={baseFee ?? ''}>
        {baseFee !== null
          ? <>노출료는 <b data-vat-label="">월 {won(fee)} (부가세 별도)</b>입니다 — 입금하실 금액은 부가세 10%를 더한 <b>월 {won(fee + vatOf(fee))}</b>
            (예: 3개월 {won(fee * 3 + vatOf(fee * 3))}). 입금이 확인되면 본사가 노출 기간을 켜고, 입금 확인마다 세금계산서를 발행합니다.</>
          : <>월 노출료는 심사 때 안내해 드립니다.</>}
      </p>
      {mine && mine.length > 0 ? (
        /* v10.33 — 좁은 화면(390)에서는 표만 옆으로 밀어 봅니다(쪽 전체가 옆으로 밀리지 않게) */
        <div style={{ overflowX: 'auto' }} data-dir-scroll="">
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>업종</th><th>사무소</th><th>상태</th><th>기간 · 금액</th><th>연장</th></tr></thead>
          <tbody>{mine.map((m) => {
            const rm = renewM[m.id] ?? 1;
            const qs = fee * rm, qv = vatOf(qs);
            return (
              <tr key={m.id} data-dir-mine={m.categoryCode} data-dir-state={m.state}><td>{m.categoryName}</td><td>{m.displayName}</td>
                <td>{STATE[m.state] ?? m.state}{m.reason ? <span className="hint"> — {m.reason}</span> : null}
                  {m.lastRenewal?.state === 'REJECTED' && m.state === 'ACTIVE' ? <div className="hint" data-renew-rejected="">연장 신청 반려 — {m.lastRenewal.reason}</div> : null}</td>
                <td>{m.paidFrom && m.paidTo ? `${ymdKst(m.paidFrom)} ~ ${ymdKst(m.paidTo)}` : '—'}
                  {m.monthlyFee ? <span className="hint"> · 월 {won(Number(m.monthlyFee))} (부가세 별도)</span> : null}
                  {m.totalAmount ? <div className="hint" data-dir-paid={m.totalAmount}>최근 입금 {m.months}개월 · 공급가액 {won(m.supplyAmount)} + 부가세 {won(m.vatAmount)} = 합계 {won(m.totalAmount)}{m.rounds ? ` · ${m.rounds}회차` : ''}</div> : null}</td>
                <td>
                  {m.state === 'RENEW_REQUESTED' && m.renewal ? (
                    <div data-renew-open={m.renewal.totalAmount}>
                      <b>{m.renewal.months}개월 연장 신청 중</b><br />
                      <span className="hint">입금하실 금액 <b>{won(m.renewal.totalAmount)}</b>(공급가액 {won(m.renewal.supplyAmount)} + 부가세 {won(m.renewal.vatAmount)})
                        · 입금이 확인되면 {ymdKst(m.renewal.from)} ~ {ymdKst(m.renewal.to)}. 그동안 노출은 계속됩니다.</span>
                    </div>
                  ) : m.state === 'ACTIVE' && baseFee !== null ? (
                    <div data-renew-form="">
                      <select name="renew-months" aria-label="연장 개월수" value={rm} onChange={(e) => setRenewM({ ...renewM, [m.id]: Number(e.target.value) })}>
                        {MONTHS.map((x) => <option key={x} value={x}>{x}개월</option>)}
                      </select>{' '}
                      <button type="button" className="btn-sm" data-act="renew" disabled={busy} onClick={() => void renew(m)}>연장 신청</button>
                      <div className="hint" data-renew-quote={qs + qv}>{won(fee)} × {rm}개월 = {won(qs)} + 부가세 {won(qv)} = <b>{won(qs + qv)}</b> · {m.paidTo ? `${ymdKst(m.paidTo)} 다음 날부터` : ''}</div>
                    </div>
                  ) : '—'}
                </td></tr>
            );
          })}</tbody>
        </table>
        </div>
      ) : null}
      {inv.length > 0 ? (
        <div data-dir-invoices="">
          <h3>세금계산서 (입금 확인마다 1건)</h3>
          <p className="hint">공급자: {inv[0]?.supplierName} — 노출(소개)을 해 드리는 소개뱅크가 발행합니다. 「발행 요청」은 금액이 확정됐다는 뜻이고, 발행되면 번호(국세청 승인번호) · 일자가 보입니다. 「전송 대기 — 연동 전」은 국세청 전자세금계산서 연동 전이라 아직 국세청에 전송되지 않았다는 뜻입니다.</p>
          <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>회차 · 기간</th><th>공급가액</th><th>부가세</th><th>합계</th><th>상태</th><th>번호(승인번호) · 일자</th></tr></thead>
            <tbody>{inv.map((i) => (
              <tr key={i.id} data-inv={i.id} data-inv-state={i.state} data-etax={i.etaxStatus ?? ''}>
                <td>{i.displayName} · {i.seq}회차({i.kind === 'RENEWAL' ? '연장' : '처음'})<br /><span className="hint">{ymdKst(i.from)} ~ {ymdKst(i.to)}</span></td>
                <td>{won(i.supply)}</td><td>{won(i.vat)}</td><td><b>{won(i.total)}</b></td>
                <td>{invState(i)}</td>
                <td>{i.invoiceNo ? <>{i.invoiceNo}<br /><span className="hint">{ymdKst(i.issuedOn)}</span></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      ) : null}
      <div className="form">
        <label>업종<select name="dir-category" value={f.categoryCode} onChange={set('categoryCode')}>
          <option value="CSL_LEGAL">법률(변호사 · 법무사)</option><option value="CSL_TAX">세무 · 회계(세무사 · 회계사)</option>
        </select></label>
        <label>사무소 이름<input name="dir-name" value={f.displayName} onChange={set('displayName')} maxLength={60} /></label>
        <label>소개 <span className="hint">(500자 이내 · 승소율 · 결과 보장 표현 금지)</span>
          <textarea name="dir-intro" rows={3} value={f.intro} onChange={set('intro')} maxLength={500} /></label>
        <label>대표번호 <span className="hint">(공개됩니다)</span><input name="dir-phone" inputMode="tel" value={f.contactPhone} onChange={set('contactPhone')} /></label>
        <label>홈페이지 <span className="hint">(선택)</span><input name="dir-url" value={f.websiteUrl} onChange={set('websiteUrl')} placeholder="https://" /></label>
        <label>지역<input name="dir-sido" value={f.sido} onChange={set('sido')} maxLength={20} placeholder="서울" /></label>
      </div>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {msg ? <p className="form-ok" role="status">{msg}</p> : null}
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
        {busy ? '처리하는 중…' : '노출 신청 · 정보 저장'}
      </button>
    </section>
  );
}
