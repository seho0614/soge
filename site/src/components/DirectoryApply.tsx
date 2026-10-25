'use client';

import { useEffect, useState } from 'react';
import { ymdKst } from '@/lib/format';
import { useTranslations } from 'next-intl';

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
/** v10.34 — 세금계산서 상태 문구(사실 그대로) · v10.101 문구는 사전 join.directoryApply.inv.<키> */
const invState = (i: Invoice) => i.etaxStatus === 'SENT' ? 'sent' as const
  : i.etaxStatus === 'ASSUMED' ? 'assumed' as const
  : i.etaxStatus === 'CANCELED' ? 'canceled' as const
  : i.etaxStatus === 'SENDING' || i.etaxStatus === 'FAILED' ? 'sending' as const
  : i.state === 'ISSUED' ? 'issued' as const : 'requested' as const;
/* 노출 상태 글은 사전 join.directoryApply.state.<상태> — 없는 상태는 서버 값 그대로 */
const won = (v: number | null | undefined) => `${Number(v ?? 0).toLocaleString('ko-KR')}원`;
/** 부가세 = 공급가액 × 10% · 1원 미만 절사 (서버 fn_directory_vat 와 같은 규칙 — 기록은 서버가 계산합니다) */
const vatOf = (supply: number) => Math.floor(supply / 10);
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function DirectoryApply() {
  const t = useTranslations('join.directoryApply');
  const stateText = (s: string) => { const k = `state.${s}` as never; return t.has(k) ? t(k) : s; };
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
    if (f.displayName.trim().length < 2) return setErr(t('errName'));
    if (!/^[0-9-]{8,14}$/.test(f.contactPhone.trim())) return setErr(t('errPhone'));
    if (f.websiteUrl && !/^https:\/\//.test(f.websiteUrl.trim())) return setErr(t('errUrl'));
    if (!f.sido.trim()) return setErr(t('errRegion'));
    setBusy(true);
    try {
      const r = await fetch('/api/v1/partner/directory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, intro: f.intro.trim() || undefined, websiteUrl: f.websiteUrl.trim() || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? t('failed'));
      setMine(j as Mine[]); setMsg(t('applied'));
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
      if (!r.ok) throw new Error(j?.message ?? t('renewFail'));
      setMine(j as Mine[]);
      const rn = (j as Mine[]).find((x) => x.id === m.id)?.renewal;
      setMsg(t('renewed', { months: String(months), amount: won(rn?.totalAmount), from: rn ? ymdKst(rn.from) : '' }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const fee = baseFee ?? 0;
  return (
    <section className="card ptc-box" data-directory-apply="1">
      <h2>{t('title')}</h2>
      <p className="hint">{t('lead')}</p>
      <p className="hint" data-base-fee={baseFee ?? ''}>
        {baseFee !== null
          ? <>{t.rich('feeLine', { fee: won(fee), feeVat: won(fee + vatOf(fee)), ex3: won(fee * 3 + vatOf(fee * 3)), vat: (c) => <b data-vat-label="">{c}</b>, b: (c) => <b>{c}</b> })}</>
          : <>{t('feeLater')}</>}
      </p>
      {mine && mine.length > 0 ? (
        /* v10.33 — 좁은 화면(390)에서는 표만 옆으로 밀어 봅니다(쪽 전체가 옆으로 밀리지 않게) */
        <div style={{ overflowX: 'auto' }} data-dir-scroll="">
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>{t('th.category')}</th><th>{t('th.office')}</th><th>{t('th.state')}</th><th>{t('th.period')}</th><th>{t('th.renew')}</th></tr></thead>
          <tbody>{mine.map((m) => {
            const rm = renewM[m.id] ?? 1;
            const qs = fee * rm, qv = vatOf(qs);
            return (
              <tr key={m.id} data-dir-mine={m.categoryCode} data-dir-state={m.state}><td>{m.categoryName}</td><td>{m.displayName}</td>
                <td>{stateText(m.state)}{m.reason ? <span className="hint"> — {m.reason}</span> : null}
                  {m.lastRenewal?.state === 'REJECTED' && m.state === 'ACTIVE' ? <div className="hint" data-renew-rejected="">{t('renewRejected', { reason: m.lastRenewal.reason ?? '' })}</div> : null}</td>
                <td>{m.paidFrom && m.paidTo ? `${ymdKst(m.paidFrom)} ~ ${ymdKst(m.paidTo)}` : '—'}
                  {m.monthlyFee ? <span className="hint">{t('monthlyFee', { fee: won(Number(m.monthlyFee)) })}</span> : null}
                  {m.totalAmount ? <div className="hint" data-dir-paid={m.totalAmount}>{t('lastPaid', { months: String(m.months ?? ''), supply: won(m.supplyAmount), vat: won(m.vatAmount), total: won(m.totalAmount) })}{m.rounds ? t('rounds', { n: String(m.rounds) }) : ''}</div> : null}</td>
                <td>
                  {m.state === 'RENEW_REQUESTED' && m.renewal ? (
                    <div data-renew-open={m.renewal.totalAmount}>
                      <b>{t('renewOpenB', { n: String(m.renewal.months) })}</b><br />
                      <span className="hint">{t.rich('renewOpen', { total: won(m.renewal.totalAmount), supply: won(m.renewal.supplyAmount), vat: won(m.renewal.vatAmount), from: ymdKst(m.renewal.from), to: ymdKst(m.renewal.to), b: (c) => <b>{c}</b> })}</span>
                    </div>
                  ) : m.state === 'ACTIVE' && baseFee !== null ? (
                    <div data-renew-form="">
                      <select name="renew-months" aria-label={t('renewMonths')} value={rm} onChange={(e) => setRenewM({ ...renewM, [m.id]: Number(e.target.value) })}>
                        {MONTHS.map((x) => <option key={x} value={x}>{t('months', { n: String(x) })}</option>)}
                      </select>{' '}
                      <button type="button" className="btn-sm" data-act="renew" disabled={busy} onClick={() => void renew(m)}>{t('renewBtn')}</button>
                      <div className="hint" data-renew-quote={qs + qv}>{t.rich('quote', { fee: won(fee), n: String(rm), qs: won(qs), qv: won(qv), total: won(qs + qv), b: (c) => <b>{c}</b> })}{m.paidTo ? t('nextDay', { date: ymdKst(m.paidTo) }) : ''}</div>
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
          <h3>{t('invTitle')}</h3>
          <p className="hint">{t('invNote', { supplier: inv[0]?.supplierName ?? '' })}</p>
          <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>{t('ith.round')}</th><th>{t('ith.supply')}</th><th>{t('ith.vat')}</th><th>{t('ith.total')}</th><th>{t('ith.state')}</th><th>{t('ith.no')}</th></tr></thead>
            <tbody>{inv.map((i) => (
              <tr key={i.id} data-inv={i.id} data-inv-state={i.state} data-etax={i.etaxStatus ?? ''}>
                <td>{i.displayName} · {t('seq', { n: String(i.seq), kind: i.kind === 'RENEWAL' ? t('kindRenew') : t('kindFirst') })}<br /><span className="hint">{ymdKst(i.from)} ~ {ymdKst(i.to)}</span></td>
                <td>{won(i.supply)}</td><td>{won(i.vat)}</td><td><b>{won(i.total)}</b></td>
                <td>{t(`inv.${invState(i)}`)}</td>
                <td>{i.invoiceNo ? <>{i.invoiceNo}<br /><span className="hint">{ymdKst(i.issuedOn)}</span></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      ) : null}
      <div className="form">
        <label>{t('fCategory')}<select name="dir-category" value={f.categoryCode} onChange={set('categoryCode')}>
          <option value="CSL_LEGAL">{t('optLegal')}</option><option value="CSL_TAX">{t('optTax')}</option>
        </select></label>
        <label>{t('fName')}<input name="dir-name" value={f.displayName} onChange={set('displayName')} maxLength={60} /></label>
        <label>{t('fIntro')} <span className="hint">{t('fIntroHint')}</span>
          <textarea name="dir-intro" rows={3} value={f.intro} onChange={set('intro')} maxLength={500} /></label>
        <label>{t('fPhone')} <span className="hint">{t('fPhoneHint')}</span><input name="dir-phone" inputMode="tel" value={f.contactPhone} onChange={set('contactPhone')} /></label>
        <label>{t('fUrl')} <span className="hint">{t('optional')}</span><input name="dir-url" value={f.websiteUrl} onChange={set('websiteUrl')} placeholder="https://" /></label>
        <label>{t('fRegion')}<input name="dir-sido" value={f.sido} onChange={set('sido')} maxLength={20} placeholder={t('regionPh')} /></label>
      </div>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {msg ? <p className="form-ok" role="status">{msg}</p> : null}
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
        {busy ? t('working') : t('submit')}
      </button>
    </section>
  );
}
