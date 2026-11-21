'use client';
/**
 * v10.609 (docs/751) ㉕ 파트너센터 › 계약 — 내 파트너 계약 · 갱신 계약 서명(간주 · 시험 서명 · 법적 전자서명 아님 표시)
 *   GET /api/v1/partner/bzx/contracts · POST /api/v1/partner/bzx/contracts/{id}/sign(대표자 이름 또는 상호 · 동의 · 본 본문 지문)
 *   전자계약 업체(HTTP)로 보낸 계약은 업체 화면 주소만 보여 줌
 *   글자는 이 파일 안 두 언어(ko · en) — 사전 묶음(index.ts)을 고치지 않으려고(NOTES)
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';

interface C { id: string; title: string; startOn: string; endOn: string; state: string; signMode: string; signedAt: string | null; signerName: string | null;
  daysLeft: number; autoRenew: boolean; body: string | null; docHash: string | null; signUrl: string | null }
interface Res { company: string; items: C[] }

const TXT = {
  ko: {
    st: { SENT: '서명 기다림', SIGNED: '효력 있음', EXPIRED: '만기 지남', ENDED: '갱신으로 끝남' } as Record<string, string>,
    none: '계약이 없습니다.', notOwner: '파트너 대표 계정에서만 계약을 봅니다.', period: '기간', left: '만기까지 {n}일', auto: '자동 갱신',
    read: '계약서 보기', sign: '서명', name: '대표자 이름(또는 상호)', agree: '계약 내용을 읽고 동의합니다', done: '서명했습니다.',
    stub: '연동 전 간주 서명입니다 — 법적 전자서명이 아니며, 전자계약 연동 뒤 업체 화면에서 다시 받습니다.', vendor: '전자계약 업체 화면에서 서명', signed: '서명 {d} · {who}',
  },
  en: {
    st: { SENT: 'Awaiting signature', SIGNED: 'In effect', EXPIRED: 'Expired', ENDED: 'Replaced by renewal' } as Record<string, string>,
    none: 'No contracts.', notOwner: 'Only the partner owner account can see contracts.', period: 'Term', left: '{n} days to expiry', auto: 'Auto-renewal',
    read: 'View contract', sign: 'Sign', name: 'Representative name (or company name)', agree: 'I have read and agree to the contract', done: 'Signed.',
    stub: 'This is a provisional signature before e-signature integration — it is not a legal e-signature and will be collected again on the provider screen later.', vendor: 'Sign on the e-signature provider screen', signed: 'Signed {d} · {who}',
  },
};

export function PartnerContracts() {
  const t = TXT[useLocale() === 'ko' ? 'ko' : 'en'];
  const [d, setD] = useState<Res | null>(null);
  const [none, setNone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await fetch('/api/v1/partner/bzx/contracts').catch(() => null);
    if (r?.ok) setD((await r.json()) as Res); else setNone(true);
  };
  useEffect(() => { void load(); }, []);
  const sign = async (c: C) => {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/v1/partner/bzx/contracts/${c.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signerName: name, agree, docHash: c.docHash ?? undefined }) }).catch(() => null);
    const b = (await r?.json().catch(() => null)) as { message?: string } | null;
    setBusy(false);
    if (r?.ok) { setMsg(t.done); setOpen(null); setName(''); setAgree(false); await load(); } else setMsg(b?.message ?? '—');
  };
  if (none) return <p data-bzx-ptc-none="">{t.notOwner}</p>;
  if (!d) return null;
  return (
    <div data-bzx-ptc={d.items.length}>
      {msg && <p role="status">{msg}</p>}
      {!d.items.length && <p>{t.none}</p>}
      {d.items.map((c) => (
        <div key={c.id} className="pt-fset" data-bzx-ptc-row={c.id} style={{ marginBottom: 12 }}>
          <p><b>{c.title}</b> · {t.st[c.state] ?? c.state}{c.autoRenew ? ` · ${t.auto}` : ''}</p>
          <p>{t.period} {c.startOn} ~ {c.endOn}{c.state === 'SIGNED' ? ` · ${t.left.replace('{n}', String(c.daysLeft))}` : ''}</p>
          {c.signedAt && <p>{t.signed.replace('{d}', c.signedAt.slice(0, 10)).replace('{who}', c.signerName ?? '')}</p>}
          {c.body && <button type="button" className="pt-bo" onClick={() => setOpen(open === c.id ? null : c.id)}>{t.read}</button>}
          {open === c.id && c.body && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }} data-bzx-ptc-body={c.id}>{c.body}</pre>}
          {c.state === 'SENT' && c.signMode === 'HTTP' && c.signUrl && <p><a href={c.signUrl} target="_blank" rel="noopener noreferrer">{t.vendor}</a></p>}
          {c.state === 'SENT' && c.signMode !== 'HTTP' && open === c.id && (
            <div data-bzx-ptc-sign={c.id}>
              <p>{t.stub}</p>
              <p><input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} data-bzx-ptc-name="" /></p>
              <p><label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-bzx-ptc-agree="" /> {t.agree}</label></p>
              <button type="button" className="pt-bp" disabled={busy || !agree || !name.trim()} onClick={() => void sign(c)} data-bzx-ptc-go="">{t.sign}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
