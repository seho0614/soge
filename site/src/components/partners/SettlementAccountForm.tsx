'use client';
import { hmKst } from '@/lib/format';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AffResult, AffSettlements } from './types';

/* 은행 이름은 API 로 보내는 값(bankName)이라 한국어 그대로 둡니다(v10.100 다국어 2-5a).
 * 은행 코드는 금융결제원 표준 3자리. 자주 쓰는 곳만 둡니다 — 없으면 문의로 받습니다. */
const BANKS: Array<[string, string]> = [
  ['004', '국민은행'], ['088', '신한은행'], ['020', '우리은행'], ['081', '하나은행'],
  ['011', '농협은행'], ['003', '기업은행'], ['090', '카카오뱅크'], ['092', '토스뱅크'],
  ['089', '케이뱅크'], ['023', 'SC제일은행'], ['031', '대구은행'], ['032', '부산은행'],
  ['071', '우체국'], ['045', '새마을금고'], ['048', '신협'],
];

/**
 * 정산 계좌 등록 — POST /partner/affiliate/settlement-account
 *
 * ★ 본인인증이 먼저입니다(2026-10-01 결정 Q4). 서버가 403 IDENTITY_REQUIRED 로
 *   막으면 본인인증 화면(/verify)으로 보내 드립니다.
 * ★ 번호는 서버가 암호화하고 뒤 4자리만 돌려줍니다 — 화면에도 다시 보이지 않습니다.
 * ★ D001 — 등록·변경하면 인증이 풀립니다. 아래 두 단계로 다시 인증합니다.
 *     ① POST …/settlement-account/verify/request  1원 받기(입금자명에 코드)
 *     ② POST …/settlement-account/verify {code}   코드 확인 → 인증 완료
 *   코드는 10분 유효 · 다섯 번 틀리면 막힘(계좌를 다시 등록해야 풀림).
 */
export function SettlementAccountForm({ hasAccount, identityVerified, account }: {
  hasAccount: boolean; identityVerified: boolean;
  account?: AffSettlements['account'];
}) {
  const router = useRouter();
  const t = useTranslations('affiliate.account');
  const tc = useTranslations('affiliate.common');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [needId, setNeedId] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(!hasAccount);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const bankCode = String(fd.get('bankCode') ?? '');
    const bankName = BANKS.find((b) => b[0] === bankCode)?.[1] ?? '';
    setErr(null); setDone(null); setNeedId(false);
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/settlement-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankCode, bankName,
          accountNo: String(fd.get('accountNo') ?? '').trim(),
          holderName: String(fd.get('holderName') ?? '').trim(),
        }),
      });
      const d = (await r.json().catch(() => null)) as (AffResult & { code?: string; message?: string }) | null;
      if (r.status === 403 && d?.code === 'IDENTITY_REQUIRED') {
        setNeedId(true);
        setErr(t('needIdRedirect'));
        setTimeout(() => router.push('/verify'), 1200);
        return;
      }
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) {
        setErr(d?.code === 'VALIDATION_ERROR'
          ? t('invalid')
          : d?.message ?? t('fail'));
        return;
      }
      if (!d?.ok) { setErr(d?.note ?? t('failShort')); return; }
      setDone(d.note ?? t('done'));
      setOpen(false);
      router.refresh();
    });
  }

  const needVerify = !!account && !account.verifiedAt;

  return (
    <div className="card p2pad">
      {needVerify && account && (
        <AccountVerify account={account} identityVerified={identityVerified} />
      )}
      {!identityVerified && (
        <div className="notice notice-act">
          <div><strong>{t('needId')}</strong><p>{t('needIdDesc')}</p></div>
          <Link className="cta-primary as-link" href="/verify">{tc('verifyNow')}</Link>
        </div>
      )}
      {done && <p className="ok-note" role="status">{done}</p>}
      {!open ? (
        <button type="button" className="btn-sm" onClick={() => setOpen(true)}>
          {hasAccount ? t('change') : t('register')}
        </button>
      ) : (
        <form className="p2form" onSubmit={submit}>
          {hasAccount && <p className="hint">{t.rich('reverifyHint', { b: (c) => <b>{c}</b> })}</p>}
          <label className="fld">
            <span>{t('bank')}</span>
            <select name="bankCode" defaultValue="004" required>
              {BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>{t('accountNo')}</span>
            <input name="accountNo" inputMode="numeric" minLength={6} maxLength={30} required placeholder={t('accountNoPlaceholder')} />
          </label>
          <label className="fld">
            <span>{t('holder')}</span>
            <input name="holderName" minLength={2} maxLength={30} required placeholder={t('holderPlaceholder')} />
            <em>{t('holderNote')}</em>
          </label>
          {err && (
            <p className="form-error" role="alert">
              {err}{needId && <> <Link href="/verify">{t('goNow')}</Link></>}
            </p>
          )}
          <div className="p2act">
            <button className="btn-sm p2primary" disabled={pending}>{pending ? t('pending') : t('save')}</button>
            {hasAccount && <button type="button" className="link-btn" onClick={() => setOpen(false)}>{tc('cancel')}</button>}
          </div>
        </form>
      )}
    </div>
  );
}

type ApiBody = {
  ok?: boolean; verified?: boolean; stub?: boolean; devCode?: string; expiresAt?: string;
  note?: string; code?: string; message?: string;
};

/** 1원 인증 두 단계 (D001) */
function AccountVerify({ account, identityVerified }: {
  account: NonNullable<AffSettlements['account']>; identityVerified: boolean;
}) {
  const router = useRouter();
  const t = useTranslations('affiliate.account.verify');
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<boolean>(!!account.verifyPending);
  const [expiresAt, setExpiresAt] = useState<string | null>(account.verifyPending ? account.verifyExpiresAt ?? null : null);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean>(!!account.verifyLocked);

  async function call(path: string, body?: unknown): Promise<{ status: number; d: ApiBody | null }> {
    const r = await fetch('/api/v1/partner/affiliate/settlement-account/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, d: (await r.json().catch(() => null)) as ApiBody | null };
  }

  function fail(status: number, d: ApiBody | null) {
    if (status === 401) { router.push('/login'); return; }
    if (status === 403 && d?.code === 'IDENTITY_REQUIRED') {
      setErr(t('needId'));
      setTimeout(() => router.push('/verify'), 1200);
      return;
    }
    if (d?.code === 'TOO_MANY_TRIES') setLocked(true);
    if (d?.code === 'CODE_EXPIRED' || d?.code === 'NOT_REQUESTED') { setSent(false); setExpiresAt(null); }
    setErr(d?.code === 'VALIDATION_ERROR' ? t('invalidCode') : d?.message ?? d?.note ?? t('fail'));
  }

  function send() {
    setErr(null); setInfo(null);
    start(async () => {
      const { status, d } = await call('verify/request');
      if (status >= 300 || !d?.ok) { fail(status, d); return; }
      if (d.verified) { setInfo(d.note ?? t('already')); router.refresh(); return; }
      setSent(true); setExpiresAt(d.expiresAt ?? null);
      setInfo(d.note ?? t('sent'));
    });
  }

  function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (!code) { setErr(t('enterCode')); return; }
    setErr(null);
    start(async () => {
      const { status, d } = await call('verify', { code });
      if (status >= 300 || !d?.ok) { fail(status, d); return; }
      setInfo(d.note ?? t('done'));
      router.refresh();
    });
  }

  const until = expiresAt ? hmKst(expiresAt) : null;

  return (
    <div className="p2verify" data-testid="account-verify">
      <h3 className="sec-title">{t('title')}</h3>
      <p className="hint">
        {t.rich('intro', { b: (c) => <b>{c}</b>, bank: account.bankName, last4: account.last4 })}
      </p>
      {locked ? (
        <p className="form-error" role="alert">
          {t.rich('locked', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/partners/inquiries">{c}</Link> })}
        </p>
      ) : (
        <>
          <div className="p2act">
            <span className="dim">{t('step1')}</span>
            <button type="button" className="btn-sm p2primary" onClick={send} disabled={pending || !identityVerified}>
              {sent ? t('resend') : t('send')}
            </button>
            {until && <span className="dim">{t('validUntil', { until })}</span>}
          </div>
          {sent && (
            <form className="p2form" onSubmit={confirm}>
              <label className="fld">
                <span>{t('step2')}</span>
                <input name="code" maxLength={20} required autoComplete="one-time-code" placeholder={t('codePlaceholder')} />
                <em>{t('codeNote')}</em>
              </label>
              <div className="p2act">
                <button className="btn-sm p2primary" disabled={pending}>{pending ? t('pending') : t('submit')}</button>
              </div>
            </form>
          )}
        </>
      )}
      {info && <p className="ok-note" role="status">{info}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}
