'use client';
/**
 * SB-MYP-ACC-020 회원 탈퇴 폼 (v10.48 · D102) — 사유 · 비밀번호 · 확인 체크 → 서버 액션 withdrawAccount(POST /me/withdraw)
 *   막는 항목이 그 사이에 생기면 서버가 409 WITHDRAW_BLOCKED — 화면을 새로 고쳐 다시 보여 줍니다.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Act = { ok: true; note?: string } | { ok: false; code: string; message: string };

export function WithdrawForm({ reasons, action }: {
  reasons: Array<{ code: string; label: string }>;
  action: (password: string, reason: string, memo?: string) => Promise<Act>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password') ?? '');
    const memo = String(fd.get('memo') ?? '').trim();
    const agree = fd.get('agree') === 'on';
    setErr(null);
    if (!reason) { setErr('탈퇴 사유를 골라 주십시오.'); return; }
    if (reason === 'OTHER' && memo.length < 2) { setErr('「기타」를 고르셨으면 사유를 적어 주십시오.'); return; }
    if (!pw) { setErr('본인 확인을 위해 지금 비밀번호를 넣어 주십시오.'); return; }
    if (!agree) { setErr('안내를 읽고 확인란에 표시해 주십시오.'); return; }
    start(async () => {
      const r = await action(pw, reason, memo || undefined);
      if (r.ok) setDone(r.note ?? '탈퇴했습니다.');   /* 로그인 쿠키가 지워져 화면이 다시 그려지면 page 가 끝 안내를 보입니다 */
      else { setErr(r.message); if (r.code === 'WITHDRAW_BLOCKED') router.refresh(); }
    });
  }

  if (done) {
    return (
      <div className="my-nt ok" role="status" data-withdraw-done="">
        <b>{done}</b>
        <div className="my-btns"><Link className="my-bp" href="/">메인으로</Link></div>
      </div>
    );
  }
  return (
    <form className="card p2pad p2form" onSubmit={submit} data-withdraw-form="">
      <label className="fld"><span>탈퇴 사유</span>
        <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">골라 주십시오</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select></label>
      <label className="fld"><span>하고 싶은 말 {reason === 'OTHER' ? '(필수)' : '(선택)'}</span>
        <textarea name="memo" maxLength={500} rows={3} placeholder="개선에 참고하겠습니다. 이름 · 연락처 같은 개인정보는 적지 말아 주십시오." /></label>
      <label className="fld"><span>지금 비밀번호</span><input name="password" type="password" autoComplete="current-password" maxLength={100} /></label>
      <label className="chk"><input type="checkbox" name="agree" />
        <span>위 안내를 읽었고, <b>탈퇴하면 되돌릴 수 없다</b>는 것을 확인했습니다.</span></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="p2act"><button className="btn-sm p2danger" disabled={pending}>{pending ? '처리 중…' : '탈퇴하기'}</button></div>
    </form>
  );
}
