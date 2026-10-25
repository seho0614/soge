'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface PayoutAccount {
  id: string; bankName: string; accountNo: string; holderName: string;
  verified: boolean; isDefault: boolean; isStub: boolean; verifyTries: number; verifiedAt: string | null;
}

/* 은행 코드는 금융결제원 표준 3자리(파트너 정산 계좌 화면과 같은 목록).
 * v10.99 — 은행 이름은 서버로 보내는 값(bankName)이라 사전에 넣지 않습니다. */
const BANKS: Array<[string, string]> = [
  ['004', '국민은행'], ['088', '신한은행'], ['020', '우리은행'], ['081', '하나은행'],
  ['011', '농협은행'], ['003', '기업은행'], ['090', '카카오뱅크'], ['092', '토스뱅크'],
  ['089', '케이뱅크'], ['023', 'SC제일은행'], ['031', '대구은행'], ['032', '부산은행'],
  ['071', '우체국'], ['045', '새마을금고'], ['048', '신협'],
];

/**
 * v10.28 받을 계좌 — 개인 회원(사업자 인증 없음)이 소개비를 받을 본인 명의 계좌. GET/POST /me/payout-accounts · POST …/:id/verify
 * ★ 계좌번호는 서버가 암호화해 보관하고 화면에는 뒤 4자리만 보입니다.
 * ★ 1원 확인 연동 전에는 간주 모드(assume.bank) — 확인되면 「확인 간주」로 표시합니다(오픈 차단 항목에 남아 있음).
 * ★ 회사는 이 계좌로 돈을 보내지 않습니다(INV-11) — 소개비를 주는 당사자에게 알려 드릴 계좌가 본인 것인지 확인할 뿐입니다.
 */
export function PayoutBox({ accounts }: { accounts: PayoutAccount[] }) {
  const router = useRouter();
  const t = useTranslations('myDeal');
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(accounts.length === 0);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const bankCode = String(fd.get('bankCode') ?? '');
    setErr(null); setInfo(null);
    start(async () => {
      const r = await fetch('/api/v1/me/payout-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode, bankName: BANKS.find((b) => b[0] === bankCode)?.[1] ?? '',
          accountNo: String(fd.get('accountNo') ?? '').trim(), holderName: String(fd.get('holderName') ?? '').trim() }),
      });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? t('payout.addFail')); return; }
      setInfo(d?.note ?? t('payout.sent'));
      setOpen(false); router.refresh();
    });
  }

  function verify(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (!code) { setErr(t('payout.needCode')); return; }
    setErr(null); setInfo(null);
    start(async () => {
      const r = await fetch(`/api/v1/me/payout-accounts/${encodeURIComponent(id)}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('payout.verifyFail')); return; }
      setInfo(d?.note ?? t('payout.verified')); router.refresh();
    });
  }

  return (
    <section className="card p2pad" data-payout-box>
      <h2 className="sec-title">{t('payout.title')}</h2>
      <p className="hint">{t('payout.hint')}</p>
      {accounts.length > 0 && (
        <ul className="rows" data-payout-list>
          {accounts.map((a) => (
            <li key={a.id} className="row" data-payout-row={a.id} data-payout-state={a.verified ? (a.isStub ? 'ASSUMED' : 'VERIFIED') : 'PENDING'}>
              <div className="row-main">
                <span>{a.bankName} {a.accountNo.slice(-4).padStart(8, '*')}</span>
                <span className="muted">{a.holderName}</span>
                {a.verified
                  ? <span className="state state-ok">{a.isStub ? t('stl.assumed') : t('payout.ok')}</span>
                  : <span className="state state-wait">{t('payout.pending')}</span>}
              </div>
              {!a.verified && (a.verifyTries >= 5
                ? <p className="form-error" role="alert">{t('payout.locked')}</p>
                : (
                  <form className="p2form" onSubmit={(e) => verify(a.id, e)} data-payout-verify={a.id}>
                    <label className="fld">
                      <span>{t('payout.code')}</span>
                      <input name="code" maxLength={20} required autoComplete="one-time-code" placeholder={t('payout.codePh')} data-payout-code />
                      <em>{t('payout.tries', { n: String(5 - a.verifyTries) })}</em>
                    </label>
                    <button className="btn-sm p2primary" disabled={pending} data-payout-verify-send>{t('payout.verifyBtn')}</button>
                  </form>))}
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button type="button" className="btn-sm" onClick={() => setOpen(true)} data-payout-open>{t('payout.other')}</button>
      ) : (
        <form className="p2form" onSubmit={add} data-payout-form>
          <label className="fld"><span>{t('payout.bank')}</span>
            <select name="bankCode" defaultValue="004" required data-payout-bank>
              {BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select></label>
          <label className="fld"><span>{t('payout.accNo')}</span>
            <input name="accountNo" inputMode="numeric" pattern="[0-9-]{9,20}" required placeholder={t('payout.accNoPh')} data-payout-no /></label>
          <label className="fld"><span>{t('payout.holder')}</span>
            <input name="holderName" minLength={2} maxLength={30} required placeholder={t('payout.holderPh')} data-payout-holder />
            <em>{t('payout.ownOnly')}</em></label>
          <div className="p2act">
            <button className="btn-sm p2primary" disabled={pending} data-payout-add>{pending ? t('payout.sending') : t('payout.send1')}</button>
            {accounts.length > 0 && <button type="button" className="link-btn" onClick={() => setOpen(false)}>{t('payout.cancel')}</button>}
          </div>
        </form>
      )}
      {info && <p className="ok-note" role="status" data-payout-info>{info}</p>}
      {err && <p className="form-error" role="alert" data-payout-err>{err}</p>}
    </section>
  );
}
