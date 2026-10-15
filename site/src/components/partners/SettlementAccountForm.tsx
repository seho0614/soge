'use client';
import { hmKst } from '@/lib/format';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AffResult, AffSettlements } from './types';

/* 은행 코드는 금융결제원 표준 3자리. 자주 쓰는 곳만 둡니다 — 없으면 문의로 받습니다. */
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
        setErr('본인인증을 먼저 하셔야 계좌를 등록하실 수 있습니다. 인증 화면으로 이동합니다.');
        setTimeout(() => router.push('/verify'), 1200);
        return;
      }
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) {
        setErr(d?.code === 'VALIDATION_ERROR'
          ? '입력한 내용을 확인해 주십시오. 계좌번호는 6~30자, 예금주는 2~30자입니다.'
          : d?.message ?? '등록하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
        return;
      }
      if (!d?.ok) { setErr(d?.note ?? '등록하지 못했습니다.'); return; }
      setDone(d.note ?? '등록했습니다.');
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
          <div><strong>본인인증이 필요합니다.</strong><p>계좌 명의가 회원 본인인지 확인하는 첫 단계입니다.</p></div>
          <Link className="cta-primary as-link" href="/verify">본인인증하기</Link>
        </div>
      )}
      {done && <p className="ok-note" role="status">{done}</p>}
      {!open ? (
        <button type="button" className="btn-sm" onClick={() => setOpen(true)}>
          {hasAccount ? '계좌 변경' : '계좌 등록'}
        </button>
      ) : (
        <form className="p2form" onSubmit={submit}>
          {hasAccount && <p className="hint">계좌를 바꾸시면 <b>다시 인증</b>해야 지급됩니다.</p>}
          <label className="fld">
            <span>은행</span>
            <select name="bankCode" defaultValue="004" required>
              {BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>계좌번호</span>
            <input name="accountNo" inputMode="numeric" minLength={6} maxLength={30} required placeholder="예: 123456-01-234567" />
          </label>
          <label className="fld">
            <span>예금주</span>
            <input name="holderName" minLength={2} maxLength={30} required placeholder="본인 이름" />
            <em>본인 명의 계좌만 받습니다</em>
          </label>
          {err && (
            <p className="form-error" role="alert">
              {err}{needId && <> <Link href="/verify">지금 이동</Link></>}
            </p>
          )}
          <div className="p2act">
            <button className="btn-sm p2primary" disabled={pending}>{pending ? '등록 중…' : '계좌 저장'}</button>
            {hasAccount && <button type="button" className="link-btn" onClick={() => setOpen(false)}>취소</button>}
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
      setErr('본인인증을 먼저 하셔야 합니다. 인증 화면으로 이동합니다.');
      setTimeout(() => router.push('/verify'), 1200);
      return;
    }
    if (d?.code === 'TOO_MANY_TRIES') setLocked(true);
    if (d?.code === 'CODE_EXPIRED' || d?.code === 'NOT_REQUESTED') { setSent(false); setExpiresAt(null); }
    setErr(d?.code === 'VALIDATION_ERROR' ? '코드는 글자와 숫자만 적으십시오.' : d?.message ?? d?.note ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
  }

  function send() {
    setErr(null); setInfo(null);
    start(async () => {
      const { status, d } = await call('verify/request');
      if (status >= 300 || !d?.ok) { fail(status, d); return; }
      if (d.verified) { setInfo(d.note ?? '이미 인증된 계좌입니다.'); router.refresh(); return; }
      setSent(true); setExpiresAt(d.expiresAt ?? null);
      setInfo(d.note ?? '1원을 보냈습니다. 입금자명의 코드를 적어 주십시오.');
    });
  }

  function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (!code) { setErr('코드를 적어 주십시오.'); return; }
    setErr(null);
    start(async () => {
      const { status, d } = await call('verify', { code });
      if (status >= 300 || !d?.ok) { fail(status, d); return; }
      setInfo(d.note ?? '인증했습니다.');
      router.refresh();
    });
  }

  const until = expiresAt ? hmKst(expiresAt) : null;

  return (
    <div className="p2verify" data-testid="account-verify">
      <h3 className="sec-title">계좌 1원 인증</h3>
      <p className="hint">
        <b>{account.bankName} 끝 {account.last4}</b> 계좌로 1원을 보내 드립니다. 통장 <b>입금자명에 찍힌 코드</b>를 적으시면 인증됩니다.
        인증 전에는 지급되지 않습니다.
      </p>
      {locked ? (
        <p className="form-error" role="alert">
          코드를 다섯 번 틀려 막혔습니다. <b>계좌를 다시 등록</b>하시면 다시 인증할 수 있습니다. 도움이 필요하시면 <Link href="/partners/inquiries">1:1 문의</Link>를 남겨 주십시오.
        </p>
      ) : (
        <>
          <div className="p2act">
            <span className="dim">1단계</span>
            <button type="button" className="btn-sm p2primary" onClick={send} disabled={pending || !identityVerified}>
              {sent ? '1원 다시 받기' : '1원 받기'}
            </button>
            {until && <span className="dim">코드 유효: {until}까지</span>}
          </div>
          {sent && (
            <form className="p2form" onSubmit={confirm}>
              <label className="fld">
                <span>2단계 · 입금자명 코드</span>
                <input name="code" maxLength={20} required autoComplete="one-time-code" placeholder="예: SGB01" />
                <em>대소문자는 가리지 않습니다 · 다섯 번 틀리면 막힙니다</em>
              </label>
              <div className="p2act">
                <button className="btn-sm p2primary" disabled={pending}>{pending ? '확인 중…' : '인증하기'}</button>
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
